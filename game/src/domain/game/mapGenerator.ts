import {
  axialToWorld,
  getNeighborKeys,
  hexDistance,
  hexKey,
  parseHexKey,
  type AxialCoord,
  type HexKey,
} from '@/domain/hex/hexCoordinates';
import {
  FACTION_PALETTES,
  getRelation,
  getTreeSpawnMultiplier,
  PLAYABLE_FACTIONS,
  STARTING_PROVINCE_MONEY,
} from '@/domain/game/rules';
import {
  DiplomaticRelation,
  EntityType,
  FactionId,
  MapSize,
  ScenarioId,
  type FactionInfo,
  type GameConfig,
  type GameState,
  type HexCell,
} from '@/domain/game/types';
import {reconcileProvinces} from '@/domain/game/gameEngine';
import {createInitialDiplomacy} from '@/domain/game/diplomacyService';

/**
 * Deterministic Mulberry32 PRNG step.
 */
export function nextRandom(state: {prngState: number}): number {
  let t = (state.prngState += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Deterministic 2D Value/Gradient fBM Noise generator seeded by map seed.
 */
class SeededNoise2D {
  private readonly perm: Uint8Array;

  constructor(seed: number) {
    const rng = {prngState: (seed >>> 0) || 1337};
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(nextRandom(rng) * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
    }
  }

  private static fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private static lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) !== 0 ? -u : u) + ((h & 2) !== 0 ? -2.0 * v : 2.0 * v);
  }

  /** Smooth 2D Perlin noise roughly in [-1, 1]. */
  public noise(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = SeededNoise2D.fade(xf);
    const v = SeededNoise2D.fade(yf);

    const aa = this.perm[this.perm[xi] + yi];
    const ab = this.perm[this.perm[xi] + yi + 1];
    const ba = this.perm[this.perm[xi + 1] + yi];
    const bb = this.perm[this.perm[xi + 1] + yi + 1];

    const x1 = SeededNoise2D.lerp(
      this.grad(aa, xf, yf),
      this.grad(ba, xf - 1, yf),
      u,
    );
    const x2 = SeededNoise2D.lerp(
      this.grad(ab, xf, yf - 1),
      this.grad(bb, xf - 1, yf - 1),
      u,
    );
    return SeededNoise2D.lerp(x1, x2, v) * 0.45;
  }

  /** Multi-octave Fractional Brownian Motion in roughly [-1, 1]. */
  public fbm(x: number, y: number, octaves = 4): number {
    let total = 0;
    let amplitude = 0.52;
    let frequency = 1;
    let maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * frequency, y * frequency) * amplitude;
      maxAmp += amplitude;
      amplitude *= 0.5;
      frequency *= 2.03;
    }
    return total / maxAmp;
  }
}

interface MapBoundsSpec {
  readonly halfWidthWorld: number;
  readonly halfHeightWorld: number;
  readonly targetHexes: number;
  readonly lobeCount: number;
  readonly fjordCount: number;
  readonly fjordLength: number;
  readonly pocketCarves: number;
}

function getBoundsSpecForSize(size: MapSize): MapBoundsSpec {
  switch (size) {
    case MapSize.SMALL:
      return {
        halfWidthWorld: 19,
        halfHeightWorld: 16,
        targetHexes: 165,
        lobeCount: 5,
        fjordCount: 4,
        fjordLength: 5,
        pocketCarves: 14,
      };
    case MapSize.MEDIUM:
      return {
        halfWidthWorld: 26,
        halfHeightWorld: 22,
        targetHexes: 310,
        lobeCount: 7,
        fjordCount: 6,
        fjordLength: 7,
        pocketCarves: 28,
      };
    case MapSize.LARGE:
      return {
        halfWidthWorld: 34,
        halfHeightWorld: 28,
        targetHexes: 510,
        lobeCount: 9,
        fjordCount: 8,
        fjordLength: 9,
        pocketCarves: 46,
      };
    case MapSize.GIANT:
      return {
        halfWidthWorld: 43,
        halfHeightWorld: 35,
        targetHexes: 780,
        lobeCount: 12,
        fjordCount: 11,
        fjordLength: 12,
        pocketCarves: 72,
      };
  }
}

