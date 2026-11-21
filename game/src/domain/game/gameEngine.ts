import {
  getNeighborKeys,
  hexDistance,
  type HexKey,
} from '@/domain/hex/hexCoordinates';
import {
  canAttackFaction,
  CATAPULT_MIN_RANGE,
  CATAPULT_MOVE_STEPS,
  CATAPULT_RANGE,
  computeVisibleHexes,
  countEntityTypeInProvince,
  countTradingPostAdjacentFarms,
  FARM_INCOME,
  findBestTradingPostFootprint,
  FLARE_COST,
  FLARE_DURATION_TURNS,
  FLARE_RADIUS,
  getActiveSubsidiesForFaction,
  getDemolishRefund,
  getEffectiveUnitStrength,
  getEntityUpkeep,
  getHexProtection,
  getMergedUnitType,
  getProvincePurchaseCost,
  getSubsidyProvinceId,
  getTradingPostClusterAt,
  getTreeSpawnMultiplier,
  HEX_BASE_INCOME,
  isCatapult,
  isDemolishable,
  isHexInRegeneratorRadius,
  isTree,
  isUnit,
  MAX_UNIT_MOVE_STEPS,
  REGENERATOR_COST,
  REGENERATOR_DURATION_TURNS,
  REGENERATOR_FARM_BONUS,
  REGENERATOR_RADIUS,
  REGENERATOR_UPKEEP,
  TRADING_POST_BASE_INCOME,
  TRADING_POST_FARM_SYNERGY,
  TREE_CHOP_BONUS,
} from '@/domain/game/rules';
import {
  EntityType,
  FactionId,
  GameEventType,
  type GameEvent,
  type GameState,
  type Province,
  type PurchasableEntity,
} from '@/domain/game/types';
import {
  nextRandom,
  recalculateFactionSummaries,
} from '@/domain/game/mapGenerator';
import {
  processTurnSubsidies,
  tickBlackMarkPairs,
  tickFriendshipTimers,
} from '@/domain/game/diplomacyService';

export function cloneGameState(state: GameState): GameState {
  // GameState is strictly JSON-serializable; JSON round-trip safely clones Vue 3 reactive Proxies
  return JSON.parse(JSON.stringify(state)) as GameState;
}

export function getActiveFaction(state: GameState): FactionId {
  return state.turnOrder[state.activeFactionIndex];
}

function pushEvent(
  events: GameEvent[],
  state: GameState,
  payload: Omit<GameEvent, 'id'>,
): void {
  events.push({
    id: state.nextEventId++,
    ...payload,
  });
}

function computeProvinceEconomics(
  state: GameState,
  faction: FactionId,
  hexKeys: HexKey[],
): {
  income: number;
  upkeep: number;
  netIncome: number;
  farmCount: number;
  tradingPostCount: number;
} {
  let income = 0;
  let upkeep = 0;
  let farmCount = 0;
  let tradingPostCount = 0;
  const hexSet = new Set(hexKeys);

  for (const key of hexKeys) {
    const cell = state.cells[key];
    if (!cell) continue;
    if (cell.entity === EntityType.FARM) {
      farmCount++;
      income += HEX_BASE_INCOME + FARM_INCOME;
      if (isHexInRegeneratorRadius(state, faction, key)) {
        income += REGENERATOR_FARM_BONUS;
      }
    } else if (!isTree(cell.entity) && cell.entity !== EntityType.GRAVE) {
      income += HEX_BASE_INCOME;
    }
    upkeep += getEntityUpkeep(cell.entity);
  }

  for (const post of state.tradingPosts ?? []) {
    if (
      post.faction === faction &&
      post.hexKeys.every(
        (k) => hexSet.has(k) && state.cells[k]?.entity === EntityType.TRADING_POST,
      )
    ) {
      tradingPostCount++;
      const adjFarms = countTradingPostAdjacentFarms(
        state,
        faction,
        post.hexKeys,
      );
      income +=
        TRADING_POST_BASE_INCOME + adjFarms * TRADING_POST_FARM_SYNERGY;
    }
  }

  for (const reg of state.regenerators ?? []) {
    if (
      reg.faction === faction &&
      reg.turnsRemaining > 0 &&
      hexSet.has(reg.centerKey)
    ) {
      upkeep += REGENERATOR_UPKEEP;
    }
  }

  return {
    income,
    upkeep,
    netIncome: income - upkeep,
    farmCount,
    tradingPostCount,
  };
}

function dismantleTradingPostCluster(
  state: GameState,
  clusterId: number,
  clearToNone = true,
): void {
  if (!state.tradingPosts) return;
  const idx = state.tradingPosts.findIndex((c) => c.id === clusterId);
  if (idx === -1) return;
  const [cluster] = state.tradingPosts.splice(idx, 1);
  if (clearToNone) {
    for (const k of cluster.hexKeys) {
      const c = state.cells[k];
      if (c && c.entity === EntityType.TRADING_POST) {
        c.entity = EntityType.NONE;
      }
    }
  }
}

