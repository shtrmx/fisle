import {
  getNeighborKeys,
  hexDistance,
  parseHexKey,
  type HexKey,
} from '@/domain/hex/hexCoordinates';
import {
  computeBuildableHexes,
  computeCatapultTargets,
  computeDemolishableHexes,
  computeReachableHexes,
  computeRegeneratorHexes,
  executeBuyAndPlace,
  executeCatapultFire,
  executeDemolishBuilding,
  executeLaunchFlare,
  executePlaceRegenerator,
  executeUnitMove,
  getActiveFaction,
} from '@/domain/game/gameEngine';
import {
  CATAPULT_MIN_RANGE,
  CATAPULT_RANGE,
  ENTITY_META,
  FARM_INCOME,
  FLARE_COST,
  FLARE_RADIUS,
  REGENERATOR_COST,
  REGENERATOR_FARM_BONUS,
  REGENERATOR_RADIUS,
  REGENERATOR_UPKEEP,
  TRADING_POST_BASE_INCOME,
  TRADING_POST_FARM_SYNERGY,
  canAttackFaction,
  computeVisibleHexes,
  countTradingPostAdjacentFarms,
  findBestTradingPostFootprint,
  getEffectiveUnitStrength,
  getEntityUpkeep,
  getHexProtection,
  getMergedUnitType,
  getProvincePurchaseCost,
  getTradingPostClusterAt,
  getUnitStrength,
  isCatapult,
  isHexInRegeneratorRadius,
  isInfantryUnit,
  isTree,
  isUnit,
} from '@/domain/game/rules';
import {
  AiDifficulty,
  EntityType,
  FactionId,
  type GameEvent,
  type GameState,
  type Province,
  type PurchasableEntity,
} from '@/domain/game/types';
import {evaluateWorldPower, type WorldPowerAssessment} from '@/domain/ai/aiStrategy';

export interface AiActionStep {
  events: GameEvent[];
  performed: boolean;
}

const BUYABLE_INFANTRY: readonly PurchasableEntity[] = [
  EntityType.PEASANT,
  EntityType.SPEARMAN,
  EntityType.BARON,
  EntityType.KNIGHT,
];

function isHostileBorderHex(
  state: GameState,
  key: HexKey,
  faction: FactionId,
): boolean {
  return getNeighborKeys(key).some((nk) => {
    const n = state.cells[nk];
    return (
      n &&
      n.faction !== FactionId.NEUTRAL &&
      canAttackFaction(state, faction, n.faction)
    );
  });
}

function isNeutralBorderHex(
  state: GameState,
  key: HexKey,
  faction: FactionId,
): boolean {
  return getNeighborKeys(key).some((nk) => {
    const n = state.cells[nk];
    return n && n.faction === FactionId.NEUTRAL && n.faction !== faction;
  });
}

function countHostileNeighbors(
  state: GameState,
  key: HexKey,
  faction: FactionId,
): number {
  let count = 0;
  for (const nk of getNeighborKeys(key)) {
    const n = state.cells[nk];
    if (
      n &&
      n.faction !== FactionId.NEUTRAL &&
      canAttackFaction(state, faction, n.faction)
    ) {
      count++;
    }
  }
  return count;
}

function isSpreadingTree(state: GameState, key: HexKey): boolean {
  const cell = state.cells[key];
  if (!cell) return false;
  if (cell.entity === EntityType.PALM) {
    // Palms spread every turn onto coastal tiles!
    return true;
  }
  if (cell.entity === EntityType.PINE) {
    // Pines spread when 2+ pines are adjacent
    return getNeighborKeys(key).some(
      (nk) => state.cells[nk]?.entity === EntityType.PINE,
    );
  }
  return false;
}

/**
 * Counts how many distinct friendly provinces border `targetKey`.
 * Capturing a hex touching >= 2 friendly provinces merges them into one stronger treasury!
 */
function countAdjacentFriendlyProvinces(
  state: GameState,
  targetKey: HexKey,
  faction: FactionId,
): number {
  const provIds = new Set<string>();
  for (const nk of getNeighborKeys(targetKey)) {
    const n = state.cells[nk];
    if (n && n.faction === faction && n.provinceId) {
      provIds.add(n.provinceId);
    }
  }
  return provIds.size;
}

function countAdjacentFriendlyTradingPosts(
  state: GameState,
  key: HexKey,
  faction: FactionId,
): number {
  const clusterIds = new Set<number>();
  for (const nk of getNeighborKeys(key)) {
    const n = state.cells[nk];
    if (!n || n.faction !== faction || n.entity !== EntityType.TRADING_POST) {
      continue;
    }
    const cluster = getTradingPostClusterAt(state, nk);
    if (cluster) {
      clusterIds.add(cluster.id);
    }
  }
  return clusterIds.size;
}

function countAdjacentFriendlyFarms(
  state: GameState,
  key: HexKey,
  faction: FactionId,
): number {
  let count = 0;
  for (const nk of getNeighborKeys(key)) {
    const n = state.cells[nk];
    if (n && n.faction === faction && n.entity === EntityType.FARM) {
      count++;
    }
  }
  return count;
}

/**
 * Detects whether capturing an enemy hex is likely to split/cut their province
 * (e.g., two non-adjacent enemy neighbors around it, or touching their Town/Farms/Trading Posts).
 */
