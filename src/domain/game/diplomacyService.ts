import {getNeighborKeys, type HexKey} from '@/domain/hex/hexCoordinates';
import {
  BLACK_MARK_COST,
  BLACK_MARK_DURATION_TURNS,
  FACTION_PALETTES,
  getRelation,
  getRelationKey,
  getSubsidyProvinceId,
  isBuilding,
  isUnit,
} from '@/domain/game/rules';
import {
  DiplomaticMessageStatus,
  DiplomaticMessageType,
  DiplomaticRelation,
  EntityType,
  ExchangeItemType,
  FactionId,
  GameEventType,
  type DiplomacyState,
  type DiplomaticMessage,
  type DiplomaticNotice,
  type ExchangeOffer,
  type ExchangeSideOffer,
  type GameEvent,
  type GameState,
  type Province,
} from '@/domain/game/types';
import {
  advanceTurn,
  getActiveFaction,
  reconcileProvinces,
} from '@/domain/game/gameEngine';
import {recalculateFactionSummaries} from '@/domain/game/mapGenerator';
import {
  evaluateIncomingExchangeForAi,
  getTrustKey,
  planAiDiplomaticActions,
  type DiplomacyStrategyHelpers,
} from '@/domain/ai/aiStrategy';

export const SUBSIDY_DURATION_TURNS = 10;
export const MIN_SUBSIDY_DURATION = 3;
export const MAX_SUBSIDY_DURATION = 25;
export const DEFAULT_FRIENDSHIP_DURATION = 15;
export const MIN_FRIENDSHIP_DURATION = 5;
export const MAX_FRIENDSHIP_DURATION = 30;

export function createInitialDiplomacy(
  turnOrder: readonly FactionId[],
  diplomacyEnabled: boolean,
): DiplomacyState {
  const relations: Record<string, DiplomaticRelation> = {};
  const friendshipTurns: Record<string, number> = {};
  const blackMarks: Record<number, number> = {};
  const pendingNotices: Record<number, DiplomaticNotice[]> = {};

  for (const f of turnOrder) {
    blackMarks[f] = 0;
    pendingNotices[f] = [];
  }

  for (let i = 0; i < turnOrder.length; i++) {
    for (let j = i + 1; j < turnOrder.length; j++) {
      const key = getRelationKey(turnOrder[i], turnOrder[j]);
      relations[key] = diplomacyEnabled
        ? DiplomaticRelation.NEUTRAL
        : DiplomaticRelation.WAR;
    }
  }

  return {
    relations,
    friendshipTurns,
    blackMarks,
    blackMarkPairs: [],
    subsidies: [],
    messages: [],
    pendingNotices,
    pairMemory: {},
    trustLog: {},
    nextMessageId: 1,
    nextSubsidyId: 1,
    nextNoticeId: 1,
  };
}

function ensurePairMemory(
  state: GameState,
  a: FactionId,
  b: FactionId,
) {
  if (!state.diplomacy.pairMemory) {
    state.diplomacy.pairMemory = {};
  }
  const key = getRelationKey(a, b);
  let rec = state.diplomacy.pairMemory[key];
  if (!rec) {
    rec = {
      pastFriendshipTurns: 0,
      friendshipsCompleted: 0,
      warsFought: 0,
      lastWarEndedTurn: -99,
      dealsAccepted: 0,
    };
    state.diplomacy.pairMemory[key] = rec;
  }
  return rec;
}

function ensureTrustRecord(
  state: GameState,
  actor: FactionId,
  target: FactionId,
) {
  if (!state.diplomacy.trustLog) {
    state.diplomacy.trustLog = {};
  }
  const key = getTrustKey(actor, target);
  let rec = state.diplomacy.trustLog[key];
  if (!rec) {
    rec = {
      betrayals: 0,
      subsidiesBroken: 0,
      rejectedDeals: 0,
      giftsGiven: 0,
    };
    state.diplomacy.trustLog[key] = rec;
  }
  return rec;
}

export function getFriendshipTurnsRemaining(
  state: GameState,
  a: FactionId,
  b: FactionId,
): number {
  return state.diplomacy.friendshipTurns[getRelationKey(a, b)] ?? 0;
}

function getRichestProvince(
  state: GameState,
  faction: FactionId,
): Province | null {
  const id = getSubsidyProvinceId(state, faction);
  return id ? (state.provinces[id] ?? null) : null;
}

export function syncBlackMarkCounters(state: GameState): void {
  for (const fId of state.turnOrder) {
    state.diplomacy.blackMarks[fId] = 0;
  }
  for (const pair of state.diplomacy.blackMarkPairs) {
    if (pair.turnsRemaining <= 0) continue;
    state.diplomacy.blackMarks[pair.target] = Math.max(
      state.diplomacy.blackMarks[pair.target] ?? 0,
      pair.turnsRemaining,
    );
  }
}

export function hasBlackMarkBetween(
  state: GameState,
  a: FactionId,
  b: FactionId,
): boolean {
  return state.diplomacy.blackMarkPairs.some(
    (p) =>
      p.turnsRemaining > 0 &&
      ((p.issuer === a && p.target === b) ||
        (p.issuer === b && p.target === a)),
  );
}

