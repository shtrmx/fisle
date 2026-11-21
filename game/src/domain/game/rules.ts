import {
  getNeighborKeys,
  HEX_DIRECTIONS,
  hexDistance,
  hexKey,
  parseHexKey,
  type HexKey,
} from '@/domain/hex/hexCoordinates';
import {
  DiplomaticRelation,
  EntityType,
  FactionId,
  TreeSpawnRate,
  type DiplomaticSubsidy,
  type GameState,
  type HexCell,
  type PurchasableEntity,
  type TradingPostCluster,
} from '@/domain/game/types';

export interface FactionPalette {
  readonly id: FactionId;
  readonly name: string;
  readonly tileHex: string;
  readonly tileSideHex: string;
  readonly accentHex: string;
  readonly bannerHex: string;
}

export const FACTION_PALETTES: Record<FactionId, FactionPalette> = {
  [FactionId.NEUTRAL]: {
    id: FactionId.NEUTRAL,
    name: 'Нейтрал',
    tileHex: '#9ba3af',
    tileSideHex: '#737b87',
    accentHex: '#59606b',
    bannerHex: '#7e8694',
  },
  [FactionId.EMERALD]: {
    id: FactionId.EMERALD,
    name: 'Зелёные',
    tileHex: '#6cb373',
    tileSideHex: '#4b8a52',
    accentHex: '#2f6d37',
    bannerHex: '#3fa34d',
  },
  [FactionId.CRIMSON]: {
    id: FactionId.CRIMSON,
    name: 'Красные',
    tileHex: '#d46a6a',
    tileSideHex: '#a54848',
    accentHex: '#7d2e2e',
    bannerHex: '#c84b4b',
  },
  [FactionId.COBALT]: {
    id: FactionId.COBALT,
    name: 'Синие',
    tileHex: '#6397cc',
    tileSideHex: '#4371a0',
    accentHex: '#2b4f75',
    bannerHex: '#3e7ec0',
  },
  [FactionId.AMBER]: {
    id: FactionId.AMBER,
    name: 'Жёлтые',
    tileHex: '#d8ad56',
    tileSideHex: '#aa8132',
    accentHex: '#7d5c1d',
    bannerHex: '#cf9628',
  },
  [FactionId.VIOLET]: {
    id: FactionId.VIOLET,
    name: 'Фиолетовые',
    tileHex: '#a27bc4',
    tileSideHex: '#795599',
    accentHex: '#553870',
    bannerHex: '#8d5db8',
  },
  [FactionId.TEAL]: {
    id: FactionId.TEAL,
    name: 'Бирюзовые',
    tileHex: '#5cb3a9',
    tileSideHex: '#3c887f',
    accentHex: '#256059',
    bannerHex: '#369b90',
  },
};

export const PLAYABLE_FACTIONS: readonly FactionId[] = [
  FactionId.EMERALD,
  FactionId.CRIMSON,
  FactionId.COBALT,
  FactionId.AMBER,
  FactionId.VIOLET,
  FactionId.TEAL,
];

export const MAX_UNIT_MOVE_STEPS = 4;
export const CATAPULT_MOVE_STEPS = 2;
export const CATAPULT_MIN_RANGE = 2;
export const CATAPULT_RANGE = 3;
export const TREE_CHOP_BONUS = 3;
export const FARM_INCOME = 4;
export const TRADING_POST_BASE_INCOME = 10;
export const TRADING_POST_FARM_SYNERGY = 2;
export const TRADING_POST_BASE_COST = 24;
export const TRADING_POST_COST_STEP = 8;
export const TRADING_POST_HEX_COUNT = 3;
export const HEX_BASE_INCOME = 1;
export const BASE_FARM_COST = 8;
export const FARM_COST_STEP = 2;
export const STARTING_PROVINCE_MONEY = 14;
export const DEMOLISH_REFUND_RATE = 0.25;
export const FLARE_COST = 8;
export const FLARE_RADIUS = 3;
export const FLARE_DURATION_TURNS = 3;
export const REGENERATOR_COST = 28;
export const REGENERATOR_RADIUS = 2;
export const REGENERATOR_DURATION_TURNS = 3;
export const REGENERATOR_UPKEEP = 6;
export const REGENERATOR_FARM_BONUS = 4;
export const REGENERATOR_STRENGTH_BONUS = 1;
export const TURN_TIME_LIMIT_SECONDS = 600;

export const TURN_TIME_LIMIT_OPTIONS: readonly {
  readonly seconds: number;
  readonly label: string;
}[] = [
  {seconds: 0, label: 'Без лимита'},
  {seconds: 60, label: '1 мин'},
  {seconds: 180, label: '3 мин'},
  {seconds: 300, label: '5 мин'},
  {seconds: 600, label: '10 мин'},
  {seconds: 900, label: '15 мин'},
];