export function reconcileProvinces(
  state: GameState,
  initialMoneyOverride?: number,
): void {
  if (!state.regenerators) {
    state.regenerators = [];
  }
  if (!state.tradingPosts) {
    state.tradingPosts = [];
  }
  if (!state.nextTradingPostId) {
    state.nextTradingPostId = 1;
  }
  // Remove any regenerator whose hex was captured by another faction
  state.regenerators = state.regenerators.filter(
    (r) =>
      r.turnsRemaining > 0 &&
      state.cells[r.centerKey]?.faction === r.faction,
  );

  const previousProvinces = state.provinces;
  const previousProvinceMap = new Map<string, Province>();
  for (const p of Object.values(previousProvinces)) {
    previousProvinceMap.set(p.id, p);
  }

  const oldProvinceByHex = new Map<HexKey, string>();
  for (const cell of Object.values(state.cells)) {
    if (cell.provinceId) {
      oldProvinceByHex.set(cell.key, cell.provinceId);
    }
    cell.provinceId = null;
  }

  const visited = new Set<HexKey>();
  const newComponents: Array<{faction: FactionId; keys: HexKey[]}> = [];

  for (const cell of Object.values(state.cells)) {
    if (cell.faction === FactionId.NEUTRAL || visited.has(cell.key)) continue;
    const queue: HexKey[] = [cell.key];
    const comp: HexKey[] = [];
    visited.add(cell.key);

    while (queue.length > 0) {
      const currKey = queue.shift()!;
      comp.push(currKey);
      for (const nKey of getNeighborKeys(currKey)) {
        const neighbor = state.cells[nKey];
        if (
          neighbor &&
          neighbor.faction === cell.faction &&
          !visited.has(nKey)
        ) {
          visited.add(nKey);
          queue.push(nKey);
        }
      }
    }

    if (comp.length >= 2) {
      newComponents.push({faction: cell.faction, keys: comp});
    } else {
      const lone = state.cells[comp[0]];
      if (
        lone.entity === EntityType.TOWN ||
        lone.entity === EntityType.TRADING_POST
      ) {
        lone.entity = EntityType.NONE;
      }
      if (isUnit(lone.entity)) {
        lone.entity = EntityType.GRAVE;
        lone.unitMoved = false;
      }
    }
  }

  const oldProvinceTotalSurviving = new Map<string, number>();
  for (const comp of newComponents) {
    for (const key of comp.keys) {
      const oldId = oldProvinceByHex.get(key);
      if (oldId && previousProvinceMap.has(oldId)) {
        const oldProv = previousProvinceMap.get(oldId)!;
        if (oldProv.faction === comp.faction) {
          oldProvinceTotalSurviving.set(
            oldId,
            (oldProvinceTotalSurviving.get(oldId) ?? 0) + 1,
          );
        }
      }
    }
  }

  const nextProvinces: Record<string, Province> = {};
  let provinceCounter = 1;

  for (const comp of newComponents) {
    const contribCounts = new Map<string, number>();
    for (const key of comp.keys) {
      const oldId = oldProvinceByHex.get(key);
      if (oldId && previousProvinceMap.has(oldId)) {
        const oldProv = previousProvinceMap.get(oldId)!;
        if (oldProv.faction === comp.faction) {
          contribCounts.set(oldId, (contribCounts.get(oldId) ?? 0) + 1);
        }
      }
    }

    let money = initialMoneyOverride ?? 0;
    if (initialMoneyOverride === undefined) {
      for (const [oldId, hexCountInComp] of contribCounts.entries()) {
        const oldProv = previousProvinceMap.get(oldId)!;
        const totalSurviving = oldProvinceTotalSurviving.get(oldId) ?? 1;
        money += Math.round((oldProv.money * hexCountInComp) / totalSurviving);
      }
    }

    const townKeys = comp.keys.filter(
      (k) => state.cells[k].entity === EntityType.TOWN,
    );
    let primaryTownKey: HexKey;

    if (townKeys.length >= 1) {
      primaryTownKey = townKeys[0];
      for (let i = 1; i < townKeys.length; i++) {
        state.cells[townKeys[i]].entity = EntityType.NONE;
      }
    } else {
      const emptyHex = comp.keys.find(
        (k) => state.cells[k].entity === EntityType.NONE,
      );
      const nonCriticalHex = comp.keys.find(
        (k) =>
          !isUnit(state.cells[k].entity) &&
          state.cells[k].entity !== EntityType.TRADING_POST,
      );
      const nonUnitHex = comp.keys.find(
        (k) => !isUnit(state.cells[k].entity),
      );
      primaryTownKey =
        emptyHex ?? nonCriticalHex ?? nonUnitHex ?? comp.keys[0];
      state.cells[primaryTownKey].entity = EntityType.TOWN;
      state.cells[primaryTownKey].unitMoved = false;
    }

    const stableId = `prov_${comp.faction}_${primaryTownKey}`;
    const provId = nextProvinces[stableId]
      ? `${stableId}_${provinceCounter++}`
      : stableId;

    for (const key of comp.keys) {
      state.cells[key].provinceId = provId;
    }

    nextProvinces[provId] = {
      id: provId,
      faction: comp.faction,
      hexKeys: comp.keys,
      townKey: primaryTownKey,
      money,
      income: 0,
      upkeep: 0,
      netIncome: 0,
      farmCount: 0,
      tradingPostCount: 0,
    };
  }

  // Validate 3-hex Trading Post clusters: every cluster must have all 3 hexes intact in the same province
  const survivingPosts: NonNullable<GameState['tradingPosts']> = [];
  const validTradingPostHexes = new Set<HexKey>();
  for (const post of state.tradingPosts) {
    const firstCell = state.cells[post.hexKeys[0]];
    const sharedProvId = firstCell?.provinceId ?? null;
    const intact =
      sharedProvId !== null &&
      post.hexKeys.every((k) => {
        const c = state.cells[k];
        return (
          Boolean(c) &&
          c.faction === post.faction &&
          c.provinceId === sharedProvId &&
          c.entity === EntityType.TRADING_POST
        );
      });
    if (intact) {
      survivingPosts.push(post);
      for (const k of post.hexKeys) validTradingPostHexes.add(k);
    } else {
      for (const k of post.hexKeys) {
        const c = state.cells[k];
        if (c && c.entity === EntityType.TRADING_POST) {
          c.entity = EntityType.NONE;
        }
      }
    }
  }
  state.tradingPosts = survivingPosts;

  // Clear any orphaned TRADING_POST cells not belonging to a valid 3-hex cluster
  for (const cell of Object.values(state.cells)) {
    if (
      cell.entity === EntityType.TRADING_POST &&
      !validTradingPostHexes.has(cell.key)
    ) {
      cell.entity = EntityType.NONE;
    }
  }

  for (const prov of Object.values(nextProvinces)) {
    const econ = computeProvinceEconomics(state, prov.faction, prov.hexKeys);
    prov.income = econ.income;
    prov.upkeep = econ.upkeep;
    prov.netIncome = econ.netIncome;
    prov.farmCount = econ.farmCount;
    prov.tradingPostCount = econ.tradingPostCount;
  }

  state.provinces = nextProvinces;

  // Reflect active diplomatic subsidies in each faction's primary province economics
  for (const fId of state.turnOrder) {
    const subs = getActiveSubsidiesForFaction(state, fId);
    if (subs.incomingTotal === 0 && subs.outgoingTotal === 0) continue;
    const primaryId = getSubsidyProvinceId(state, fId);
    if (!primaryId || !state.provinces[primaryId]) continue;
    const prov = state.provinces[primaryId];
    prov.income += subs.incomingTotal;
    prov.upkeep += subs.outgoingTotal;
    prov.netIncome = prov.income - prov.upkeep;
  }

  recalculateFactionSummaries(state);
}