/**
 * Black Mark rule: if A places a black mark on B, no third party C may form
 * a NEW friendship with both A and B simultaneously (existing treaties remain intact).
 */
export function canFormFriendship(
  state: GameState,
  a: FactionId,
  b: FactionId,
): {allowed: boolean; reason?: string} {
  if (a === b) return {allowed: false};
  if (hasBlackMarkBetween(state, a, b)) {
    return {
      allowed: false,
      reason: 'Между державами действует Чёрная метка.',
    };
  }

  for (const pair of state.diplomacy.blackMarkPairs) {
    if (pair.turnsRemaining <= 0) continue;
    // Check if forming friendship (a, b) violates a black mark between pair.issuer and pair.target
    if (a === pair.issuer) {
      if (getRelation(state, b, pair.target) === DiplomaticRelation.FRIEND) {
        return {
          allowed: false,
          reason: `Чёрная метка запрещает дружить одновременно с «${FACTION_PALETTES[pair.issuer].name}» и «${FACTION_PALETTES[pair.target].name}».`,
        };
      }
    }
    if (a === pair.target) {
      if (getRelation(state, b, pair.issuer) === DiplomaticRelation.FRIEND) {
        return {
          allowed: false,
          reason: `Чёрная метка запрещает дружить одновременно с «${FACTION_PALETTES[pair.issuer].name}» и «${FACTION_PALETTES[pair.target].name}».`,
        };
      }
    }
    if (b === pair.issuer) {
      if (getRelation(state, a, pair.target) === DiplomaticRelation.FRIEND) {
        return {
          allowed: false,
          reason: `Чёрная метка запрещает дружить одновременно с «${FACTION_PALETTES[pair.issuer].name}» и «${FACTION_PALETTES[pair.target].name}».`,
        };
      }
    }
    if (b === pair.target) {
      if (getRelation(state, a, pair.issuer) === DiplomaticRelation.FRIEND) {
        return {
          allowed: false,
          reason: `Чёрная метка запрещает дружить одновременно с «${FACTION_PALETTES[pair.issuer].name}» и «${FACTION_PALETTES[pair.target].name}».`,
        };
      }
    }
  }

  return {allowed: true};
}

function queueNotice(
  state: GameState,
  recipient: FactionId,
  fromFaction: FactionId,
  category: DiplomaticNotice['category'],
  text: string,
  messageId?: number,
): void {
  if (!state.diplomacy.pendingNotices[recipient]) {
    state.diplomacy.pendingNotices[recipient] = [];
  }
  state.diplomacy.pendingNotices[recipient].push({
    id: state.diplomacy.nextNoticeId++,
    turn: state.turn,
    fromFaction,
    toFaction: recipient,
    category,
    text,
    messageId,
  });
}

function queueNoticeToAllHumansExcept(
  state: GameState,
  actor: FactionId,
  category: DiplomaticNotice['category'],
  text: string,
  messageId?: number,
): void {
  for (const fId of state.turnOrder) {
    const info = state.factions[fId];
    if (info && info.isHuman && !info.isEliminated && fId !== actor) {
      queueNotice(state, fId, actor, category, text, messageId);
    }
  }
}

function addMessage(
  state: GameState,
  payload: Omit<DiplomaticMessage, 'id' | 'turn'>,
): DiplomaticMessage {
  const msg: DiplomaticMessage = {
    id: state.diplomacy.nextMessageId++,
    turn: state.turn,
    ...payload,
  };
  state.diplomacy.messages = [msg, ...state.diplomacy.messages].slice(0, 60);
  return msg;
}

function pushDiplomacyEvent(
  events: GameEvent[],
  state: GameState,
  faction: FactionId,
  note: string,
  toKey?: HexKey,
  amount?: number,
): void {
  events.push({
    id: state.nextEventId++,
    type: GameEventType.DIPLOMACY_UPDATED,
    faction,
    toKey,
    amount,
    note,
  });
}

/**
 * Checks whether a single hex is eligible to be transferred in a land exchange
 * (owned by fromFaction, not a Town, no units or buildings, and province has > 2 hexes).
 */
export function isFreeTransferableHex(
  state: GameState,
  fromFaction: FactionId,
  key: HexKey,
): boolean {
  const cell = state.cells[key];
  if (!cell || cell.faction !== fromFaction) return false;
  if (cell.entity === EntityType.TOWN) return false;
  const isFree =
    cell.entity === EntityType.NONE ||
    cell.entity === EntityType.PINE ||
    cell.entity === EntityType.PALM ||
    cell.entity === EntityType.GRAVE;
  if (!isFree) return false;
  if (cell.provinceId) {
    const prov = state.provinces[cell.provinceId];
    if (prov && prov.hexKeys.length <= 2) return false;
  }
  return true;
}

/**
 * Returns all free, transferable hexes owned by `fromFaction` (excluding Towns,
 * units, buildings, and tiny 2-hex provinces). Prefers hexes bordering `toFaction`.
 */