export function getTurnTimeLimitSeconds(
  config: {readonly turnTimeLimitSeconds?: number} | null | undefined,
): number {
  const raw = config?.turnTimeLimitSeconds;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return TURN_TIME_LIMIT_SECONDS;
  }
  return Math.floor(raw);
}
export const BLACK_MARK_COST = 10;
export const BLACK_MARK_DURATION_TURNS = 6;

export interface EntityMeta {
  readonly type: EntityType;
  readonly label: string;
  readonly shortLabel: string;
  readonly strength: number;
  readonly defense: number;
  readonly cost: number;
  readonly costStep: number;
  readonly upkeep: number;
  readonly income: number;
  readonly visionRadius: number;
  readonly description: string;
}

export const ENTITY_META: Record<EntityType, EntityMeta> = {
  [EntityType.NONE]: {
    type: EntityType.NONE,
    label: 'Пустой гекс',
    shortLabel: 'Пусто',
    strength: 0,
    defense: 0,
    cost: 0,
    costStep: 0,
    upkeep: 0,
    income: 1,
    visionRadius: 2,
    description: 'Свободная земля, приносит +1 монету в ход.',
  },
  [EntityType.PINE]: {
    type: EntityType.PINE,
    label: 'Сосна',
    shortLabel: 'Сосна',
    strength: 0,
    defense: 0,
    cost: 0,
    costStep: 0,
    upkeep: 0,
    income: 0,
    visionRadius: 1,
    description: 'Блокирует доход гекса. Вырубка приносит +3 монеты.',
  },
  [EntityType.PALM]: {
    type: EntityType.PALM,
    label: 'Пальма',
    shortLabel: 'Пальма',
    strength: 0,
    defense: 0,
    cost: 0,
    costStep: 0,
    upkeep: 0,
    income: 0,
    visionRadius: 1,
    description:
      'Быстро разрастается у берега и блокирует доход. Вырубка: +3 монеты.',
  },
  [EntityType.GRAVE]: {
    type: EntityType.GRAVE,
    label: 'Могила',
    shortLabel: 'Могила',
    strength: 0,
    defense: 0,
    cost: 0,
    costStep: 0,
    upkeep: 0,
    income: 0,
    visionRadius: 1,
    description:
      'Остаётся после гибели воина. В следующем раунде прорастёт деревом.',
  },
  [EntityType.TOWN]: {
    type: EntityType.TOWN,
    label: 'Столица провинции',
    shortLabel: 'Столица',
    strength: 0,
    defense: 1,
    cost: 0,
    costStep: 0,
    upkeep: 0,
    income: 1,
    visionRadius: 3,
    description:
      'Сердце провинции. Хранит казну, защищает соседей (защита 1) и освещает окрестности.',
  },
  [EntityType.FARM]: {
    type: EntityType.FARM,
    label: 'Ферма',
    shortLabel: 'Ферма',
    strength: 0,
    defense: 0,
    cost: BASE_FARM_COST,
    costStep: FARM_COST_STEP,
    upkeep: 0,
    income: FARM_INCOME,
    visionRadius: 2,
    description:
      'Основной источник золота в провинции. Строится рядом со столицей, другой фермой или торговым посадом. Гранича с торговым посадом, дополнительно усиливает его доход на +2 монеты.',
  },
  [EntityType.TRADING_POST]: {
    type: EntityType.TRADING_POST,
    label: 'Торговый посад',
    shortLabel: 'Посад',
    strength: 0,
    defense: 0,
    cost: TRADING_POST_BASE_COST,
    costStep: TRADING_POST_COST_STEP,
    upkeep: 0,
    income: TRADING_POST_BASE_INCOME,
    visionRadius: 3,
    description:
      'Крупный торговый узел на 3 смежных гексах (шатры и колокольня) — улучшение существующей фермы. Даёт +10 золота в ход и дополнительно +2 золота за каждую обычную ферму, граничащую с посадом. Лучше строить в защищённом тылу и окружать фермами.',
  },
  [EntityType.TOWER]: {
    type: EntityType.TOWER,
    label: 'Башня',
    shortLabel: 'Башня',
    strength: 0,
    defense: 2,
    cost: 10,
    costStep: 3,
    upkeep: 1,
    income: 1,
    visionRadius: 3,
    description:
      'Надёжное укрепление, дающее защиту 2 своему гексу и всем 6 соседним клеткам. Останавливает крестьян и копейщиков, пробивается бароном, рыцарем или катапультой.',
  },
  [EntityType.STRONG_TOWER]: {
    type: EntityType.STRONG_TOWER,
    label: 'Цитадель',
    shortLabel: 'Цитадель',
    strength: 0,
    defense: 3,
    cost: 24,
    costStep: 5,
    upkeep: 6,
    income: 1,
    visionRadius: 4,
    description:
      'Мощная крепость, обеспечивающая защиту 3 своему гексу и 6 соседним. Можно возвести поверх обычной башни. Пробивается только рыцарем или разрушается катапультой.',
  },
  [EntityType.BEACON]: {
    type: EntityType.BEACON,
    label: 'Сигнальный маяк',
    shortLabel: 'Маяк',
    strength: 0,
    defense: 0,
    cost: 10,
    costStep: 2,
    upkeep: 1,
    income: 1,
    visionRadius: 5,
    description:
      'Стационарная дозорная вышка, постоянно раскрывающая туман войны в радиусе 5 гексов. Помогает контролировать границы и наводить катапульты на цели.',
  },
  [EntityType.PEASANT]: {
    type: EntityType.PEASANT,
    label: 'Крестьянин',
    shortLabel: 'Крестьянин',
    strength: 1,
    defense: 1,
    cost: 6,
    costStep: 2,
    upkeep: 2,
    income: 1,
    visionRadius: 2,
    description:
      'Самый простой юнит: позволяет осваивать свободные территории и рубить лес (+3 золота), но не может побороть других воинов и укрепления.',
  },
  [EntityType.SPEARMAN]: {
    type: EntityType.SPEARMAN,
    label: 'Копейщик',
    shortLabel: 'Копейщик',
    strength: 2,
    defense: 2,
    cost: 14,
    costStep: 3,
    upkeep: 6,
    income: 1,
    visionRadius: 2,
    description:
      'Базовый боевой отряд. Уверенно побеждает крестьян, пробивает вражеские столицы и прикрывает соседние клетки защитой 2.',
  },
  [EntityType.BARON]: {
    type: EntityType.BARON,
    label: 'Барон',
    shortLabel: 'Барон',
    strength: 3,
    defense: 3,
    cost: 22,
    costStep: 4,
    upkeep: 18,
    income: 1,
    visionRadius: 2,
    description:
      'Тяжёлый воин с силой 3. Штурмует башни и копейщиков, защищает прилегающие гексы на уровне цитадели, но требует заметного содержания.',
  },
  [EntityType.KNIGHT]: {
    type: EntityType.KNIGHT,
    label: 'Рыцарь',
    shortLabel: 'Рыцарь',
    strength: 4,
    defense: 3,
    cost: 30,
    costStep: 5,
    upkeep: 36,
    income: 1,
    visionRadius: 2,
    description:
      'Элитный штурмовой отряд высшей силы (4). Единственный пехотный юнит, способный напрямую сокрушить цитадель, барона и другого рыцаря.',
  },
  [EntityType.CATAPULT]: {
    type: EntityType.CATAPULT,
    label: 'Катапульта',
    shortLabel: 'Катапульта',
    strength: 1,
    defense: 1,
    cost: 24,
    costStep: 5,
    upkeep: 8,
    income: 1,
    visionRadius: 3,
    description:
      'Осадная машина дальнего боя (дистанция 2–3 гекса, не стреляет вплотную). Разрушает вражеские башни, фермы и торговые посады, ослабляет цитадели и понижает ранг вражеских отрядов.',
  },
};