/**
 * Computes reachable movement hexes for a selected infantry unit or catapult.
 * Respects Diplomacy (can only capture neutral hexes or factions at WAR).
 */
export function computeReachableHexes(
  state: GameState,
  fromKey: HexKey,
): Map<HexKey, HexKey[]> {
  const result = new Map<HexKey, HexKey[]>();
  const startCell = state.cells[fromKey];
  if (
    !startCell ||
    !isUnit(startCell.entity) ||
    startCell.unitMoved ||
    !startCell.provinceId
  ) {
    return result;
  }

  const faction = startCell.faction;
  const provinceId = startCell.provinceId;
  const unitStrength = getEffectiveUnitStrength(
    state,
    faction,
    startCell.entity,
    fromKey,
  );
  const catapultMode = isCatapult(startCell.entity);
  const maxSteps = catapultMode ? CATAPULT_MOVE_STEPS : MAX_UNIT_MOVE_STEPS;

  const queue: Array<{key: HexKey; steps: number; path: HexKey[]}> = [
    {key: fromKey, steps: 0, path: [fromKey]},
  ];
  const visitedDist = new Map<HexKey, number>([[fromKey, 0]]);

  while (queue.length > 0) {
    const {key, steps, path} = queue.shift()!;
    if (steps >= maxSteps) continue;

    for (const nKey of getNeighborKeys(key)) {
      const neighbor = state.cells[nKey];
      if (!neighbor) continue;

      const nextPath = [...path, nKey];

      if (neighbor.faction === faction && neighbor.provinceId === provinceId) {
        const canLand = catapultMode
          ? neighbor.entity === EntityType.NONE ||
            neighbor.entity === EntityType.GRAVE
          : neighbor.entity === EntityType.NONE ||
            isTree(neighbor.entity) ||
            neighbor.entity === EntityType.GRAVE ||
            getMergedUnitType(startCell.entity, neighbor.entity) !== null;

        if (canLand && nKey !== fromKey && !result.has(nKey)) {
          result.set(nKey, nextPath);
        }

        const prevDist = visitedDist.get(nKey);
        if (
          !isTree(neighbor.entity) &&
          (prevDist === undefined || steps + 1 < prevDist)
        ) {
          visitedDist.set(nKey, steps + 1);
          queue.push({key: nKey, steps: steps + 1, path: nextPath});
        }
      } else if (!catapultMode && neighbor.faction !== faction) {
        if (!canAttackFaction(state, faction, neighbor.faction)) continue;
        const protection = getHexProtection(state, nKey);
        if (unitStrength > protection && !result.has(nKey)) {
          result.set(nKey, nextPath);
        }
      }
    }
  }

  return result;
}