export function getTransferableFreeHexes(
  state: GameState,
  fromFaction: FactionId,
  toFaction: FactionId,
): HexKey[] {
  const candidates: Array<{key: HexKey; bordering: boolean; empty: boolean}> =
    [];

  for (const cell of Object.values(state.cells)) {
    if (!isFreeTransferableHex(state, fromFaction, cell.key)) continue;

    const bordering = getNeighborKeys(cell.key).some(
      (nk) => state.cells[nk]?.faction === toFaction,
    );
    candidates.push({
      key: cell.key,
      bordering,
      empty: cell.entity === EntityType.NONE,
    });
  }

  candidates.sort((a, b) => {
    if (a.bordering !== b.bordering) return a.bordering ? -1 : 1;
    if (a.empty !== b.empty) return a.empty ? -1 : 1;
    return 0;
  });

  return candidates.map((c) => c.key);
}

function transferFreeLandHexes(
  state: GameState,
  fromFaction: FactionId,
  toFaction: FactionId,
  side: ExchangeSideOffer,
  events: GameEvent[],
): number {
  const provRemaining = new Map<string, number>();
  for (const prov of Object.values(state.provinces)) {
    if (prov.faction === fromFaction) {
      provRemaining.set(prov.id, prov.hexKeys.length);
    }
  }

  const candidateKeys =
    side.hexKeys && side.hexKeys.length > 0
      ? [...new Set(side.hexKeys)]
      : getTransferableFreeHexes(state, fromFaction, toFaction).slice(
          0,
          Math.max(0, side.amount),
        );

  const toTransfer: HexKey[] = [];
  for (const key of candidateKeys) {
    if (!isFreeTransferableHex(state, fromFaction, key)) continue;
    const cell = state.cells[key];
    if (cell.provinceId) {
      const rem = provRemaining.get(cell.provinceId) ?? 0;
      if (rem <= 2) continue;
      provRemaining.set(cell.provinceId, rem - 1);
    }
    toTransfer.push(key);
  }

  for (const key of toTransfer) {
    const cell = state.cells[key];
    if (!cell) continue;
    cell.faction = toFaction;
    cell.unitMoved = false;
    events.push({
      id: state.nextEventId++,
      type: GameEventType.HEX_CAPTURED,
      faction: toFaction,
      toKey: key,
    });
  }
  if (toTransfer.length > 0) {
    reconcileProvinces(state);
  }
  return toTransfer.length;
}

export function declareWar(
  state: GameState,
  actor: FactionId,
  target: FactionId,
): GameEvent[] {
  const events: GameEvent[] = [];
  if (actor === target || !state.config.diplomacyEnabled) return events;
  const relKey = getRelationKey(actor, target);
  const current = getRelation(state, actor, target);
  if (current === DiplomaticRelation.WAR) return events;

  const betrayedFriend = current === DiplomaticRelation.FRIEND;
  state.diplomacy.relations[relKey] = DiplomaticRelation.WAR;
  delete state.diplomacy.friendshipTurns[relKey];

  // Cancel active subsidies between warring factions
  const prevSubCount = state.diplomacy.subsidies.length;
  state.diplomacy.subsidies = state.diplomacy.subsidies.filter(
    (s) =>
      !(
        (s.fromFaction === actor && s.toFaction === target) ||
        (s.fromFaction === target && s.toFaction === actor)
      ),
  );
  if (state.diplomacy.subsidies.length !== prevSubCount) {
    reconcileProvinces(state);
  }

  const pairMem = ensurePairMemory(state, actor, target);
  pairMem.warsFought += 1;

  if (betrayedFriend) {
    ensureTrustRecord(state, actor, target).betrayals += 1;
    state.diplomacy.blackMarkPairs.push({
      issuer: target,
      target: actor,
      turnsRemaining: BLACK_MARK_DURATION_TURNS,
    });
    syncBlackMarkCounters(state);
  }

  const actorName = FACTION_PALETTES[actor].name;
  const targetName = FACTION_PALETTES[target].name;
  const text = betrayedFriend
    ? `${actorName} разорвала дружбу и объявила войну державе «${targetName}»! Наложена Чёрная метка.`
    : `${actorName} объявила войну державе «${targetName}».`;

  addMessage(state, {
    fromFaction: actor,
    toFaction: target,
    type: DiplomaticMessageType.WAR_DECLARED,
    status: DiplomaticMessageStatus.INFO,
    text,
  });
  queueNoticeToAllHumansExcept(state, actor, 'WAR', text);
  pushDiplomacyEvent(events, state, actor, text);
  return events;
}