export function isInfantryUnit(entity: EntityType): boolean {
  return (
    entity === EntityType.PEASANT ||
    entity === EntityType.SPEARMAN ||
    entity === EntityType.BARON ||
    entity === EntityType.KNIGHT
  );
}

export function isCatapult(entity: EntityType): boolean {
  return entity === EntityType.CATAPULT;
}

export function isUnit(entity: EntityType): boolean {
  return isInfantryUnit(entity) || isCatapult(entity);
}

export function isTree(entity: EntityType): boolean {
  return entity === EntityType.PINE || entity === EntityType.PALM;
}

export function isBuilding(entity: EntityType): boolean {
  return (
    entity === EntityType.TOWN ||
    entity === EntityType.FARM ||
    entity === EntityType.TRADING_POST ||
    entity === EntityType.TOWER ||
    entity === EntityType.STRONG_TOWER ||
    entity === EntityType.BEACON
  );
}

export function isDemolishable(entity: EntityType): boolean {
  return (
    entity === EntityType.FARM ||
    entity === EntityType.TRADING_POST ||
    entity === EntityType.TOWER ||
    entity === EntityType.STRONG_TOWER ||
    entity === EntityType.BEACON
  );
}

export function getUnitStrength(entity: EntityType): number {
  return ENTITY_META[entity].strength;
}

export function getEntityDefense(entity: EntityType): number {
  return ENTITY_META[entity].defense;
}

export function getEntityUpkeep(entity: EntityType): number {
  return ENTITY_META[entity].upkeep;
}

export function getTradingPostClusterAt(
  state: GameState,
  key: HexKey,
): TradingPostCluster | null {
  const clusters = state.tradingPosts;
  if (!clusters || clusters.length === 0) return null;
  for (const cluster of clusters) {
    if (cluster.hexKeys.includes(key)) {
      return cluster;
    }
  }
  return null;
}

