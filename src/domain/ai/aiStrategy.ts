import {getNeighborKeys, type HexKey} from '@/domain/hex/hexCoordinates';
import {
  BLACK_MARK_COST,
  getRelation,
  getRelationKey,
  getSubsidyProvinceId,
  getUnitStrength,
  isUnit,
} from '@/domain/game/rules';
import {
  AiDifficulty,
  DiplomaticMessageStatus,
  DiplomaticRelation,
  EntityType,
  ExchangeItemType,
  FactionId,
  type ExchangeOffer,
  type ExchangeSideOffer,
  type GameState,
  type Province,
} from '@/domain/game/types';

export type FactionPowerTier = 'HEGEMON' | 'STRONG' | 'MID' | 'WEAK';

export interface FactionPowerProfile {
  readonly factionId: FactionId;
  readonly hexCount: number;
  readonly provinceCount: number;
  readonly farmCount: number;
  readonly totalMoney: number;
  readonly totalGrossIncome: number;
  readonly totalUpkeep: number;
  readonly totalNetIncome: number;
  readonly avgRecentIncome: number;
  readonly incomeTrend: number;
  readonly militaryScore: number;
  readonly globalIncomeShare: number;
  readonly globalHexShare: number;
  readonly powerScore: number;
  readonly rank: number;
  readonly tier: FactionPowerTier;
  readonly friendCount: number;
  readonly warCount: number;
  readonly friendsNeededToWin: number;
  readonly isDiplomaticThreat: boolean;
}

export interface WorldPowerAssessment {
  readonly livingFactions: FactionId[];
  readonly profiles: Record<number, FactionPowerProfile>;
  readonly ranked: FactionPowerProfile[];
  readonly totalWorldHexes: number;
  readonly totalWorldGrossIncome: number;
  readonly totalWorldNetIncome: number;
  readonly avgPowerScore: number;
  readonly avgNetIncome: number;
  readonly hegemonFaction: FactionId | null;
  readonly diplomaticFrontrunner: FactionId | null;
}

export interface PairTrustSummary {
  readonly trustScore: number;
  readonly pastFriendshipTurns: number;
  readonly friendshipsCompleted: number;
  readonly betrayalsAgainstMe: number;
  readonly globalBetrayals: number;
  readonly subsidiesBrokenAgainstMe: number;
  readonly globalSubsidiesBroken: number;
  readonly warsFought: number;
  readonly lastWarEndedTurn: number;
  readonly dealsAccepted: number;
  readonly rejectedDeals: number;
  readonly giftsGiven: number;
}

export interface AiNeedProfile {
  readonly cashUrgency: number; // 0..1 (high when low money / deficit)
  readonly incomeUrgency: number; // 0..1 (high when netIncome weak vs world)
  readonly peaceUrgency: number; // 0..1 (high when losing wars or stretched thin)
  readonly allyUrgency: number; // 0..1 (high when fighting stronger/multiple enemies)
  readonly landUrgency: number; // 0..1 (high when cramped or trailing in hexes)
  readonly isFinanciallyStrong: boolean;
  readonly isBankruptRisk: boolean;
  readonly primaryEnemy: FactionId | null;
  readonly activeWars: FactionId[];
  readonly neutralFrontierCount: number;
  readonly borderingFactions: Set<FactionId>;
  readonly factionBorders: Map<FactionId, Set<FactionId>>;
}

export interface AiDealEvaluation {
  readonly accepts: boolean;
  readonly reason?: string;
  readonly netScore: number;
}

export type AiDiplomaticIntent =
  | {readonly kind: 'CANCEL_SUBSIDY'; readonly subsidyId: number}
  | {readonly kind: 'DECLARE_WAR'; readonly target: FactionId}
  | {
      readonly kind: 'BLACK_MARK';
      readonly target: FactionId;
      readonly provinceId: string;
    }
  | {
      readonly kind: 'PROPOSE_EXCHANGE';
      readonly target: FactionId;
      readonly offer: ExchangeOffer;
      readonly provinceId?: string;
    };

export interface DiplomacyStrategyHelpers {
  readonly canFormFriendship: (
    state: GameState,
    a: FactionId,
    b: FactionId,
  ) => {allowed: boolean; reason?: string};
  readonly hasBlackMarkBetween: (
    state: GameState,
    a: FactionId,
    b: FactionId,
  ) => boolean;
  readonly getTransferableFreeHexes: (
    state: GameState,
    fromFaction: FactionId,
    toFaction: FactionId,
  ) => HexKey[];
  readonly isFreeTransferableHex: (
    state: GameState,
    fromFaction: FactionId,
    key: HexKey,
  ) => boolean;
}

export function getTrustKey(actor: FactionId, target: FactionId): string {
  return `${actor}->${target}`;
}

function getRichestProvinceForFaction(
  state: GameState,
  faction: FactionId,
): Province | null {
  const id = getSubsidyProvinceId(state, faction);
  return id ? (state.provinces[id] ?? null) : null;
}

function computeBorderGraph(state: GameState): Map<FactionId, Set<FactionId>> {
  const borders = new Map<FactionId, Set<FactionId>>();
  for (const cell of Object.values(state.cells)) {
    if (cell.faction === FactionId.NEUTRAL) continue;
    for (const nk of getNeighborKeys(cell.key)) {
      const n = state.cells[nk];
      if (!n || n.faction === FactionId.NEUTRAL || n.faction === cell.faction) {
        continue;
      }
      let set = borders.get(cell.faction);
      if (!set) {
        set = new Set<FactionId>();
        borders.set(cell.faction, set);
      }
      set.add(n.faction);
    }
  }
  return borders;
}

/**
 * Evaluates every surviving faction's economic, territorial, military, and
 * diplomatic standing — including share of global income and proximity to
 * diplomatic ("world peace") victory.
 */