export function issueBlackMark(
  state: GameState,
  actor: FactionId,
  target: FactionId,
  provinceId?: string,
): GameEvent[] {
  const events: GameEvent[] = [];
  if (actor === target || !state.config.diplomacyEnabled) return events;

  const payProv =
    (provinceId ? state.provinces[provinceId] : null) ??
    getRichestProvince(state, actor);
  if (!payProv || payProv.money < BLACK_MARK_COST) return events;

  payProv.money -= BLACK_MARK_COST;

  const existing = state.diplomacy.blackMarkPairs.find(
    (p) => p.issuer === actor && p.target === target,
  );
  if (existing) {
    existing.turnsRemaining += BLACK_MARK_DURATION_TURNS;
  } else {
    state.diplomacy.blackMarkPairs.push({
      issuer: actor,
      target,
      turnsRemaining: BLACK_MARK_DURATION_TURNS,
    });
  }
  syncBlackMarkCounters(state);

  const text = `${FACTION_PALETTES[actor].name} поставила Чёрную метку державе «${FACTION_PALETTES[target].name}» (${BLACK_MARK_DURATION_TURNS} х.).`;
  addMessage(state, {
    fromFaction: actor,
    toFaction: target,
    type: DiplomaticMessageType.BLACK_MARK,
    status: DiplomaticMessageStatus.INFO,
    goldAmount: BLACK_MARK_COST,
    text,
  });
  queueNoticeToAllHumansExcept(state, actor, 'BLACK_MARK', text);
  pushDiplomacyEvent(
    events,
    state,
    actor,
    text,
    payProv.townKey,
    -BLACK_MARK_COST,
  );
  return events;
}

export function removeBlackMarkBetween(
  state: GameState,
  a: FactionId,
  b: FactionId,
): boolean {
  const before = state.diplomacy.blackMarkPairs.length;
  state.diplomacy.blackMarkPairs = state.diplomacy.blackMarkPairs.filter(
    (p) =>
      !(
        (p.issuer === a && p.target === b) ||
        (p.issuer === b && p.target === a)
      ),
  );
  syncBlackMarkCounters(state);
  return state.diplomacy.blackMarkPairs.length < before;
}

export function describeExchangeSide(side: ExchangeSideOffer): string {
  switch (side.type) {
    case ExchangeItemType.NOTHING:
      return 'Ничего';
    case ExchangeItemType.MONEY:
      return `${side.amount} зол.`;
    case ExchangeItemType.LAND: {
      const cnt = side.hexKeys?.length ?? side.amount;
      return `${cnt} кл. земли`;
    }
    case ExchangeItemType.FRIENDSHIP: {
      const dur = side.duration ?? DEFAULT_FRIENDSHIP_DURATION;
      return `Дружба (${dur} х.)`;
    }
    case ExchangeItemType.DECLARE_WAR:
      return side.warTargetFaction
        ? `Война с «${FACTION_PALETTES[side.warTargetFaction].name}»`
        : 'Объявление войны';
    case ExchangeItemType.END_WAR:
      return 'Прекращение войны';
    case ExchangeItemType.REMOVE_BLACK_MARK:
      return 'Снятие Чёрной метки';
    case ExchangeItemType.SUBSIDY: {
      const dur = side.duration ?? SUBSIDY_DURATION_TURNS;
      return `Дотации ${side.amount}/ход (${dur} х.)`;
    }
  }
}

function applyExchangeSide(
  state: GameState,
  giver: FactionId,
  receiver: FactionId,
  side: ExchangeSideOffer,
  events: GameEvent[],
  giverProvinceId?: string,
): void {
  switch (side.type) {
    case ExchangeItemType.NOTHING:
      return;
    case ExchangeItemType.MONEY: {
      const fromProv =
        (giverProvinceId ? state.provinces[giverProvinceId] : null) ??
        getRichestProvince(state, giver);
      const toProv = getRichestProvince(state, receiver);
      if (fromProv && toProv && side.amount > 0) {
        const actual = Math.min(fromProv.money, side.amount);
        fromProv.money -= actual;
        toProv.money += actual;
      }
      return;
    }
    case ExchangeItemType.LAND: {
      transferFreeLandHexes(state, giver, receiver, side, events);
      return;
    }
    case ExchangeItemType.FRIENDSHIP: {
      const check = canFormFriendship(state, giver, receiver);
      if (check.allowed) {
        const relKey = getRelationKey(giver, receiver);
        const dur = Math.max(
          MIN_FRIENDSHIP_DURATION,
          Math.min(
            MAX_FRIENDSHIP_DURATION,
            side.duration ?? DEFAULT_FRIENDSHIP_DURATION,
          ),
        );
        state.diplomacy.relations[relKey] = DiplomaticRelation.FRIEND;
        state.diplomacy.friendshipTurns[relKey] = Math.max(
          state.diplomacy.friendshipTurns[relKey] ?? 0,
          dur,
        );
      }
      return;
    }
    case ExchangeItemType.END_WAR: {
      if (getRelation(state, giver, receiver) === DiplomaticRelation.WAR) {
        state.diplomacy.relations[getRelationKey(giver, receiver)] =
          DiplomaticRelation.NEUTRAL;
        ensurePairMemory(state, giver, receiver).lastWarEndedTurn = state.turn;
      }
      return;
    }
    case ExchangeItemType.DECLARE_WAR: {
      const warVictim = side.warTargetFaction ?? receiver;
      if (warVictim !== giver) {
        events.push(...declareWar(state, giver, warVictim));
      }
      return;
    }
    case ExchangeItemType.REMOVE_BLACK_MARK: {
      removeBlackMarkBetween(state, giver, receiver);
      return;
    }
    case ExchangeItemType.SUBSIDY: {
      if (side.amount > 0) {
        const dur = Math.max(
          MIN_SUBSIDY_DURATION,
          Math.min(
            MAX_SUBSIDY_DURATION,
            side.duration ?? SUBSIDY_DURATION_TURNS,
          ),
        );
        state.diplomacy.subsidies.push({
          id: state.diplomacy.nextSubsidyId++,
          fromFaction: giver,
          toFaction: receiver,
          amountPerTurn: side.amount,
          turnsRemaining: dur,
        });
      }
      return;
    }
  }
}