export function getProvinceTradingPosts(
  state: GameState,
  provinceId: string,
): TradingPostCluster[] {
  const province = state.provinces[provinceId];
  const clusters = state.tradingPosts;
  if (!province || !clusters || clusters.length === 0) return [];
  const hexSet = new Set(province.hexKeys);
  return clusters.filter(
    (c) =>
      c.faction === province.faction &&
      c.hexKeys.every(
        (k) => hexSet.has(k) && state.cells[k]?.entity === EntityType.TRADING_POST,
      ),
  );
}

/**
 * Returns all 6 mutually-adjacent 3-hex triangles touching `anchorKey`.
 * Because HEX_DIRECTIONS is ordered cyclically around a hex, consecutive
 * neighbor pairs (dir[i], dir[(i+1)%6]) are always adjacent to each other.
 */
export function getTradingPostTriangleCandidates(
  anchorKey: HexKey,
): [HexKey, HexKey, HexKey][] {
  const {q, r} = parseHexKey(anchorKey);
  const triangles: [HexKey, HexKey, HexKey][] = [];
  for (let i = 0; i < HEX_DIRECTIONS.length; i++) {
    const d1 = HEX_DIRECTIONS[i];
    const d2 = HEX_DIRECTIONS[(i + 1) % HEX_DIRECTIONS.length];
    triangles.push([
      anchorKey,
      hexKey(q + d1.q, r + d1.r),
      hexKey(q + d2.q, r + d2.r),
    ]);
  }
  return triangles;
}

/**
 * Counts unique ordinary friendly FARMs bordering ANY of the 3 hexes in a Trading Post cluster.
 */
export function countTradingPostAdjacentFarms(
  state: GameState,
  faction: FactionId,
  clusterHexKeys: readonly HexKey[],
): number {
  const clusterSet = new Set(clusterHexKeys);
  const countedFarms = new Set<HexKey>();
  for (const key of clusterHexKeys) {
    for (const nk of getNeighborKeys(key)) {
      if (clusterSet.has(nk) || countedFarms.has(nk)) continue;
      const cell = state.cells[nk];
      if (cell && cell.faction === faction && cell.entity === EntityType.FARM) {
        countedFarms.add(nk);
      }
    }
  }
  return countedFarms.size;
}

/**
 * Validates that a 3-hex triangle can be upgraded into a Trading Post:
 * - all 3 hexes belong to `provinceId`
 * - every hex is either NONE or FARM
 * - at least 1 hex in the triangle is an existing FARM (farm upgrade rule)
 */
export function isValidTradingPostTriangle(
  state: GameState,
  provinceId: string,
  hexKeys: readonly [HexKey, HexKey, HexKey],
): boolean {
  let hasFarm = false;
  for (const key of hexKeys) {
    const cell = state.cells[key];
    if (!cell || cell.provinceId !== provinceId) return false;
    if (cell.entity === EntityType.FARM) {
      hasFarm = true;
    } else if (cell.entity !== EntityType.NONE) {
      return false;
    }
  }
  return hasFarm;
}

/**
 * Deterministically selects the best valid 3-hex Trading Post footprint containing `anchorKey`.
 * Maximizes net income gain (adjacent outside farms minus sacrificed interior farms),
 * prefers safe rear hexes away from hostile borders, and breaks ties deterministically.
 */
export function findBestTradingPostFootprint(
  state: GameState,
  provinceId: string,
  anchorKey: HexKey,
): [HexKey, HexKey, HexKey] | null {
  const province = state.provinces[provinceId];
  if (!province) return null;
  const anchorCell = state.cells[anchorKey];
  if (!anchorCell || anchorCell.provinceId !== provinceId) return null;
  if (
    anchorCell.entity !== EntityType.NONE &&
    anchorCell.entity !== EntityType.FARM
  ) {
    return null;
  }

  let best: [HexKey, HexKey, HexKey] | null = null;
  let bestScore = -Infinity;
  let bestTieKey = '';

  for (const tri of getTradingPostTriangleCandidates(anchorKey)) {
    if (!isValidTradingPostTriangle(state, provinceId, tri)) continue;

    let replacedFarms = 0;
    let hostileExposure = 0;
    for (const k of tri) {
      if (state.cells[k]?.entity === EntityType.FARM) replacedFarms++;
      const touchesEnemy = getNeighborKeys(k).some((nk) => {
        const n = state.cells[nk];
        return (
          n &&
          n.faction !== province.faction &&
          n.faction !== FactionId.NEUTRAL
        );
      });
      if (touchesEnemy) hostileExposure++;
    }

    const adjOutsideFarms = countTradingPostAdjacentFarms(
      state,
      province.faction,
      tri,
    );
    const netGain =
      TRADING_POST_BASE_INCOME +
      adjOutsideFarms * TRADING_POST_FARM_SYNERGY -
      replacedFarms * FARM_INCOME;
    const score = netGain * 10 - hostileExposure * 6 - replacedFarms * 2;
    const tieKey = [...tri].sort().join('|');

    if (
      score > bestScore ||
      (score === bestScore && (!best || tieKey < bestTieKey))
    ) {
      bestScore = score;
      bestTieKey = tieKey;
      best = tri;
    }
  }

  return best;
}