/**
 * Computes valid bombardment targets for a selected ready Catapult (range 1..3).
 * Targets must be visible (if Fog of War is enabled), belong to a hostile faction at WAR,
 * and contain a destructible building, unit, or Town Hall.
 */
export function computeCatapultTargets(
  state: GameState,
  fromKey: HexKey,
): Set<HexKey> {
  const targets = new Set<HexKey>();
  const origin = state.cells[fromKey];
  if (
    !origin ||
    !isCatapult(origin.entity) ||
    origin.unitMoved ||
    !origin.provinceId
  ) {
    return targets;
  }

  const visible = computeVisibleHexes(state, origin.faction);

  for (const cell of Object.values(state.cells)) {
    if (cell.key === fromKey) continue;
    const dist = hexDistance(origin, cell);
    if (dist < CATAPULT_MIN_RANGE || dist > CATAPULT_RANGE) continue;
    if (!visible.has(cell.key)) continue;

    // Can bombard hostile factions at war (or clear trees on neutral/enemy hexes)
    const isHostileFaction =
      cell.faction !== origin.faction &&
      cell.faction !== FactionId.NEUTRAL &&
      canAttackFaction(state, origin.faction, cell.faction);

    if (
      isHostileFaction &&
      cell.entity !== EntityType.NONE &&
      cell.entity !== EntityType.GRAVE
    ) {
      targets.add(cell.key);
    }
  }

  return targets;
}

/**
 * Executes a Catapult boulder bombardment against a target hex.
 */
export function executeCatapultFire(
  state: GameState,
  fromKey: HexKey,
  targetKey: HexKey,
): GameEvent[] {
  const events: GameEvent[] = [];
  const activeFaction = getActiveFaction(state);
  const origin = state.cells[fromKey];
  const target = state.cells[targetKey];
  if (!origin || !target || origin.faction !== activeFaction) return events;

  const validTargets = computeCatapultTargets(state, fromKey);
  if (!validTargets.has(targetKey)) return events;

  origin.unitMoved = true;
  state.stats.catapultShots++;

  let impactNote = 'Попадание!';
  switch (target.entity) {
    case EntityType.STRONG_TOWER:
      target.entity = EntityType.TOWER;
      impactNote = 'Цитадель повреждена!';
      break;
    case EntityType.TRADING_POST: {
      const cluster = getTradingPostClusterAt(state, targetKey);
      if (cluster) {
        dismantleTradingPostCluster(state, cluster.id, true);
      } else {
        target.entity = EntityType.NONE;
      }
      impactNote = 'Торговый посад разрушен!';
      break;
    }
    case EntityType.TOWER:
    case EntityType.FARM:
    case EntityType.BEACON:
    case EntityType.PINE:
    case EntityType.PALM:
      target.entity = EntityType.NONE;
      impactNote = 'Укрепление разрушено!';
      break;
    case EntityType.KNIGHT:
      target.entity = EntityType.BARON;
      impactNote = 'Рыцарь ослаблен!';
      break;
    case EntityType.BARON:
      target.entity = EntityType.SPEARMAN;
      impactNote = 'Барон ослаблен!';
      break;
    case EntityType.SPEARMAN:
      target.entity = EntityType.PEASANT;
      impactNote = 'Копейщик ослаблен!';
      break;
    case EntityType.PEASANT:
    case EntityType.CATAPULT:
      target.entity = EntityType.GRAVE;
      target.unitMoved = false;
      impactNote = 'Отряд уничтожен!';
      break;
    case EntityType.TOWN: {
      const targetProv = target.provinceId
        ? state.provinces[target.provinceId]
        : null;
      if (targetProv) {
        const loss = Math.min(targetProv.money, 8);
        targetProv.money -= loss;
        impactNote = loss > 0 ? `Столица: -${loss} зол.` : 'Обстрел столицы!';
      }
      break;
    }
    default:
      break;
  }

  pushEvent(events, state, {
    type: GameEventType.CATAPULT_FIRED,
    faction: activeFaction,
    fromKey,
    toKey: targetKey,
    entity: EntityType.CATAPULT,
    note: impactNote,
  });

  reconcileProvinces(state);
  return events;
}

/**
 * Computes valid placement hexes when buying a unit or building from a province.
 */