export function proposeExchangeDeal(
  state: GameState,
  proposer: FactionId,
  target: FactionId,
  offer: ExchangeOffer,
  proposerProvinceId?: string,
): GameEvent[] {
  const events: GameEvent[] = [];
  if (proposer === target || !state.config.diplomacyEnabled) return events;
  const targetInfo = state.factions[target];
  if (!targetInfo || targetInfo.isEliminated) return events;

  const rel = getRelation(state, proposer, target);

  // Enforce land rule: can only request land from target if already FRIENDS
  if (
    offer.targetGives.type === ExchangeItemType.LAND &&
    rel !== DiplomaticRelation.FRIEND
  ) {
    pushDiplomacyEvent(
      events,
      state,
      proposer,
      'Запрашивать земли можно только у дружественной державы.',
    );
    return events;
  }

  // Enforce friendship Black Mark rule
  if (
    offer.targetGives.type === ExchangeItemType.FRIENDSHIP ||
    offer.proposerGives.type === ExchangeItemType.FRIENDSHIP
  ) {
    const check = canFormFriendship(state, proposer, target);
    if (!check.allowed) {
      pushDiplomacyEvent(
        events,
        state,
        proposer,
        check.reason ?? 'Невозможно заключить дружбу из-за Чёрной метки.',
      );
      return events;
    }
  }

  const proposerName = FACTION_PALETTES[proposer].name;
  const targetName = FACTION_PALETTES[target].name;
  const summary = `${targetName} (${describeExchangeSide(offer.targetGives)}) ⇄ ${proposerName} (${describeExchangeSide(offer.proposerGives)})`;

  if (!targetInfo.isHuman) {
    // Strategic AI evaluation (power ratings, global income, real needs, memory, anti-world-peace)
    const evaluation = evaluateIncomingExchangeForAi(
      state,
      target,
      proposer,
      offer,
      STRATEGY_HELPERS,
    );

    if (evaluation.accepts) {
      applyExchangeSide(
        state,
        proposer,
        target,
        offer.proposerGives,
        events,
        proposerProvinceId,
      );
      applyExchangeSide(state, target, proposer, offer.targetGives, events);
      reconcileProvinces(state);
      ensurePairMemory(state, proposer, target).dealsAccepted += 1;

      const isFriendshipDeal =
        offer.targetGives.type === ExchangeItemType.FRIENDSHIP ||
        offer.proposerGives.type === ExchangeItemType.FRIENDSHIP;
      const text = isFriendshipDeal
        ? `${proposerName} и ${targetName} заключили дружбу.`
        : `Соглашение заключено: ${summary}.`;
      addMessage(state, {
        fromFaction: target,
        toFaction: proposer,
        type: DiplomaticMessageType.EXCHANGE_OFFER,
        status: DiplomaticMessageStatus.ACCEPTED,
        exchangeOffer: offer,
        text,
      });

      const changedRelation = isFriendshipDeal
        ? 'FRIEND'
        : offer.targetGives.type === ExchangeItemType.END_WAR ||
            offer.proposerGives.type === ExchangeItemType.END_WAR
          ? 'NEUTRAL'
          : 'EXCHANGE';
      queueNoticeToAllHumansExcept(state, proposer, changedRelation, text);
      pushDiplomacyEvent(events, state, proposer, text);
      recalculateFactionSummaries(state);
      if (state.winner !== null) {
        events.push({
          id: state.nextEventId++,
          type: GameEventType.GAME_WON,
          faction: state.winner,
        });
      }
    } else {
      ensureTrustRecord(state, proposer, target).rejectedDeals += 1;
      const reason = evaluation.reason ?? 'условия невыгодны';
      const text = `${targetName} отклонила предложение «${proposerName}» (${reason}).`;
      addMessage(state, {
        fromFaction: target,
        toFaction: proposer,
        type: DiplomaticMessageType.EXCHANGE_OFFER,
        status: DiplomaticMessageStatus.REJECTED,
        exchangeOffer: offer,
        text,
      });
      queueNoticeToAllHumansExcept(state, proposer, 'REJECTED', text);
      pushDiplomacyEvent(events, state, proposer, text);
    }
    return events;
  }

  // Target is Human: enqueue pending offer & notify target with messageId for quick actions
  const text = `${proposerName} предлагает обмен: ${summary}.`;
  const createdMsg = addMessage(state, {
    fromFaction: proposer,
    toFaction: target,
    type: DiplomaticMessageType.EXCHANGE_OFFER,
    status: DiplomaticMessageStatus.PENDING,
    exchangeOffer: offer,
    text,
  });
  queueNotice(state, target, proposer, 'EXCHANGE', text, createdMsg.id);
  pushDiplomacyEvent(
    events,
    state,
    proposer,
    `Запрос отправлен: ${targetName}.`,
  );
  return events;
}