export function countEntityTypeInProvince(
  state: GameState,
  provinceId: string,
  entity: EntityType,
): number {
  const province = state.provinces[provinceId];
  if (!province) return 0;
  if (entity === EntityType.TRADING_POST) {
    return getProvinceTradingPosts(state, provinceId).length;
  }
  let count = 0;
  for (const key of province.hexKeys) {
    if (state.cells[key]?.entity === entity) {
      count++;
    }
  }
  return count;
}

export function getFarmCost(farmCountInProvince: number): number {
  return BASE_FARM_COST + farmCountInProvince * FARM_COST_STEP;
}

/**
 * Arithmetic cost progression per entity type: cheaper base cost,
 * increasing linearly with each existing unit/building of the same type in the province.
 */
export function getPurchaseCost(
  entity: PurchasableEntity,
  existingOfTypeInProvince: number,
): number {
  const meta = ENTITY_META[entity];
  return meta.cost + Math.max(0, existingOfTypeInProvince) * meta.costStep;
}

export function getProvincePurchaseCost(
  state: GameState,
  provinceId: string,
  entity: PurchasableEntity,
): number {
  const existing = countEntityTypeInProvince(state, provinceId, entity);
  return getPurchaseCost(entity, existing);
}

/**
 * Returns exact 25% demolition refund based on the last built progressive cost of that building type.
 */
export function getDemolishRefund(
  entity: EntityType,
  existingOfTypeInProvince: number,
): number {
  if (!isDemolishable(entity)) return 0;
  const meta = ENTITY_META[entity];
  const lastBuiltCost =
    meta.cost + Math.max(0, existingOfTypeInProvince - 1) * meta.costStep;
  return Math.max(1, Math.floor(lastBuiltCost * DEMOLISH_REFUND_RATE));
}

export type CoverageAreaKind =
  | 'defense'
  | 'catapult'
  | 'beacon'
  | 'flare'
  | 'regenerator'
  | 'economy';

export interface HexCoverageArea {
  readonly centerKey: HexKey;
  readonly radius: number;
  readonly kind: CoverageAreaKind;
}

/**
 * Checks whether a hex lies within the active influence radius of any friendly Regenerator.
 */
export function isHexInRegeneratorRadius(
  state: GameState,
  faction: FactionId,
  key: HexKey,
): boolean {
  const regs = state.regenerators;
  if (!regs || regs.length === 0) return false;
  const targetCoord = parseHexKey(key);
  for (const reg of regs) {
    if (reg.faction !== faction || reg.turnsRemaining <= 0) continue;
    if (hexDistance(parseHexKey(reg.centerKey), targetCoord) <= reg.radius) {
      return true;
    }
  }
  return false;
}

/**
 * Computes effective combat strength for a unit on `hexKey`, adding +1 if the unit
 * is under the influence of a friendly Regenerator.
 */
export function getEffectiveUnitStrength(
  state: GameState,
  faction: FactionId,
  entity: EntityType,
  hexKeyForCheck: HexKey,
): number {
  const base = getUnitStrength(entity);
  if (base <= 0) return 0;
  if (isHexInRegeneratorRadius(state, faction, hexKeyForCheck)) {
    return base + REGENERATOR_STRENGTH_BONUS;
  }
  return base;
}

/**
 * Returns the animated coverage zone when inspecting a defensive structure,
 * catapult, beacon, illumination flare, or regenerator on a hex.
 */
export function getHexCoverageArea(
  state: GameState,
  key: HexKey,
  viewerFaction?: FactionId,
): HexCoverageArea | null {
  const reg = (state.regenerators ?? []).find((r) => r.centerKey === key);
  if (reg) {
    return {centerKey: key, radius: reg.radius, kind: 'regenerator'};
  }
  const flare = state.flares.find(
    (f) => f.centerKey === key && f.turnsRemaining > 0,
  );
  if (flare) {
    return {centerKey: key, radius: flare.radius, kind: 'flare'};
  }
  const cell = state.cells[key];
  if (!cell) return null;

  switch (cell.entity) {
    case EntityType.TOWN:
    case EntityType.TOWER:
    case EntityType.STRONG_TOWER:
      return {centerKey: key, radius: 1, kind: 'defense'};
    case EntityType.CATAPULT:
      return {centerKey: key, radius: CATAPULT_RANGE, kind: 'catapult'};
    case EntityType.BEACON:
      return {
        centerKey: key,
        radius: ENTITY_META[EntityType.BEACON].visionRadius,
        kind: 'beacon',
      };
    case EntityType.TRADING_POST:
      return {centerKey: key, radius: 1, kind: 'economy'};
    default:
      return null;
  }
}