export function computeBuildableHexes(
  state: GameState,
  provinceId: string,
  entityType: PurchasableEntity,
): Set<HexKey> {
  const valid = new Set<HexKey>();
  const province = state.provinces[provinceId];
  if (!province) return valid;

  const cost = getProvincePurchaseCost(state, provinceId, entityType);
  if (province.money < cost) return valid;

  if (entityType === EntityType.FARM) {
    for (const key of province.hexKeys) {
      const cell = state.cells[key];
      if (cell.entity !== EntityType.NONE) continue;
      const adjacentToSupport = getNeighborKeys(key).some((nk) => {
        const n = state.cells[nk];
        return (
          n &&
          n.provinceId === provinceId &&
          (n.entity === EntityType.TOWN ||
            n.entity === EntityType.FARM ||
            n.entity === EntityType.TRADING_POST)
        );
      });
      if (adjacentToSupport) {
        valid.add(key);
      }
    }
    return valid;
  }

  if (entityType === EntityType.TRADING_POST) {
    for (const key of province.hexKeys) {
      if (findBestTradingPostFootprint(state, provinceId, key) !== null) {
        valid.add(key);
      }
    }
    return valid;
  }

  if (
    entityType === EntityType.TOWER ||
    entityType === EntityType.BEACON ||
    entityType === EntityType.CATAPULT
  ) {
    for (const key of province.hexKeys) {
      if (state.cells[key].entity === EntityType.NONE) {
        valid.add(key);
      }
    }
    return valid;
  }

  if (entityType === EntityType.STRONG_TOWER) {
    for (const key of province.hexKeys) {
      const ent = state.cells[key].entity;
      if (ent === EntityType.NONE || ent === EntityType.TOWER) {
        valid.add(key);
      }
    }
    return valid;
  }

  // Infantry unit purchase
  for (const key of province.hexKeys) {
    const cell = state.cells[key];
    if (
      cell.entity === EntityType.NONE ||
      isTree(cell.entity) ||
      cell.entity === EntityType.GRAVE ||
      getMergedUnitType(entityType, cell.entity) !== null
    ) {
      valid.add(key);
    }

    const effectiveStrength = getEffectiveUnitStrength(
      state,
      province.faction,
      entityType,
      key,
    );

    for (const nKey of getNeighborKeys(key)) {
      const neighbor = state.cells[nKey];
      if (!neighbor || neighbor.faction === province.faction) continue;
      if (!canAttackFaction(state, province.faction, neighbor.faction)) {
        continue;
      }
      const protection = getHexProtection(state, nKey);
      if (effectiveStrength > protection) {
        valid.add(nKey);
      }
    }
  }

  return valid;
}

/**
 * Computes valid placement hexes for a Regenerator (any hex of the selected province
 * that does not already have an active Regenerator centered on it).
 */
export function computeRegeneratorHexes(
  state: GameState,
  provinceId: string,
): Set<HexKey> {
  const valid = new Set<HexKey>();
  const province = state.provinces[provinceId];
  if (!province || province.money < REGENERATOR_COST) return valid;
  const occupied = new Set((state.regenerators ?? []).map((r) => r.centerKey));
  for (const key of province.hexKeys) {
    if (!occupied.has(key)) {
      valid.add(key);
    }
  }
  return valid;
}

/**
 * Computes all buildings in a province eligible for demolition (25% refund).
 */
export function computeDemolishableHexes(
  state: GameState,
  provinceId: string,
): Set<HexKey> {
  const valid = new Set<HexKey>();
  const province = state.provinces[provinceId];
  if (!province) return valid;
  for (const key of province.hexKeys) {
    if (isDemolishable(state.cells[key].entity)) {
      valid.add(key);
    }
  }
  return valid;
}

/**
 * Demolishes a friendly building and refunds 25% of its cost to the province treasury.
 */
export function executeDemolishBuilding(
  state: GameState,
  provinceId: string,
  targetKey: HexKey,
): GameEvent[] {
  const events: GameEvent[] = [];
  const activeFaction = getActiveFaction(state);
  const province = state.provinces[provinceId];
  const cell = state.cells[targetKey];
  if (
    !province ||
    !cell ||
    province.faction !== activeFaction ||
    cell.provinceId !== provinceId ||
    !isDemolishable(cell.entity)
  ) {
    return events;
  }

  const removedEntity = cell.entity;
  const existingCount = countEntityTypeInProvince(
    state,
    provinceId,
    removedEntity,
  );
  const refund = getDemolishRefund(removedEntity, existingCount);
  if (removedEntity === EntityType.TRADING_POST) {
    const cluster = getTradingPostClusterAt(state, targetKey);
    if (cluster) {
      dismantleTradingPostCluster(state, cluster.id, true);
    } else {
      cell.entity = EntityType.NONE;
    }
  } else {
    cell.entity = EntityType.NONE;
  }
  province.money += refund;
  state.stats.buildingsDemolished++;

  pushEvent(events, state, {
    type: GameEventType.BUILDING_DEMOLISHED,
    faction: activeFaction,
    toKey: targetKey,
    entity: removedEntity,
    amount: refund,
  });

  reconcileProvinces(state);
  return events;
}

/**
 * Launches a remote illumination flare anywhere on the map to reveal Fog of War
 * where the player has no presence.
 */