export function proposePeace(
  state: GameState,
  actor: FactionId,
  target: FactionId,
  goldOffer = 0,
  provinceId?: string,
): GameEvent[] {
  return proposeExchangeDeal(
    state,
    actor,
    target,
    {
      targetGives: {
        type: ExchangeItemType.FRIENDSHIP,
        amount: 0,
        duration: DEFAULT_FRIENDSHIP_DURATION,
      },
      proposerGives:
        goldOffer > 0
          ? {type: ExchangeItemType.MONEY, amount: goldOffer}
          : {type: ExchangeItemType.NOTHING, amount: 0},
    },
    provinceId,
  );
}

export function sendGoldExchange(
  state: GameState,
  actorProvinceId: string,
  target: FactionId,
  amount: number,
  note?: string,
): GameEvent[] {
  const events: GameEvent[] = [];
  const province = state.provinces[actorProvinceId];
  if (!province || amount <= 0 || province.money < amount) return events;
  const targetProv = getRichestProvince(state, target);
  if (!targetProv) return events;

  province.money -= amount;
  targetProv.money += amount;
  ensureTrustRecord(state, province.faction, target).giftsGiven += amount;

  const text = note?.trim()
    ? `${FACTION_PALETTES[province.faction].name} передала ${amount} зол.: «${note.trim()}»`
    : `${FACTION_PALETTES[province.faction].name} передала ${amount} зол.`;

  addMessage(state, {
    fromFaction: province.faction,
    toFaction: target,
    type: DiplomaticMessageType.TRADE_GOLD,
    status: DiplomaticMessageStatus.INFO,
    goldAmount: amount,
    text,
  });
  queueNotice(state, target, province.faction, 'EXCHANGE', text);
  pushDiplomacyEvent(
    events,
    state,
    province.faction,
    text,
    province.townKey,
    -amount,
  );
  return events;
}

export function sendDiplomaticNote(
  state: GameState,
  actor: FactionId,
  target: FactionId,
  rawText: string,
): GameEvent[] {
  const events: GameEvent[] = [];
  const trimmed = rawText.trim();
  if (!trimmed) return events;
  const text = `${FACTION_PALETTES[actor].name}: «${trimmed}»`;
  addMessage(state, {
    fromFaction: actor,
    toFaction: target,
    type: DiplomaticMessageType.NOTE,
    status: DiplomaticMessageStatus.INFO,
    text,
  });
  queueNotice(state, target, actor, 'MESSAGE', text);
  pushDiplomacyEvent(events, state, actor, `Сообщение отправлено (${FACTION_PALETTES[target].name}).`);
  return events;
}

export function respondToDiplomaticMessage(
  state: GameState,
  messageId: number,
  accept: boolean,
): GameEvent[] {
  const events: GameEvent[] = [];
  const msg = state.diplomacy.messages.find((m) => m.id === messageId);
  if (!msg || msg.status !== DiplomaticMessageStatus.PENDING) return events;

  const responderName =
    state.factions[msg.toFaction]?.name ?? FACTION_PALETTES[msg.toFaction].name;
  const senderName =
    state.factions[msg.fromFaction]?.name ??
    FACTION_PALETTES[msg.fromFaction].name;

  if (!accept) {
    msg.status = DiplomaticMessageStatus.REJECTED;
    const rejectText = `${responderName} отклонил(а) предложение «${senderName}».`;
    queueNoticeToAllHumansExcept(state, msg.toFaction, 'REJECTED', rejectText);
    pushDiplomacyEvent(events, state, msg.toFaction, rejectText);
    return events;
  }

  if (
    msg.type === DiplomaticMessageType.EXCHANGE_OFFER &&
    msg.exchangeOffer
  ) {
    applyExchangeSide(
      state,
      msg.fromFaction,
      msg.toFaction,
      msg.exchangeOffer.proposerGives,
      events,
    );
    applyExchangeSide(
      state,
      msg.toFaction,
      msg.fromFaction,
      msg.exchangeOffer.targetGives,
      events,
    );
    reconcileProvinces(state);
    msg.status = DiplomaticMessageStatus.ACCEPTED;
    ensurePairMemory(state, msg.fromFaction, msg.toFaction).dealsAccepted += 1;

    const isFriendship =
      msg.exchangeOffer.proposerGives.type === ExchangeItemType.FRIENDSHIP ||
      msg.exchangeOffer.targetGives.type === ExchangeItemType.FRIENDSHIP;

    if (isFriendship) {
      const friendText = `${senderName} и ${responderName} заключили дружбу.`;
      queueNoticeToAllHumansExcept(state, msg.toFaction, 'FRIEND', friendText);
      pushDiplomacyEvent(events, state, msg.toFaction, friendText);
    } else {
      const dealText = `Соглашение заключено: ${senderName} ⇄ ${responderName}.`;
      queueNotice(state, msg.fromFaction, msg.toFaction, 'EXCHANGE', dealText);
      pushDiplomacyEvent(events, state, msg.toFaction, dealText);
    }
  } else if (msg.type === DiplomaticMessageType.PEACE_OFFER) {
    const senderProv = getRichestProvince(state, msg.fromFaction);
    const receiverProv = getRichestProvince(state, msg.toFaction);
    const gold = msg.goldAmount ?? 0;
    if (gold > 0 && senderProv && senderProv.money >= gold && receiverProv) {
      senderProv.money -= gold;
      receiverProv.money += gold;
    }
    const relKey = getRelationKey(msg.fromFaction, msg.toFaction);
    state.diplomacy.relations[relKey] = DiplomaticRelation.FRIEND;
    state.diplomacy.friendshipTurns[relKey] = DEFAULT_FRIENDSHIP_DURATION;
    msg.status = DiplomaticMessageStatus.ACCEPTED;
    const friendText = `${senderName} и ${responderName} заключили дружбу.`;
    queueNoticeToAllHumansExcept(state, msg.toFaction, 'FRIEND', friendText);
    pushDiplomacyEvent(events, state, msg.toFaction, friendText);
  }

  recalculateFactionSummaries(state);
  if (state.winner !== null) {
    events.push({
      id: state.nextEventId++,
      type: GameEventType.GAME_WON,
      faction: state.winner,
    });
  }

  return events;
}