export function evaluateWorldPower(state: GameState): WorldPowerAssessment {
  const livingFactions = state.turnOrder.filter(
    (f) => state.factions[f] && !state.factions[f].isEliminated,
  );

  const provinceCounts = new Map<FactionId, number>();
  const farmCounts = new Map<FactionId, number>();
  const grossIncomeByFaction = new Map<FactionId, number>();
  const upkeepByFaction = new Map<FactionId, number>();
  const militaryByFaction = new Map<FactionId, number>();

  for (const f of livingFactions) {
    provinceCounts.set(f, 0);
    farmCounts.set(f, 0);
    grossIncomeByFaction.set(f, 0);
    upkeepByFaction.set(f, 0);
    militaryByFaction.set(f, 0);
  }

  for (const prov of Object.values(state.provinces)) {
    const f = prov.faction;
    if (!provinceCounts.has(f)) continue;
    provinceCounts.set(f, (provinceCounts.get(f) ?? 0) + 1);
    farmCounts.set(f, (farmCounts.get(f) ?? 0) + prov.farmCount);
    grossIncomeByFaction.set(
      f,
      (grossIncomeByFaction.get(f) ?? 0) + prov.income,
    );
    upkeepByFaction.set(f, (upkeepByFaction.get(f) ?? 0) + prov.upkeep);
  }

  for (const cell of Object.values(state.cells)) {
    const f = cell.faction;
    if (f === FactionId.NEUTRAL || !militaryByFaction.has(f)) continue;
    let mil = 0;
    if (isUnit(cell.entity)) {
      mil =
        cell.entity === EntityType.CATAPULT
          ? 3.2
          : getUnitStrength(cell.entity) * 1.45;
    } else if (cell.entity === EntityType.STRONG_TOWER) {
      mil = 2.6;
    } else if (cell.entity === EntityType.TOWER) {
      mil = 1.4;
    }
    if (mil > 0) {
      militaryByFaction.set(f, (militaryByFaction.get(f) ?? 0) + mil);
    }
  }

  let totalWorldHexes = 0;
  let totalWorldGrossIncome = 0;
  let totalWorldNetIncome = 0;

  for (const f of livingFactions) {
    const info = state.factions[f];
    totalWorldHexes += info.hexCount;
    totalWorldGrossIncome += Math.max(0, grossIncomeByFaction.get(f) ?? 0);
    totalWorldNetIncome += info.totalNetIncome;
  }

  const rawProfiles: Array<{
    factionId: FactionId;
    hexCount: number;
    provinceCount: number;
    farmCount: number;
    totalMoney: number;
    totalGrossIncome: number;
    totalUpkeep: number;
    totalNetIncome: number;
    avgRecentIncome: number;
    incomeTrend: number;
    militaryScore: number;
    globalIncomeShare: number;
    globalHexShare: number;
    powerScore: number;
    friendCount: number;
    warCount: number;
    friendsNeededToWin: number;
  }> = [];

  for (const f of livingFactions) {
    const info = state.factions[f];
    const gross = grossIncomeByFaction.get(f) ?? 0;
    const upkeep = upkeepByFaction.get(f) ?? 0;
    const mil = militaryByFaction.get(f) ?? 0;
    const hist = state.incomeHistory[f] ?? [info.totalNetIncome];
    const recent = hist.slice(-5);
    const avgRecentIncome =
      recent.reduce((sum, v) => sum + v, 0) / Math.max(1, recent.length);
    const incomeTrend =
      recent.length >= 2 ? recent[recent.length - 1] - recent[0] : 0;

    const globalIncomeShare =
      totalWorldGrossIncome > 0
        ? Math.max(0, gross) / totalWorldGrossIncome
        : 1 / Math.max(1, livingFactions.length);
    const globalHexShare =
      totalWorldHexes > 0
        ? info.hexCount / totalWorldHexes
        : 1 / Math.max(1, livingFactions.length);

    let friendCount = 0;
    let warCount = 0;
    for (const other of livingFactions) {
      if (other === f) continue;
      const rel = getRelation(state, f, other);
      if (rel === DiplomaticRelation.FRIEND) friendCount++;
      else if (rel === DiplomaticRelation.WAR) warCount++;
    }

    const friendsNeededToWin = Math.max(
      0,
      livingFactions.length - 1 - friendCount,
    );

    const powerScore = Math.max(
      1,
      info.hexCount * 2.2 +
        gross * 2.8 +
        Math.max(-18, info.totalNetIncome) * 2.3 +
        Math.max(-10, Math.min(18, incomeTrend)) * 1.4 +
        Math.min(180, info.totalMoney) * 0.42 +
        mil * 2.9,
    );

    rawProfiles.push({
      factionId: f,
      hexCount: info.hexCount,
      provinceCount: provinceCounts.get(f) ?? 0,
      farmCount: farmCounts.get(f) ?? 0,
      totalMoney: info.totalMoney,
      totalGrossIncome: gross,
      totalUpkeep: upkeep,
      totalNetIncome: info.totalNetIncome,
      avgRecentIncome,
      incomeTrend,
      militaryScore: mil,
      globalIncomeShare,
      globalHexShare,
      powerScore,
      friendCount,
      warCount,
      friendsNeededToWin,
    });
  }

  rawProfiles.sort((a, b) => b.powerScore - a.powerScore);

  const avgPowerScore =
    rawProfiles.reduce((s, p) => s + p.powerScore, 0) /
    Math.max(1, rawProfiles.length);
  const avgNetIncome =
    rawProfiles.reduce((s, p) => s + p.totalNetIncome, 0) /
    Math.max(1, rawProfiles.length);
  const secondPower = rawProfiles[1]?.powerScore ?? avgPowerScore;

  const profiles: Record<number, FactionPowerProfile> = {};
  const ranked: FactionPowerProfile[] = [];
  let hegemonFaction: FactionId | null = null;
  let diplomaticFrontrunner: FactionId | null = null;
  let smallestFriendsNeeded = 999;

  for (let i = 0; i < rawProfiles.length; i++) {
    const raw = rawProfiles[i];
    const rank = i + 1;
    const isHegemon =
      livingFactions.length >= 3 &&
      state.turn >= 4 &&
      (raw.globalIncomeShare >= 0.36 ||
        raw.globalHexShare >= 0.38 ||
        (rank === 1 && raw.powerScore >= secondPower * 1.38));

    let tier: FactionPowerTier = 'MID';
    if (isHegemon) {
      tier = 'HEGEMON';
      if (hegemonFaction === null) hegemonFaction = raw.factionId;
    } else if (rank === 1 || raw.powerScore >= avgPowerScore * 1.18) {
      tier = 'STRONG';
    } else if (raw.powerScore <= avgPowerScore * 0.72) {
      tier = 'WEAK';
    }

    const isDiplomaticThreat =
      state.config.diplomacyEnabled &&
      livingFactions.length >= 3 &&
      raw.friendCount >= 1 &&
      raw.friendsNeededToWin <= 2;

    if (
      isDiplomaticThreat &&
      (raw.friendsNeededToWin < smallestFriendsNeeded ||
        (raw.friendsNeededToWin === smallestFriendsNeeded &&
          diplomaticFrontrunner !== null &&
          raw.powerScore > (profiles[diplomaticFrontrunner]?.powerScore ?? 0)))
    ) {
      smallestFriendsNeeded = raw.friendsNeededToWin;
      diplomaticFrontrunner = raw.factionId;
    }

    const profile: FactionPowerProfile = {
      ...raw,
      rank,
      tier,
      isDiplomaticThreat,
    };
    profiles[raw.factionId] = profile;
    ranked.push(profile);
  }

  return {
    livingFactions,
    profiles,
    ranked,
    totalWorldHexes,
    totalWorldGrossIncome,
    totalWorldNetIncome,
    avgPowerScore,
    avgNetIncome,
    hegemonFaction,
    diplomaticFrontrunner,
  };
}

/**
 * Computes pairwise trust and relationship memory between `aiFaction` and `other`.
 */
export function getPairTrust(
  state: GameState,
  aiFaction: FactionId,
  other: FactionId,
): PairTrustSummary {
  const relKey = getRelationKey(aiFaction, other);
  const pair = state.diplomacy.pairMemory?.[relKey];
  const trustLog = state.diplomacy.trustLog ?? {};
  const direct = trustLog[getTrustKey(other, aiFaction)];

  let globalBetrayals = 0;
  let globalSubsidiesBroken = 0;
  const prefix = `${other}->`;
  for (const [k, rec] of Object.entries(trustLog)) {
    if (k.startsWith(prefix)) {
      globalBetrayals += rec.betrayals;
      globalSubsidiesBroken += rec.subsidiesBroken;
    }
  }

  const pastFriendshipTurns = pair?.pastFriendshipTurns ?? 0;
  const friendshipsCompleted = pair?.friendshipsCompleted ?? 0;
  const warsFought = pair?.warsFought ?? 0;
  const lastWarEndedTurn = pair?.lastWarEndedTurn ?? -99;
  const dealsAccepted = pair?.dealsAccepted ?? 0;

  const betrayalsAgainstMe = direct?.betrayals ?? 0;
  const subsidiesBrokenAgainstMe = direct?.subsidiesBroken ?? 0;
  const rejectedDeals = direct?.rejectedDeals ?? 0;
  const giftsGiven = direct?.giftsGiven ?? 0;

  const otherMarked = (state.diplomacy.blackMarks[other] ?? 0) > 0;

  // Positive memory from reliable friendships & honored deals, penalized heavily by betrayals
  let trustScore = 0;
  trustScore += Math.min(24, friendshipsCompleted * 12);
  trustScore += Math.min(18, pastFriendshipTurns * 0.55);
  trustScore += Math.min(10, dealsAccepted * 2.5);
  trustScore += Math.min(12, giftsGiven * 0.35);

  trustScore -= betrayalsAgainstMe * 48;
  trustScore -= Math.max(0, globalBetrayals - betrayalsAgainstMe) * 14;
  trustScore -= subsidiesBrokenAgainstMe * 24;
  trustScore -= Math.max(0, globalSubsidiesBroken - subsidiesBrokenAgainstMe) * 6;
  trustScore -= Math.min(12, warsFought * 3);
  trustScore -= Math.min(8, rejectedDeals * 2);
  if (otherMarked) trustScore -= 16;

  return {
    trustScore,
    pastFriendshipTurns,
    friendshipsCompleted,
    betrayalsAgainstMe,
    globalBetrayals,
    subsidiesBrokenAgainstMe,
    globalSubsidiesBroken,
    warsFought,
    lastWarEndedTurn,
    dealsAccepted,
    rejectedDeals,
    giftsGiven,
  };
}