function findLargestConnectedComponent(landSet: Set<HexKey>): HexKey[] {
  const visited = new Set<HexKey>();
  let largest: HexKey[] = [];
  for (const key of landSet) {
    if (visited.has(key)) continue;
    const queue: HexKey[] = [key];
    const comp: HexKey[] = [];
    visited.add(key);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      comp.push(curr);
      for (const nk of getNeighborKeys(curr)) {
        if (landSet.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          queue.push(nk);
        }
      }
    }
    if (comp.length > largest.length) {
      largest = comp;
    }
  }
  return largest;
}

/**
 * Generates classic Antiyoy-style asymmetric, branching, heavily indented landmasses
 * filled with crisp 1..4 hex interior water pockets, narrow fjords, peninsulas,
 * and tactical bottlenecks driven deterministically by the map seed.
 */
function generateLandCoords(
  config: GameConfig,
  rng: {prngState: number},
): AxialCoord[] {
  const spec = getBoundsSpecForSize(config.mapSize);
  const noise = new SeededNoise2D(config.seed || 1337);

  // Build an asymmetric branching skeleton of overlapping lobes (never round!)
  interface MacroLobe {
    x: number;
    z: number;
    rx: number;
    rz: number;
    cosA: number;
    sinA: number;
    weight: number;
  }

  const maxW = spec.halfWidthWorld;
  const maxH = spec.halfHeightWorld;
  const lobes: MacroLobe[] = [];

  // Primary random wandering spine across the bounding box (diagonal, vertical, L-shaped, etc.)
  const spineAngle = nextRandom(rng) * Math.PI * 2;
  let curX = -Math.cos(spineAngle) * maxW * 0.48;
  let curZ = -Math.sin(spineAngle) * maxH * 0.48;
  let heading = spineAngle + (nextRandom(rng) - 0.5) * 0.5;
  const stepDist = (Math.hypot(maxW, maxH) * 0.85) / Math.max(3, spec.lobeCount - 1);

  for (let i = 0; i < spec.lobeCount; i++) {
    const a = nextRandom(rng) * Math.PI;
    const rx = maxW * (0.2 + nextRandom(rng) * 0.16);
    const rz = maxH * (0.18 + nextRandom(rng) * 0.16);
    lobes.push({
      x: curX,
      z: curZ,
      rx,
      rz,
      cosA: Math.cos(a),
      sinA: Math.sin(a),
      weight: 0.88 + nextRandom(rng) * 0.35,
    });

    // Occasional side branch peninsula
    if (i > 0 && i < spec.lobeCount - 1 && nextRandom(rng) < 0.55) {
      const branchDir = heading + (nextRandom(rng) < 0.5 ? 1 : -1) * (0.85 + nextRandom(rng) * 0.6);
      const branchLen = stepDist * (0.95 + nextRandom(rng) * 0.75);
      const bx = Math.max(-maxW * 0.72, Math.min(maxW * 0.72, curX + Math.cos(branchDir) * branchLen));
      const bz = Math.max(-maxH * 0.72, Math.min(maxH * 0.72, curZ + Math.sin(branchDir) * branchLen));
      const ba = nextRandom(rng) * Math.PI;
      lobes.push({
        x: bx,
        z: bz,
        rx: rx * (0.72 + nextRandom(rng) * 0.35),
        rz: rz * (0.72 + nextRandom(rng) * 0.35),
        cosA: Math.cos(ba),
        sinA: Math.sin(ba),
        weight: 0.82 + nextRandom(rng) * 0.3,
      });
    }

    heading += (nextRandom(rng) - 0.5) * 1.15;
    curX = Math.max(-maxW * 0.72, Math.min(maxW * 0.72, curX + Math.cos(heading) * stepDist));
    curZ = Math.max(-maxH * 0.72, Math.min(maxH * 0.72, curZ + Math.sin(heading) * stepDist));
  }

  const offX1 = nextRandom(rng) * 90 - 45;
  const offZ1 = nextRandom(rng) * 90 - 45;
  const offX2 = nextRandom(rng) * 90 - 45;
  const offZ2 = nextRandom(rng) * 90 - 45;
  const offX3 = nextRandom(rng) * 90 - 45;
  const offZ3 = nextRandom(rng) * 90 - 45;
  const offP1 = nextRandom(rng) * 90 - 45;
  const offP2 = nextRandom(rng) * 90 - 45;

  const maxGridBound = Math.ceil(Math.max(maxW, maxH) / 1.35) + 4;
  const warpAmp = Math.max(3.6, maxW * 0.19);
  const scored: Array<{coord: AxialCoord; score: number}> = [];

  for (let q = -maxGridBound; q <= maxGridBound; q++) {
    for (let r = -maxGridBound; r <= maxGridBound; r++) {
      const world = axialToWorld(q, r);
      if (Math.abs(world.x) > maxW || Math.abs(world.z) > maxH) continue;

      // Domain warp for organic jagged coasts & curved peninsulas
      const wx =
        world.x +
        noise.fbm(world.x * 0.065 + offX1, world.z * 0.065 + offZ1, 3) * warpAmp;
      const wz =
        world.z +
        noise.fbm(world.x * 0.065 + offX2, world.z * 0.065 + offZ2, 3) * warpAmp;

      // Smooth-max metaball union over the wandering asymmetric lobes
      let lobeField = 0;
      for (let i = 0; i < lobes.length; i++) {
        const l = lobes[i];
        const dx = wx - l.x;
        const dz = wz - l.z;
        const lx = (dx * l.cosA - dz * l.sinA) / l.rx;
        const lz = (dx * l.sinA + dz * l.cosA) / l.rz;
        const d2 = lx * lx + lz * lz;
        const influence = Math.exp(-d2 * 1.15) * l.weight;
        if (influence > lobeField) {
          lobeField = influence;
        }
      }

      const macroNoise = noise.fbm(wx * 0.085 + offX3, wz * 0.085 + offZ3, 4);
      // High-frequency swiss-cheese porosity noise creates small 1..4 hex interior lakes & jagged coves
      const poreNoise = noise.fbm(world.x * 0.27 + offP1, world.z * 0.27 + offP2, 3);
      const microJagged = noise.noise(world.x * 0.52 - offP2, world.z * 0.52 + offP1);

      let score =
        lobeField * 1.35 +
        macroNoise * 0.55 +
        microJagged * 0.18;

      // Carve strong crisp interior water holes directly from high-frequency noise troughs
      if (poreNoise < -0.14) {
        score -= (Math.abs(poreNoise + 0.14) * 2.6 + 0.45);
      }

      if (config.scenario === ScenarioId.ARCHIPELAGO) {
        score -= Math.abs(noise.fbm(wx * 0.12 - offX1, wz * 0.12 + offZ2, 3)) * 0.65;
      } else if (config.scenario === ScenarioId.TWIN_CONTINENTS) {
        const nx = world.x / maxW;
        const nz = world.z / maxH;
        const straitPos =
          nx + noise.fbm(world.x * 0.07 + offX2, world.z * 0.07, 2) * 0.36;
        const straitCut = Math.exp(-(straitPos * straitPos) / 0.032) * 0.95;
        const bridges =
          Math.abs(nz - 0.38) < 0.11 || Math.abs(nz + 0.38) < 0.11 ? 0.65 : 0;
        score += bridges - straitCut;
      } else if (config.scenario === ScenarioId.CITADEL_RING) {
        const nx = world.x / maxW;
        const nz = world.z / maxH;
        const warpedR = Math.hypot(nx * 1.15, nz * 1.15) + macroNoise * 0.25;
        const trough = Math.exp(-Math.pow(warpedR - 0.45, 2) / 0.022) * 0.95;
        const angle = Math.atan2(nz, nx);
        const spokes = Math.pow(Math.abs(Math.cos(angle * 1.5)), 9) * 0.68;
        score += spokes - trough;
      }

      scored.push({coord: {q, r}, score});
    }
  }

  // Select slightly more than targetHexes before carving pockets & fjords
  scored.sort((a, b) => b.score - a.score);
  const initialTake = Math.min(
    scored.length,
    Math.round(spec.targetHexes * 1.24),
  );
  const landSet = new Set<HexKey>();
  for (let i = 0; i < initialTake; i++) {
    const c = scored[i].coord;
    landSet.add(hexKey(c.q, c.r));
  }

  // Keep only the main connected landmass before carving pockets
  const initialMain = findLargestConnectedComponent(landSet);
  landSet.clear();
  for (const k of initialMain) landSet.add(k);

  // Carve classic Antiyoy swiss-cheese interior pockets (1..4 hex ponds/lakes) & winding coastal fjords
  if (landSet.size > 55) {
    const carved = new Set<HexKey>(landSet);

    // 1. Interior 1..4 hex ponds & jagged lakes scattered across dense regions
    for (let p = 0; p < spec.pocketCarves; p++) {
      const dense = [...carved].filter((k) => {
        let nCount = 0;
        for (const nk of getNeighborKeys(k)) {
          if (carved.has(nk)) nCount++;
        }
        return nCount >= 5;
      });
      if (dense.length === 0) break;

      const seedKey = dense[Math.floor(nextRandom(rng) * dense.length)];
      const pocketSize = 1 + Math.floor(nextRandom(rng) * 3); // 1..3 hex crisp cavities
      const removed: HexKey[] = [seedKey];
      carved.delete(seedKey);

      let cursor = seedKey;
      for (let s = 1; s < pocketSize; s++) {
        const candidates = getNeighborKeys(cursor).filter((nk) => {
          if (!carved.has(nk)) return false;
          let ln = 0;
          for (const nnk of getNeighborKeys(nk)) {
            if (carved.has(nnk)) ln++;
          }
          return ln >= 4;
        });
        if (candidates.length === 0) break;
        const pick = candidates[Math.floor(nextRandom(rng) * candidates.length)];
        carved.delete(pick);
        removed.push(pick);
        cursor = pick;
      }

      // Preserve connectivity: if this pocket severed a major chunk, revert it
      const mainAfter = findLargestConnectedComponent(carved);
      if (mainAfter.length < carved.size - 3) {
        for (const rk of removed) carved.add(rk);
      }
    }

    // 2. Narrow jagged coastal fjords & winding rivers biting deep inland
    for (let f = 0; f < spec.fjordCount; f++) {
      const coast = [...carved].filter((k) => {
        let nCount = 0;
        for (const nk of getNeighborKeys(k)) {
          if (carved.has(nk)) nCount++;
        }
        return nCount >= 2 && nCount <= 4;
      });
      if (coast.length === 0) break;

      let cursor = coast[Math.floor(nextRandom(rng) * coast.length)];
      const path: HexKey[] = [cursor];
      const used = new Set<HexKey>([cursor]);

      for (let step = 0; step < spec.fjordLength; step++) {
        const nexts = getNeighborKeys(cursor).filter((nk) => {
          if (!carved.has(nk) || used.has(nk)) return false;
          let touchesPath = 0;
          let landDeg = 0;
          for (const nnk of getNeighborKeys(nk)) {
            if (used.has(nnk)) touchesPath++;
            if (carved.has(nnk)) landDeg++;
          }
          return touchesPath <= 1 && landDeg >= 3;
        });
        if (nexts.length === 0) break;
        const pick = nexts[Math.floor(nextRandom(rng) * nexts.length)];
        path.push(pick);
        used.add(pick);
        cursor = pick;
      }

      for (const rk of path) carved.delete(rk);
      const mainAfter = findLargestConnectedComponent(carved);
      if (mainAfter.length < Math.floor(landSet.size * 0.72)) {
        for (const rk of path) carved.add(rk);
      }
    }

    const bestComp = findLargestConnectedComponent(carved);
    if (bestComp.length >= Math.floor(spec.targetHexes * 0.65)) {
      landSet.clear();
      for (const k of bestComp) landSet.add(k);
    }
  }

  const largestComponent = findLargestConnectedComponent(landSet);
  const coords = largestComponent.map(parseHexKey);

  // Recenter coordinates around (0, 0) so the irregular landmass sits centered on screen
  if (coords.length > 0) {
    let sumQ = 0;
    let sumR = 0;
    for (const c of coords) {
      sumQ += c.q;
      sumR += c.r;
    }
    const shiftQ = Math.round(sumQ / coords.length);
    const shiftR = Math.round(sumR / coords.length);
    if (shiftQ !== 0 || shiftR !== 0) {
      return coords.map((c) => ({q: c.q - shiftQ, r: c.r - shiftR}));
    }
  }

  return coords;
}