export function executeLaunchFlare(
  state: GameState,
  provinceId: string,
  targetKey: HexKey,
): GameEvent[] {
  const events: GameEvent[] = [];
  const activeFaction = getActiveFaction(state);
  const province = state.provinces[provinceId];
  const cell = state.cells[targetKey];
  if (
    !province ||
    !cell ||
    province.faction !== activeFaction ||
    province.money < FLARE_COST
  ) {
    return events;
  }

  province.money -= FLARE_COST;
  state.flares.push({
    id: state.nextFlareId++,
    faction: activeFaction,
    centerKey: targetKey,
    radius: FLARE_RADIUS,
    turnsRemaining: FLARE_DURATION_TURNS,
  });

  pushEvent(events, state, {
    type: GameEventType.FLARE_LAUNCHED,
    faction: activeFaction,
    toKey: targetKey,
    amount: -FLARE_COST,
    note: `Освещено (${FLARE_DURATION_TURNS} х.)`,
  });

  recalculateFactionSummaries(state);
  return events;
}

/**
 * Places a green Regenerator beacon on a friendly province hex.
 * Lasts 3 turns: boosts nearby units (+1 strength) and farms (+4 income)
 * while draining extra upkeep (-6/turn).
 */
export function executePlaceRegenerator(
  state: GameState,
  provinceId: string,
  targetKey: HexKey,
): GameEvent[] {
  const events: GameEvent[] = [];
  const activeFaction = getActiveFaction(state);
  const province = state.provinces[provinceId];
  const cell = state.cells[targetKey];
  if (
    !province ||
    !cell ||
    province.faction !== activeFaction ||
    cell.provinceId !== provinceId ||
    province.money < REGENERATOR_COST
  ) {
    return events;
  }

  if (!state.regenerators) {
    state.regenerators = [];
  }
  if (!state.nextRegeneratorId) {
    state.nextRegeneratorId = 1;
  }
  if (state.regenerators.some((r) => r.centerKey === targetKey)) {
    return events;
  }

  province.money -= REGENERATOR_COST;
  state.regenerators.push({
    id: state.nextRegeneratorId++,
    faction: activeFaction,
    centerKey: targetKey,
    radius: REGENERATOR_RADIUS,
    turnsRemaining: REGENERATOR_DURATION_TURNS,
  });

  pushEvent(events, state, {
    type: GameEventType.REGENERATOR_PLACED,
    faction: activeFaction,
    toKey: targetKey,
    amount: -REGENERATOR_COST,
    note: `Регенератор (${REGENERATOR_DURATION_TURNS} х.)`,
  });

  reconcileProvinces(state);
  return events;
}

export function executeUnitMove(
  state: GameState,
  fromKey: HexKey,
  toKey: HexKey,
): GameEvent[] {
  const events: GameEvent[] = [];
  const activeFaction = getActiveFaction(state);
  const fromCell = state.cells[fromKey];
  const toCell = state.cells[toKey];
  if (!fromCell || !toCell || fromCell.faction !== activeFaction) {
    return events;
  }

  const reachable = computeReachableHexes(state, fromKey);
  const path = reachable.get(toKey);
  if (!path) return events;

  const movingEntity = fromCell.entity;
  const sourceProvinceId = fromCell.provinceId!;
  const province = state.provinces[sourceProvinceId];

  fromCell.entity = EntityType.NONE;
  fromCell.unitMoved = false;

  if (toCell.faction === activeFaction) {
    if (isTree(toCell.entity)) {
      toCell.entity = movingEntity;
      toCell.unitMoved = true;
      if (province) {
        province.money += TREE_CHOP_BONUS;
      }
      state.stats.treesChopped++;
      pushEvent(events, state, {
        type: GameEventType.UNIT_MOVED,
        faction: activeFaction,
        fromKey,
        toKey,
        entity: movingEntity,
        path,
      });
      pushEvent(events, state, {
        type: GameEventType.TREE_CHOPPED,
        faction: activeFaction,
        toKey,
        amount: TREE_CHOP_BONUS,
      });
    } else if (isUnit(toCell.entity)) {
      const merged = getMergedUnitType(movingEntity, toCell.entity);
      if (merged) {
        toCell.entity = merged;
        pushEvent(events, state, {
          type: GameEventType.UNIT_MOVED,
          faction: activeFaction,
          fromKey,
          toKey,
          entity: movingEntity,
          path,
        });
        pushEvent(events, state, {
          type: GameEventType.UNIT_MERGED,
          faction: activeFaction,
          toKey,
          entity: merged,
        });
      }
    } else {
      toCell.entity = movingEntity;
      toCell.unitMoved = true;
      pushEvent(events, state, {
        type: GameEventType.UNIT_MOVED,
        faction: activeFaction,
        fromKey,
        toKey,
        entity: movingEntity,
        path,
      });
    }
  } else {
    const choppedTree = isTree(toCell.entity);
    toCell.faction = activeFaction;
    toCell.entity = movingEntity;
    toCell.unitMoved = true;
    state.stats.hexesCaptured++;

    pushEvent(events, state, {
      type: GameEventType.UNIT_MOVED,
      faction: activeFaction,
      fromKey,
      toKey,
      entity: movingEntity,
      path,
    });
    pushEvent(events, state, {
      type: GameEventType.HEX_CAPTURED,
      faction: activeFaction,
      toKey,
      entity: movingEntity,
    });
    if (choppedTree) {
      state.stats.treesChopped++;
    }
  }

  reconcileProvinces(state);
  return events;
}