/**
 * Diagnoses what an AI faction actually needs right now (cash, steady income,
 * military help, flank peace, or land) relative to the global situation.
 */
export function assessAiNeeds(
  state: GameState,
  aiFaction: FactionId,
  world: WorldPowerAssessment,
): AiNeedProfile {
  const ai = world.profiles[aiFaction];
  const factionBorders = computeBorderGraph(state);
  const borderingFactions = factionBorders.get(aiFaction) ?? new Set<FactionId>();

  const neutralNeighbors = new Set<HexKey>();
  for (const cell of Object.values(state.cells)) {
    if (cell.faction !== aiFaction) continue;
    for (const nk of getNeighborKeys(cell.key)) {
      if (state.cells[nk]?.faction === FactionId.NEUTRAL) {
        neutralNeighbors.add(nk);
      }
    }
  }
  const neutralFrontierCount = neutralNeighbors.size;

  const activeWars = world.livingFactions.filter(
    (f) =>
      f !== aiFaction &&
      getRelation(state, aiFaction, f) === DiplomaticRelation.WAR,
  );

  const aiProvs = Object.values(state.provinces).filter(
    (p) => p.faction === aiFaction,
  );
  const isBankruptRisk = aiProvs.some(
    (p) => p.money + p.netIncome < 2 || (p.netIncome < 0 && p.money < 12),
  );

  const cashUrgency = !ai
    ? 0.5
    : isBankruptRisk
      ? 1
      : ai.totalMoney < 14
        ? 0.8
        : ai.totalMoney < 28
          ? 0.45
          : ai.totalMoney > 65
            ? 0.08
            : 0.22;

  const incomeRatio =
    ai && world.avgNetIncome > 2
      ? ai.totalNetIncome / Math.max(4, world.avgNetIncome)
      : 1;
  const incomeUrgency = !ai
    ? 0.5
    : ai.totalNetIncome <= 0
      ? 1
      : incomeRatio < 0.65
        ? 0.82
        : incomeRatio < 0.92
          ? 0.48
          : 0.15;

  let totalEnemyPower = 0;
  let primaryEnemy: FactionId | null = null;
  let maxEnemyThreat = -1;
  for (const enemy of activeWars) {
    const ep = world.profiles[enemy];
    if (!ep) continue;
    const borderWeight = borderingFactions.has(enemy) ? 1.25 : 0.7;
    const threat = ep.powerScore * borderWeight;
    totalEnemyPower += ep.powerScore;
    if (threat > maxEnemyThreat) {
      maxEnemyThreat = threat;
      primaryEnemy = enemy;
    }
  }

  const aiPower = ai?.powerScore ?? 10;
  const warLoadRatio = totalEnemyPower / Math.max(1, aiPower);
  const peaceUrgency =
    activeWars.length === 0
      ? 0
      : Math.min(
          1,
          Math.max(
            0,
            (warLoadRatio - 0.85) * 0.75 +
              (activeWars.length >= 2 ? 0.32 : 0) +
              (isBankruptRisk ? 0.25 : 0),
          ),
        );

  const allyUrgency =
    activeWars.length === 0
      ? world.hegemonFaction && world.hegemonFaction !== aiFaction
        ? 0.42
        : 0.1
      : Math.min(
          1,
          Math.max(
            0.25,
            (warLoadRatio - 0.7) * 0.7 + (activeWars.length >= 2 ? 0.3 : 0),
          ),
        );

  const landUrgency = !ai
    ? 0.4
    : ai.globalHexShare < 0.8 / Math.max(2, world.livingFactions.length)
      ? 0.78
      : 0.32;

  const isFinanciallyStrong = Boolean(
    ai &&
      !isBankruptRisk &&
      ai.totalMoney >= 35 &&
      ai.totalNetIncome >= Math.max(8, world.avgNetIncome * 0.95),
  );

  return {
    cashUrgency,
    incomeUrgency,
    peaceUrgency,
    allyUrgency,
    landUrgency,
    isFinanciallyStrong,
    isBankruptRisk,
    primaryEnemy,
    activeWars,
    neutralFrontierCount,
    borderingFactions,
    factionBorders,
  };
}

/**
 * Estimates the strategic value to AI of entering a FRIENDSHIP treaty with `partner`
 * (separate from any gold/subsidy/land attached to the deal).
 * Negative means AI is giving up expansion opportunity or granting protection to a
 * weaker rival — so AI will demand real resources in return instead of free "friendship-for-friendship".
 */
function computeFriendshipNetDesireForAi(
  state: GameState,
  aiFaction: FactionId,
  partner: FactionId,
  duration: number,
  world: WorldPowerAssessment,
  needs: AiNeedProfile,
  trust: PairTrustSummary,
): number {
  const ai = world.profiles[aiFaction];
  const them = world.profiles[partner];
  if (!ai || !them) return -10;

  const difficulty = state.config.difficulty;
  const powerRatio = them.powerScore / Math.max(1, ai.powerScore);
  const incomeRatio =
    them.totalGrossIncome / Math.max(1, ai.totalGrossIncome);
  const isBordering = needs.borderingFactions.has(partner);
  const rel = getRelation(state, aiFaction, partner);

  let desire = 0;

  // 1. Power & income balance: strong AI granting safety to weak rival demands tribute!
  if (powerRatio < 0.72) {
    // They are much weaker — AI could conquer them; friendship needs serious payment
    desire -= 24 + Math.round((0.72 - powerRatio) * 28);
  } else if (powerRatio < 0.95) {
    desire -= 12;
  } else if (powerRatio <= 1.35) {
    // Comparable peer: mildly useful only if flank security or shared threat
    desire -= 4;
  } else {
    // They are stronger than AI — securing their non-aggression has real value
    desire += Math.min(18, Math.round((powerRatio - 1.1) * 18));
  }

  // Factor in global income strength
  if (incomeRatio < 0.7) {
    desire -= 6;
  } else if (them.globalIncomeShare >= 0.34) {
    // Careful about allying with an economic runaway hegemon
    desire -= difficulty === AiDifficulty.EASY ? 4 : 16;
  }

  // 2. Strategic context: flank security during active war is valuable
  if (isBordering && needs.activeWars.length > 0 && rel !== DiplomaticRelation.WAR) {
    desire += 10 + Math.round(needs.peaceUrgency * 10);
  } else if (!isBordering && needs.activeWars.length === 0) {
    // Distant neutral asking for free friendship — little strategic value to AI
    desire -= 10;
  }

  // Ending an active war via friendship is valued based on whether AI is winning or losing
  if (rel === DiplomaticRelation.WAR) {
    if (powerRatio < 0.85) {
      // AI is winning the war — don't stop for free!
      desire -= 24;
    } else if (powerRatio > 1.15 || needs.peaceUrgency > 0.5) {
      desire += 12;
    } else {
      desire -= 8;
    }
  }

  // 3. Friendship & betrayal memory
  if (trust.betrayalsAgainstMe > 0) {
    desire -= trust.betrayalsAgainstMe * 44;
  } else if (trust.friendshipsCompleted > 0 || trust.pastFriendshipTurns >= 10) {
    // Remembers loyal past ally warmly
    desire += Math.min(
      14,
      trust.friendshipsCompleted * 6 + Math.floor(trust.pastFriendshipTurns / 6),
    );
  }
  if (trust.subsidiesBrokenAgainstMe > 0) {
    desire -= trust.subsidiesBrokenAgainstMe * 14;
  }
  if ((state.diplomacy.blackMarks[partner] ?? 0) > 0) {
    desire -= 16;
  }

  // 4. Anti-World-Peace resistance: as partner gets closer to all-friends victory, AI resists strongly
  if (them.friendsNeededToWin <= 2 && world.livingFactions.length >= 3) {
    desire -= difficulty === AiDifficulty.HARD ? 55 : difficulty === AiDifficulty.BALANCED ? 38 : 20;
  } else if (
    them.friendCount >= Math.max(2, Math.floor((world.livingFactions.length - 1) * 0.5))
  ) {
    desire -= difficulty === AiDifficulty.HARD ? 16 : 9;
  }

  // 5. Duration scaling (longer lock-in costs more when AI isn't eager)
  const durFactor = Math.max(0.75, Math.min(1.4, duration / 15));
  if (desire < 0) {
    desire = Math.round(desire * durFactor);
  }

  // 6. Difficulty adjustment (HARD demands tighter deals; EASY is slightly softer)
  if (difficulty === AiDifficulty.HARD) {
    desire -= 6;
  } else if (difficulty === AiDifficulty.EASY) {
    desire += 7;
  }

  return desire;
}