export function processTurnSubsidies(
  state: GameState,
  activeFaction: FactionId,
): void {
  const remaining: typeof state.diplomacy.subsidies = [];
  for (const sub of state.diplomacy.subsidies) {
    if (sub.fromFaction === activeFaction) {
      const fromProv = getRichestProvince(state, sub.fromFaction);
      const toProv = getRichestProvince(state, sub.toFaction);
      const rel = getRelation(state, sub.fromFaction, sub.toFaction);
      if (
        fromProv &&
        toProv &&
        rel !== DiplomaticRelation.WAR &&
        !state.factions[sub.toFaction]?.isEliminated
      ) {
        const pay = Math.min(fromProv.money, sub.amountPerTurn);
        fromProv.money -= pay;
        toProv.money += pay;
      }
      if (sub.turnsRemaining - 1 > 0) {
        remaining.push({...sub, turnsRemaining: sub.turnsRemaining - 1});
      }
    } else {
      remaining.push(sub);
    }
  }
  state.diplomacy.subsidies = remaining;
}

/**
 * Allows either party (payer or recipient) to terminate an active subsidy treaty
 * at any moment, releasing both sides from future obligations.
 */
export function cancelDiplomaticSubsidy(
  state: GameState,
  actor: FactionId,
  subsidyId: number,
): GameEvent[] {
  const events: GameEvent[] = [];
  if (state.winner !== null) return events;
  const actorInfo = state.factions[actor];
  if (!actorInfo || actorInfo.isEliminated) return events;

  const idx = state.diplomacy.subsidies.findIndex((s) => s.id === subsidyId);
  if (idx === -1) return events;
  const sub = state.diplomacy.subsidies[idx];
  if (sub.fromFaction !== actor && sub.toFaction !== actor) return events;

  state.diplomacy.subsidies.splice(idx, 1);
  reconcileProvinces(state);

  const otherFaction =
    sub.fromFaction === actor ? sub.toFaction : sub.fromFaction;
  // Breaking a subsidy you promised to pay harms trust in diplomatic memory
  if (sub.fromFaction === actor) {
    ensureTrustRecord(state, actor, otherFaction).subsidiesBroken += 1;
  }
  const actorName =
    state.factions[actor]?.name ?? FACTION_PALETTES[actor].name;
  const otherName =
    state.factions[otherFaction]?.name ?? FACTION_PALETTES[otherFaction].name;
  const text = `${actorName} прервал(а) договор о дотациях (${sub.amountPerTurn}/ход) с «${otherName}».`;

  addMessage(state, {
    fromFaction: actor,
    toFaction: otherFaction,
    type: DiplomaticMessageType.NOTE,
    status: DiplomaticMessageStatus.INFO,
    text,
  });
  queueNotice(state, otherFaction, actor, 'EXCHANGE', text);
  pushDiplomacyEvent(events, state, actor, text);
  return events;
}

/**
 * Voluntarily surrenders a living faction: neutralizes all its territory,
 * clears units/buildings/regenerators/treaties, marks the faction eliminated,
 * checks win conditions, and advances the turn if it was the surrendering faction's turn.
 */