export function getUnitByStrength(strength: number): EntityType | null {
  switch (strength) {
    case 1:
      return EntityType.PEASANT;
    case 2:
      return EntityType.SPEARMAN;
    case 3:
      return EntityType.BARON;
    case 4:
      return EntityType.KNIGHT;
    default:
      return null;
  }
}

export function getMergedUnitType(
  first: EntityType,
  second: EntityType,
): EntityType | null {
  if (!isInfantryUnit(first) || !isInfantryUnit(second)) {
    return null;
  }
  const combined = getUnitStrength(first) + getUnitStrength(second);
  return combined <= 4 ? getUnitByStrength(combined) : null;
}

export function getHexProtection(state: GameState, targetKey: HexKey): number {
  const cell = state.cells[targetKey];
  if (!cell || cell.faction === FactionId.NEUTRAL) {
    return 0;
  }
  let maxDefense = getEntityDefense(cell.entity);
  for (const neighborKey of getNeighborKeys(targetKey)) {
    const neighbor = state.cells[neighborKey];
    if (neighbor && neighbor.faction === cell.faction) {
      const def = getEntityDefense(neighbor.entity);
      if (def > maxDefense) {
        maxDefense = def;
      }
    }
  }
  return maxDefense;
}

export function getTreeSpawnMultiplier(rate: TreeSpawnRate): number {
  switch (rate) {
    case TreeSpawnRate.NONE:
      return 0;
    case TreeSpawnRate.LOW:
      return 0.45;
    case TreeSpawnRate.NORMAL:
      return 1.0;
    case TreeSpawnRate.HIGH:
      return 2.0;
  }
}

export function getRelationKey(a: FactionId, b: FactionId): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function getRelation(
  state: GameState,
  a: FactionId,
  b: FactionId,
): DiplomaticRelation {
  if (a === b) return DiplomaticRelation.FRIEND;
  if (a === FactionId.NEUTRAL || b === FactionId.NEUTRAL) {
    return DiplomaticRelation.WAR;
  }
  if (!state.config.diplomacyEnabled) {
    return DiplomaticRelation.WAR;
  }
  return (
    state.diplomacy.relations[getRelationKey(a, b)] ??
    DiplomaticRelation.NEUTRAL
  );
}

export function canAttackFaction(
  state: GameState,
  attacker: FactionId,
  defender: FactionId,
): boolean {
  if (attacker === defender) return false;
  if (defender === FactionId.NEUTRAL) return true;
  if (!state.config.diplomacyEnabled) return true;
  return getRelation(state, attacker, defender) === DiplomaticRelation.WAR;
}

export function getFairLandPrice(cell: HexCell): number {
  switch (cell.entity) {
    case EntityType.FARM:
      return 28;
    case EntityType.TRADING_POST:
      return 52;
    case EntityType.TOWER:
      return 26;
    case EntityType.STRONG_TOWER:
      return 45;
    case EntityType.BEACON:
      return 22;
    case EntityType.PINE:
    case EntityType.PALM:
      return 12;
    default:
      return 18;
  }
}

/**
 * Computes all illuminated/visible hexes for `viewerFaction` under Fog of War.
 * Includes own territory, structures (Beacons = 5, Strong Towers = 4, Towers/Towns = 3),
 * allied (`FRIEND`) vision, and active remote illumination flares.
 */
export function computeVisibleHexes(
  state: GameState,
  viewerFaction: FactionId,
): Set<HexKey> {
  const allKeys = Object.keys(state.cells);
  if (!state.config.fogOfWar) {
    return new Set(allKeys);
  }

  const visible = new Set<HexKey>();
  const visionSources: Array<{q: number; r: number; radius: number}> = [];

  for (const cell of Object.values(state.cells)) {
    const sharesVision =
      cell.faction === viewerFaction ||
      (cell.faction !== FactionId.NEUTRAL &&
        state.config.diplomacyEnabled &&
        getRelation(state, viewerFaction, cell.faction) ===
          DiplomaticRelation.FRIEND);

    if (!sharesVision) continue;
    visible.add(cell.key);
    const radius = ENTITY_META[cell.entity].visionRadius;
    visionSources.push({q: cell.q, r: cell.r, radius});
  }

  // Active remote illumination flares illuminate the map for all players
  for (const flare of state.flares) {
    if (flare.turnsRemaining <= 0) continue;
    const coord = parseHexKey(flare.centerKey);
    visionSources.push({q: coord.q, r: coord.r, radius: flare.radius});
  }

  // Fast local axial neighborhood stamp O(V * r^2) instead of O(cells * sources)
  for (const src of visionSources) {
    const rad = src.radius;
    for (let dq = -rad; dq <= rad; dq++) {
      const rMin = Math.max(-rad, -dq - rad);
      const rMax = Math.min(rad, -dq + rad);
      for (let dr = rMin; dr <= rMax; dr++) {
        const k = hexKey(src.q + dq, src.r + dr);
        if (state.cells[k]) {
          visible.add(k);
        }
      }
    }
  }

  return visible;
}