/**
 * Evaluates a single non-FRIENDSHIP resource side from AI's perspective.
 * `isAiReceiving = true` -> value AI gains; `false` -> cost AI pays.
 */
function evaluateResourceSideForAi(
  state: GameState,
  side: ExchangeSideOffer,
  giver: FactionId,
  receiver: FactionId,
  isAiReceiving: boolean,
  world: WorldPowerAssessment,
  needs: AiNeedProfile,
  trust: PairTrustSummary,
): number {
  const aiFaction = isAiReceiving ? receiver : giver;
  const partner = isAiReceiving ? giver : receiver;
  const ai = world.profiles[aiFaction];
  const them = world.profiles[partner];
  const difficulty = state.config.difficulty;

  switch (side.type) {
    case ExchangeItemType.NOTHING:
    case ExchangeItemType.FRIENDSHIP:
      return 0;

    case ExchangeItemType.MONEY: {
      if (side.amount <= 0) return 0;
      if (isAiReceiving) {
        const mult = 0.85 + needs.cashUrgency * 0.72;
        return side.amount * mult;
      }
      // Cost of AI paying gold out of pocket
      const aiProv = getRichestProvinceForFaction(state, aiFaction);
      const treasury = aiProv?.money ?? 0;
      const drainRatio = treasury > 0 ? side.amount / treasury : 2;
      const painMult =
        1.05 +
        needs.cashUrgency * 0.85 +
        (drainRatio > 0.55 ? (drainRatio - 0.55) * 1.1 : 0);
      return side.amount * painMult;
    }

    case ExchangeItemType.SUBSIDY: {
      const dur = Math.max(3, Math.min(25, side.duration ?? 10));
      if (side.amount <= 0) return 0;
      const rawTotal = side.amount * dur;
      if (isAiReceiving) {
        // Discount promises if proposer broke subsidies, betrayed us, or has weak income
        let reliability = 0.66;
        if (trust.subsidiesBrokenAgainstMe > 0) {
          reliability *= Math.pow(0.45, trust.subsidiesBrokenAgainstMe);
        }
        if (trust.betrayalsAgainstMe > 0) {
          reliability *= 0.35;
        }
        if (them && them.totalNetIncome < side.amount) {
          reliability *= them.totalNetIncome <= 0 ? 0.52 : 0.78;
        }
        // Long-term promises carry natural risk of war/cancellation
        const lengthDecay = dur > 14 ? 0.86 : 1;
        const needMult = 0.9 + needs.incomeUrgency * 0.58;
        return rawTotal * reliability * lengthDecay * needMult;
      }
      // Cost of AI committing to pay outgoing subsidies
      const aiNet = ai?.totalNetIncome ?? 0;
      let burdenMult = 0.78 + needs.incomeUrgency * 0.65;
      if (aiNet - side.amount < 1) {
        // Paying this subsidy would push AI into deficit!
        burdenMult += 1.2;
      }
      if (difficulty === AiDifficulty.HARD) {
        burdenMult += 0.12;
      }
      return rawTotal * burdenMult;
    }

    case ExchangeItemType.LAND: {
      const keys = side.hexKeys ?? [];
      const cnt = keys.length > 0 ? keys.length : side.amount;
      if (cnt <= 0) return 0;
      if (isAiReceiving) {
        let value = 0;
        if (keys.length > 0) {
          for (const k of keys) {
            const cell = state.cells[k];
            const bordersAi = getNeighborKeys(k).some(
              (nk) => state.cells[nk]?.faction === aiFaction,
            );
            const cleanBonus = cell?.entity === EntityType.NONE ? 3 : 0;
            value += (bordersAi ? 19 : 11) + cleanBonus;
          }
        } else {
          value = cnt * (15 + needs.landUrgency * 6);
        }
        return value;
      }
      // AI giving away its own territory is painful (especially to a stronger rival)
      const powerPenalty =
        them && ai && them.powerScore > ai.powerScore ? 1.35 : 1.08;
      return cnt * 21 * powerPenalty;
    }

    case ExchangeItemType.END_WAR: {
      if (getRelation(state, aiFaction, partner) !== DiplomaticRelation.WAR) {
        return 0;
      }
      const ratio =
        (them?.powerScore ?? 10) / Math.max(1, ai?.powerScore ?? 10);
      if (isAiReceiving) {
        // Proposer offers to end war (redundant if symmetric, mainly used when AI receives END_WAR)
        if (ratio > 1.15 || needs.peaceUrgency > 0.45) {
          return 18 + Math.round(needs.peaceUrgency * 22);
        }
        return 6;
      }
      // AI is asked to stop fighting (targetGives = END_WAR)
      if (ratio < 0.75) {
        // AI is crushing them — demand high reparations!
        return 36 + Math.round((0.75 - ratio) * 35);
      }
      if (ratio < 1.05 && needs.peaceUrgency < 0.35) {
        return 22;
      }
      if (needs.peaceUrgency >= 0.55 || ratio > 1.25) {
        // AI actually wants peace too
        return 4;
      }
      return 14;
    }

    case ExchangeItemType.DECLARE_WAR: {
      const warTarget = side.warTargetFaction;
      if (warTarget === undefined || warTarget === giver) return 0;
      const targetProfile = world.profiles[warTarget];

      if (isAiReceiving) {
        // Partner agrees to declare war on `warTarget`
        if (getRelation(state, partner, warTarget) === DiplomaticRelation.WAR) {
          return 0; // Already at war!
        }
        const partnerBordersTarget =
          needs.factionBorders.get(partner)?.has(warTarget) ?? false;
        const isMyEnemy =
          getRelation(state, aiFaction, warTarget) === DiplomaticRelation.WAR;
        const isHegemon = world.hegemonFaction === warTarget;
        const isDipThreat = Boolean(targetProfile?.isDiplomaticThreat);

        if (isMyEnemy) {
          const base = partnerBordersTarget ? 38 : 20;
          const strengthBonus = Math.min(
            24,
            Math.round(
              ((them?.powerScore ?? 10) /
                Math.max(1, targetProfile?.powerScore ?? 10)) *
                14,
            ),
          );
          return (base + strengthBonus) * (0.85 + needs.allyUrgency * 0.55);
        }
        if (isDipThreat || isHegemon) {
          return partnerBordersTarget ? 32 : 16;
        }
        return 4;
      }

      // AI is asked to declare war on `warTarget`!
      const relWithTarget = getRelation(state, aiFaction, warTarget);
      if (relWithTarget === DiplomaticRelation.WAR) return 0;

      // Never betray a friend cheaply (causes Black Mark!)
      if (relWithTarget === DiplomaticRelation.FRIEND) {
        if (
          targetProfile?.isDiplomaticThreat &&
          targetProfile.friendsNeededToWin <= 1
        ) {
          return 25; // Stopping an imminent diplomatic defeat
        }
        return 120;
      }

      const targetTrust = getPairTrust(state, aiFaction, warTarget);
      const targetPowerRatio =
        (targetProfile?.powerScore ?? 10) / Math.max(1, ai?.powerScore ?? 10);
      const aiBordersTarget = needs.borderingFactions.has(warTarget);

      let warCost = 20;
      if (aiBordersTarget) {
        warCost += Math.round(targetPowerRatio * 20);
      } else {
        warCost += 10;
      }
      if (needs.activeWars.length >= 1) {
        warCost += 18 * needs.activeWars.length;
      }
      if (targetTrust.friendshipsCompleted > 0 && targetTrust.betrayalsAgainstMe === 0) {
        warCost += 16;
      }
      if (targetProfile?.isDiplomaticThreat || world.hegemonFaction === warTarget) {
        warCost = Math.max(8, warCost - 18);
      }
      if (targetTrust.betrayalsAgainstMe > 0) {
        warCost = Math.max(6, warCost - 16);
      }
      return warCost;
    }

    case ExchangeItemType.REMOVE_BLACK_MARK: {
      const aiMarkedByPartner = state.diplomacy.blackMarkPairs.some(
        (p) =>
          p.turnsRemaining > 0 &&
          p.issuer === partner &&
          p.target === aiFaction,
      );
      if (isAiReceiving) {
        return aiMarkedByPartner ? 22 : 6;
      }
      const partnerMarkedByAi = state.diplomacy.blackMarkPairs.some(
        (p) =>
          p.turnsRemaining > 0 &&
          p.issuer === aiFaction &&
          p.target === partner,
      );
      if (!partnerMarkedByAi) return 8;
      if (trust.betrayalsAgainstMe > 0) return 38;
      return 20;
    }
  }
}