function computeProvinceSplitBonus(
  state: GameState,
  targetKey: HexKey,
  enemyFaction: FactionId,
): number {
  const neighbors = getNeighborKeys(targetKey);
  const enemyFlags: boolean[] = [];
  let touchesTown = false;
  let touchesFarm = false;
  let touchesTradingPost = false;

  for (const nk of neighbors) {
    const n = state.cells[nk];
    const isEnemy = Boolean(n && n.faction === enemyFaction);
    enemyFlags.push(isEnemy);
    if (isEnemy && n) {
      if (n.entity === EntityType.TOWN) touchesTown = true;
      if (n.entity === EntityType.FARM) touchesFarm = true;
      if (n.entity === EntityType.TRADING_POST) touchesTradingPost = true;
    }
  }

  // Count disconnected arcs of enemy neighbors around the hex (2+ arcs = pinch/cut point!)
  let transitions = 0;
  for (let i = 0; i < enemyFlags.length; i++) {
    if (enemyFlags[i] && !enemyFlags[(i + 1) % enemyFlags.length]) {
      transitions++;
    }
  }

  let bonus = 0;
  if (transitions >= 2) bonus += 20;
  if (touchesTown) bonus += 14;
  if (touchesTradingPost) bonus += 16;
  if (touchesFarm) bonus += 8;
  return bonus;
}

/**
 * Computes BFS distance from every hex in `province` to the nearest hostile or
 * neutral expansion frontier. Prevents interior units from idling forever.
 */