export function surrenderFaction(
  state: GameState,
  faction: FactionId,
): GameEvent[] {
  const events: GameEvent[] = [];
  if (state.winner !== null) return events;
  const info = state.factions[faction];
  if (!info || info.isEliminated) return events;

  const wasActiveTurn = getActiveFaction(state) === faction;

  for (const cell of Object.values(state.cells)) {
    if (cell.faction !== faction) continue;
    cell.faction = FactionId.NEUTRAL;
    cell.provinceId = null;
    cell.unitMoved = false;
    if (isUnit(cell.entity) || isBuilding(cell.entity)) {
      cell.entity = EntityType.NONE;
    }
  }

  if (state.regenerators && state.regenerators.length > 0) {
    state.regenerators = state.regenerators.filter((r) => r.faction !== faction);
  }
  if (state.tradingPosts && state.tradingPosts.length > 0) {
    state.tradingPosts = state.tradingPosts.filter((p) => p.faction !== faction);
  }

  state.diplomacy.subsidies = state.diplomacy.subsidies.filter(
    (s) => s.fromFaction !== faction && s.toFaction !== faction,
  );
  for (const msg of state.diplomacy.messages) {
    if (
      msg.status === DiplomaticMessageStatus.PENDING &&
      (msg.fromFaction === faction || msg.toFaction === faction)
    ) {
      msg.status = DiplomaticMessageStatus.REJECTED;
    }
  }
  for (const other of state.turnOrder) {
    if (other === faction) continue;
    const relKey = getRelationKey(faction, other);
    if (state.diplomacy.relations[relKey] === DiplomaticRelation.FRIEND) {
      state.diplomacy.relations[relKey] = DiplomaticRelation.NEUTRAL;
    }
    delete state.diplomacy.friendshipTurns[relKey];
  }

  info.isEliminated = true;
  reconcileProvinces(state);

  const actorName = info.name ?? FACTION_PALETTES[faction].name;
  const text = `${actorName} сдалась и вышла из партии.`;
  addMessage(state, {
    fromFaction: faction,
    toFaction: faction,
    type: DiplomaticMessageType.NOTE,
    status: DiplomaticMessageStatus.INFO,
    text,
  });
  queueNoticeToAllHumansExcept(state, faction, 'NEUTRAL', text);
  pushDiplomacyEvent(events, state, faction, text);

  if (state.winner !== null) {
    events.push({
      id: state.nextEventId++,
      type: GameEventType.GAME_WON,
      faction: state.winner,
    });
    return events;
  }

  if (wasActiveTurn) {
    events.push(...advanceTurn(state));
  }

  return events;
}

export function tickBlackMarkPairs(state: GameState): void {
  state.diplomacy.blackMarkPairs = state.diplomacy.blackMarkPairs
    .map((p) => ({...p, turnsRemaining: p.turnsRemaining - 1}))
    .filter((p) => p.turnsRemaining > 0);
  syncBlackMarkCounters(state);
}

/**
 * Decrements active friendship duration timers each round and reverts expired
 * friendships back to NEUTRAL with a diplomatic notice.
 */
export function tickFriendshipTimers(state: GameState): void {
  const timers = state.diplomacy.friendshipTurns;
  if (!timers) return;
  for (const [relKey, turns] of Object.entries(timers)) {
    const [aStr, bStr] = relKey.split('-');
    const a = Number(aStr) as FactionId;
    const b = Number(bStr) as FactionId;
    const pairMem = ensurePairMemory(state, a, b);
    pairMem.pastFriendshipTurns += 1;

    const next = turns - 1;
    if (next > 0) {
      timers[relKey] = next;
      continue;
    }
    delete timers[relKey];
    if (state.diplomacy.relations[relKey] === DiplomaticRelation.FRIEND) {
      pairMem.friendshipsCompleted += 1;
      state.diplomacy.relations[relKey] = DiplomaticRelation.NEUTRAL;
      if (state.factions[a]?.isHuman && !state.factions[a].isEliminated) {
        queueNotice(
          state,
          a,
          b,
          'NEUTRAL',
          `Срок дружбы с державой «${FACTION_PALETTES[b].name}» истёк.`,
        );
      }
      if (state.factions[b]?.isHuman && !state.factions[b].isEliminated) {
        queueNotice(
          state,
          b,
          a,
          'NEUTRAL',
          `Срок дружбы с державой «${FACTION_PALETTES[a].name}» истёк.`,
        );
      }
    }
  }
}

const STRATEGY_HELPERS: DiplomacyStrategyHelpers = {
  canFormFriendship,
  hasBlackMarkBetween,
  getTransferableFreeHexes,
  isFreeTransferableHex,
};

/**
 * Evaluates strategic diplomatic actions for an AI faction at the start of its turn.
 * Uses power ratings, global income analysis, relationship memory, real economic/military
 * needs, and active anti-world-peace countermeasures.
 */
export function runAiDiplomacyTurn(
  state: GameState,
  aiFaction: FactionId,
): GameEvent[] {
  const events: GameEvent[] = [];
  if (!state.config.diplomacyEnabled) return events;

  const aiInfo = state.factions[aiFaction];
  if (!aiInfo || aiInfo.isEliminated) return events;

  const intents = planAiDiplomaticActions(state, aiFaction, STRATEGY_HELPERS);
  for (const intent of intents) {
    if (state.winner !== null) break;
    switch (intent.kind) {
      case 'CANCEL_SUBSIDY':
        events.push(...cancelDiplomaticSubsidy(state, aiFaction, intent.subsidyId));
        break;
      case 'BLACK_MARK':
        events.push(
          ...issueBlackMark(state, aiFaction, intent.target, intent.provinceId),
        );
        break;
      case 'DECLARE_WAR':
        events.push(...declareWar(state, aiFaction, intent.target));
        break;
      case 'PROPOSE_EXCHANGE':
        events.push(
          ...proposeExchangeDeal(
            state,
            aiFaction,
            intent.target,
            intent.offer,
            intent.provinceId,
          ),
        );
        break;
    }
  }

  return events;
}