/**
 * Full strategic evaluation of an incoming exchange deal for an AI faction.
 * Blocks world-peace handovers, rejects empty "friendship-for-friendship" deals,
 * weighs real economic/military needs, and remembers past friendships & betrayals.
 */
export function evaluateIncomingExchangeForAi(
  state: GameState,
  aiFaction: FactionId,
  proposer: FactionId,
  offer: ExchangeOffer,
  helpers: DiplomacyStrategyHelpers,
): AiDealEvaluation {
  const world = evaluateWorldPower(state);
  const needs = assessAiNeeds(state, aiFaction, world);
  const trust = getPairTrust(state, aiFaction, proposer);
  const aiProfile = world.profiles[aiFaction];
  const proposerProfile = world.profiles[proposer];
  const difficulty = state.config.difficulty;

  if (!aiProfile || !proposerProfile) {
    return {accepts: false, reason: 'условия невыгодны', netScore: -100};
  }

  // 1. Check physical resource fulfillment by AI
  if (offer.targetGives.type === ExchangeItemType.MONEY) {
    const aiProv = getRichestProvinceForFaction(state, aiFaction);
    if (!aiProv || aiProv.money < offer.targetGives.amount) {
      return {accepts: false, reason: 'недостаточно золота', netScore: -100};
    }
  } else if (offer.targetGives.type === ExchangeItemType.LAND) {
    if (offer.targetGives.hexKeys && offer.targetGives.hexKeys.length > 0) {
      const allValid = offer.targetGives.hexKeys.every((k) =>
        helpers.isFreeTransferableHex(state, aiFaction, k),
      );
      if (!allValid) {
        return {accepts: false, reason: 'недостаточно земель', netScore: -100};
      }
    } else {
      const avail = helpers.getTransferableFreeHexes(state, aiFaction, proposer);
      if (avail.length < offer.targetGives.amount) {
        return {accepts: false, reason: 'недостаточно земель', netScore: -100};
      }
    }
  } else if (offer.targetGives.type === ExchangeItemType.SUBSIDY) {
    // AI refuses outgoing subsidies that would immediately bankrupt it
    if (
      offer.targetGives.amount > Math.max(2, aiProfile.totalNetIncome + 1) &&
      needs.cashUrgency > 0.5
    ) {
      return {accepts: false, reason: 'слишком высокие дотации', netScore: -100};
    }
  }

  const involvesFriendship =
    offer.targetGives.type === ExchangeItemType.FRIENDSHIP ||
    offer.proposerGives.type === ExchangeItemType.FRIENDSHIP;

  const isEmptyFriendshipForFriendship =
    offer.targetGives.type === ExchangeItemType.FRIENDSHIP &&
    offer.proposerGives.type === ExchangeItemType.FRIENDSHIP;

  // 2. Hard Anti-World-Peace protection: NEVER hand another faction a diplomatic victory!
  if (involvesFriendship && world.livingFactions.length >= 2) {
    const aiWouldWinInstead = aiProfile.friendsNeededToWin <= 1;
    if (!aiWouldWinInstead && proposerProfile.friendsNeededToWin <= 1) {
      return {
        accepts: false,
        reason: 'не допустит дипломатической победы',
        netScore: -999,
      };
    }
    if (
      !aiWouldWinInstead &&
      world.livingFactions.length >= 3 &&
      proposerProfile.friendsNeededToWin === 2 &&
      (difficulty === AiDifficulty.HARD ||
        proposerProfile.tier === 'HEGEMON' ||
        isEmptyFriendshipForFriendship)
    ) {
      return {
        accepts: false,
        reason: 'опасается вашей дипломатической победы',
        netScore: -120,
      };
    }
  }

  // 3. Reject empty "Дружба <-> Дружба" unless AI genuinely needs flank security or partner is much stronger/trusted
  if (isEmptyFriendshipForFriendship) {
    const dur = Math.max(
      offer.targetGives.duration ?? 15,
      offer.proposerGives.duration ?? 15,
    );
    const desire = computeFriendshipNetDesireForAi(
      state,
      aiFaction,
      proposer,
      dur,
      world,
      needs,
      trust,
    );
    // On HARD/BALANCED, empty friendship-for-friendship is rejected unless AI strongly benefits (e.g. desperately needs flank safety vs stronger threat)
    const threshold =
      difficulty === AiDifficulty.HARD
        ? 14
        : difficulty === AiDifficulty.BALANCED
          ? 8
          : 0;
    if (desire < threshold) {
      return {
        accepts: false,
        reason:
          trust.betrayalsAgainstMe > 0
            ? 'помнит ваше предательство'
            : 'нужны ресурсы или реальная выгода',
        netScore: desire - threshold,
      };
    }
  }

  // 4. Compute asymmetric friendship utility (counted ONCE, not cancelling itself!)
  let friendshipDelta = 0;
  if (involvesFriendship) {
    const dur = Math.max(
      offer.targetGives.type === ExchangeItemType.FRIENDSHIP
        ? (offer.targetGives.duration ?? 15)
        : 0,
      offer.proposerGives.type === ExchangeItemType.FRIENDSHIP
        ? (offer.proposerGives.duration ?? 15)
        : 0,
    );
    friendshipDelta = computeFriendshipNetDesireForAi(
      state,
      aiFaction,
      proposer,
      dur || 15,
      world,
      needs,
      trust,
    );
  }

  // 5. Evaluate real resource value received vs given
  const receivesResourceValue = evaluateResourceSideForAi(
    state,
    offer.proposerGives,
    proposer,
    aiFaction,
    true,
    world,
    needs,
    trust,
  );
  const givesResourceValue = evaluateResourceSideForAi(
    state,
    offer.targetGives,
    aiFaction,
    proposer,
    false,
    world,
    needs,
    trust,
  );

  // Pure gift to AI (AI gives NOTHING) is always welcome!
  if (
    offer.targetGives.type === ExchangeItemType.NOTHING &&
    offer.proposerGives.type !== ExchangeItemType.FRIENDSHIP
  ) {
    return {accepts: true, netScore: receivesResourceValue};
  }

  // Small trust modifier on general trade deals
  const trustBonus = Math.max(-24, Math.min(10, trust.trustScore * 0.25));
  const difficultyMargin =
    difficulty === AiDifficulty.HARD
      ? 4
      : difficulty === AiDifficulty.BALANCED
        ? 1
        : -3;

  const netScore =
    receivesResourceValue -
    givesResourceValue +
    friendshipDelta +
    trustBonus -
    difficultyMargin;

  if (netScore >= 0) {
    return {accepts: true, netScore};
  }

  const reason =
    trust.betrayalsAgainstMe > 0
      ? 'помнит ваше предательство'
      : trust.subsidiesBrokenAgainstMe > 0 &&
          offer.proposerGives.type === ExchangeItemType.SUBSIDY
        ? 'не доверяет вашим дотациям'
        : involvesFriendship && receivesResourceValue < 1
          ? 'нужны ресурсы за союз'
          : 'условия невыгодны';

  return {accepts: false, reason, netScore};
}