function computeFrontDistanceMap(
  state: GameState,
  province: Province,
  faction: FactionId,
): Map<HexKey, number> {
  const dist = new Map<HexKey, number>();
  const queue: HexKey[] = [];

  for (const key of province.hexKeys) {
    if (isHostileBorderHex(state, key, faction)) {
      dist.set(key, 0);
      queue.push(key);
    }
  }
  // If no hostile front, march toward neutral land
  if (queue.length === 0) {
    for (const key of province.hexKeys) {
      if (isNeutralBorderHex(state, key, faction)) {
        dist.set(key, 0);
        queue.push(key);
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const d = dist.get(curr)!;
    for (const nk of getNeighborKeys(curr)) {
      const n = state.cells[nk];
      if (!n || n.provinceId !== province.id || dist.has(nk)) continue;
      dist.set(nk, d + 1);
      queue.push(nk);
    }
  }
  return dist;
}

/**
 * Checks whether the province's Town is currently threatened by an adjacent hostile hex.
 */
function isTownThreatened(
  state: GameState,
  province: Province,
  faction: FactionId,
): boolean {
  return isHostileBorderHex(state, province.townKey, faction);
}

function scoreTargetHex(
  state: GameState,
  faction: FactionId,
  targetKey: HexKey,
  difficulty: AiDifficulty,
  world: WorldPowerAssessment,
  provinceMoneyTight: boolean,
): number {
  const cell = state.cells[targetKey];
  if (!cell) return -999;

  let score = 0;
  if (cell.faction !== faction) {
    // Connecting two of our own separate provinces is a massive strategic win
    const adjOwnProvs = countAdjacentFriendlyProvinces(state, targetKey, faction);
    if (adjOwnProvs >= 2 && difficulty !== AiDifficulty.EASY) {
      score += 36;
    }

    if (cell.faction === FactionId.NEUTRAL) {
      score += state.turn <= 4 ? 22 : 18;
      if (isTree(cell.entity)) score += provinceMoneyTight ? 7 : 4;
      // Prefer neutral hexes bordering more of our own hexes (compact territory, easy to defend)
      const ownNeighbors = getNeighborKeys(targetKey).filter(
        (nk) => state.cells[nk]?.faction === faction,
      ).length;
      score += ownNeighbors * 2;
    } else {
      const enemyProfile = world.profiles[cell.faction];
      score += 35;
      if (cell.entity === EntityType.TOWN) score += 48;
      if (cell.entity === EntityType.TRADING_POST) score += 52;
      if (cell.entity === EntityType.CATAPULT) score += 42;
      if (cell.entity === EntityType.FARM) score += 32;
      if (cell.entity === EntityType.STRONG_TOWER) score += 30;
      if (cell.entity === EntityType.TOWER) score += 24;
      if (cell.entity === EntityType.BEACON) score += 16;
      if (isInfantryUnit(cell.entity)) {
        score += 20 + getUnitStrength(cell.entity) * 4;
      }

      // Prioritize striking the world Hegemon or Diplomatic Frontrunner!
      if (
        difficulty !== AiDifficulty.EASY &&
        (world.hegemonFaction === cell.faction ||
          world.diplomaticFrontrunner === cell.faction ||
          enemyProfile?.isDiplomaticThreat)
      ) {
        score += 11;
      }

      // Bonus for killing enemy threats adjacent to our Town
      const threatensOurTown = getNeighborKeys(targetKey).some((nk) => {
        const n = state.cells[nk];
        return n && n.faction === faction && n.entity === EntityType.TOWN;
      });
      if (threatensOurTown) {
        score += 28;
      }

      if (difficulty !== AiDifficulty.EASY) {
        const enemyNeighbors = getNeighborKeys(targetKey).filter((nk) => {
          const n = state.cells[nk];
          return n && n.faction === cell.faction;
        }).length;
        score += enemyNeighbors * 3;
        score += computeProvinceSplitBonus(state, targetKey, cell.faction);
      }
    }
  } else {
    if (isTree(cell.entity)) {
      // Actively stop tree plagues (palms & pine clusters) + gain +3 instant gold!
      const spreading = isSpreadingTree(state, targetKey);
      score += spreading ? 25 : 16;
      if (provinceMoneyTight) score += 8;
    } else if (cell.entity === EntityType.GRAVE) {
      // Clear graves before they sprout trees next turn
      score += 12;
    } else {
      score -= 8;
    }
  }

  return score;
}

function canSustainUpkeep(
  province: Province,
  additionalUpkeep: number,
  difficulty: AiDifficulty,
): boolean {
  const projectedNext = province.money + province.netIncome - additionalUpkeep;
  if (projectedNext < 0) return false;
  const buffer = difficulty === AiDifficulty.HARD ? -1 : 0;
  return province.netIncome - additionalUpkeep >= buffer;
}

function hasHighDefenseThreatNearProvince(
  state: GameState,
  province: Province,
  faction: FactionId,
  minProtection: number,
): boolean {
  for (const key of province.hexKeys) {
    for (const nk of getNeighborKeys(key)) {
      const n = state.cells[nk];
      if (!n || n.faction === faction || !canAttackFaction(state, faction, n.faction)) {
        continue;
      }
      if (getHexProtection(state, nk) >= minProtection) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Counts how many hostile-at-war destructible targets lie within Catapult range [2..3] of `key`.
 */
function countCatapultTargetsFromHex(
  state: GameState,
  key: HexKey,
  faction: FactionId,
  visible: Set<HexKey> | null,
): number {
  const origin = parseHexKey(key);
  let count = 0;
  for (const cell of Object.values(state.cells)) {
    if (
      cell.faction === faction ||
      cell.faction === FactionId.NEUTRAL ||
      !canAttackFaction(state, faction, cell.faction)
    ) {
      continue;
    }
    if (cell.entity === EntityType.NONE || cell.entity === EntityType.GRAVE) {
      continue;
    }
    if (visible && !visible.has(cell.key)) continue;
    const d = hexDistance(origin, cell);
    if (d >= CATAPULT_MIN_RANGE && d <= CATAPULT_RANGE) {
      count++;
    }
  }
  return count;
}

/**
 * Minimum hex distance from `key` to any hostile-at-war cell.
 */
function minDistanceToHostile(
  state: GameState,
  key: HexKey,
  faction: FactionId,
): number {
  const origin = parseHexKey(key);
  let best = 999;
  for (const cell of Object.values(state.cells)) {
    if (
      cell.faction === faction ||
      cell.faction === FactionId.NEUTRAL ||
      !canAttackFaction(state, faction, cell.faction)
    ) {
      continue;
    }
    const d = hexDistance(origin, cell);
    if (d < best) best = d;
  }
  return best;
}

function pickBestRegeneratorHex(
  state: GameState,
  province: Province,
  faction: FactionId,
): {key: HexKey; farmCount: number; unitCount: number; score: number} | null {
  const candidates = computeRegeneratorHexes(state, province.id);
  if (candidates.size === 0) return null;

  let best: {
    key: HexKey;
    farmCount: number;
    unitCount: number;
    score: number;
  } | null = null;
  for (const key of candidates) {
    if (isHexInRegeneratorRadius(state, faction, key)) continue;
    const center = parseHexKey(key);
    let farmCount = 0;
    let unitCount = 0;
    let frontlineCount = 0;

    for (const pk of province.hexKeys) {
      if (hexDistance(center, parseHexKey(pk)) > REGENERATOR_RADIUS) continue;
      const c = state.cells[pk];
      if (!c) continue;
      if (c.entity === EntityType.FARM) farmCount++;
      if (isInfantryUnit(c.entity)) unitCount++;
      if (isHostileBorderHex(state, pk, faction)) frontlineCount++;
    }

    // Prefer placing the Regenerator itself on a safe interior hex
    const safeBonus = isHostileBorderHex(state, key, faction) ? -6 : 5;
    const score = farmCount * 16 + unitCount * 10 + frontlineCount * 4 + safeBonus;
    if (score > 0 && (!best || score > best.score)) {
      best = {key, farmCount, unitCount, score};
    }
  }
  return best;
}

/**
 * Picks a fogged hex whose FLARE_RADIUS illuminates the most unexplored frontier tiles.
 * On HARD difficulty, also biases toward active war directions; on EASY/BALANCED,
 * uses only visible-frontier geometry without peeking through Fog of War.
 */
function pickBestFlareTarget(
  state: GameState,
  faction: FactionId,
  visible: Set<HexKey>,
  difficulty: AiDifficulty,
): HexKey | null {
  const frontierFogged: HexKey[] = [];
  for (const cell of Object.values(state.cells)) {
    if (visible.has(cell.key)) continue;
    if (getNeighborKeys(cell.key).some((nk) => visible.has(nk))) {
      frontierFogged.push(cell.key);
    }
  }
  if (frontierFogged.length === 0) return null;

  const allFoggedCoords = Object.values(state.cells)
    .filter((c) => !visible.has(c.key))
    .map((c) => ({key: c.key, q: c.q, r: c.r, faction: c.faction}));

  let bestKey: HexKey | null = null;
  let bestScore = 0;

  for (const candidateKey of frontierFogged) {
    const center = parseHexKey(candidateKey);
    let revealedFog = 0;
    let enemyHint = 0;
    for (const f of allFoggedCoords) {
      if (hexDistance(center, f) <= FLARE_RADIUS) {
        revealedFog++;
        if (
          difficulty === AiDifficulty.HARD &&
          f.faction !== FactionId.NEUTRAL &&
          canAttackFaction(state, faction, f.faction)
        ) {
          enemyHint++;
        }
      }
    }
    const score = revealedFog * 2 + enemyHint * 3;
    if (revealedFog >= 5 && score > bestScore) {
      bestScore = score;
      bestKey = candidateKey;
    }
  }
  return bestKey;
}

/**
 * Scores a Tower or Strong Tower placement hex by how many under-protected
 * friendly hexes (especially Town, Farms, and frontline border tiles) it shields!
 */
function scoreDefenseTowerHex(
  state: GameState,
  key: HexKey,
  faction: FactionId,
  towerStrength: number,
): number {
  const hostileCount = countHostileNeighbors(state, key, faction);
  const covers = [key, ...getNeighborKeys(key)];
  let score = hostileCount * 10;

  let shieldedFrontline = 0;
  for (const ck of covers) {
    const c = state.cells[ck];
    if (!c || c.faction !== faction) continue;
    const currentProt = getHexProtection(state, ck);
    if (currentProt >= towerStrength) continue;

    const gain = towerStrength - currentProt;
    if (c.entity === EntityType.TOWN) score += gain * 16;
    else if (c.entity === EntityType.TRADING_POST) score += gain * 18;
    else if (c.entity === EntityType.FARM) score += gain * 11;
    else if (c.entity === EntityType.CATAPULT) score += gain * 12;

    if (isHostileBorderHex(state, ck, faction)) {
      shieldedFrontline++;
      score += gain * 8;
    } else {
      score += gain * 2;
    }
  }

  // Must actually protect at least 1 contested frontline hex (or threatened Town)
  if (shieldedFrontline === 0 && hostileCount === 0) return -1;
  return score;
}

export function runSingleAiStep(state: GameState): AiActionStep {
  const faction = getActiveFaction(state);
  const difficulty = state.config.difficulty;
  const world = evaluateWorldPower(state);
  const visible = state.config.fogOfWar
    ? computeVisibleHexes(state, faction)
    : null;

  // ===== 1. Catapults: Fire at high-value targets OR relocate idle catapults toward front =====
  const readyCatapults = Object.values(state.cells).filter(
    (c) =>
      c.faction === faction &&
      isCatapult(c.entity) &&
      !c.unitMoved &&
      Boolean(c.provinceId),
  );

  for (const cat of readyCatapults) {
    const targets = [...computeCatapultTargets(state, cat.key)];
    if (targets.length > 0) {
      targets.sort((a, b) => {
        const score = (k: HexKey) => {
          const cell = state.cells[k];
          const e = cell.entity;
          let s = 15;
          if (e === EntityType.STRONG_TOWER) s = 60;
          else if (e === EntityType.TRADING_POST) s = 56;
          else if (e === EntityType.TOWER) s = 50;
          else if (e === EntityType.KNIGHT) s = 48;
          else if (e === EntityType.BARON) s = 44;
          else if (e === EntityType.CATAPULT) s = 45;
          else if (e === EntityType.FARM) s = 36;
          else if (e === EntityType.TOWN) s = 32;
          else if (e === EntityType.SPEARMAN) s = 28;
          else if (e === EntityType.BEACON) s = 22;

          // Extra priority if target is right next to our frontline (opens a breakthrough!)
          const touchesUs = getNeighborKeys(k).some(
            (nk) => state.cells[nk]?.faction === faction,
          );
          if (touchesUs) s += 12;
          return s;
        };
        return score(b) - score(a);
      });
      const events = executeCatapultFire(state, cat.key, targets[0]);
      if (events.length > 0) return {events, performed: true};
    } else if (difficulty !== AiDifficulty.EASY) {
      // Relocate an idle catapult toward a safe rear hex (distance 2..3 from enemy!)
      const currDist = minDistanceToHostile(state, cat.key, faction);
      if (currDist > CATAPULT_RANGE || currDist < CATAPULT_MIN_RANGE) {
        const reachable = computeReachableHexes(state, cat.key);
        let bestSpot: {key: HexKey; score: number} | null = null;
        for (const toKey of reachable.keys()) {
          if (isHostileBorderHex(state, toKey, faction)) continue; // Never park on exposed border!
          const nextDist = minDistanceToHostile(state, toKey, faction);
          const nextTargets = countCatapultTargetsFromHex(
            state,
            toKey,
            faction,
            visible,
          );
          let moveScore = 0;
          if (nextTargets > 0) {
            moveScore = 30 + nextTargets * 8;
          } else if (currDist > CATAPULT_RANGE && nextDist < currDist) {
            moveScore = 15 + (currDist - nextDist) * 6;
          } else if (currDist === 1 && nextDist >= 2) {
            // Pull exposed catapult back 1 hex to safety!
            moveScore = 24;
          }
          if (moveScore > 0 && (!bestSpot || moveScore > bestSpot.score)) {
            bestSpot = {key: toKey, score: moveScore};
          }
        }
        if (bestSpot) {
          const events = executeUnitMove(state, cat.key, bestSpot.key);
          if (events.length > 0) return {events, performed: true};
        }
      }
    }
  }

  // Precompute front-distance maps per province so stranded interior units march forward
  const myProvinces = Object.values(state.provinces)
    .filter((p) => p.faction === faction)
    .sort((a, b) => {
      // Prioritize threatened provinces and richer provinces first
      const aThreat = isTownThreatened(state, a, faction) ? 1000 : 0;
      const bThreat = isTownThreatened(state, b, faction) ? 1000 : 0;
      return bThreat + b.money + b.hexKeys.length - (aThreat + a.money + a.hexKeys.length);
    });

  const frontMaps = new Map<string, Map<HexKey, number>>();
  for (const prov of myProvinces) {
    frontMaps.set(prov.id, computeFrontDistanceMap(state, prov, faction));
  }

  // ===== 2. Move Ready Infantry Units (Captures, Tree Clearing, Tactical Merges, Front Marching) =====
  const readyUnitKeys = Object.values(state.cells)
    .filter(
      (c) =>
        c.faction === faction &&
        isUnit(c.entity) &&
        !isCatapult(c.entity) &&
        !c.unitMoved &&
        Boolean(c.provinceId),
    )
    .map((c) => c.key);

  let bestMove: {from: HexKey; to: HexKey; score: number} | null = null;
  for (const unitKey of readyUnitKeys) {
    const unitCell = state.cells[unitKey];
    const prov = unitCell.provinceId ? state.provinces[unitCell.provinceId] : null;
    if (!prov) continue;
    const provTight = prov.money + prov.netIncome < 4 || prov.netIncome < 0;
    const reachable = computeReachableHexes(state, unitKey);
    const unitEffectiveStr = getEffectiveUnitStrength(
      state,
      faction,
      unitCell.entity,
      unitKey,
    );
    const frontDistMap = frontMaps.get(prov.id);
    const fromFrontDist = frontDistMap?.get(unitKey) ?? 99;

    // Slight stay-bonus if this unit is currently defending a threatened Town or frontline
    const guardingEndangeredTown =
      hexDistance(parseHexKey(unitKey), parseHexKey(prov.townKey)) <= 1 &&
      isTownThreatened(state, prov, faction);

    for (const targetKey of reachable.keys()) {
      const targetCell = state.cells[targetKey];

      // 2a. Tactical merge when enemy defenses require a stronger tier
      if (targetCell.faction === faction && isInfantryUnit(targetCell.entity)) {
        if (difficulty === AiDifficulty.EASY) continue;
        const merged = getMergedUnitType(unitCell.entity, targetCell.entity);
        if (!merged) continue;
        const mergedStrength = getUnitStrength(merged);
        const upkeepDelta =
          getEntityUpkeep(merged) -
          getEntityUpkeep(unitCell.entity) -
          getEntityUpkeep(targetCell.entity);
        if (
          canSustainUpkeep(prov, upkeepDelta, difficulty) &&
          hasHighDefenseThreatNearProvince(
            state,
            prov,
            faction,
            Math.max(unitEffectiveStr, getUnitStrength(targetCell.entity)),
          )
        ) {
          const nearFrontBonus =
            (frontDistMap?.get(targetKey) ?? 99) <= 1 ? 8 : 0;
          const mergeScore = 18 + mergedStrength * 4 + nearFrontBonus;
          if (!bestMove || mergeScore > bestMove.score) {
            bestMove = {from: unitKey, to: targetKey, score: mergeScore};
          }
        }
        continue;
      }

      let score = scoreTargetHex(
        state,
        faction,
        targetKey,
        difficulty,
        world,
        provTight,
      );

      // Avoid wasting a Knight/Baron on a 0-protection tile if a weaker unit can do it
      if (targetCell.faction !== faction) {
        const prot = getHexProtection(state, targetKey);
        const overkill = Math.max(0, unitEffectiveStr - (prot + 1));
        score -= overkill * 4;
      } else if (
        targetCell.entity === EntityType.NONE &&
        frontDistMap
      ) {
        // March stranded interior units toward the frontline without pointless shuffling!
        const toFrontDist = frontDistMap.get(targetKey) ?? 99;
        if (fromFrontDist > 0 && toFrontDist < fromFrontDist) {
          score = 8 + (fromFrontDist - toFrontDist) * 5;
          // Prefer moving onto a hex that also protects our Town or Farms
          if (
            hexDistance(parseHexKey(targetKey), parseHexKey(prov.townKey)) <= 1 &&
            isTownThreatened(state, prov, faction)
          ) {
            score += 12;
          }
        } else {
          // Do not shuffle between two already-frontline empty hexes
          score = -20;
        }
      }

      if (guardingEndangeredTown && targetCell.faction === faction && !isTree(targetCell.entity)) {
        score -= 12;
      }

      if (score > 0 && (!bestMove || score > bestMove.score)) {
        bestMove = {from: unitKey, to: targetKey, score};
      }
    }
  }

  if (bestMove) {
    const events = executeUnitMove(state, bestMove.from, bestMove.to);
    if (events.length > 0) {
      return {events, performed: true};
    }
  }

  // ===== 3. Province Economy, Anti-Bankruptcy, Fortifications & Recruitment =====
  for (const province of myProvinces) {
    const projectedNextMoney = province.money + province.netIncome;
    const isBankruptRisk = projectedNextMoney < 0;
    const hasHostileFront = province.hexKeys.some((k) =>
      isHostileBorderHex(state, k, faction),
    );
    const hasNeutralAdj = province.hexKeys.some((k) =>
      isNeutralBorderHex(state, k, faction),
    );

    // 3a. Anti-Bankruptcy & Obsolete Building Demolition (reclaim 25% gold & cut dead upkeep)
    if (
      isBankruptRisk ||
      (province.netIncome < 0 && province.money < 10) ||
      (difficulty === AiDifficulty.HARD && province.netIncome <= 2)
    ) {
      const demolishable = [...computeDemolishableHexes(state, province.id)];
      const obsolete = demolishable.find((k) => {
        const ent = state.cells[k].entity;
        if (ent === EntityType.FARM || ent === EntityType.TRADING_POST) {
          return false;
        }
        if (ent === EntityType.TOWER || ent === EntityType.STRONG_TOWER) {
          // Demolish interior towers that no longer shield any hostile border!
          const shieldsFront = [k, ...getNeighborKeys(k)].some(
            (nk) =>
              state.cells[nk]?.faction === faction &&
              isHostileBorderHex(state, nk, faction),
          );
          return !shieldsFront;
        }
        return (
          ent === EntityType.BEACON &&
          (isBankruptRisk || province.netIncome < -2)
        );
      });
      if (obsolete) {
        const events = executeDemolishBuilding(state, province.id, obsolete);
        if (events.length > 0) return {events, performed: true};
      }
    }

    // 3b. Emergency Safe Farm when facing deficit/bankruptcy (immediate +4 netIncome/turn, +6 next to Trading Post!)
    const farmCost = getProvincePurchaseCost(state, province.id, EntityType.FARM);
    if (isBankruptRisk && province.money >= farmCost) {
      const farmHexes = [
        ...computeBuildableHexes(state, province.id, EntityType.FARM),
      ];
      if (farmHexes.length > 0) {
        farmHexes.sort((a, b) => {
          const scoreFarm = (k: HexKey) =>
            (isHostileBorderHex(state, k, faction) ? -14 : 12) +
            getHexProtection(state, k) * 3 +
            countAdjacentFriendlyTradingPosts(state, k, faction) * 18 +
            countAdjacentFriendlyFarms(state, k, faction) * 4 +
            (isHexInRegeneratorRadius(state, faction, k) ? 10 : 0);
          return scoreFarm(b) - scoreFarm(a);
        });
        const events = executeBuyAndPlace(
          state,
          province.id,
          EntityType.FARM,
          farmHexes[0],
        );
        if (events.length > 0) return {events, performed: true};
      }
    }

    // 3c. Place green Regenerator beacon when it boosts farms (+4 each) or frontline units (+1 str)
    const activeProvRegenerators = (state.regenerators ?? []).filter(
      (r) =>
        r.faction === faction &&
        state.cells[r.centerKey]?.provinceId === province.id,
    ).length;
    const maxRegenerators =
      difficulty === AiDifficulty.HARD
        ? Math.max(1, Math.min(3, Math.floor(province.hexKeys.length / 10)))
        : 1;
    if (
      !isBankruptRisk &&
      activeProvRegenerators < maxRegenerators &&
      province.money >= REGENERATOR_COST
    ) {
      const candidate = pickBestRegeneratorHex(state, province, faction);
      if (candidate) {
        const effectiveNetUpkeep =
          REGENERATOR_UPKEEP - candidate.farmCount * REGENERATOR_FARM_BONUS;
        const worthPlacing =
          candidate.farmCount >= 2 ||
          (candidate.farmCount >= 1 && candidate.unitCount >= 1) ||
          (difficulty !== AiDifficulty.EASY &&
            candidate.unitCount >= 2 &&
            hasHostileFront);
        if (
          worthPlacing &&
          canSustainUpkeep(province, Math.max(0, effectiveNetUpkeep), difficulty)
        ) {
          const events = executePlaceRegenerator(
            state,
            province.id,
            candidate.key,
          );
          if (events.length > 0) return {events, performed: true};
        }
      }
    }

    // 3c-2. Build Trading Post (3-hex farm agglomeration hub: +10 base + 2 per adjacent farm)
    const tradingPostCost = getProvincePurchaseCost(
      state,
      province.id,
      EntityType.TRADING_POST,
    );
    if (
      !isBankruptRisk &&
      province.farmCount >= 1 &&
      province.hexKeys.length >= 6 &&
      province.money >= tradingPostCost
    ) {
      const tpAnchors = [
        ...computeBuildableHexes(state, province.id, EntityType.TRADING_POST),
      ];
      if (tpAnchors.length > 0) {
        const seenFootprints = new Set<string>();
        let bestTp: {
          anchorKey: HexKey;
          netGain: number;
          payback: number;
          score: number;
        } | null = null;

        for (const anchorKey of tpAnchors) {
          const footprint = findBestTradingPostFootprint(
            state,
            province.id,
            anchorKey,
          );
          if (!footprint) continue;
          const sig = [...footprint].sort().join('|');
          if (seenFootprints.has(sig)) continue;
          seenFootprints.add(sig);

          const exposedUnshielded = footprint.some(
            (k) =>
              isHostileBorderHex(state, k, faction) &&
              getHexProtection(state, k) < 2,
          );
          if (exposedUnshielded && hasHostileFront) continue;

          const replacedInsideFarms = footprint.filter(
            (k) => state.cells[k]?.entity === EntityType.FARM,
          ).length;
          const adjOutsideFarms = countTradingPostAdjacentFarms(
            state,
            faction,
            footprint,
          );
          const netGain =
            TRADING_POST_BASE_INCOME +
            adjOutsideFarms * TRADING_POST_FARM_SYNERGY -
            replacedInsideFarms * FARM_INCOME;
          if (netGain < 8) continue;

          // Reward footprints surrounded by safe empty tiles for future farm agglomeration
          const clusterSet = new Set<HexKey>(footprint);
          const ringEmpty = new Set<HexKey>();
          for (const fk of footprint) {
            for (const nk of getNeighborKeys(fk)) {
              if (clusterSet.has(nk)) continue;
              const nc = state.cells[nk];
              if (
                nc &&
                nc.provinceId === province.id &&
                nc.entity === EntityType.NONE &&
                !isHostileBorderHex(state, nk, faction)
              ) {
                ringEmpty.add(nk);
              }
            }
          }

          const payback = tradingPostCost / Math.max(1, netGain);
          const safetyScore = footprint.reduce(
            (acc, k) =>
              acc +
              (isHostileBorderHex(state, k, faction) ? -14 : 6) +
              getHexProtection(state, k) * 3,
            0,
          );
          const score = netGain * 6 + ringEmpty.size * 2 + safetyScore;
          if (!bestTp || score > bestTp.score) {
            bestTp = {anchorKey, netGain, payback, score};
          }
        }

        const maxTpPayback =
          difficulty === AiDifficulty.HARD
            ? 5.2
            : difficulty === AiDifficulty.BALANCED
              ? 4.4
              : 3.6;
        if (bestTp && bestTp.payback <= maxTpPayback) {
          const events = executeBuyAndPlace(
            state,
            province.id,
            EntityType.TRADING_POST,
            bestTp.anchorKey,
          );
          if (events.length > 0) return {events, performed: true};
        }
      }
    }

    // 3d. ROI-Driven Farm Building (prefers safe rear agglomerations & Trading Post synergy!)
    const farmHexes =
      province.money >= farmCost
        ? [...computeBuildableHexes(state, province.id, EntityType.FARM)]
        : [];
    const earlyLandGrabPriority =
      state.turn <= 2 && hasNeutralAdj && province.money < farmCost + 10;
    const maxFarmCostForRoi =
      difficulty === AiDifficulty.HARD
        ? 36
        : difficulty === AiDifficulty.BALANCED
          ? 28
          : 22;

    if (
      farmHexes.length > 0 &&
      !earlyLandGrabPriority &&
      farmCost <= maxFarmCostForRoi &&
      province.farmCount < Math.max(2, Math.floor(province.hexKeys.length * 0.55))
    ) {
      farmHexes.sort((a, b) => {
        const scoreFarm = (k: HexKey) =>
          (isHostileBorderHex(state, k, faction) ? -16 : 14) +
          getHexProtection(state, k) * 3 +
          countAdjacentFriendlyTradingPosts(state, k, faction) * 18 +
          countAdjacentFriendlyFarms(state, k, faction) * 5 +
          (isHexInRegeneratorRadius(state, faction, k) ? 12 : 0);
        return scoreFarm(b) - scoreFarm(a);
      });
      const bestFarmHex = farmHexes[0];
      const safeSpot = !isHostileBorderHex(state, bestFarmHex, faction);
      const regenBoost = isHexInRegeneratorRadius(state, faction, bestFarmHex)
        ? REGENERATOR_FARM_BONUS
        : 0;
      const tpSynergyBoost =
        countAdjacentFriendlyTradingPosts(state, bestFarmHex, faction) *
        TRADING_POST_FARM_SYNERGY;
      const effectiveFarmIncome = FARM_INCOME + regenBoost + tpSynergyBoost;
      const paybackTurns = farmCost / effectiveFarmIncome;
      const shouldBuildFarm =
        (safeSpot || !hasHostileFront) &&
        (paybackTurns <= (difficulty === AiDifficulty.HARD ? 7.5 : 6.0) ||
          province.netIncome < 4);

      if (shouldBuildFarm) {
        const events = executeBuyAndPlace(
          state,
          province.id,
          EntityType.FARM,
          bestFarmHex,
        );
        if (events.length > 0) return {events, performed: true};
      }
    }

    // 3e. Buy Infantry (or Merge-on-Buy Upgrade!) onto highest-value border target, tree, or grave
    let bestPurchase: {
      entity: PurchasableEntity;
      targetKey: HexKey;
      score: number;
    } | null = null;

    for (const unitType of BUYABLE_INFANTRY) {
      const cost = getProvincePurchaseCost(state, province.id, unitType);
      const upkeep = getEntityUpkeep(unitType);
      if (province.money < cost) continue;

      const buildable = computeBuildableHexes(state, province.id, unitType);
      for (const targetKey of buildable) {
        const target = state.cells[targetKey];

        // Merge-on-buy upgrade: buying a Peasant (10g) onto an existing friendly unit!
        if (target.faction === faction && isInfantryUnit(target.entity)) {
          if (difficulty === AiDifficulty.EASY) continue;
          const merged = getMergedUnitType(unitType, target.entity);
          if (!merged) continue;
          const upkeepDelta = getEntityUpkeep(merged) - getEntityUpkeep(target.entity);
          if (!canSustainUpkeep(province, upkeepDelta, difficulty)) continue;
          const curStr = getEffectiveUnitStrength(state, faction, target.entity, targetKey);
          if (!hasHighDefenseThreatNearProvince(state, province, faction, curStr)) {
            continue;
          }
          const nearFront = isHostileBorderHex(state, targetKey, faction) ? 10 : 0;
          const mergeBuyScore =
            20 + getUnitStrength(merged) * 4 + nearFront - cost * 0.35;
          if (!bestPurchase || mergeBuyScore > bestPurchase.score) {
            bestPurchase = {entity: unitType, targetKey, score: mergeBuyScore};
          }
          continue;
        }

        if (
          target.faction === faction &&
          !isTree(target.entity) &&
          target.entity !== EntityType.GRAVE
        ) {
          continue;
        }

        // Check upkeep sustainability (allow tree-chopping Peasant even when slightly tight if net gain helps!)
        const treeIncomeGain = target.faction === faction && isTree(target.entity) ? 1 : 0;
        const captureIncomeGain =
          target.faction !== faction
            ? target.entity === EntityType.FARM
              ? 5
              : 1
            : 0;
        const netUpkeepDelta = upkeep - treeIncomeGain - captureIncomeGain;
        if (!canSustainUpkeep(province, Math.max(0, netUpkeepDelta), difficulty)) {
          continue;
        }

        const prot = getHexProtection(state, targetKey);
        const strength = getEffectiveUnitStrength(
          state,
          faction,
          unitType,
          targetKey,
        );
        const wastePenalty = Math.max(0, strength - (prot + 1)) * 16;
        const efficiencyPenalty = cost * 0.32 + upkeep * 0.85;
        const rawScore = scoreTargetHex(
          state,
          faction,
          targetKey,
          difficulty,
          world,
          isBankruptRisk,
        );
        const score = rawScore - wastePenalty - efficiencyPenalty;

        if (score > 4 && (!bestPurchase || score > bestPurchase.score)) {
          bestPurchase = {entity: unitType, targetKey, score};
        }
      }
    }

    if (bestPurchase) {
      const events = executeBuyAndPlace(
        state,
        province.id,
        bestPurchase.entity,
        bestPurchase.targetKey,
      );
      if (events.length > 0) return {events, performed: true};
    }

    // 3f. Recruit Catapult onto a SAFE REAR HEX (dist 2..3 from enemy, NOT directly on frontline!)
    if (!isBankruptRisk && hasHostileFront && province.hexKeys.length >= 7) {
      const catapultCount = province.hexKeys.filter(
        (k) => state.cells[k].entity === EntityType.CATAPULT,
      ).length;
      const maxCatapults =
        difficulty === AiDifficulty.HARD && province.hexKeys.length >= 14 ? 2 : 1;
      const catapultCost = getProvincePurchaseCost(
        state,
        province.id,
        EntityType.CATAPULT,
      );
      if (
        catapultCount < maxCatapults &&
        province.money >=
          catapultCost + (difficulty === AiDifficulty.EASY ? 14 : 4) &&
        canSustainUpkeep(
          province,
          getEntityUpkeep(EntityType.CATAPULT),
          difficulty,
        )
      ) {
        const spots = [
          ...computeBuildableHexes(state, province.id, EntityType.CATAPULT),
        ];
        let bestCatSpot: {key: HexKey; score: number} | null = null;
        for (const k of spots) {
          // NEVER place a fragile 1-prot catapult directly adjacent to an enemy!
          if (isHostileBorderHex(state, k, faction)) continue;
          const targetsInRange = countCatapultTargetsFromHex(
            state,
            k,
            faction,
            visible,
          );
          if (targetsInRange <= 0) continue;
          const protBonus = getHexProtection(state, k) * 4;
          const s = targetsInRange * 12 + protBonus;
          if (!bestCatSpot || s > bestCatSpot.score) {
            bestCatSpot = {key: k, score: s};
          }
        }
        if (bestCatSpot) {
          const events = executeBuyAndPlace(
            state,
            province.id,
            EntityType.CATAPULT,
            bestCatSpot.key,
          );
          if (events.length > 0) return {events, performed: true};
        }
      }
    }

    // 3g. Build Strong Tower on highest-coverage contested frontline hex (or upgrade Tower)
    const strongTowerCost = getProvincePurchaseCost(
      state,
      province.id,
      EntityType.STRONG_TOWER,
    );
    if (
      !isBankruptRisk &&
      hasHostileFront &&
      province.hexKeys.length >= 6 &&
      province.money >= strongTowerCost &&
      canSustainUpkeep(
        province,
        getEntityUpkeep(EntityType.STRONG_TOWER),
        difficulty,
      )
    ) {
      const strongHexes = [
        ...computeBuildableHexes(state, province.id, EntityType.STRONG_TOWER),
      ];
      let bestStrong: {key: HexKey; score: number} | null = null;
      const minHostile = difficulty === AiDifficulty.EASY ? 3 : 2;
      for (const k of strongHexes) {
        if (
          countHostileNeighbors(state, k, faction) < minHostile &&
          !isTownThreatened(state, province, faction)
        ) {
          continue;
        }
        const s = scoreDefenseTowerHex(state, k, faction, 3);
        if (s >= 24 && (!bestStrong || s > bestStrong.score)) {
          bestStrong = {key: k, score: s};
        }
      }
      if (bestStrong) {
        const events = executeBuyAndPlace(
          state,
          province.id,
          EntityType.STRONG_TOWER,
          bestStrong.key,
        );
        if (events.length > 0) return {events, performed: true};
      }
    }

    // 3h. Build regular defensive Tower on cluster-optimal exposed border hex
    const towerCost = getProvincePurchaseCost(
      state,
      province.id,
      EntityType.TOWER,
    );
    if (
      !isBankruptRisk &&
      hasHostileFront &&
      province.money >= towerCost &&
      canSustainUpkeep(province, getEntityUpkeep(EntityType.TOWER), difficulty)
    ) {
      const towerHexes = [
        ...computeBuildableHexes(state, province.id, EntityType.TOWER),
      ];
      let bestTower: {key: HexKey; score: number} | null = null;
      for (const k of towerHexes) {
        if (getHexProtection(state, k) >= 2) continue;
        const s = scoreDefenseTowerHex(state, k, faction, 2);
        if (s >= 18 && (!bestTower || s > bestTower.score)) {
          bestTower = {key: k, score: s};
        }
      }
      if (bestTower) {
        const events = executeBuyAndPlace(
          state,
          province.id,
          EntityType.TOWER,
          bestTower.key,
        );
        if (events.length > 0) return {events, performed: true};
      }
    }

    // 3i. Build Vision Beacon when Fog of War is enabled near fogged borders
    if (
      !isBankruptRisk &&
      state.config.fogOfWar &&
      visible &&
      province.hexKeys.length >= 6
    ) {
      const beaconCost = getProvincePurchaseCost(
        state,
        province.id,
        EntityType.BEACON,
      );
      if (
        province.money >= beaconCost + 6 &&
        canSustainUpkeep(province, getEntityUpkeep(EntityType.BEACON), difficulty)
      ) {
        const existingBeacons = province.hexKeys
          .filter((k) => state.cells[k].entity === EntityType.BEACON)
          .map((k) => parseHexKey(k));
        if (
          existingBeacons.length <
          Math.max(1, Math.floor(province.hexKeys.length / 10))
        ) {
          const beaconHexes = [
            ...computeBuildableHexes(state, province.id, EntityType.BEACON),
          ];
          const beaconRadius = ENTITY_META[EntityType.BEACON].visionRadius;
          const goodBeaconSpot = beaconHexes.find((k) => {
            const coord = parseHexKey(k);
            if (
              existingBeacons.some((b) => hexDistance(b, coord) <= beaconRadius)
            ) {
              return false;
            }
            return (
              isHostileBorderHex(state, k, faction) ||
              getNeighborKeys(k).some((nk) =>
                getNeighborKeys(nk).some(
                  (nk2) => state.cells[nk2] && !visible.has(nk2),
                ),
              )
            );
          });
          if (goodBeaconSpot) {
            const events = executeBuyAndPlace(
              state,
              province.id,
              EntityType.BEACON,
              goodBeaconSpot,
            );
            if (events.length > 0) return {events, performed: true};
          }
        }
      }
    }

    // 3j. Launch Illumination Flare when Fog of War is enabled and treasury is healthy
    if (
      !isBankruptRisk &&
      state.config.fogOfWar &&
      visible &&
      province.money >= FLARE_COST + 16 &&
      province.netIncome >= 4 &&
      !state.flares.some((f) => f.faction === faction)
    ) {
      const flareTarget = pickBestFlareTarget(state, faction, visible, difficulty);
      if (flareTarget) {
        const events = executeLaunchFlare(state, province.id, flareTarget);
        if (events.length > 0) return {events, performed: true};
      }
    }
  }

  return {events: [], performed: false};
}