export interface EconomyLineItem {
  readonly label: string;
  readonly count: number;
  readonly perUnit: number;
  readonly total: number;
  readonly kind: 'income' | 'upkeep' | 'blocked';
}

export interface ProvinceEconomyBreakdown {
  readonly provinceId: string;
  readonly money: number;
  readonly totalIncome: number;
  readonly totalUpkeep: number;
  readonly netIncome: number;
  readonly projectedMoney: number;
  readonly hexCount: number;
  readonly incomeItems: EconomyLineItem[];
  readonly upkeepItems: EconomyLineItem[];
  readonly blockedItems: EconomyLineItem[];
}

/**
 * Returns the primary (richest) province ID for a faction where diplomatic
 * subsidies are billed and credited.
 */
export function getSubsidyProvinceId(
  state: GameState,
  faction: FactionId,
): string | null {
  const provs = Object.values(state.provinces)
    .filter((p) => p.faction === faction)
    .sort((a, b) => {
      if (b.money !== a.money) return b.money - a.money;
      if (b.hexKeys.length !== a.hexKeys.length) {
        return b.hexKeys.length - a.hexKeys.length;
      }
      return a.id.localeCompare(b.id);
    });
  return provs[0]?.id ?? null;
}

/**
 * Returns all active (non-war, living) diplomatic subsidies incoming to and
 * outgoing from a faction, along with their per-turn totals.
 */
export function getActiveSubsidiesForFaction(
  state: GameState,
  faction: FactionId,
): {
  incoming: DiplomaticSubsidy[];
  outgoing: DiplomaticSubsidy[];
  incomingTotal: number;
  outgoingTotal: number;
} {
  const incoming: DiplomaticSubsidy[] = [];
  const outgoing: DiplomaticSubsidy[] = [];
  let incomingTotal = 0;
  let outgoingTotal = 0;

  if (!state.diplomacy?.subsidies || state.diplomacy.subsidies.length === 0) {
    return {incoming, outgoing, incomingTotal, outgoingTotal};
  }

  for (const sub of state.diplomacy.subsidies) {
    if (sub.turnsRemaining <= 0 || sub.amountPerTurn <= 0) continue;
    if (sub.fromFaction !== faction && sub.toFaction !== faction) continue;
    const fromInfo = state.factions[sub.fromFaction];
    const toInfo = state.factions[sub.toFaction];
    if (!fromInfo || fromInfo.isEliminated || !toInfo || toInfo.isEliminated) {
      continue;
    }
    if (
      getRelation(state, sub.fromFaction, sub.toFaction) ===
      DiplomaticRelation.WAR
    ) {
      continue;
    }
    if (sub.toFaction === faction) {
      incoming.push(sub);
      incomingTotal += sub.amountPerTurn;
    }
    if (sub.fromFaction === faction) {
      outgoing.push(sub);
      outgoingTotal += sub.amountPerTurn;
    }
  }

  return {incoming, outgoing, incomingTotal, outgoingTotal};
}

/**
 * Computes an exact itemized income & upkeep ledger for a province.
 */