/**
 * Plans strategic, needs-driven diplomatic actions for an AI faction on its turn:
 * 1. Cancels bankrupting or self-sabotaging subsidies
 * 2. Actively disrupts any rival nearing World Peace (diplomatic victory)
 * 3. Forms anti-hegemon coalitions using real resources
 * 4. Seeks peace when genuinely outmatched (power + income)
 * 5. Proposes resource-backed treaties tailored to what AI actually needs (no empty Friendship<->Friendship!)
 * 6. Declares smart wars informed by power ratings, global income share, and friendship memory
 */
export function planAiDiplomaticActions(
  state: GameState,
  aiFaction: FactionId,
  helpers: DiplomacyStrategyHelpers,
): AiDiplomaticIntent[] {
  const intents: AiDiplomaticIntent[] = [];
  if (!state.config.diplomacyEnabled) return intents;

  const world = evaluateWorldPower(state);
  const ai = world.profiles[aiFaction];
  if (!ai) return intents;

  const needs = assessAiNeeds(state, aiFaction, world);
  const difficulty = state.config.difficulty;
  const richestProv = getRichestProvinceForFaction(state, aiFaction);
  const livingOthers = world.livingFactions.filter((f) => f !== aiFaction);
  if (livingOthers.length === 0) return intents;

  const hasPendingWith = (other: FactionId): boolean =>
    state.diplomacy.messages.some(
      (m) =>
        ((m.fromFaction === aiFaction && m.toFaction === other) ||
          (m.fromFaction === other && m.toFaction === aiFaction)) &&
        m.status === DiplomaticMessageStatus.PENDING,
    );

  const hasRecentDiplomacyWith = (other: FactionId, cooldownTurns = 4): boolean =>
    state.diplomacy.messages.some(
      (m) =>
        state.turn - m.turn < cooldownTurns &&
        ((m.fromFaction === aiFaction && m.toFaction === other) ||
          (m.fromFaction === other && m.toFaction === aiFaction)),
    );

  // ===== 1. Cancel outgoing subsidies if AI is bleeding gold or funding a hegemon/threat =====
  for (const sub of state.diplomacy.subsidies) {
    if (sub.fromFaction !== aiFaction || sub.turnsRemaining <= 0) continue;
    const recipient = world.profiles[sub.toFaction];
    const shouldBreak =
      (needs.isBankruptRisk && ai.totalNetIncome < 0) ||
      (ai.totalNetIncome < -2 && ai.totalMoney < 14) ||
      Boolean(
        recipient &&
          difficulty !== AiDifficulty.EASY &&
          (recipient.isDiplomaticThreat ||
            (recipient.tier === 'HEGEMON' &&
              recipient.powerScore > ai.powerScore * 1.45)),
      );
    if (shouldBreak) {
      intents.push({kind: 'CANCEL_SUBSIDY', subsidyId: sub.id});
      break;
    }
  }

  // ===== 2. ANTI-WORLD-PEACE: Actively stop any rival close to diplomatic victory =====
  if (
    world.diplomaticFrontrunner !== null &&
    world.diplomaticFrontrunner !== aiFaction
  ) {
    const threatId = world.diplomaticFrontrunner;
    const threat = world.profiles[threatId];
    const rel = getRelation(state, aiFaction, threatId);

    if (threat) {
      // 2a. Put a Black Mark on the diplomatic frontrunner to prevent third parties from befriending them!
      if (
        richestProv &&
        richestProv.money >= BLACK_MARK_COST + 6 &&
        !helpers.hasBlackMarkBetween(state, aiFaction, threatId) &&
        rel !== DiplomaticRelation.FRIEND
      ) {
        intents.push({
          kind: 'BLACK_MARK',
          target: threatId,
          provinceId: richestProv.id,
        });
        return intents;
      }

      // 2b. If they are literally 1 friend away from winning and we are Neutral, declare war!
      if (
        rel === DiplomaticRelation.NEUTRAL &&
        (threat.friendsNeededToWin <= 1 ||
          (threat.friendsNeededToWin === 2 &&
            difficulty !== AiDifficulty.EASY &&
            needs.borderingFactions.has(threatId)))
      ) {
        intents.push({kind: 'DECLARE_WAR', target: threatId});
        return intents;
      }

      // 2c. If we are ALREADY their friend and they are 1 friendship away from winning the match,
      //     on HARD/BALANCED break the friendship to prevent instant defeat!
      if (
        rel === DiplomaticRelation.FRIEND &&
        threat.friendsNeededToWin <= 1 &&
        difficulty !== AiDifficulty.EASY
      ) {
        intents.push({kind: 'DECLARE_WAR', target: threatId});
        return intents;
      }

      // 2d. Hire a neutral rival bordering the diplomatic frontrunner to attack them
      if (richestProv && richestProv.money >= 16) {
        const hireCandidate = livingOthers.find((cand) => {
          if (cand === threatId || hasPendingWith(cand) || hasRecentDiplomacyWith(cand, 3)) {
            return false;
          }
          return (
            getRelation(state, aiFaction, cand) !== DiplomaticRelation.WAR &&
            getRelation(state, cand, threatId) === DiplomaticRelation.NEUTRAL &&
            (needs.factionBorders.get(cand)?.has(threatId) ?? false)
          );
        });
        if (hireCandidate !== undefined) {
          const payment = Math.min(24, Math.max(10, Math.floor(richestProv.money * 0.45)));
          intents.push({
            kind: 'PROPOSE_EXCHANGE',
            target: hireCandidate,
            provinceId: richestProv.id,
            offer: {
              targetGives: {
                type: ExchangeItemType.DECLARE_WAR,
                amount: 0,
                warTargetFaction: threatId,
              },
              proposerGives: {type: ExchangeItemType.MONEY, amount: payment},
            },
          });
          return intents;
        }
      }
    }
  }

  // ===== 3. Seek Peace (END_WAR) when outmatched in overall power + income =====
  if (state.turn >= 4 && needs.peaceUrgency >= 0.42) {
    const sortedEnemies = [...needs.activeWars].sort(
      (a, b) =>
        (world.profiles[b]?.powerScore ?? 0) -
        (world.profiles[a]?.powerScore ?? 0),
    );
    for (const enemy of sortedEnemies) {
      const ep = world.profiles[enemy];
      if (!ep || hasPendingWith(enemy) || hasRecentDiplomacyWith(enemy, 3)) {
        continue;
      }
      if (
        ep.powerScore > ai.powerScore * 1.18 ||
        (needs.activeWars.length >= 2 && ep.powerScore >= ai.powerScore * 0.9)
      ) {
        const offerGold = richestProv
          ? Math.min(28, Math.floor(richestProv.money * 0.48))
          : 0;
        const subsidyAmt = Math.max(2, Math.min(8, Math.floor(Math.max(4, ai.totalNetIncome) * 0.38)));
        intents.push({
          kind: 'PROPOSE_EXCHANGE',
          target: enemy,
          provinceId: richestProv?.id,
          offer: {
            targetGives: {type: ExchangeItemType.END_WAR, amount: 0},
            proposerGives:
              offerGold >= 8
                ? {type: ExchangeItemType.MONEY, amount: offerGold}
                : {type: ExchangeItemType.SUBSIDY, amount: subsidyAmt, duration: 6},
          },
        });
        return intents;
      }
    }
  }

  // ===== 4. Anti-Hegemon Actions (Black Mark or Paid War Coalition) =====
  if (
    state.turn >= 4 &&
    world.hegemonFaction !== null &&
    world.hegemonFaction !== aiFaction
  ) {
    const hegemon = world.hegemonFaction;
    const relWithHegemon = getRelation(state, aiFaction, hegemon);

    if (
      relWithHegemon === DiplomaticRelation.WAR &&
      richestProv &&
      richestProv.money >= BLACK_MARK_COST + 10 &&
      !helpers.hasBlackMarkBetween(state, aiFaction, hegemon)
    ) {
      intents.push({
        kind: 'BLACK_MARK',
        target: hegemon,
        provinceId: richestProv.id,
      });
      return intents;
    }

    if (
      relWithHegemon === DiplomaticRelation.WAR &&
      richestProv &&
      (richestProv.money >= 14 || ai.totalNetIncome >= 6)
    ) {
      const partner = livingOthers
        .filter((cand) => {
          if (cand === hegemon || hasPendingWith(cand) || hasRecentDiplomacyWith(cand, 4)) {
            return false;
          }
          return (
            getRelation(state, aiFaction, cand) !== DiplomaticRelation.WAR &&
            getRelation(state, cand, hegemon) === DiplomaticRelation.NEUTRAL &&
            (needs.factionBorders.get(cand)?.has(hegemon) ?? false)
          );
        })
        .sort(
          (a, b) =>
            (world.profiles[b]?.powerScore ?? 0) -
            (world.profiles[a]?.powerScore ?? 0),
        )[0];

      if (partner !== undefined) {
        const payment = Math.min(24, Math.floor(richestProv.money * 0.42));
        const subAmt = Math.max(3, Math.min(7, Math.floor(ai.totalNetIncome * 0.35)));
        intents.push({
          kind: 'PROPOSE_EXCHANGE',
          target: partner,
          provinceId: richestProv.id,
          offer: {
            targetGives: {
              type: ExchangeItemType.DECLARE_WAR,
              amount: 0,
              warTargetFaction: hegemon,
            },
            proposerGives:
              payment >= 10
                ? {type: ExchangeItemType.MONEY, amount: payment}
                : {type: ExchangeItemType.SUBSIDY, amount: subAmt, duration: 6},
          },
        });
        return intents;
      }
    }
  }

  // ===== 5. Needs-Based Treaties (Resource-Backed — NEVER empty Friendship<->Friendship!) =====
  if (state.turn >= 2 && livingOthers.length >= 2) {
    const maxAiFriends = Math.max(1, Math.floor((livingOthers.length) / 2));

    // 5a. If at war and needs an ally, recruit a neutral neighbor of our primary enemy with gold/subsidy
    if (
      needs.primaryEnemy !== null &&
      needs.allyUrgency >= 0.45 &&
      richestProv &&
      richestProv.money >= 15
    ) {
      const primaryEnemy = needs.primaryEnemy;
      const recruit = livingOthers
        .filter((cand) => {
          if (cand === primaryEnemy || hasPendingWith(cand) || hasRecentDiplomacyWith(cand, 4)) {
            return false;
          }
          const trust = getPairTrust(state, aiFaction, cand);
          return (
            trust.betrayalsAgainstMe === 0 &&
            getRelation(state, aiFaction, cand) !== DiplomaticRelation.WAR &&
            getRelation(state, cand, primaryEnemy) === DiplomaticRelation.NEUTRAL &&
            (needs.factionBorders.get(cand)?.has(primaryEnemy) ?? false)
          );
        })
        .sort(
          (a, b) =>
            (world.profiles[b]?.powerScore ?? 0) -
            (world.profiles[a]?.powerScore ?? 0),
        )[0];

      if (recruit !== undefined) {
        const payment = Math.min(20, Math.max(10, Math.floor(richestProv.money * 0.38)));
        intents.push({
          kind: 'PROPOSE_EXCHANGE',
          target: recruit,
          provinceId: richestProv.id,
          offer: {
            targetGives: {
              type: ExchangeItemType.DECLARE_WAR,
              amount: 0,
              warTargetFaction: primaryEnemy,
            },
            proposerGives: {type: ExchangeItemType.MONEY, amount: payment},
          },
        });
        return intents;
      }
    }

    // 5b. Needs-based Friendship proposals (always involving real resources or war entry!)
    if (ai.friendCount < maxAiFriends) {
      const neutralCandidates = livingOthers
        .filter((other) => {
          const op = world.profiles[other];
          if (!op || hasPendingWith(other) || hasRecentDiplomacyWith(other, 4)) {
            return false;
          }
          if (getRelation(state, aiFaction, other) !== DiplomaticRelation.NEUTRAL) {
            return false;
          }
          if (!helpers.canFormFriendship(state, aiFaction, other).allowed) {
            return false;
          }
          // NEVER help a rival get within 1 friend of diplomatic victory!
          if (op.friendsNeededToWin <= 2 && ai.friendsNeededToWin > 1) {
            return false;
          }
          const trust = getPairTrust(state, aiFaction, other);
          if (trust.betrayalsAgainstMe > 0) return false;
          return true;
        })
        .sort((a, b) => {
          // Prefer bordering factions & reliable past friends
          const aBorder = needs.borderingFactions.has(a) ? 15 : 0;
          const bBorder = needs.borderingFactions.has(b) ? 15 : 0;
          const aTrust = getPairTrust(state, aiFaction, a).trustScore;
          const bTrust = getPairTrust(state, aiFaction, b).trustScore;
          return bBorder + bTrust - (aBorder + aTrust);
        });

      for (const other of neutralCandidates) {
        const op = world.profiles[other];
        const trust = getPairTrust(state, aiFaction, other);
        const isBordering = needs.borderingFactions.has(other);
        const powerRatio = op.powerScore / Math.max(1, ai.powerScore);
        const dur = trust.friendshipsCompleted > 0 ? 15 : 12;

        // Case A: AI needs gold/income -> Sell Friendship to a wealthier neighbor for Subsidy or Gold!
        if (
          (needs.cashUrgency >= 0.65 || needs.incomeUrgency >= 0.65) &&
          isBordering &&
          (op.totalMoney >= 18 || op.totalNetIncome >= 6) &&
          powerRatio <= 1.25
        ) {
          const askSubsidy = op.totalNetIncome >= 7 && trust.subsidiesBrokenAgainstMe === 0;
          const subAmt = Math.max(3, Math.min(8, Math.floor(op.totalNetIncome * 0.35)));
          const goldAmt = Math.max(10, Math.min(28, Math.floor(op.totalMoney * 0.42)));
          intents.push({
            kind: 'PROPOSE_EXCHANGE',
            target: other,
            provinceId: richestProv?.id,
            offer: {
              proposerGives: {
                type: ExchangeItemType.FRIENDSHIP,
                amount: 0,
                duration: dur,
              },
              targetGives: askSubsidy
                ? {type: ExchangeItemType.SUBSIDY, amount: subAmt, duration: 8}
                : {type: ExchangeItemType.MONEY, amount: goldAmt},
            },
          });
          return intents;
        }

        // Case B: AI is at war & needs flank security from a peer/stronger neighbor -> Pay Gold or Subsidy for Friendship!
        if (
          isBordering &&
          needs.activeWars.length > 0 &&
          powerRatio >= 0.85 &&
          richestProv &&
          (richestProv.money >= 12 || ai.totalNetIncome >= 5)
        ) {
          const offerGold = Math.min(22, Math.max(8, Math.floor(richestProv.money * 0.35)));
          const offerSub = Math.max(2, Math.min(6, Math.floor(ai.totalNetIncome * 0.32)));
          intents.push({
            kind: 'PROPOSE_EXCHANGE',
            target: other,
            provinceId: richestProv.id,
            offer: {
              targetGives: {
                type: ExchangeItemType.FRIENDSHIP,
                amount: 0,
                duration: dur,
              },
              proposerGives:
                offerGold >= 10
                  ? {type: ExchangeItemType.MONEY, amount: offerGold}
                  : {type: ExchangeItemType.SUBSIDY, amount: offerSub, duration: 7},
            },
          });
          return intents;
        }

        // Case C: Stronger AI offers protection (Friendship) to weaker bordering neighbor in exchange for Tribute!
        if (
          isBordering &&
          state.turn >= 3 &&
          powerRatio <= 0.78 &&
          (needs.activeWars.length > 0 || needs.borderingFactions.size >= 2) &&
          (op.totalNetIncome >= 4 || op.totalMoney >= 14)
        ) {
          const tributeSub = Math.max(2, Math.min(7, Math.floor(Math.max(4, op.totalNetIncome) * 0.35)));
          intents.push({
            kind: 'PROPOSE_EXCHANGE',
            target: other,
            provinceId: richestProv?.id,
            offer: {
              proposerGives: {
                type: ExchangeItemType.FRIENDSHIP,
                amount: 0,
                duration: dur,
              },
              targetGives:
                op.totalNetIncome >= 5
                  ? {type: ExchangeItemType.SUBSIDY, amount: tributeSub, duration: 8}
                  : {
                      type: ExchangeItemType.MONEY,
                      amount: Math.min(20, Math.max(8, Math.floor(op.totalMoney * 0.4))),
                    },
            },
          });
          return intents;
        }

        // Case C2: Peacetime pre-war flank security — before attacking one rival, secure another bordering flank with gold/subsidy!
        if (
          isBordering &&
          needs.activeWars.length === 0 &&
          needs.borderingFactions.size >= 2 &&
          needs.neutralFrontierCount <= 3 &&
          state.turn >= 4 &&
          powerRatio >= 0.88 &&
          richestProv &&
          (richestProv.money >= 18 || ai.totalNetIncome >= 8) &&
          (state.turn + aiFaction + other) % 2 === 0
        ) {
          const offerGold = Math.min(24, Math.max(10, Math.floor(richestProv.money * 0.32)));
          const offerSub = Math.max(3, Math.min(6, Math.floor(ai.totalNetIncome * 0.25)));
          intents.push({
            kind: 'PROPOSE_EXCHANGE',
            target: other,
            provinceId: richestProv.id,
            offer: {
              targetGives: {
                type: ExchangeItemType.FRIENDSHIP,
                amount: 0,
                duration: dur,
              },
              proposerGives:
                offerGold >= 12
                  ? {type: ExchangeItemType.MONEY, amount: offerGold}
                  : {type: ExchangeItemType.SUBSIDY, amount: offerSub, duration: 7},
            },
          });
          return intents;
        }

        // Case D: Renew alliance with a reliable longtime friend (modest resource payment from the wealthier side)
        if (
          trust.friendshipsCompleted >= 1 &&
          trust.pastFriendshipTurns >= 10 &&
          state.turn - trust.lastWarEndedTurn >= 6 &&
          (state.turn + aiFaction + other) % 3 === 0
        ) {
          if (op.totalMoney >= ai.totalMoney + 10 && op.totalMoney >= 16) {
            intents.push({
              kind: 'PROPOSE_EXCHANGE',
              target: other,
              provinceId: richestProv?.id,
              offer: {
                proposerGives: {
                  type: ExchangeItemType.FRIENDSHIP,
                  amount: 0,
                  duration: 15,
                },
                targetGives: {
                  type: ExchangeItemType.MONEY,
                  amount: Math.min(18, Math.max(8, Math.floor(op.totalMoney * 0.3))),
                },
              },
            });
            return intents;
          }
          if (richestProv && richestProv.money >= 14) {
            intents.push({
              kind: 'PROPOSE_EXCHANGE',
              target: other,
              provinceId: richestProv.id,
              offer: {
                targetGives: {
                  type: ExchangeItemType.FRIENDSHIP,
                  amount: 0,
                  duration: 15,
                },
                proposerGives: {
                  type: ExchangeItemType.MONEY,
                  amount: Math.min(16, Math.max(8, Math.floor(richestProv.money * 0.28))),
                },
              },
            });
            return intents;
          }
        }
      }
    }

    // 5c. Rich AI buys 1-2 bordering free land hexes from a friendly weaker neighbor
    if (
      state.turn >= 5 &&
      needs.isFinanciallyStrong &&
      richestProv &&
      richestProv.money >= 36
    ) {
      for (const friend of livingOthers) {
        if (
          getRelation(state, aiFaction, friend) !== DiplomaticRelation.FRIEND ||
          hasPendingWith(friend) ||
          hasRecentDiplomacyWith(friend, 6)
        ) {
          continue;
        }
        const fp = world.profiles[friend];
        if (!fp || fp.powerScore > ai.powerScore * 0.95) continue;
        const freeHexes = helpers
          .getTransferableFreeHexes(state, friend, aiFaction)
          .filter((k) =>
            getNeighborKeys(k).some((nk) => state.cells[nk]?.faction === aiFaction),
          );
        if (freeHexes.length >= 1) {
          const wantKeys = freeHexes.slice(0, Math.min(2, freeHexes.length));
          const offerGold = Math.min(
            richestProv.money - 12,
            wantKeys.length * 18,
          );
          if (offerGold >= wantKeys.length * 15) {
            intents.push({
              kind: 'PROPOSE_EXCHANGE',
              target: friend,
              provinceId: richestProv.id,
              offer: {
                targetGives: {
                  type: ExchangeItemType.LAND,
                  amount: wantKeys.length,
                  hexKeys: wantKeys,
                },
                proposerGives: {type: ExchangeItemType.MONEY, amount: offerGold},
              },
            });
            return intents;
          }
        }
      }
    }
  }

  // ===== 6. Strategic War Declarations (Rating + Global Income + Expansion Pressure + Trust Memory) =====
  if (state.turn >= 2 && !needs.isBankruptRisk) {
    let bestTarget: {faction: FactionId; score: number} | null = null;
    const shareThreatLine = Math.max(0.28, 1.12 / Math.max(2, world.livingFactions.length));

    for (const other of needs.borderingFactions) {
      const op = world.profiles[other];
      if (!op || hasPendingWith(other)) continue;
      if (getRelation(state, aiFaction, other) !== DiplomaticRelation.NEUTRAL) {
        continue;
      }

      const trust = getPairTrust(state, aiFaction, other);
      // Respect recent peace treaties for a few turns
      if (state.turn - trust.lastWarEndedTurn < 5) continue;

      const powerRatio = ai.powerScore / Math.max(1, op.powerScore);
      const otherMarked = (state.diplomacy.blackMarks[other] ?? 0) > 0;
      const canHandleFront =
        needs.activeWars.length === 0 ||
        (needs.activeWars.length === 1 &&
          powerRatio >= (difficulty === AiDifficulty.HARD ? 1.28 : 1.48));

      if (!canHandleFront && !otherMarked && !op.isDiplomaticThreat) continue;

      let warScore = 0;
      // Power & income advantage
      if (powerRatio >= 1.25) warScore += 28 + Math.min(20, (powerRatio - 1.25) * 20);
      else if (powerRatio >= 0.95) warScore += 14;
      else if (powerRatio < 0.72) warScore -= 24;

      // Expansion pressure: boxed in with little/no neutral land left to expand into
      if (needs.neutralFrontierCount === 0) warScore += 12;
      else if (needs.neutralFrontierCount <= 2) warScore += 7;

      // Ready economy shouldn't stagnate in endless peacetime
      if (
        needs.activeWars.length === 0 &&
        state.turn >= 5 &&
        ai.totalNetIncome >= 10 &&
        ai.totalMoney >= 18
      ) {
        warScore += 6;
      }

      // Target weak economy or juicy farms/income
      if (op.totalNetIncome <= 2) warScore += 10;
      // Or target an emerging economic leader (global income share) before they snowball
      if (op.globalIncomeShare >= shareThreatLine && difficulty !== AiDifficulty.EASY) {
        warScore += 7;
      }
      if (op.tier === 'HEGEMON' && op.warCount >= 1) warScore += 22;
      if (op.isDiplomaticThreat) warScore += 32;

      // Trust memory: punish betrayers & black marks; avoid attacking loyal past friends
      if (otherMarked) warScore += 20;
      if (trust.betrayalsAgainstMe > 0) warScore += 35;
      if (trust.subsidiesBrokenAgainstMe > 0) warScore += 14;
      if (trust.friendshipsCompleted > 0 && trust.betrayalsAgainstMe === 0) {
        warScore -= 18;
      }
      // Prefer attacking a rival already distracted in another war!
      if (op.warCount >= 1) warScore += 14;

      const threshold =
        difficulty === AiDifficulty.HARD
          ? 16
          : difficulty === AiDifficulty.BALANCED
            ? 20
            : 26;

      if (warScore >= threshold && (!bestTarget || warScore > bestTarget.score)) {
        bestTarget = {faction: other, score: warScore};
      }
    }

    if (bestTarget) {
      intents.push({kind: 'DECLARE_WAR', target: bestTarget.faction});
    }
  }

  return intents;
}