export function executeBuyAndPlace(
  state: GameState,
  provinceId: string,
  entityType: PurchasableEntity,
  targetKey: HexKey,
): GameEvent[] {
  const events: GameEvent[] = [];
  const activeFaction = getActiveFaction(state);
  const province = state.provinces[provinceId];
  const targetCell = state.cells[targetKey];

  if (!province || !targetCell || province.faction !== activeFaction) {
    return events;
  }

  const validHexes = computeBuildableHexes(state, provinceId, entityType);
  if (!validHexes.has(targetKey)) {
    return events;
  }

  const cost = getProvincePurchaseCost(state, provinceId, entityType);
  province.money -= cost;

  if (entityType === EntityType.TRADING_POST) {
    const footprint = findBestTradingPostFootprint(state, provinceId, targetKey);
    if (!footprint) {
      province.money += cost;
      return events;
    }
    if (!state.tradingPosts) state.tradingPosts = [];
    if (!state.nextTradingPostId) state.nextTradingPostId = 1;
    for (const hexKeyInCluster of footprint) {
      const c = state.cells[hexKeyInCluster];
      if (c) {
        c.entity = EntityType.TRADING_POST;
        c.unitMoved = false;
      }
    }
    state.tradingPosts.push({
      id: state.nextTradingPostId++,
      faction: activeFaction,
      anchorKey: footprint[0],
      hexKeys: footprint,
    });
    state.stats.farmsBuilt++;
    pushEvent(events, state, {
      type: GameEventType.BUILDING_BUILT,
      faction: activeFaction,
      toKey: footprint[0],
      entity: EntityType.TRADING_POST,
      amount: -cost,
      path: footprint,
    });
  } else if (
    entityType === EntityType.FARM ||
    entityType === EntityType.TOWER ||
    entityType === EntityType.STRONG_TOWER ||
    entityType === EntityType.BEACON
  ) {
    targetCell.entity = entityType;
    targetCell.unitMoved = false;
    if (entityType === EntityType.FARM) {
      state.stats.farmsBuilt++;
    }
    pushEvent(events, state, {
      type: GameEventType.BUILDING_BUILT,
      faction: activeFaction,
      toKey: targetKey,
      entity: entityType,
      amount: -cost,
    });
  } else {
    state.stats.unitsRecruited++;
    if (targetCell.faction === activeFaction) {
      if (isTree(targetCell.entity)) {
        targetCell.entity = entityType;
        targetCell.unitMoved = true;
        province.money += TREE_CHOP_BONUS;
        state.stats.treesChopped++;
        pushEvent(events, state, {
          type: GameEventType.UNIT_BOUGHT,
          faction: activeFaction,
          toKey: targetKey,
          entity: entityType,
          amount: -cost,
        });
        pushEvent(events, state, {
          type: GameEventType.TREE_CHOPPED,
          faction: activeFaction,
          toKey: targetKey,
          amount: TREE_CHOP_BONUS,
        });
      } else if (isUnit(targetCell.entity)) {
        const merged = getMergedUnitType(entityType, targetCell.entity);
        if (merged) {
          targetCell.entity = merged;
          pushEvent(events, state, {
            type: GameEventType.UNIT_MERGED,
            faction: activeFaction,
            toKey: targetKey,
            entity: merged,
            amount: -cost,
          });
        }
      } else {
        targetCell.entity = entityType;
        targetCell.unitMoved = false;
        pushEvent(events, state, {
          type: GameEventType.UNIT_BOUGHT,
          faction: activeFaction,
          toKey: targetKey,
          entity: entityType,
          amount: -cost,
        });
      }
    } else {
      targetCell.faction = activeFaction;
      targetCell.entity = entityType;
      targetCell.unitMoved = true;
      state.stats.hexesCaptured++;
      pushEvent(events, state, {
        type: GameEventType.UNIT_BOUGHT,
        faction: activeFaction,
        toKey: targetKey,
        entity: entityType,
        amount: -cost,
      });
      pushEvent(events, state, {
        type: GameEventType.HEX_CAPTURED,
        faction: activeFaction,
        toKey: targetKey,
        entity: entityType,
      });
    }
  }

  reconcileProvinces(state);
  return events;
}