export function computeProvinceEconomyBreakdown(
  state: GameState,
  provinceId: string,
): ProvinceEconomyBreakdown | null {
  const province = state.provinces[provinceId];
  if (!province) return null;

  let productiveHexes = 0;
  let farmCount = 0;
  let boostedFarmCount = 0;
  let pineCount = 0;
  let palmCount = 0;
  let graveCount = 0;
  const upkeepCounts = new Map<EntityType, number>();
  const provinceHexSet = new Set(province.hexKeys);
  const provinceRegenerators = (state.regenerators ?? []).filter(
    (r) =>
      r.faction === province.faction &&
      r.turnsRemaining > 0 &&
      provinceHexSet.has(r.centerKey),
  );

  for (const key of province.hexKeys) {
    const cell = state.cells[key];
    if (!cell) continue;
    if (cell.entity === EntityType.PINE) {
      pineCount++;
    } else if (cell.entity === EntityType.PALM) {
      palmCount++;
    } else if (cell.entity === EntityType.GRAVE) {
      graveCount++;
    } else {
      productiveHexes++;
      if (cell.entity === EntityType.FARM) {
        farmCount++;
        if (isHexInRegeneratorRadius(state, province.faction, key)) {
          boostedFarmCount++;
        }
      }
    }
    const up = getEntityUpkeep(cell.entity);
    if (up > 0) {
      upkeepCounts.set(cell.entity, (upkeepCounts.get(cell.entity) ?? 0) + 1);
    }
  }

  const provinceTradingPosts = getProvinceTradingPosts(state, provinceId);
  let tradingPostSynergyFarms = 0;
  for (const post of provinceTradingPosts) {
    tradingPostSynergyFarms += countTradingPostAdjacentFarms(
      state,
      province.faction,
      post.hexKeys,
    );
  }

  const incomeItems: EconomyLineItem[] = [];
  if (productiveHexes > 0) {
    incomeItems.push({
      label: 'Земли (базовый налог)',
      count: productiveHexes,
      perUnit: HEX_BASE_INCOME,
      total: productiveHexes * HEX_BASE_INCOME,
      kind: 'income',
    });
  }
  if (farmCount > 0) {
    incomeItems.push({
      label: 'Фермы (бонус урожая)',
      count: farmCount,
      perUnit: FARM_INCOME,
      total: farmCount * FARM_INCOME,
      kind: 'income',
    });
  }
  if (provinceTradingPosts.length > 0) {
    incomeItems.push({
      label: 'Торговые посады (база)',
      count: provinceTradingPosts.length,
      perUnit: TRADING_POST_BASE_INCOME,
      total: provinceTradingPosts.length * TRADING_POST_BASE_INCOME,
      kind: 'income',
    });
  }
  if (tradingPostSynergyFarms > 0) {
    incomeItems.push({
      label: 'Синергия посадов (фермы рядом)',
      count: tradingPostSynergyFarms,
      perUnit: TRADING_POST_FARM_SYNERGY,
      total: tradingPostSynergyFarms * TRADING_POST_FARM_SYNERGY,
      kind: 'income',
    });
  }
  if (boostedFarmCount > 0) {
    incomeItems.push({
      label: 'Регенератор (бонус ферм)',
      count: boostedFarmCount,
      perUnit: REGENERATOR_FARM_BONUS,
      total: boostedFarmCount * REGENERATOR_FARM_BONUS,
      kind: 'income',
    });
  }

  const blockedItems: EconomyLineItem[] = [];
  if (pineCount > 0) {
    blockedItems.push({
      label: 'Сосны (блокируют налог)',
      count: pineCount,
      perUnit: 0,
      total: 0,
      kind: 'blocked',
    });
  }
  if (palmCount > 0) {
    blockedItems.push({
      label: 'Пальмы (блокируют налог)',
      count: palmCount,
      perUnit: 0,
      total: 0,
      kind: 'blocked',
    });
  }
  if (graveCount > 0) {
    blockedItems.push({
      label: 'Могилы (прорастут деревом)',
      count: graveCount,
      perUnit: 0,
      total: 0,
      kind: 'blocked',
    });
  }

  const upkeepOrder: EntityType[] = [
    EntityType.PEASANT,
    EntityType.SPEARMAN,
    EntityType.BARON,
    EntityType.KNIGHT,
    EntityType.CATAPULT,
    EntityType.TOWER,
    EntityType.STRONG_TOWER,
    EntityType.BEACON,
  ];

  const upkeepItems: EconomyLineItem[] = [];
  for (const ent of upkeepOrder) {
    const count = upkeepCounts.get(ent) ?? 0;
    if (count > 0) {
      const perUnit = getEntityUpkeep(ent);
      upkeepItems.push({
        label: ENTITY_META[ent].label,
        count,
        perUnit: -perUnit,
        total: -count * perUnit,
        kind: 'upkeep',
      });
    }
  }
  if (provinceRegenerators.length > 0) {
    upkeepItems.push({
      label: 'Регенератор',
      count: provinceRegenerators.length,
      perUnit: -REGENERATOR_UPKEEP,
      total: -provinceRegenerators.length * REGENERATOR_UPKEEP,
      kind: 'upkeep',
    });
  }

  // Active diplomatic subsidies (billed/credited on the faction's primary province)
  const isSubsidyProvince =
    getSubsidyProvinceId(state, province.faction) === province.id;
  if (isSubsidyProvince) {
    const subs = getActiveSubsidiesForFaction(state, province.faction);
    for (const sub of subs.incoming) {
      const fromName =
        state.factions[sub.fromFaction]?.name ??
        FACTION_PALETTES[sub.fromFaction]?.name ??
        'Держава';
      incomeItems.push({
        label: `Дотации от «${fromName}» (${sub.turnsRemaining} х.)`,
        count: 1,
        perUnit: sub.amountPerTurn,
        total: sub.amountPerTurn,
        kind: 'income',
      });
    }
    for (const sub of subs.outgoing) {
      const toName =
        state.factions[sub.toFaction]?.name ??
        FACTION_PALETTES[sub.toFaction]?.name ??
        'Держава';
      upkeepItems.push({
        label: `Дотации «${toName}» (${sub.turnsRemaining} х.)`,
        count: 1,
        perUnit: -sub.amountPerTurn,
        total: -sub.amountPerTurn,
        kind: 'upkeep',
      });
    }
  }

  return {
    provinceId: province.id,
    money: province.money,
    totalIncome: province.income,
    totalUpkeep: province.upkeep,
    netIncome: province.netIncome,
    projectedMoney: province.money + province.netIncome,
    hexCount: province.hexKeys.length,
    incomeItems,
    upkeepItems,
    blockedItems,
  };
}