export interface CustomPlayerSlot {
  readonly factionId: FactionId;
  readonly nickname: string;
}

/**
 * Generates a balanced Antiyoy GameState honoring TreeSpawnRate, Diplomacy, and Fog of War.
 * Internal rivers and lakes are always enabled.
 */
export function createInitialGameState(
  config: GameConfig,
  customPlayers?: readonly CustomPlayerSlot[],
): GameState {
  const normalizedConfig: GameConfig = {
    ...config,
    riversAndLakes: true,
    seed: config.seed || 1337,
  };
  const rng = {prngState: normalizedConfig.seed};
  const coords = generateLandCoords(normalizedConfig, rng);
  const cells: Record<HexKey, HexCell> = {};

  for (const coord of coords) {
    const key = hexKey(coord.q, coord.r);
    cells[key] = {
      key,
      q: coord.q,
      r: coord.r,
      faction: FactionId.NEUTRAL,
      entity: EntityType.NONE,
      unitMoved: false,
      provinceId: null,
      elevation: 0.04 + nextRandom(rng) * 0.06,
      isCoastal: false,
    };
  }

  for (const cell of Object.values(cells)) {
    const neighborCount = getNeighborKeys(cell.key).filter((nKey) =>
      Boolean(cells[nKey]),
    ).length;
    cell.isCoastal = neighborCount < 6;
  }

  const clampedFactions = Math.max(
    2,
    Math.min(PLAYABLE_FACTIONS.length, normalizedConfig.factionCount),
  );

  const customSlotByFaction = new Map<FactionId, CustomPlayerSlot>();
  let turnOrder: FactionId[];

  if (customPlayers && customPlayers.length > 0) {
    const chosen: FactionId[] = [];
    for (const slot of customPlayers) {
      if (
        PLAYABLE_FACTIONS.includes(slot.factionId) &&
        !customSlotByFaction.has(slot.factionId) &&
        chosen.length < clampedFactions
      ) {
        customSlotByFaction.set(slot.factionId, slot);
        chosen.push(slot.factionId);
      }
    }
    const remaining = PLAYABLE_FACTIONS.filter((f) => !chosen.includes(f));
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(nextRandom(rng) * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    turnOrder = [...chosen, ...remaining].slice(0, clampedFactions);
  } else {
    const shuffled = [...PLAYABLE_FACTIONS];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(nextRandom(rng) * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    turnOrder = shuffled.slice(0, clampedFactions);
  }

  const allKeys = Object.keys(cells);
  const capitalKeys: HexKey[] = [];

  if (allKeys.length > 0) {
    // Pick a well-connected inland/coastal hex for the first faction
    const wellConnected = allKeys.filter(
      (k) => getNeighborKeys(k).filter((nk) => Boolean(cells[nk])).length >= 4,
    );
    const startPool = wellConnected.length > 0 ? wellConnected : allKeys;
    const firstIdx = Math.floor(nextRandom(rng) * startPool.length);
    capitalKeys.push(startPool[firstIdx]);

    for (let f = 1; f < turnOrder.length; f++) {
      let bestKey = allKeys[0];
      let bestScore = -Infinity;
      for (const candidateKey of allKeys) {
        if (capitalKeys.includes(candidateKey)) continue;
        const candCoord = cells[candidateKey];
        let minDist = Infinity;
        for (const chosenKey of capitalKeys) {
          const d = hexDistance(candCoord, cells[chosenKey]);
          if (d < minDist) minDist = d;
        }
        const landNeighbors = getNeighborKeys(candidateKey).filter((nk) =>
          Boolean(cells[nk]),
        ).length;
        const score = minDist + (landNeighbors >= 4 ? 0.8 : -1.5);
        if (score > bestScore) {
          bestScore = score;
          bestKey = candidateKey;
        }
      }
      capitalKeys.push(bestKey);
    }
  }

  for (let i = 0; i < turnOrder.length; i++) {
    const faction = turnOrder[i];
    const capKey = capitalKeys[i];
    if (!capKey || !cells[capKey]) continue;

    cells[capKey].faction = faction;
    cells[capKey].entity = EntityType.TOWN;

    const neighbors = getNeighborKeys(capKey).filter(
      (nk) => cells[nk] && cells[nk].faction === FactionId.NEUTRAL,
    );
    for (let j = neighbors.length - 1; j > 0; j--) {
      const k = Math.floor(nextRandom(rng) * (j + 1));
      [neighbors[j], neighbors[k]] = [neighbors[k], neighbors[j]];
    }
    const startExtra = Math.min(3, neighbors.length);
    for (let j = 0; j < startExtra; j++) {
      const nCell = cells[neighbors[j]];
      nCell.faction = faction;
      nCell.entity = EntityType.NONE;
    }
  }

  // Seed trees according to configured TreeSpawnRate
  const treeMult = getTreeSpawnMultiplier(normalizedConfig.treeSpawnRate);
  if (treeMult > 0) {
    const palmProb = Math.min(0.42, 0.13 * treeMult);
    const pineProb = Math.min(0.45, 0.15 * treeMult);
    for (const cell of Object.values(cells)) {
      if (cell.faction !== FactionId.NEUTRAL) continue;
      const roll = nextRandom(rng);
      if (cell.isCoastal && roll < palmProb) {
        cell.entity = EntityType.PALM;
      } else if (!cell.isCoastal && roll < pineProb) {
        cell.entity = EntityType.PINE;
      }
    }
  }

  const factions: Record<number, FactionInfo> = {};
  for (let i = 0; i < turnOrder.length; i++) {
    const fId = turnOrder[i];
    const customSlot = customSlotByFaction.get(fId);
    factions[fId] = {
      id: fId,
      name: customSlot?.nickname.trim() || FACTION_PALETTES[fId].name,
      isHuman:
        customPlayers && customPlayers.length > 0
          ? Boolean(customSlot)
          : i < normalizedConfig.humanCount,
      isEliminated: false,
      hexCount: 0,
      totalMoney: 0,
      totalNetIncome: 0,
    };
  }

  const incomeHistory: Record<number, number[]> = {};
  for (const fId of turnOrder) {
    incomeHistory[fId] = [];
  }

  const state: GameState = {
    config: {...normalizedConfig, factionCount: clampedFactions},
    turn: 1,
    activeFactionIndex: 0,
    turnOrder,
    factions,
    cells,
    provinces: {},
    diplomacy: createInitialDiplomacy(
      turnOrder,
      normalizedConfig.diplomacyEnabled,
    ),
    incomeHistory,
    flares: [],
    nextFlareId: 1,
    regenerators: [],
    nextRegeneratorId: 1,
    tradingPosts: [],
    nextTradingPostId: 1,
    winner: null,
    victoryReason: null,
    stats: {
      turnsPlayed: 1,
      hexesCaptured: 0,
      unitsRecruited: 0,
      farmsBuilt: 0,
      treesChopped: 0,
      catapultShots: 0,
      buildingsDemolished: 0,
    },
    nextEventId: 1,
    prngState: rng.prngState,
  };

  reconcileProvinces(state, STARTING_PROVINCE_MONEY);
  recalculateFactionSummaries(state);
  for (const fId of turnOrder) {
    state.incomeHistory[fId] = [state.factions[fId].totalNetIncome];
  }
  return state;
}

export function recalculateFactionSummaries(state: GameState): void {
  for (const fId of state.turnOrder) {
    const info = state.factions[fId];
    info.hexCount = 0;
    info.totalMoney = 0;
    info.totalNetIncome = 0;
  }

  for (const cell of Object.values(state.cells)) {
    if (cell.faction !== FactionId.NEUTRAL && state.factions[cell.faction]) {
      state.factions[cell.faction].hexCount++;
    }
  }

  for (const province of Object.values(state.provinces)) {
    const info = state.factions[province.faction];
    if (info) {
      info.totalMoney += province.money;
      info.totalNetIncome += province.netIncome;
    }
  }

  const aliveFactions: FactionId[] = [];
  for (const fId of state.turnOrder) {
    const info = state.factions[fId];
    const hasProvince = Object.values(state.provinces).some(
      (p) => p.faction === fId,
    );
    info.isEliminated = !hasProvince;
    if (!info.isEliminated) {
      aliveFactions.push(fId);
    }
  }

  if (aliveFactions.length === 1) {
    state.winner = aliveFactions[0];
    state.victoryReason = 'DOMINATION';
    return;
  }

  // Diplomatic victory: if ALL other surviving factions are FRIEND with a faction, that faction wins!
  if (state.config.diplomacyEnabled && aliveFactions.length >= 2) {
    const activeFaction = state.turnOrder[state.activeFactionIndex];
    const orderedCandidates =
      activeFaction !== undefined && aliveFactions.includes(activeFaction)
        ? [activeFaction, ...aliveFactions.filter((f) => f !== activeFaction)]
        : aliveFactions;

    for (const candidate of orderedCandidates) {
      const allFriends = aliveFactions.every(
        (other) =>
          other === candidate ||
          getRelation(state, candidate, other) === DiplomaticRelation.FRIEND,
      );
      if (allFriends) {
        state.winner = candidate;
        state.victoryReason = 'DIPLOMACY';
        return;
      }
    }
  }

  state.winner = null;
  state.victoryReason = null;
}