function runEnvironmentalGrowth(state: GameState, events: GameEvent[]): void {
  const treeMult = getTreeSpawnMultiplier(state.config.treeSpawnRate);
  const newPines: HexKey[] = [];
  const newPalms: HexKey[] = [];

  for (const cell of Object.values(state.cells)) {
    if (cell.entity === EntityType.GRAVE) {
      if (treeMult === 0) {
        cell.entity = EntityType.NONE;
      } else if (cell.isCoastal) {
        newPalms.push(cell.key);
      } else {
        newPines.push(cell.key);
      }
      continue;
    }

    if (treeMult === 0 || cell.entity !== EntityType.NONE) continue;

    const neighbors = getNeighborKeys(cell.key)
      .map((nk) => state.cells[nk])
      .filter((c): c is NonNullable<typeof c> => Boolean(c));

    if (cell.isCoastal) {
      const adjacentPalms = neighbors.filter(
        (n) => n.entity === EntityType.PALM,
      ).length;
      const prob = Math.min(0.65, 0.24 * treeMult);
      if (adjacentPalms >= 1 && nextRandom(state) < prob) {
        newPalms.push(cell.key);
      }
    } else {
      const adjacentPines = neighbors.filter(
        (n) => n.entity === EntityType.PINE,
      ).length;
      const prob = Math.min(0.6, 0.22 * treeMult);
      if (adjacentPines >= 2 && nextRandom(state) < prob) {
        newPines.push(cell.key);
      }
    }
  }

  for (const key of newPines) {
    state.cells[key].entity = EntityType.PINE;
    pushEvent(events, state, {
      type: GameEventType.TREE_GROWN,
      faction: state.cells[key].faction,
      toKey: key,
      entity: EntityType.PINE,
    });
  }
  for (const key of newPalms) {
    state.cells[key].entity = EntityType.PALM;
    pushEvent(events, state, {
      type: GameEventType.TREE_GROWN,
      faction: state.cells[key].faction,
      toKey: key,
      entity: EntityType.PALM,
    });
  }
}

export function advanceTurn(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  if (state.winner !== null) return events;

  const totalFactions = state.turnOrder.length;
  let wrappedRound = false;
  let nextIndex = state.activeFactionIndex;

  for (let step = 0; step < totalFactions; step++) {
    nextIndex = (nextIndex + 1) % totalFactions;
    if (nextIndex === 0) {
      wrappedRound = true;
    }
    const candidate = state.turnOrder[nextIndex];
    if (!state.factions[candidate].isEliminated) {
      break;
    }
  }

  state.activeFactionIndex = nextIndex;
  if (wrappedRound) {
    state.turn++;
    state.stats.turnsPlayed = state.turn;
    runEnvironmentalGrowth(state, events);

    // Tick down pairwise Black Marks & timed Friendships
    tickBlackMarkPairs(state);
    tickFriendshipTimers(state);

    // Tick down remote illumination flares
    state.flares = state.flares
      .map((f) => ({...f, turnsRemaining: f.turnsRemaining - 1}))
      .filter((f) => f.turnsRemaining > 0);
  }

  const nextFaction = getActiveFaction(state);

  for (const cell of Object.values(state.cells)) {
    if (cell.faction === nextFaction && isUnit(cell.entity)) {
      cell.unitMoved = false;
    }
  }

  reconcileProvinces(state);
  const activeSubsidies = getActiveSubsidiesForFaction(state, nextFaction);
  const subsidyProvId = getSubsidyProvinceId(state, nextFaction);
  for (const province of Object.values(state.provinces)) {
    if (province.faction !== nextFaction) continue;
    // Apply base province economics; diplomatic subsidies are transferred directly
    // by processTurnSubsidies below so neither payer nor receiver is double-counted.
    const subsidyDelta =
      province.id === subsidyProvId
        ? activeSubsidies.incomingTotal - activeSubsidies.outgoingTotal
        : 0;
    province.money += province.netIncome - subsidyDelta;
    if (province.money < 0) {
      province.money = 0;
      for (const key of province.hexKeys) {
        const cell = state.cells[key];
        if (isUnit(cell.entity)) {
          cell.entity = EntityType.GRAVE;
          cell.unitMoved = false;
        }
      }
      pushEvent(events, state, {
        type: GameEventType.PROVINCE_BANKRUPT,
        faction: nextFaction,
        toKey: province.townKey,
      });
    }
  }

  // Apply active diplomatic subsidies for the starting faction
  processTurnSubsidies(state, nextFaction);

  // Decrement active Regenerators owned by `nextFaction` after their turn's harvest
  if (state.regenerators && state.regenerators.length > 0) {
    state.regenerators = state.regenerators
      .map((r) =>
        r.faction === nextFaction
          ? {...r, turnsRemaining: r.turnsRemaining - 1}
          : r,
      )
      .filter((r) => r.turnsRemaining > 0);
  }

  reconcileProvinces(state);

  if (wrappedRound) {
    for (const fId of state.turnOrder) {
      if (!state.incomeHistory[fId]) state.incomeHistory[fId] = [];
      state.incomeHistory[fId].push(state.factions[fId].totalNetIncome);
      if (state.incomeHistory[fId].length > 18) {
        state.incomeHistory[fId].shift();
      }
    }
  }

  pushEvent(events, state, {
    type: GameEventType.TURN_CHANGED,
    faction: nextFaction,
  });

  if (state.winner !== null) {
    pushEvent(events, state, {
      type: GameEventType.GAME_WON,
      faction: state.winner,
    });
  }

  return events;
}
