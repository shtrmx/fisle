import {defineStore} from 'pinia';
import {computed, ref, shallowRef} from 'vue';
import type {HexKey} from '@/domain/hex/hexCoordinates';
import {
  advanceTurn,
  cloneGameState,
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
  cancelDiplomaticSubsidy as domainCancelSubsidy,
  canFormFriendship,
  declareWar as domainDeclareWar,
  getFriendshipTurnsRemaining,
  getTransferableFreeHexes,
  hasBlackMarkBetween,
  issueBlackMark as domainIssueBlackMark,
  proposeExchangeDeal as domainProposeExchange,
  proposePeace as domainProposePeace,
  respondToDiplomaticMessage as domainRespondToMessage,
  runAiDiplomacyTurn,
  sendDiplomaticNote as domainSendNote,
  sendGoldExchange as domainSendGold,
  surrenderFaction as domainSurrenderFaction,
} from '@/domain/game/diplomacyService';
import {createInitialGameState} from '@/domain/game/mapGenerator';
import {
  computeProvinceEconomyBreakdown,
  computeVisibleHexes,
  countEntityTypeInProvince,
  FACTION_PALETTES,
  findBestTradingPostFootprint,
  FLARE_COST,
  FLARE_RADIUS,
  getActiveSubsidiesForFaction,
  getHexCoverageArea,
  getHexProtection,
  getProvincePurchaseCost,
  getPurchaseCost,
  getRelation,
  isUnit,
  REGENERATOR_COST,
  REGENERATOR_RADIUS,
  getTurnTimeLimitSeconds,
  TURN_TIME_LIMIT_SECONDS,
  type CoverageAreaKind,
  type ProvinceEconomyBreakdown,
} from '@/domain/game/rules';
import {
  AiDifficulty,
  CameraMode,
  DiplomaticMessageStatus,
  DiplomaticRelation,
  EntityType,
  FactionId,
  GameEventType,
  GameMode,
  MapSize,
  ScenarioId,
  TreeSpawnRate,
  type ActiveToolType,
  type DiplomaticNotice,
  type ExchangeOffer,
  type GameConfig,
  type GameEvent,
  type GameState,
  type HexCell,
  type Province,
  type PurchasableEntity,
} from '@/domain/game/types';
import {runSingleAiStep} from '@/domain/ai/aiService';
import {soundService} from '@/application/services/soundService';
import type {
  ChatMessage,
  FactionController,
  GameNotification,
  NotificationActionKind,
  NotificationCategory,
  OnlinePlayerSlot,
  RoomHistoryEntry,
  RoomSnapshot,
  RoomStatus,
  ServerWsMessage,
} from '@/domain/multiplayer/types';
import {wsClient} from '@/infrastructure/multiplayer/wsClient';
import {
  deleteSaveSlot,
  listSaveSlots,
  loadGameFromSlot,
  saveGameToSlot,
  type SaveSlotSummary,
} from '@/infrastructure/storage/saveGameStorage';

const DEFAULT_CONFIG: GameConfig = {
  mode: GameMode.SKIRMISH,
  scenario: ScenarioId.ARCHIPELAGO,
  mapSize: MapSize.MEDIUM,
  factionCount: 4,
  humanCount: 1,
  difficulty: AiDifficulty.BALANCED,
  treeSpawnRate: TreeSpawnRate.NORMAL,
  riversAndLakes: true,
  diplomacyEnabled: true,
  fogOfWar: true,
  seed: 202604,
};

function createMenuDemoConfig(seed?: number): GameConfig {
  return {
    mode: GameMode.SKIRMISH,
    scenario: ScenarioId.RANDOM,
    mapSize: MapSize.SMALL,
    factionCount: 4,
    humanCount: 0,
    difficulty: AiDifficulty.BALANCED,
    treeSpawnRate: TreeSpawnRate.NORMAL,
    riversAndLakes: true,
    diplomacyEnabled: false,
    fogOfWar: false,
    seed: seed ?? Math.floor(100_000 + Math.random() * 900_000),
  };
}

export interface SonnerItem {
  readonly id: string;
  readonly category: NotificationCategory;
  readonly title?: string;
  readonly text: string;
  readonly details?: string[];
  readonly fromFaction?: FactionId;
  readonly notificationId?: string;
  readonly messageId?: number;
  readonly actionKind?: NotificationActionKind;
  readonly durationMs: number;
  readonly createdAt: number;
}

const DEFAULT_SONNER_DURATION_MS = 5000;

export const useGameStore = defineStore('antiyoyGame', () => {
  const gameState = ref<GameState>(
    createInitialGameState(createMenuDemoConfig()),
  );
  const selectedProvinceId = ref<string | null>(null);
  const selectedUnitKey = ref<HexKey | null>(null);
  const activeTool = ref<ActiveToolType | null>(null);
  const hoveredHexKey = ref<HexKey | null>(null);
  const toastMessage = ref<string | null>(null);
  const sonnerItems = ref<SonnerItem[]>([]);

  const undoStack = shallowRef<GameState[]>([]);
  const isAiThinking = ref(false);
  const latestEvents = shallowRef<GameEvent[]>([]);
  const boardVersion = ref(1);
  const mapResetVersion = ref(1);

  const cameraMode = ref<CameraMode>(CameraMode.AUTO);
  const cameraZoom = ref(0.82);
  const cameraTiltFactor = ref(0);
  const soundEnabled = ref(true);
  const hudCollapsed = ref(false);
  const showNewGameDialog = ref(false);
  const newGameDialogInitialTab = ref<'create' | 'join'>('create');
  const showMainMenu = ref(true);
  const showPauseDialog = ref(false);
  const showRulesDialog = ref(false);
  const showDiplomacyDialog = ref(false);
  const showCountriesDialog = ref(false);
  const showIncomeDialog = ref(false);
  const showNotificationsDialog = ref(false);
  const showChatDialog = ref(false);
  const showMatchOverviewDialog = ref(false);
  const showSaveLoadDialog = ref(false);
  const showShortcutsDialog = ref(false);
  const showHistoryDialog = ref(false);
  const roomHistory = ref<RoomHistoryEntry[]>([]);
  const roomHistoryCreatedCount = ref(0);
  const roomHistoryMaxCreated = ref(3);
  const roomHistoryLoading = ref(false);
  const roomHistoryError = ref<string | null>(null);
  const saveSlots = ref<Array<SaveSlotSummary | null>>(listSaveSlots());
  const elapsedSeconds = ref(0);
  const turnRemainingSeconds = ref(TURN_TIME_LIMIT_SECONDS);
  const turnTimeLimitSeconds = computed(() =>
    getTurnTimeLimitSeconds(gameState.value.config),
  );
  const isLoading = ref(true);
  const loadingLabel = ref('Подготовка карты...');
  const turnDiplomaticNotices = ref<DiplomaticNotice[]>([]);
  const areaPulseSignal = ref<{
    id: number;
    centerKey: HexKey;
    radius: number;
    kind: CoverageAreaKind;
  } | null>(null);

  // Online Multiplayer State
  const isOnlineMode = ref(false);
  const roomCode = ref<string | null>(null);
  const roomName = ref<string | null>(null);
  const roomStatus = ref<'IDLE' | RoomStatus>('IDLE');
  const roomHasPassword = ref(false);
  const roomConfig = ref<GameConfig | null>(null);
  const localPlayerId = ref<string | null>(null);
  const localPlayerFactionId = ref<FactionId | null>(null);
  const onlinePlayers = ref<OnlinePlayerSlot[]>([]);
  const factionControllers = ref<Record<number, FactionController>>({});
  const waitingForFactionId = ref<FactionId | null>(null);
  const isRoomPaused = ref(false);
  const roomPausedBy = ref<string | null>(null);
  const chatMessages = ref<ChatMessage[]>([]);
  const notifications = ref<GameNotification[]>([]);
  const wsConnected = ref(false);
  const onlineCanUndo = ref(false);
  const onlineBusy = ref(false);
  const onlineError = ref<string | null>(null);
  const autoSaveSlot = ref<number | null>(null);
  const lastAutoSaveAt = ref<number | null>(null);

  interface LandPickerSession {
    side: 'target' | 'proposer';
    ownerFaction: FactionId;
    recipientFaction: FactionId;
    eligibleKeys: Set<HexKey>;
    selectedKeys: HexKey[];
  }

  const landPicker = ref<LandPickerSession | null>(null);
  const landPickerCompleted = ref<{
    side: 'target' | 'proposer';
    hexKeys: HexKey[];
    seq: number;
  } | null>(null);
  const returningFromLandPicker = ref(false);

  const AUTO_SAVE_INTERVAL_SECONDS = 5 * 60;
  let autoSaveElapsedSec = 0;
  let aiRunToken = 0;
  let areaPulseCounter = 1;
  let landPickerSeq = 1;
  let localNotifSeq = 1;
  let sonnerSeq = 1;
  const sonnerTimers = new Map<string, number>();

  window.setInterval(() => {
    if (showMainMenu.value) return;
    if (
      isOnlineMode.value &&
      (roomStatus.value !== 'PLAYING' || isRoomPaused.value)
    ) {
      return;
    }
    if (
      gameState.value.winner === null &&
      (!showPauseDialog.value || isOnlineMode.value) &&
      !isLoading.value
    ) {
      elapsedSeconds.value++;

      // Host / local player auto-save every 5 minutes when an auto-save slot was chosen
      if (
        autoSaveSlot.value !== null &&
        (!isOnlineMode.value || isLocalHost.value)
      ) {
        autoSaveElapsedSec++;
        if (autoSaveElapsedSec >= AUTO_SAVE_INTERVAL_SECONDS) {
          autoSaveElapsedSec = 0;
          performAutoSave(false);
        }
      }

      if (
        !isAiThinking.value &&
        waitingForFactionId.value === null &&
        turnTimeLimitSeconds.value > 0
      ) {
        if (turnRemainingSeconds.value > 0) {
          turnRemainingSeconds.value--;
        }
        if (
          !isOnlineMode.value &&
          turnRemainingSeconds.value <= 0 &&
          isHumanTurn.value
        ) {
          showToast('Время хода истекло — ход завершён.');
          endTurn();
        }
      }
    }
  }, 1000);

  function dismissSonner(id: string): void {
    const timer = sonnerTimers.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      sonnerTimers.delete(id);
    }
    sonnerItems.value = sonnerItems.value.filter((item) => item.id !== id);
  }

  const seenNoticeIds = new Set<number>();

  function clearAllSonners(): void {
    for (const timer of sonnerTimers.values()) {
      window.clearTimeout(timer);
    }
    sonnerTimers.clear();
    sonnerItems.value = [];
    seenNoticeIds.clear();
  }

  function pushSonner(input: {
    category?: NotificationCategory;
    title?: string;
    text: string;
    details?: string[];
    fromFaction?: FactionId;
    notificationId?: string;
    messageId?: number;
    actionKind?: NotificationActionKind;
    durationMs?: number;
  }): void {
    const now = Date.now();
    // Deduplicate identical recent banners within 3s (regardless of title differences)
    const duplicate = sonnerItems.value.find(
      (existing) =>
        ((input.messageId !== undefined &&
          existing.messageId === input.messageId) ||
          existing.text === input.text) &&
        now - existing.createdAt < 3000,
    );
    if (duplicate) return;

    const id = `sonner_${sonnerSeq++}`;
    const durationMs = input.durationMs ?? DEFAULT_SONNER_DURATION_MS;
    const item: SonnerItem = {
      id,
      category: input.category ?? 'SYSTEM',
      title: input.title,
      text: input.text,
      details: input.details,
      fromFaction: input.fromFaction,
      notificationId: input.notificationId,
      messageId: input.messageId,
      actionKind: input.actionKind,
      durationMs,
      createdAt: now,
    };

    const next = [item, ...sonnerItems.value];
    while (next.length > 3) {
      const removed = next.pop();
      if (removed) {
        const t = sonnerTimers.get(removed.id);
        if (t !== undefined) {
          window.clearTimeout(t);
          sonnerTimers.delete(removed.id);
        }
      }
    }
    sonnerItems.value = next;

    const timer = window.setTimeout(() => {
      dismissSonner(id);
    }, durationMs);
    sonnerTimers.set(id, timer);
  }

  function showToast(
    text: string,
    category: NotificationCategory = 'SYSTEM',
    opts?: {
      title?: string;
      fromFaction?: FactionId;
      notificationId?: string;
      messageId?: number;
      actionKind?: NotificationActionKind;
      durationMs?: number;
    },
  ): void {
    toastMessage.value = text;
    pushSonner({
      category,
      text,
      ...opts,
    });
  }

  function pushNotification(notif: GameNotification): void {
    if (
      notifications.value.some(
        (n) =>
          n.id === notif.id ||
          (n.turn === notif.turn &&
            n.category === notif.category &&
            n.text === notif.text),
      )
    ) {
      return;
    }
    notifications.value = [notif, ...notifications.value].slice(0, 80);
  }

  function markNotificationRead(id: string): void {
    notifications.value = notifications.value.map((n) =>
      n.id === id ? {...n, read: true} : n,
    );
  }

  function markNotificationsReadByCategories(
    categories: readonly NotificationCategory[],
  ): void {
    const set = new Set(categories);
    notifications.value = notifications.value.map((n) =>
      set.has(n.category) ? {...n, read: true} : n,
    );
  }

  function markAllNotificationsRead(): void {
    notifications.value = notifications.value.map((n) => ({...n, read: true}));
  }

  function clearNotifications(): void {
    notifications.value = [];
  }

  function handleSonnerQuickAction(
    itemId: string,
    action: 'accept' | 'chat' | 'diplomacy',
  ): void {
    const item = sonnerItems.value.find((s) => s.id === itemId);
    if (!item) return;

    if (item.notificationId) {
      markNotificationRead(item.notificationId);
    }
    dismissSonner(itemId);

    if (action === 'accept' && item.messageId !== undefined) {
      respondToMessage(item.messageId, true);
    } else if (action === 'chat' && isOnlineMode.value) {
      showChatDialog.value = true;
    } else if (action === 'diplomacy' && gameState.value.config.diplomacyEnabled) {
      showDiplomacyDialog.value = true;
    }
  }

  function emitAreaPulse(
    centerKey: HexKey,
    radius: number,
    kind: CoverageAreaKind,
  ): void {
    areaPulseSignal.value = {
      id: areaPulseCounter++,
      centerKey,
      radius,
      kind,
    };
  }

  function triggerCoveragePulseIfVisible(key: HexKey): void {
    const isVisible =
      visibleHexSet.value === null || visibleHexSet.value.has(key);
    if (!isVisible) return;
    const area = getHexCoverageArea(
      gameState.value,
      key,
      viewerFactionId.value,
    );
    if (area) {
      emitAreaPulse(area.centerKey, area.radius, area.kind);
    }
  }

  function getEntityCountInSelectedProvince(entity: EntityType): number {
    void boardVersion.value;
    if (!selectedProvince.value) return 0;
    return countEntityTypeInProvince(
      gameState.value,
      selectedProvince.value.id,
      entity,
    );
  }

  function getToolCost(entity: PurchasableEntity): number {
    void boardVersion.value;
    if (!selectedProvince.value) {
      return getPurchaseCost(entity, 0);
    }
    return getProvincePurchaseCost(
      gameState.value,
      selectedProvince.value.id,
      entity,
    );
  }

  const activeFactionId = computed<FactionId>(() =>
    getActiveFaction(gameState.value),
  );

  const isLocalHost = computed(() =>
    isOnlineMode.value
      ? onlinePlayers.value.some(
          (p) => !p.left && p.playerId === localPlayerId.value && p.isHost,
        )
      : true,
  );

  const localControlledFactions = computed<FactionId[]>(() => {
    if (isOnlineMode.value) {
      const list: FactionId[] = [];
      if (localPlayerFactionId.value !== null) {
        list.push(localPlayerFactionId.value);
      }
      if (isLocalHost.value) {
        for (const fId of gameState.value.turnOrder) {
          if (
            factionControllers.value[fId] === 'HOTSEAT' &&
            !list.includes(fId)
          ) {
            list.push(fId);
          }
        }
      }
      return list;
    }
    return gameState.value.turnOrder.filter(
      (fId) => gameState.value.factions[fId]?.isHuman,
    );
  });

  /**
   * The local viewer's faction.
   * - In Online Mode: active hotseat faction if host controls it, else our own chosen faction.
   * - In Offline Mode: active human faction, or first human faction during AI turns.
   */
  const viewerFactionId = computed<FactionId>(() => {
    const active = activeFactionId.value;
    if (isOnlineMode.value) {
      if (localControlledFactions.value.includes(active)) {
        return active;
      }
      if (localPlayerFactionId.value !== null) {
        return localPlayerFactionId.value;
      }
    }
    if (gameState.value.factions[active]?.isHuman) {
      return active;
    }
    const humanFaction = gameState.value.turnOrder.find(
      (fId) => gameState.value.factions[fId]?.isHuman,
    );
    return humanFaction ?? active;
  });

  const isViewerEliminated = computed<boolean>(() => {
    void boardVersion.value;
    if (isOnlineMode.value) {
      if (localControlledFactions.value.length > 0) {
        return localControlledFactions.value.every((fId) =>
          Boolean(gameState.value.factions[fId]?.isEliminated),
        );
      }
      return Boolean(gameState.value.factions[viewerFactionId.value]?.isEliminated);
    }
    const humanFactions = gameState.value.turnOrder.filter(
      (fId) => gameState.value.factions[fId]?.isHuman,
    );
    if (humanFactions.length === 0) return false;
    return humanFactions.every((fId) =>
      Boolean(gameState.value.factions[fId]?.isEliminated),
    );
  });

  const visibleHexSet = computed<Set<HexKey> | null>(() => {
    if (!gameState.value.config.fogOfWar || isViewerEliminated.value) {
      return null;
    }
    void boardVersion.value;
    return computeVisibleHexes(gameState.value, viewerFactionId.value);
  });

  const activeFactionInfo = computed(
    () => gameState.value.factions[activeFactionId.value],
  );

  const activeFactionPalette = computed(
    () => FACTION_PALETTES[activeFactionId.value],
  );

  const viewerFactionInfo = computed(
    () => gameState.value.factions[viewerFactionId.value],
  );

  const viewerFactionPalette = computed(
    () => FACTION_PALETTES[viewerFactionId.value],
  );

  const isHumanTurn = computed(() => {
    if (isOnlineMode.value) {
      return (
        roomStatus.value === 'PLAYING' &&
        !isRoomPaused.value &&
        gameState.value.winner === null &&
        waitingForFactionId.value === null &&
        localControlledFactions.value.includes(activeFactionId.value) &&
        !isAiThinking.value
      );
    }
    return (
      Boolean(activeFactionInfo.value?.isHuman) &&
      gameState.value.winner === null &&
      !isAiThinking.value
    );
  });

  /**
   * Outgoing diplomatic requests can ONLY be sent on the player's own turn.
   */
  const canSendDiplomacy = computed(() => {
    if (!gameState.value.config.diplomacyEnabled) return false;
    if (gameState.value.winner !== null) return false;
    if (isOnlineMode.value && isRoomPaused.value) return false;
    return isHumanTurn.value;
  });

  /**
   * Incoming diplomatic requests can be accepted/rejected at ANY moment.
   */
  const canRespondDiplomacy = computed(() => {
    if (!gameState.value.config.diplomacyEnabled) return false;
    if (gameState.value.winner !== null) return false;
    if (isOnlineMode.value) {
      if (roomStatus.value !== 'PLAYING' || isRoomPaused.value) return false;
      const actor = viewerFactionId.value;
      return (
        localControlledFactions.value.includes(actor) &&
        !gameState.value.factions[actor]?.isEliminated
      );
    }
    return isHumanTurn.value;
  });

  /**
   * Legacy alias: true whenever viewer can interact with incoming diplomacy.
   */
  const canUseDiplomacy = computed(() => canRespondDiplomacy.value);

  /**
   * Selected province ALWAYS belongs to OUR viewerFactionId so top-bar treasury
   * and income remain OURS even while waiting for another online player's turn!
   */
  const selectedProvince = computed<Province | null>(() => {
    void boardVersion.value;
    const ownerId = viewerFactionId.value;
    if (selectedProvinceId.value) {
      const prov = gameState.value.provinces[selectedProvinceId.value];
      if (prov && prov.faction === ownerId) return prov;
    }
    const ownProvs = Object.values(gameState.value.provinces)
      .filter((p) => p.faction === ownerId)
      .sort((a, b) => b.hexKeys.length - a.hexKeys.length);
    return ownProvs[0] ?? null;
  });

  const activeFactionProvinces = computed<Province[]>(() =>
    Object.values(gameState.value.provinces)
      .filter((p) => p.faction === viewerFactionId.value)
      .sort((a, b) => b.hexKeys.length - a.hexKeys.length),
  );

  const onlinePresenceByFaction = computed<
    Record<number, OnlinePlayerSlot | undefined>
  >(() => {
    const map: Record<number, OnlinePlayerSlot | undefined> = {};
    for (const p of onlinePlayers.value) {
      if (!p.left) {
        map[p.factionId] = p;
      }
    }
    return map;
  });

  const unreadNotificationCount = computed(
    () => notifications.value.filter((n) => !n.read).length,
  );

  const reachableHexMap = computed<Map<HexKey, HexKey[]>>(() => {
    void boardVersion.value;
    if (!isHumanTurn.value || !selectedUnitKey.value) {
      return new Map();
    }
    return computeReachableHexes(gameState.value, selectedUnitKey.value);
  });

  const catapultTargetSet = computed<Set<HexKey>>(() => {
    void boardVersion.value;
    if (!isHumanTurn.value || !selectedUnitKey.value) {
      return new Set();
    }
    return computeCatapultTargets(gameState.value, selectedUnitKey.value);
  });

  const buildableHexSet = computed<Set<HexKey>>(() => {
    void boardVersion.value;
    if (
      !isHumanTurn.value ||
      !selectedProvince.value ||
      !activeTool.value ||
      activeTool.value === 'DEMOLISH' ||
      activeTool.value === 'FLARE'
    ) {
      return new Set();
    }
    if (activeTool.value === 'REGENERATOR') {
      return computeRegeneratorHexes(gameState.value, selectedProvince.value.id);
    }
    return computeBuildableHexes(
      gameState.value,
      selectedProvince.value.id,
      activeTool.value as PurchasableEntity,
    );
  });

  const hoveredTradingPostPreviewSet = computed<Set<HexKey>>(() => {
    void boardVersion.value;
    if (
      !isHumanTurn.value ||
      !selectedProvince.value ||
      activeTool.value !== EntityType.TRADING_POST ||
      !hoveredHexKey.value ||
      !buildableHexSet.value.has(hoveredHexKey.value)
    ) {
      return new Set();
    }
    const footprint = findBestTradingPostFootprint(
      gameState.value,
      selectedProvince.value.id,
      hoveredHexKey.value,
    );
    return footprint ? new Set(footprint) : new Set();
  });

  const demolishHexSet = computed<Set<HexKey>>(() => {
    void boardVersion.value;
    if (
      !isHumanTurn.value ||
      !selectedProvince.value ||
      activeTool.value !== 'DEMOLISH'
    ) {
      return new Set();
    }
    return computeDemolishableHexes(gameState.value, selectedProvince.value.id);
  });

  const landPickEligibleSet = computed<Set<HexKey>>(() =>
    landPicker.value ? landPicker.value.eligibleKeys : new Set(),
  );

  const landPickSelectedSet = computed<Set<HexKey>>(() =>
    landPicker.value ? new Set(landPicker.value.selectedKeys) : new Set(),
  );

  const hoveredCell = computed<HexCell | null>(() => {
    if (!hoveredHexKey.value) return null;
    if (
      visibleHexSet.value &&
      !visibleHexSet.value.has(hoveredHexKey.value)
    ) {
      return null;
    }
    return gameState.value.cells[hoveredHexKey.value] ?? null;
  });

  const hoveredProtection = computed<number>(() => {
    if (!hoveredHexKey.value) return 0;
    if (
      visibleHexSet.value &&
      !visibleHexSet.value.has(hoveredHexKey.value)
    ) {
      return 0;
    }
    return getHexProtection(gameState.value, hoveredHexKey.value);
  });

  const canUndo = computed(() =>
    isOnlineMode.value
      ? isHumanTurn.value && onlineCanUndo.value
      : isHumanTurn.value && undoStack.value.length > 0,
  );

  const readyUnitsCount = computed(() => {
    void boardVersion.value;
    const fId = viewerFactionId.value;
    return Object.values(gameState.value.cells).filter(
      (c) => c.faction === fId && isUnit(c.entity) && !c.unitMoved,
    ).length;
  });

  const pendingMessagesCount = computed(() => {
    void boardVersion.value;
    const viewer = viewerFactionId.value;
    return gameState.value.diplomacy.messages.filter(
      (m) =>
        m.toFaction === viewer &&
        m.status === DiplomaticMessageStatus.PENDING,
    ).length;
  });

  const selectedProvinceBreakdown = computed<ProvinceEconomyBreakdown | null>(
    () => {
      void boardVersion.value;
      if (!selectedProvince.value) return null;
      return computeProvinceEconomyBreakdown(
        gameState.value,
        selectedProvince.value.id,
      );
    },
  );

  const viewerActiveSubsidies = computed(() => {
    void boardVersion.value;
    return getActiveSubsidiesForFaction(gameState.value, viewerFactionId.value);
  });

  const factionLeaderboard = computed(() => {
    void boardVersion.value;
    const provincesByFaction = new Map<number, number>();
    const farmsByFaction = new Map<number, number>();
    const unitsByFaction = new Map<number, number>();

    for (const prov of Object.values(gameState.value.provinces)) {
      provincesByFaction.set(
        prov.faction,
        (provincesByFaction.get(prov.faction) ?? 0) + 1,
      );
      farmsByFaction.set(
        prov.faction,
        (farmsByFaction.get(prov.faction) ?? 0) + prov.farmCount,
      );
    }
    for (const cell of Object.values(gameState.value.cells)) {
      if (cell.faction !== FactionId.NEUTRAL && isUnit(cell.entity)) {
        unitsByFaction.set(
          cell.faction,
          (unitsByFaction.get(cell.faction) ?? 0) + 1,
        );
      }
    }

    return gameState.value.turnOrder
      .map((fId) => {
        const slot = onlinePresenceByFaction.value[fId];
        return {
          ...gameState.value.factions[fId],
          palette: FACTION_PALETTES[fId],
          provinceCount: provincesByFaction.get(fId) ?? 0,
          farmCount: farmsByFaction.get(fId) ?? 0,
          unitCount: unitsByFaction.get(fId) ?? 0,
          relationToViewer: getRelation(
            gameState.value,
            viewerFactionId.value,
            fId,
          ),
          blackMarkTurns: gameState.value.diplomacy.blackMarks[fId] ?? 0,
          onlineSlot: slot ?? null,
        };
      })
      .sort((a, b) => b.hexCount - a.hexCount);
  });

  function selectPrimaryProvinceForViewer(): void {
    const provs = activeFactionProvinces.value;
    if (provs.length > 0) {
      selectedProvinceId.value = provs[0].id;
    } else {
      selectedProvinceId.value = null;
    }
  }

  selectPrimaryProvinceForViewer();

  function triggerEventSounds(events: GameEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case GameEventType.CATAPULT_FIRED: {
          if (
            visibleHexSet.value !== null &&
            (!ev.toKey || !visibleHexSet.value.has(ev.toKey)) &&
            (!ev.fromKey || !visibleHexSet.value.has(ev.fromKey))
          ) {
            break;
          }
          soundService.playCatapult();
          return;
        }
        case GameEventType.BUILDING_DEMOLISHED:
          soundService.playDemolish();
          return;
        case GameEventType.FLARE_LAUNCHED:
        case GameEventType.REGENERATOR_PLACED:
          if (
            !isOnlineMode.value ||
            localControlledFactions.value.includes(ev.faction)
          ) {
            soundService.playFlare();
            return;
          }
          break;
        case GameEventType.DIPLOMACY_UPDATED:
          soundService.playDiplomacy();
          return;
        case GameEventType.HEX_CAPTURED:
          soundService.playCapture();
          return;
        case GameEventType.BUILDING_BUILT:
          soundService.playBuild();
          return;
        case GameEventType.TREE_CHOPPED:
          soundService.playCoin();
          return;
        case GameEventType.UNIT_MOVED:
        case GameEventType.UNIT_BOUGHT:
        case GameEventType.UNIT_MERGED:
          soundService.playMove();
          return;
        case GameEventType.GAME_WON:
          soundService.playVictory();
          return;
        default:
          break;
      }
    }
  }

  function pushUndoSnapshot(): void {
    undoStack.value = [
      ...undoStack.value.slice(-19),
      cloneGameState(gameState.value),
    ];
  }

  function commitEvents(events: GameEvent[]): void {
    latestEvents.value = events;
    boardVersion.value++;
    triggerEventSounds(events);
    for (const ev of events) {
      if (!ev.note) continue;
      // Do not spam notifications when flares or regenerators are placed
      if (
        ev.type === GameEventType.FLARE_LAUNCHED ||
        ev.type === GameEventType.REGENERATOR_PLACED
      ) {
        continue;
      }
      // Do not leak catapult bombardment toasts when target hex is hidden in Fog of War
      if (
        ev.type === GameEventType.CATAPULT_FIRED &&
        visibleHexSet.value !== null &&
        (!ev.toKey || !visibleHexSet.value.has(ev.toKey))
      ) {
        continue;
      }
      const isDip = ev.type === GameEventType.DIPLOMACY_UPDATED;

      // In online mode, other factions' diplomacy is delivered via notification:new
      // or start-of-turn summary — skip re-displaying it from broadcast events.
      if (
        isDip &&
        isOnlineMode.value &&
        !localControlledFactions.value.includes(ev.faction)
      ) {
        continue;
      }

      const category: NotificationCategory = isDip
        ? ev.note.includes('войн')
          ? 'WAR'
          : ev.note.includes('дружб')
            ? 'FRIEND'
            : ev.note.includes('отклон')
              ? 'REJECTED'
              : ev.note.includes('метк')
                ? 'BLACK_MARK'
                : 'EXCHANGE'
        : 'SYSTEM';

      let notifId: string | undefined;
      if (isDip) {
        notifId = `local_ev_${localNotifSeq++}_${ev.id}`;
        const fromName =
          gameState.value.factions[ev.faction]?.name ??
          FACTION_PALETTES[ev.faction]?.name ??
          'Держава';
        pushNotification({
          id: notifId,
          category,
          fromFaction: ev.faction,
          fromName,
          text: ev.note,
          turn: gameState.value.turn,
          timestamp: Date.now(),
          actionKind: 'OPEN_DIPLOMACY',
          read: showNotificationsDialog.value,
        });
      }

      pushSonner({
        category,
        fromFaction: isDip ? ev.faction : undefined,
        text: ev.note,
        notificationId: notifId,
        actionKind: isDip ? 'OPEN_DIPLOMACY' : undefined,
      });
    }
  }

  function setSceneReady(): void {
    isLoading.value = false;
    if (showMainMenu.value && gameState.value.config.humanCount === 0) {
      void processMenuDemoAiTurns();
    }
  }

  function mirrorNoticesToBell(notices: DiplomaticNotice[]): Map<number, string> {
    const idMap = new Map<number, string>();
    const mapCat: Record<DiplomaticNotice['category'], NotificationCategory> = {
      WAR: 'WAR',
      FRIEND: 'FRIEND',
      NEUTRAL: 'NEUTRAL',
      BLACK_MARK: 'BLACK_MARK',
      EXCHANGE: 'EXCHANGE',
      MESSAGE: 'MESSAGE',
      REJECTED: 'REJECTED',
    };
    for (const n of notices) {
      const fromName =
        gameState.value.factions[n.fromFaction]?.name ??
        FACTION_PALETTES[n.fromFaction]?.name ??
        'Держава';
      const notifId = `local_n_${localNotifSeq++}_${n.id}`;
      idMap.set(n.id, notifId);
      pushNotification({
        id: notifId,
        category: mapCat[n.category] ?? 'MESSAGE',
        fromFaction: n.fromFaction,
        fromName,
        text: n.text,
        turn: n.turn,
        timestamp: Date.now(),
        messageId: n.messageId,
        actionKind:
          n.messageId !== undefined ? 'DIPLOMACY_RESPONSE' : 'OPEN_DIPLOMACY',
        read: false,
      });
    }
    return idMap;
  }

  function flushTurnNoticesForActiveHuman(): void {
    const fId = viewerFactionId.value;
    if (!gameState.value.factions[fId]?.isHuman) return;
    const pending = gameState.value.diplomacy.pendingNotices[fId] ?? [];
    gameState.value.diplomacy.pendingNotices[fId] = [];
    turnDiplomaticNotices.value = [];
    if (pending.length === 0) return;

    const unseen = pending.filter((n) => !seenNoticeIds.has(n.id));
    for (const n of unseen) {
      seenNoticeIds.add(n.id);
    }
    if (unseen.length === 0) return;

    const notifIds = mirrorNoticesToBell(unseen);

    // 1. Start-of-turn summary: ONLY friends formed, wars declared, proposals rejected
    const summaryLines: string[] = [];
    const seen = new Set<string>();
    for (const n of unseen) {
      if (
        n.category === 'FRIEND' ||
        n.category === 'WAR' ||
        n.category === 'REJECTED'
      ) {
        if (!seen.has(n.text)) {
          seen.add(n.text);
          summaryLines.push(n.text);
        }
      }
    }

    if (summaryLines.length > 0) {
      pushSonner({
        category: summaryLines.some((s) => s.includes('войн'))
          ? 'WAR'
          : summaryLines.some((s) => s.includes('дружб'))
            ? 'FRIEND'
            : 'REJECTED',
        title: `Сводка хода ${gameState.value.turn}`,
        text: summaryLines[0],
        details: summaryLines.length > 1 ? summaryLines : undefined,
        actionKind: 'OPEN_DIPLOMACY',
        durationMs: 6000,
      });
    }

    // 2. Offline/hotseat actionable pending proposals -> immediate Sonner with Accept
    if (!isOnlineMode.value) {
      for (const n of unseen) {
        if (n.messageId === undefined) continue;
        const msg = gameState.value.diplomacy.messages.find(
          (m) =>
            m.id === n.messageId &&
            m.status === DiplomaticMessageStatus.PENDING,
        );
        if (!msg) continue;
        const fromName =
          gameState.value.factions[n.fromFaction]?.name ??
          FACTION_PALETTES[n.fromFaction]?.name ??
          'Держава';
        pushSonner({
          category: 'EXCHANGE',
          title: fromName,
          text: n.text,
          fromFaction: n.fromFaction,
          notificationId: notifIds.get(n.id),
          messageId: n.messageId,
          actionKind: 'DIPLOMACY_RESPONSE',
          durationMs: 5500,
        });
      }
    }
  }

  function dismissTurnNotices(): void {
    turnDiplomaticNotices.value = [];
  }

  // ==================== ONLINE MULTIPLAYER INTEGRATION ====================

  function applyRoomSnapshot(
    snapshot: RoomSnapshot,
    resetScene: boolean,
  ): void {
    roomCode.value = snapshot.code;
    roomName.value = snapshot.name;
    roomStatus.value = snapshot.status;
    roomHasPassword.value = Boolean(snapshot.hasPassword);
    roomConfig.value = snapshot.config;
    onlinePlayers.value = snapshot.players;
    factionControllers.value = snapshot.factionControllers ?? {};
    waitingForFactionId.value = snapshot.waitingForFactionId ?? null;
    isRoomPaused.value = Boolean(snapshot.isPaused);
    roomPausedBy.value = snapshot.pausedByNickname ?? null;
    if (isRoomPaused.value) {
      isAiThinking.value = false;
    }
    chatMessages.value = snapshot.chat;
    elapsedSeconds.value = snapshot.elapsedSeconds;
    turnRemainingSeconds.value =
      snapshot.turnRemainingSeconds ??
      getTurnTimeLimitSeconds(snapshot.config);
    onlineCanUndo.value = snapshot.canUndo;
    onlineBusy.value = false;
    onlineError.value = null;

    if (snapshot.state) {
      const shouldReset =
        resetScene ||
        Object.keys(gameState.value.cells).length === 0 ||
        gameState.value.config.seed !== snapshot.state.config.seed;

      gameState.value = snapshot.state;
      selectedUnitKey.value = null;
      activeTool.value = null;
      hoveredHexKey.value = null;
      selectPrimaryProvinceForViewer();
      if (shouldReset) {
        isLoading.value = true;
        loadingLabel.value = 'Построение 3D-сцены...';
        mapResetVersion.value++;
      } else {
        isLoading.value = false;
      }
      boardVersion.value++;
    } else {
      isLoading.value = false;
    }
  }

  function handleServerMessage(msg: ServerWsMessage): void {
    switch (msg.type) {
      case 'pong':
        return;

      case 'error':
        onlineBusy.value = false;
        onlineError.value = msg.message;
        showToast(msg.message);
        return;

      case 'room:joined':
        isOnlineMode.value = true;
        localPlayerId.value = msg.credentials.playerId;
        localPlayerFactionId.value = msg.credentials.factionId;
        wsClient.saveSession({
          ...msg.credentials,
          roomName: msg.snapshot.name,
          autoSaveSlot: autoSaveSlot.value,
        });
        showMainMenu.value = false;
        showNewGameDialog.value = false;
        showHistoryDialog.value = false;
        showPauseDialog.value = false;
        applyRoomSnapshot(msg.snapshot, true);
        if (
          msg.snapshot.status === 'PLAYING' &&
          isLocalHost.value &&
          autoSaveSlot.value !== null
        ) {
          autoSaveElapsedSec = 0;
          performAutoSave(true);
        }
        if (msg.snapshot.status === 'WAITING') {
          soundService.playSelect();
        } else {
          soundService.playTurnEnd();
        }
        return;

      case 'room:sync':
        applyRoomSnapshot(msg.snapshot, false);
        return;

      case 'room:started':
        showMainMenu.value = false;
        notifications.value = [];
        turnDiplomaticNotices.value = [];
        applyRoomSnapshot(msg.snapshot, true);
        if (isLocalHost.value && autoSaveSlot.value !== null) {
          autoSaveElapsedSec = 0;
          performAutoSave(true);
        }
        showToast('Все игроки в сборе! Карта сгенерирована.');
        soundService.playTurnEnd();
        return;

      case 'room:presence':
        onlinePlayers.value = msg.players;
        if (msg.factionControllers) {
          factionControllers.value = msg.factionControllers;
        }
        if (msg.waitingForFactionId !== undefined) {
          waitingForFactionId.value = msg.waitingForFactionId;
        }
        if (msg.isPaused !== undefined) {
          isRoomPaused.value = Boolean(msg.isPaused);
        }
        if (msg.pausedByNickname !== undefined) {
          roomPausedBy.value = msg.pausedByNickname ?? null;
        }
        return;

      case 'room:left':
        wsClient.clearSession();
        wsClient.disconnect();
        if (isOnlineMode.value) {
          resetOnlineStateLocally();
          autoSaveSlot.value = null;
          lastAutoSaveAt.value = null;
          autoSaveElapsedSec = 0;
          clearAllSonners();
          showMainMenu.value = true;
          isLoading.value = false;
          if (msg.reason) {
            showToast(msg.reason);
          }
        } else {
          isLoading.value = false;
        }
        return;

      case 'game:state_updated': {
        const prevActive = getActiveFaction(gameState.value);
        gameState.value = msg.state;
        elapsedSeconds.value = msg.elapsedSeconds;
        if (typeof msg.turnRemainingSeconds === 'number') {
          turnRemainingSeconds.value = msg.turnRemainingSeconds;
        }
        if (msg.waitingForFactionId !== undefined) {
          waitingForFactionId.value = msg.waitingForFactionId;
        }
        if (msg.factionControllers) {
          factionControllers.value = msg.factionControllers;
        }
        onlineCanUndo.value = msg.canUndo;
        isAiThinking.value = Boolean(msg.isAiStep);

        const nextActive = getActiveFaction(gameState.value);
        if (!localControlledFactions.value.includes(nextActive)) {
          selectedUnitKey.value = null;
          activeTool.value = null;
        }
        if (
          selectedProvinceId.value &&
          (!gameState.value.provinces[selectedProvinceId.value] ||
            gameState.value.provinces[selectedProvinceId.value].faction !==
              viewerFactionId.value)
        ) {
          selectPrimaryProvinceForViewer();
        }
        if (gameState.value.winner !== null) {
          roomStatus.value = 'FINISHED';
        }

        commitEvents(msg.events);

        if (
          prevActive !== nextActive &&
          localControlledFactions.value.includes(nextActive) &&
          gameState.value.winner === null
        ) {
          selectPrimaryProvinceForViewer();
          soundService.playTurnEnd();
          showToast('Ваш ход!');
          flushTurnNoticesForActiveHuman();
        }
        return;
      }

      case 'chat:message':
        if (!chatMessages.value.some((c) => c.id === msg.message.id)) {
          chatMessages.value = [...chatMessages.value.slice(-99), msg.message];
        }
        return;

      case 'notification:new': {
        const notif = msg.notification;
        const alreadyViewing =
          showNotificationsDialog.value ||
          (notif.category === 'CHAT' && showChatDialog.value);
        pushNotification(alreadyViewing ? {...notif, read: true} : notif);

        if (notif.category === 'CHAT') {
          if (!showChatDialog.value) {
            soundService.playSelect();
            pushSonner({
              category: 'CHAT',
              title: notif.fromName ?? 'Чат',
              text: notif.text,
              fromFaction: notif.fromFaction,
              notificationId: notif.id,
              actionKind: 'OPEN_CHAT',
            });
          }
        } else {
          soundService.playDiplomacy();
          pushSonner({
            category: notif.category,
            title: notif.fromName,
            text: notif.text,
            fromFaction: notif.fromFaction,
            notificationId: notif.id,
            messageId: notif.messageId,
            actionKind:
              notif.actionKind ??
              (notif.messageId !== undefined
                ? 'DIPLOMACY_RESPONSE'
                : 'OPEN_DIPLOMACY'),
          });
        }
        return;
      }
    }
  }

  function resetOnlineStateLocally(): void {
    isOnlineMode.value = false;
    roomCode.value = null;
    roomName.value = null;
    roomStatus.value = 'IDLE';
    roomHasPassword.value = false;
    roomConfig.value = null;
    localPlayerId.value = null;
    localPlayerFactionId.value = null;
    onlinePlayers.value = [];
    factionControllers.value = {};
    waitingForFactionId.value = null;
    isRoomPaused.value = false;
    roomPausedBy.value = null;
    chatMessages.value = [];
    notifications.value = [];
    onlineCanUndo.value = false;
    onlineBusy.value = false;
    onlineError.value = null;
    showChatDialog.value = false;
    showNotificationsDialog.value = false;
    showPauseDialog.value = false;
  }

  wsClient.onMessage(handleServerMessage);
  wsClient.onStatus((connected) => {
    wsConnected.value = connected;
  });

  // Establish persistent HttpOnly player ID cookie on first visit
  void wsClient.ensurePlayerIdentity();

  // Auto-reconnect on tab reload if an online session exists
  const savedOnlineSession = wsClient.loadSavedSession();
  if (savedOnlineSession) {
    showMainMenu.value = false;
    isOnlineMode.value = true;
    roomCode.value = savedOnlineSession.roomCode;
    roomName.value = savedOnlineSession.roomName ?? null;
    localPlayerId.value = savedOnlineSession.playerId;
    localPlayerFactionId.value = savedOnlineSession.factionId;
    autoSaveSlot.value = savedOnlineSession.autoSaveSlot ?? null;
    isLoading.value = true;
    loadingLabel.value = 'Восстановление онлайн-партии...';

    void wsClient
      .send({
        type: 'room:reconnect',
        code: savedOnlineSession.roomCode,
        playerId: savedOnlineSession.playerId,
      })
      .catch(() => {
        wsClient.clearSession();
        resetOnlineStateLocally();
        autoSaveSlot.value = null;
        showMainMenu.value = true;
        isLoading.value = false;
      });
  }

  function openNewGameMenu(tab: 'create' | 'join' = 'create'): void {
    newGameDialogInitialTab.value = tab;
    showPauseDialog.value = false;
    showNewGameDialog.value = true;
  }

  async function createOnlineRoom(
    config: GameConfig,
    nickname: string,
    factionId: FactionId,
    password?: string,
    chosenAutoSaveSlot?: number | null,
  ): Promise<void> {
    onlineError.value = null;
    onlineBusy.value = true;
    autoSaveSlot.value = chosenAutoSaveSlot ?? null;
    lastAutoSaveAt.value = null;
    autoSaveElapsedSec = 0;
    try {
      await wsClient.send({
        type: 'room:create',
        config,
        nickname,
        factionId,
        password: password?.trim() || undefined,
      });
    } catch (err) {
      onlineBusy.value = false;
      onlineError.value =
        err instanceof Error ? err.message : 'Ошибка подключения к серверу.';
      showToast(onlineError.value);
    }
  }

  async function hostCurrentGameOnline(
    nickname: string,
    primaryFactionId: FactionId,
    controllers: Record<number, FactionController>,
    password?: string,
    chosenAutoSaveSlot?: number | null,
  ): Promise<void> {
    if (isOnlineMode.value) return;
    onlineError.value = null;
    onlineBusy.value = true;
    if (chosenAutoSaveSlot !== undefined) {
      autoSaveSlot.value = chosenAutoSaveSlot;
    }
    autoSaveElapsedSec = 0;
    aiRunToken++;
    isAiThinking.value = false;
    try {
      await wsClient.send({
        type: 'room:host_existing',
        state: cloneGameState(gameState.value),
        elapsedSeconds: elapsedSeconds.value,
        nickname,
        primaryFactionId,
        factionControllers: controllers,
        password: password?.trim() || undefined,
      });
    } catch (err) {
      onlineBusy.value = false;
      onlineError.value =
        err instanceof Error ? err.message : 'Ошибка подключения к серверу.';
      showToast(onlineError.value);
    }
  }

  async function joinOnlineRoom(
    code: string,
    nickname: string,
    factionId: FactionId,
    password?: string,
  ): Promise<void> {
    onlineError.value = null;
    onlineBusy.value = true;
    try {
      await wsClient.send({
        type: 'room:join',
        code: code.trim().toUpperCase(),
        nickname,
        factionId,
        password: password?.trim() || undefined,
      });
    } catch (err) {
      onlineBusy.value = false;
      onlineError.value =
        err instanceof Error ? err.message : 'Ошибка подключения к серверу.';
      showToast(onlineError.value);
    }
  }

  async function refreshRoomHistory(): Promise<void> {
    roomHistoryLoading.value = true;
    roomHistoryError.value = null;
    try {
      const res = await wsClient.fetchRoomHistory();
      roomHistory.value = res.rooms;
      roomHistoryCreatedCount.value = res.createdCount;
      roomHistoryMaxCreated.value = res.maxCreatedRooms;
    } catch {
      roomHistoryError.value = 'Не удалось загрузить историю партий.';
    } finally {
      roomHistoryLoading.value = false;
    }
  }

  async function rejoinRoomFromHistory(code: string): Promise<void> {
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return;
    onlineError.value = null;
    roomHistoryError.value = null;
    onlineBusy.value = true;
    try {
      await wsClient.send({
        type: 'room:rejoin',
        code: cleanCode,
      });
    } catch (err) {
      onlineBusy.value = false;
      const message =
        err instanceof Error ? err.message : 'Не удалось вернуться в комнату.';
      onlineError.value = message;
      roomHistoryError.value = message;
      showToast(message);
    }
  }

  function kickOnlinePlayer(targetPlayerId: string): void {
    if (!isOnlineMode.value || !isLocalHost.value) return;
    wsClient.sendRaw({type: 'room:kick_player', targetPlayerId});
  }

  function reassignOnlineFaction(
    factionId: FactionId,
    controller: FactionController,
  ): void {
    if (!isOnlineMode.value || !isLocalHost.value) return;
    wsClient.sendRaw({type: 'room:reassign_faction', factionId, controller});
  }

  function setLocalFactionHuman(factionId: FactionId, isHuman: boolean): void {
    if (isOnlineMode.value) return;
    const info = gameState.value.factions[factionId];
    if (!info || info.isEliminated) return;
    if (!isHuman) {
      const remainingHumans = gameState.value.turnOrder.filter(
        (fId) =>
          fId !== factionId &&
          !gameState.value.factions[fId]?.isEliminated &&
          gameState.value.factions[fId]?.isHuman,
      );
      if (remainingHumans.length === 0) {
        showToast('Должен остаться хотя бы 1 живой игрок.');
        return;
      }
    }
    info.isHuman = isHuman;
    const humanCount = gameState.value.turnOrder.filter(
      (fId) => gameState.value.factions[fId]?.isHuman,
    ).length;
    gameState.value.config.humanCount = Math.max(1, humanCount);
    gameState.value.config.mode =
      humanCount > 1 ? GameMode.HOTSEAT : GameMode.SKIRMISH;
    boardVersion.value++;

    const active = getActiveFaction(gameState.value);
    if (active === factionId && !isHuman && gameState.value.winner === null) {
      undoStack.value = [];
      clearSelection();
      void processAiTurnsIfNeeded();
    } else if (active === factionId && isHuman) {
      aiRunToken++;
      isAiThinking.value = false;
      selectPrimaryProvinceForViewer();
    }
  }

  // ==================== SAVE / LOAD SLOTS (1..10) & HOST AUTO-SAVE ====================

  function refreshSaveSlots(): void {
    saveSlots.value = listSaveSlots();
  }

  function setAutoSaveSlot(slot: number | null): void {
    autoSaveSlot.value = slot;
    autoSaveElapsedSec = 0;
    if (isOnlineMode.value) {
      const saved = wsClient.loadSavedSession();
      if (saved) {
        wsClient.saveSession({...saved, autoSaveSlot: slot});
      }
    }
  }

  function performAutoSave(silent = false): boolean {
    const slot = autoSaveSlot.value;
    if (slot === null) return false;
    if (showMainMenu.value || gameState.value.winner !== null) return false;
    if (isOnlineMode.value && (!isLocalHost.value || roomStatus.value !== 'PLAYING')) {
      return false;
    }
    try {
      const prefix =
        isOnlineMode.value && roomName.value
          ? roomName.value
          : (FACTION_PALETTES[viewerFactionId.value]?.name ?? 'Партия');
      saveGameToSlot(slot, {
        label: `${prefix} · Ход ${gameState.value.turn}`,
        state: gameState.value,
        elapsedSeconds: elapsedSeconds.value,
        viewerFactionId: viewerFactionId.value,
        wasOnline: isOnlineMode.value,
      });
      refreshSaveSlots();
      lastAutoSaveAt.value = Date.now();
      if (!silent) {
        showToast(`Автосохранение в слот ${slot}/10.`);
      }
      return true;
    } catch {
      return false;
    }
  }

  function saveCurrentGameToSlot(slot: number, label?: string): boolean {
    try {
      const prefix =
        isOnlineMode.value && roomName.value
          ? roomName.value
          : (FACTION_PALETTES[viewerFactionId.value]?.name ?? 'Партия');
      const fallbackLabel = `${prefix} · Ход ${gameState.value.turn}`;
      saveGameToSlot(slot, {
        label: label?.trim() || fallbackLabel,
        state: gameState.value,
        elapsedSeconds: elapsedSeconds.value,
        viewerFactionId: viewerFactionId.value,
        wasOnline: isOnlineMode.value,
      });
      if (!isOnlineMode.value || isLocalHost.value) {
        setAutoSaveSlot(slot);
        lastAutoSaveAt.value = Date.now();
      }
      refreshSaveSlots();
      soundService.playSelect();
      showToast(`Сохранено в слот ${slot}/10.`);
      return true;
    } catch {
      showToast('Не удалось сохранить игру.');
      return false;
    }
  }

  function loadSavedGameFromSlot(slot: number): boolean {
    const rec = loadGameFromSlot(slot);
    if (!rec) {
      showToast('Слот пуст.');
      return false;
    }

    if (isOnlineMode.value) {
      wsClient.sendRaw({type: 'room:leave'});
      wsClient.clearSession();
      wsClient.disconnect();
      resetOnlineStateLocally();
    }

    aiRunToken++;
    isAiThinking.value = false;
    isLoading.value = true;
    loadingLabel.value = 'Загрузка сохранения...';
    showMainMenu.value = false;
    showNewGameDialog.value = false;
    showPauseDialog.value = false;
    showSaveLoadDialog.value = false;
    autoSaveSlot.value = slot;
    lastAutoSaveAt.value = rec.savedAt;
    autoSaveElapsedSec = 0;

    window.requestAnimationFrame(() => {
      gameState.value = rec.state;
      undoStack.value = [];
      selectedUnitKey.value = null;
      activeTool.value = null;
      hoveredHexKey.value = null;
      latestEvents.value = [];
      toastMessage.value = null;
      clearAllSonners();
      turnDiplomaticNotices.value = [];
      notifications.value = [];
      elapsedSeconds.value = rec.elapsedSeconds;
      turnRemainingSeconds.value = getTurnTimeLimitSeconds(rec.state.config);
      selectPrimaryProvinceForViewer();
      mapResetVersion.value++;
      boardVersion.value++;
      soundService.playTurnEnd();
      showToast(`Загружен слот ${slot}/10.`);

      const active = getActiveFaction(gameState.value);
      if (
        gameState.value.winner === null &&
        !gameState.value.factions[active]?.isHuman
      ) {
        void processAiTurnsIfNeeded();
      }
    });
    return true;
  }

  function removeSaveSlot(slot: number): void {
    deleteSaveSlot(slot);
    if (autoSaveSlot.value === slot) {
      setAutoSaveSlot(null);
      lastAutoSaveAt.value = null;
    }
    refreshSaveSlots();
    soundService.playSelect();
  }

  function setOnlineGamePaused(paused: boolean): void {
    if (!isOnlineMode.value || !isLocalHost.value) return;
    if (roomStatus.value !== 'PLAYING' || gameState.value.winner !== null) return;
    wsClient.sendRaw({type: 'room:set_paused', paused});
  }

  function disbandOnlineRoom(): void {
    if (!isOnlineMode.value || !isLocalHost.value) return;
    wsClient.sendRaw({type: 'room:disband'});
    // Fallback local cleanup if the socket closes before room:left arrives
    window.setTimeout(() => {
      if (isOnlineMode.value) {
        wsClient.clearSession();
        wsClient.disconnect();
        resetOnlineStateLocally();
        autoSaveSlot.value = null;
        lastAutoSaveAt.value = null;
        autoSaveElapsedSec = 0;
        clearAllSonners();
        showMainMenu.value = true;
        isLoading.value = false;
        startMenuDemo();
        showToast('Комната распущена и удалена.');
      }
    }, 450);
  }

  function leaveOnlineGame(): void {
    if (isOnlineMode.value) {
      wsClient.sendRaw({type: 'room:leave'});
    }
    wsClient.clearSession();
    wsClient.disconnect();
    resetOnlineStateLocally();
    autoSaveSlot.value = null;
    lastAutoSaveAt.value = null;
    autoSaveElapsedSec = 0;
    clearAllSonners();
    showMainMenu.value = true;
    isLoading.value = false;
    startMenuDemo();
  }

  function exitCurrentMatch(): void {
    if (isOnlineMode.value) {
      leaveOnlineGame();
      return;
    }
    aiRunToken++;
    isAiThinking.value = false;
    selectedUnitKey.value = null;
    activeTool.value = null;
    hoveredHexKey.value = null;
    autoSaveSlot.value = null;
    lastAutoSaveAt.value = null;
    autoSaveElapsedSec = 0;
    clearAllSonners();
    showPauseDialog.value = false;
    showDiplomacyDialog.value = false;
    showCountriesDialog.value = false;
    showIncomeDialog.value = false;
    showNotificationsDialog.value = false;
    showMatchOverviewDialog.value = false;
    showMainMenu.value = true;
    startMenuDemo();
  }

  function sendChatMessage(text: string): void {
    if (!isOnlineMode.value) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    wsClient.sendRaw({type: 'chat:send', text: trimmed});
  }

  // ==================== OFFLINE / LOCAL GAME LIFECYCLE ====================

  function startNewGame(
    customConfig?: Partial<GameConfig>,
    chosenAutoSaveSlot?: number | null,
  ): void {
    if (isOnlineMode.value) {
      wsClient.sendRaw({type: 'room:leave'});
      wsClient.clearSession();
      wsClient.disconnect();
      resetOnlineStateLocally();
    }

    aiRunToken++;
    isAiThinking.value = false;
    isLoading.value = true;
    loadingLabel.value = 'Генерация ландшафта...';
    showMainMenu.value = false;
    showNewGameDialog.value = false;
    showPauseDialog.value = false;
    autoSaveSlot.value = chosenAutoSaveSlot ?? null;
    lastAutoSaveAt.value = null;
    autoSaveElapsedSec = 0;

    const baseConfig =
      gameState.value.config.humanCount > 0
        ? gameState.value.config
        : DEFAULT_CONFIG;
    const merged: GameConfig = {
      ...baseConfig,
      ...customConfig,
      riversAndLakes: true,
      seed:
        customConfig?.seed ??
        Math.floor(Date.now() % 1_000_000) + Math.floor(Math.random() * 9999),
    };
    const requestedFactions = Math.max(2, Math.min(6, merged.factionCount));
    const requestedHumans = Math.max(
      1,
      Math.min(requestedFactions, customConfig?.humanCount ?? merged.humanCount),
    );
    merged.factionCount = requestedFactions;
    merged.humanCount = requestedHumans;
    merged.mode = requestedHumans > 1 ? GameMode.HOTSEAT : GameMode.SKIRMISH;

    window.requestAnimationFrame(() => {
      gameState.value = createInitialGameState(merged);
      undoStack.value = [];
      selectedUnitKey.value = null;
      activeTool.value = null;
      hoveredHexKey.value = null;
      latestEvents.value = [];
      toastMessage.value = null;
      clearAllSonners();
      turnDiplomaticNotices.value = [];
      notifications.value = [];
      elapsedSeconds.value = 0;
      turnRemainingSeconds.value = getTurnTimeLimitSeconds(merged);
      selectPrimaryProvinceForViewer();
      loadingLabel.value = 'Построение 3D-сцены...';
      mapResetVersion.value++;
      boardVersion.value++;
      if (autoSaveSlot.value !== null) {
        performAutoSave(true);
      }
      soundService.playTurnEnd();
    });
  }

  function selectTool(tool: ActiveToolType | null, toggleIfSame = false): void {
    if (!isHumanTurn.value) return;
    if (!selectedProvince.value) {
      selectPrimaryProvinceForViewer();
    }
    if (!selectedProvince.value) return;

    if (toggleIfSame && activeTool.value === tool) {
      activeTool.value = null;
      return;
    }

    selectedUnitKey.value = null;
    activeTool.value = tool;
    soundService.playSelect();
  }

  function startLandPicker(
    side: 'target' | 'proposer',
    ownerFaction: FactionId,
    recipientFaction: FactionId,
    initialKeys: HexKey[],
  ): void {
    const eligible = getTransferableFreeHexes(
      gameState.value,
      ownerFaction,
      recipientFaction,
    );
    const eligibleSet = new Set(eligible);
    const cleanedInitial = initialKeys.filter((k) => eligibleSet.has(k));

    selectedUnitKey.value = null;
    activeTool.value = null;
    showDiplomacyDialog.value = false;
    landPicker.value = {
      side,
      ownerFaction,
      recipientFaction,
      eligibleKeys: eligibleSet,
      selectedKeys: cleanedInitial,
    };
    soundService.playSelect();
  }

  function toggleLandPickerHex(key: HexKey): void {
    const session = landPicker.value;
    if (!session) return;
    if (!session.eligibleKeys.has(key)) {
      showToast('Выберите подсвеченную свободную клетку державы.');
      return;
    }

    const idx = session.selectedKeys.indexOf(key);
    if (idx !== -1) {
      const next = [...session.selectedKeys];
      next.splice(idx, 1);
      landPicker.value = {...session, selectedKeys: next};
      soundService.playSelect();
      return;
    }

    const cell = gameState.value.cells[key];
    if (cell?.provinceId) {
      const prov = gameState.value.provinces[cell.provinceId];
      if (prov) {
        const pickedInSameProv = session.selectedKeys.filter(
          (k) => gameState.value.cells[k]?.provinceId === cell.provinceId,
        ).length;
        if (prov.hexKeys.length - (pickedInSameProv + 1) < 2) {
          showToast('В провинции должно оставаться минимум 2 клетки.');
          return;
        }
      }
    }

    landPicker.value = {
      ...session,
      selectedKeys: [...session.selectedKeys, key],
    };
    soundService.playSelect();
  }

  function clearLandPickerSelection(): void {
    if (!landPicker.value) return;
    landPicker.value = {...landPicker.value, selectedKeys: []};
    soundService.playSelect();
  }

  function finishLandPicker(): void {
    const session = landPicker.value;
    if (!session) return;
    landPickerCompleted.value = {
      side: session.side,
      hexKeys: [...session.selectedKeys],
      seq: landPickerSeq++,
    };
    landPicker.value = null;
    returningFromLandPicker.value = true;
    showDiplomacyDialog.value = true;
    soundService.playSelect();
  }

  function cancelLandPicker(): void {
    if (!landPicker.value) return;
    landPicker.value = null;
    returningFromLandPicker.value = true;
    showDiplomacyDialog.value = true;
    soundService.playSelect();
  }

  function clearSelection(): void {
    selectedUnitKey.value = null;
    activeTool.value = null;
  }

  function handleHexClick(key: HexKey): void {
    // 0. Interactive manual land exchange picker mode (works even off-turn in online mode!)
    if (landPicker.value) {
      toggleLandPickerHex(key);
      return;
    }

    const cell = gameState.value.cells[key];

    // Off-turn in online mode: still allow inspecting our own provinces & pulsing structure coverage
    if (!isHumanTurn.value) {
      if (
        isOnlineMode.value &&
        cell &&
        cell.faction === viewerFactionId.value &&
        cell.provinceId
      ) {
        selectedProvinceId.value = cell.provinceId;
        soundService.playSelect();
      }
      if (cell) {
        triggerCoveragePulseIfVisible(key);
      }
      return;
    }

    if (!cell) {
      clearSelection();
      return;
    }

    // 1. Remote Illumination Flare (NOT undoable to prevent free fog scouting!)
    if (activeTool.value === 'FLARE' && selectedProvince.value) {
      if (selectedProvince.value.money < FLARE_COST) {
        showToast(
          `Недостаточно золота: нужно ${FLARE_COST}, в казне ${selectedProvince.value.money}.`,
        );
        clearSelection();
        return;
      }
      if (isOnlineMode.value) {
        wsClient.sendRaw({
          type: 'game:action',
          action: {
            kind: 'LAUNCH_FLARE',
            provinceId: selectedProvince.value.id,
            targetKey: key,
          },
        });
        onlineCanUndo.value = false;
        activeTool.value = null;
        emitAreaPulse(key, FLARE_RADIUS, 'flare');
        return;
      }
      const events = executeLaunchFlare(
        gameState.value,
        selectedProvince.value.id,
        key,
      );
      if (events.length > 0) {
        undoStack.value = [];
        activeTool.value = null;
        commitEvents(events);
        emitAreaPulse(key, FLARE_RADIUS, 'flare');
      }
      return;
    }

    // 1b. Green Regenerator Beacon
    if (activeTool.value === 'REGENERATOR' && selectedProvince.value) {
      if (selectedProvince.value.money < REGENERATOR_COST) {
        showToast(
          `Недостаточно золота: нужно ${REGENERATOR_COST}, в казне ${selectedProvince.value.money}.`,
        );
        clearSelection();
        return;
      }
      if (buildableHexSet.value.has(key)) {
        if (isOnlineMode.value) {
          wsClient.sendRaw({
            type: 'game:action',
            action: {
              kind: 'PLACE_REGENERATOR',
              provinceId: selectedProvince.value.id,
              targetKey: key,
            },
          });
          activeTool.value = null;
          emitAreaPulse(key, REGENERATOR_RADIUS, 'regenerator');
          return;
        }
        pushUndoSnapshot();
        const events = executePlaceRegenerator(
          gameState.value,
          selectedProvince.value.id,
          key,
        );
        if (events.length > 0) {
          activeTool.value = null;
          commitEvents(events);
          emitAreaPulse(key, REGENERATOR_RADIUS, 'regenerator');
        }
        return;
      }
      if (
        cell.faction === viewerFactionId.value &&
        cell.provinceId &&
        cell.provinceId !== selectedProvince.value.id
      ) {
        selectedProvinceId.value = cell.provinceId;
        soundService.playSelect();
        return;
      }
      clearSelection();
      triggerCoveragePulseIfVisible(key);
      return;
    }

    // 2. Demolish Building
    if (activeTool.value === 'DEMOLISH' && selectedProvince.value) {
      if (demolishHexSet.value.has(key)) {
        if (isOnlineMode.value) {
          wsClient.sendRaw({
            type: 'game:action',
            action: {
              kind: 'DEMOLISH',
              provinceId: selectedProvince.value.id,
              targetKey: key,
            },
          });
          activeTool.value = null;
          return;
        }
        pushUndoSnapshot();
        const events = executeDemolishBuilding(
          gameState.value,
          selectedProvince.value.id,
          key,
        );
        if (events.length > 0) {
          activeTool.value = null;
          commitEvents(events);
        }
        return;
      }
      if (
        cell.faction === viewerFactionId.value &&
        cell.provinceId &&
        cell.provinceId !== selectedProvince.value.id
      ) {
        selectedProvinceId.value = cell.provinceId;
        soundService.playSelect();
        return;
      }
      clearSelection();
      triggerCoveragePulseIfVisible(key);
      return;
    }

    // 3. Placing a purchased unit or building
    if (
      activeTool.value &&
      activeTool.value !== 'DEMOLISH' &&
      activeTool.value !== 'FLARE' &&
      activeTool.value !== 'REGENERATOR' &&
      selectedProvince.value
    ) {
      const chosenTool = activeTool.value as PurchasableEntity;
      if (buildableHexSet.value.has(key)) {
        if (isOnlineMode.value) {
          wsClient.sendRaw({
            type: 'game:action',
            action: {
              kind: 'BUY_PLACE',
              provinceId: selectedProvince.value.id,
              entity: chosenTool,
              targetKey: key,
            },
          });
          activeTool.value = null;
          selectedUnitKey.value = null;
          return;
        }
        pushUndoSnapshot();
        const events = executeBuyAndPlace(
          gameState.value,
          selectedProvince.value.id,
          chosenTool,
          key,
        );
        if (events.length > 0) {
          const placedCell = gameState.value.cells[key];
          if (placedCell?.provinceId) {
            selectedProvinceId.value = placedCell.provinceId;
          }
          if (
            placedCell &&
            isUnit(placedCell.entity) &&
            !placedCell.unitMoved
          ) {
            selectedUnitKey.value = key;
          } else {
            selectedUnitKey.value = null;
          }
          activeTool.value = null;
          commitEvents(events);
          triggerCoveragePulseIfVisible(key);
          return;
        }
      }

      if (
        cell.faction === viewerFactionId.value &&
        cell.provinceId &&
        cell.provinceId !== selectedProvince.value.id
      ) {
        selectedProvinceId.value = cell.provinceId;
        soundService.playSelect();
        return;
      }

      const cost = getProvincePurchaseCost(
        gameState.value,
        selectedProvince.value.id,
        chosenTool,
      );
      if (selectedProvince.value.money < cost) {
        showToast(
          `Недостаточно золота: нужно ${cost}, в казне ${selectedProvince.value.money}.`,
        );
      } else if (
        gameState.value.config.diplomacyEnabled &&
        cell.faction !== FactionId.NEUTRAL &&
        cell.faction !== viewerFactionId.value &&
        getRelation(gameState.value, viewerFactionId.value, cell.faction) !==
          DiplomaticRelation.WAR
      ) {
        const enemyName =
          gameState.value.factions[cell.faction]?.name ??
          FACTION_PALETTES[cell.faction].name;
        showToast(
          `С державой «${enemyName}» нет войны — объявите её в Дипломатии.`,
        );
      }
      clearSelection();
      triggerCoveragePulseIfVisible(key);
      return;
    }

    // 5. Firing selected Catapult at enemy target
    if (selectedUnitKey.value && catapultTargetSet.value.has(key)) {
      if (isOnlineMode.value) {
        wsClient.sendRaw({
          type: 'game:action',
          action: {
            kind: 'CATAPULT_FIRE',
            catapultKey: selectedUnitKey.value,
            targetKey: key,
          },
        });
        selectedUnitKey.value = null;
        activeTool.value = null;
        return;
      }
      pushUndoSnapshot();
      const events = executeCatapultFire(
        gameState.value,
        selectedUnitKey.value,
        key,
      );
      if (events.length > 0) {
        selectedUnitKey.value = null;
        activeTool.value = null;
        commitEvents(events);
        return;
      }
    }

    // 6. Moving a currently selected friendly unit
    if (selectedUnitKey.value && reachableHexMap.value.has(key)) {
      if (isOnlineMode.value) {
        wsClient.sendRaw({
          type: 'game:action',
          action: {
            kind: 'MOVE_UNIT',
            fromKey: selectedUnitKey.value,
            toKey: key,
          },
        });
        selectedUnitKey.value = null;
        activeTool.value = null;
        return;
      }
      pushUndoSnapshot();
      const events = executeUnitMove(
        gameState.value,
        selectedUnitKey.value,
        key,
      );
      if (events.length > 0) {
        const destCell = gameState.value.cells[key];
        if (destCell?.provinceId) {
          selectedProvinceId.value = destCell.provinceId;
        }
        selectedUnitKey.value = null;
        activeTool.value = null;
        commitEvents(events);
        return;
      }
    }

    // 7. Clicking an enemy hex while Diplomacy blocks war
    if (
      selectedUnitKey.value &&
      gameState.value.config.diplomacyEnabled &&
      cell.faction !== FactionId.NEUTRAL &&
      cell.faction !== viewerFactionId.value &&
      getRelation(gameState.value, viewerFactionId.value, cell.faction) !==
        DiplomaticRelation.WAR
    ) {
      const enemyName =
        gameState.value.factions[cell.faction]?.name ??
        FACTION_PALETTES[cell.faction].name;
      showToast(
        `С державой «${enemyName}» нет войны — объявите её в Дипломатии.`,
      );
      clearSelection();
      triggerCoveragePulseIfVisible(key);
      return;
    }

    // 8. Selecting a friendly province or unit
    if (cell.faction === viewerFactionId.value && cell.provinceId) {
      selectedProvinceId.value = cell.provinceId;
      activeTool.value = null;
      if (isUnit(cell.entity) && !cell.unitMoved) {
        selectedUnitKey.value = selectedUnitKey.value === key ? null : key;
      } else {
        selectedUnitKey.value = null;
      }
      soundService.playSelect();
      triggerCoveragePulseIfVisible(key);
      return;
    }

    clearSelection();
    triggerCoveragePulseIfVisible(key);
  }

  // ==================== DIPLOMACY ACTIONS (SEND = OWN TURN, RESPOND = ANYTIME) ====================

  function guardCanSendDiplomacy(): boolean {
    if (!canSendDiplomacy.value) {
      showToast('Отправлять запросы можно только в свой ход.');
      return false;
    }
    return true;
  }

  function declareWarOn(target: FactionId): void {
    if (!guardCanSendDiplomacy()) return;
    if (isOnlineMode.value) {
      wsClient.sendRaw({
        type: 'diplomacy:action',
        action: {kind: 'DECLARE_WAR', target},
      });
      return;
    }
    const events = domainDeclareWar(
      gameState.value,
      viewerFactionId.value,
      target,
    );
    if (events.length > 0) commitEvents(events);
  }

  function proposePeaceTo(target: FactionId, goldOffer = 0): void {
    if (!guardCanSendDiplomacy()) return;
    if (isOnlineMode.value) {
      wsClient.sendRaw({
        type: 'diplomacy:action',
        action: {
          kind: 'PROPOSE_PEACE',
          target,
          goldOffer,
          provinceId: selectedProvince.value?.id,
        },
      });
      return;
    }
    const events = domainProposePeace(
      gameState.value,
      viewerFactionId.value,
      target,
      goldOffer,
      selectedProvince.value?.id,
    );
    if (events.length > 0) commitEvents(events);
  }

  function issueBlackMarkOn(target: FactionId): void {
    if (!guardCanSendDiplomacy()) return;
    if (isOnlineMode.value) {
      wsClient.sendRaw({
        type: 'diplomacy:action',
        action: {
          kind: 'ISSUE_BLACK_MARK',
          target,
          provinceId: selectedProvince.value?.id,
        },
      });
      return;
    }
    const events = domainIssueBlackMark(
      gameState.value,
      viewerFactionId.value,
      target,
      selectedProvince.value?.id,
    );
    if (events.length > 0) {
      commitEvents(events);
    } else {
      showToast('Недостаточно золота для Чёрной метки (нужно 10 монет).');
    }
  }

  function sendGoldTo(target: FactionId, amount: number, note?: string): void {
    if (!guardCanSendDiplomacy() || !selectedProvince.value) return;
    if (isOnlineMode.value) {
      wsClient.sendRaw({
        type: 'diplomacy:action',
        action: {
          kind: 'SEND_GOLD',
          provinceId: selectedProvince.value.id,
          target,
          amount,
          note,
        },
      });
      return;
    }
    const events = domainSendGold(
      gameState.value,
      selectedProvince.value.id,
      target,
      amount,
      note,
    );
    if (events.length > 0) {
      commitEvents(events);
    } else {
      showToast('Недостаточно монет в выбранной провинции.');
    }
  }

  function sendNoteTo(target: FactionId, text: string): void {
    if (!guardCanSendDiplomacy()) return;
    if (isOnlineMode.value) {
      wsClient.sendRaw({
        type: 'diplomacy:action',
        action: {kind: 'SEND_NOTE', target, text},
      });
      return;
    }
    const events = domainSendNote(
      gameState.value,
      viewerFactionId.value,
      target,
      text,
    );
    if (events.length > 0) commitEvents(events);
  }

  function respondToMessage(messageId: number, accept: boolean): void {
    if (!canRespondDiplomacy.value) return;
    // Mark any linked notification read and close any Sonner for this messageId
    for (const n of notifications.value) {
      if (n.messageId === messageId && !n.read) {
        markNotificationRead(n.id);
      }
    }
    for (const s of [...sonnerItems.value]) {
      if (s.messageId === messageId) {
        dismissSonner(s.id);
      }
    }
    if (isOnlineMode.value) {
      wsClient.sendRaw({
        type: 'diplomacy:action',
        action: {kind: 'RESPOND_MESSAGE', messageId, accept},
      });
      return;
    }
    const events = domainRespondToMessage(gameState.value, messageId, accept);
    if (events.length > 0) commitEvents(events);
  }

  function proposeExchange(target: FactionId, offer: ExchangeOffer): void {
    if (!guardCanSendDiplomacy()) return;
    if (isOnlineMode.value) {
      wsClient.sendRaw({
        type: 'diplomacy:action',
        action: {
          kind: 'PROPOSE_EXCHANGE',
          target,
          offer,
          provinceId: selectedProvince.value?.id,
        },
      });
      return;
    }
    const events = domainProposeExchange(
      gameState.value,
      viewerFactionId.value,
      target,
      offer,
      selectedProvince.value?.id,
    );
    if (events.length > 0) commitEvents(events);
  }

  function cancelSubsidy(subsidyId: number): void {
    if (gameState.value.winner !== null) return;
    if (isOnlineMode.value) {
      if (roomStatus.value !== 'PLAYING' || isRoomPaused.value) return;
      wsClient.sendRaw({
        type: 'diplomacy:action',
        action: {kind: 'CANCEL_SUBSIDY', subsidyId},
      });
      return;
    }
    const events = domainCancelSubsidy(
      gameState.value,
      viewerFactionId.value,
      subsidyId,
    );
    if (events.length > 0) {
      commitEvents(events);
    }
  }

  function surrenderCurrentFaction(): void {
    if (gameState.value.winner !== null || isViewerEliminated.value) return;
    if (isOnlineMode.value) {
      if (roomStatus.value !== 'PLAYING' || isRoomPaused.value) return;
      wsClient.sendRaw({
        type: 'diplomacy:action',
        action: {kind: 'SURRENDER'},
      });
      showDiplomacyDialog.value = false;
      selectedUnitKey.value = null;
      activeTool.value = null;
      return;
    }

    const actor = viewerFactionId.value;
    const events = domainSurrenderFaction(gameState.value, actor);
    if (events.length === 0) return;

    undoStack.value = [];
    selectedUnitKey.value = null;
    activeTool.value = null;
    showDiplomacyDialog.value = false;
    selectPrimaryProvinceForViewer();
    commitEvents(events);

    if (gameState.value.winner !== null) {
      soundService.playVictory();
      return;
    }
    const nextFaction = getActiveFaction(gameState.value);
    if (!gameState.value.factions[nextFaction]?.isHuman) {
      void processAiTurnsIfNeeded();
    } else {
      flushTurnNoticesForActiveHuman();
    }
  }

  function getTransferableLandCount(
    fromFaction: FactionId,
    toFaction: FactionId,
  ): number {
    void boardVersion.value;
    return getTransferableFreeHexes(gameState.value, fromFaction, toFaction)
      .length;
  }

  function hasBlackMarkWith(target: FactionId): boolean {
    void boardVersion.value;
    return hasBlackMarkBetween(gameState.value, viewerFactionId.value, target);
  }

  function getFriendshipTurns(target: FactionId): number {
    void boardVersion.value;
    return getFriendshipTurnsRemaining(
      gameState.value,
      viewerFactionId.value,
      target,
    );
  }

  function canBeFriendsWith(target: FactionId): {
    allowed: boolean;
    reason?: string;
  } {
    void boardVersion.value;
    return canFormFriendship(gameState.value, viewerFactionId.value, target);
  }

  function selectNextReadyUnit(): HexKey | null {
    if (!isHumanTurn.value) return null;
    const fId = viewerFactionId.value;
    const ready = Object.values(gameState.value.cells)
      .filter((c) => c.faction === fId && isUnit(c.entity) && !c.unitMoved)
      .map((c) => c.key);
    if (ready.length === 0) return null;

    const currIdx = selectedUnitKey.value
      ? ready.indexOf(selectedUnitKey.value)
      : -1;
    const nextKey = ready[(currIdx + 1) % ready.length];
    const cell = gameState.value.cells[nextKey];
    selectedProvinceId.value = cell.provinceId;
    selectedUnitKey.value = nextKey;
    activeTool.value = null;
    soundService.playSelect();
    return nextKey;
  }

  function undoLastAction(): void {
    if (!canUndo.value) return;
    if (isOnlineMode.value) {
      wsClient.sendRaw({type: 'game:action', action: {kind: 'UNDO'}});
      selectedUnitKey.value = null;
      activeTool.value = null;
      soundService.playSelect();
      return;
    }
    const stack = [...undoStack.value];
    const previous = stack.pop();
    if (!previous) return;
    undoStack.value = stack;
    gameState.value = previous;
    selectedUnitKey.value = null;
    activeTool.value = null;
    if (
      selectedProvinceId.value &&
      !gameState.value.provinces[selectedProvinceId.value]
    ) {
      selectPrimaryProvinceForViewer();
    }
    latestEvents.value = [];
    boardVersion.value++;
    soundService.playSelect();
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function startMenuDemo(fixedSeed?: number): void {
    aiRunToken++;
    isAiThinking.value = false;
    selectedProvinceId.value = null;
    selectedUnitKey.value = null;
    activeTool.value = null;
    hoveredHexKey.value = null;
    undoStack.value = [];
    latestEvents.value = [];
    const cfg = createMenuDemoConfig(fixedSeed);
    gameState.value = createInitialGameState(cfg);
    mapResetVersion.value++;
    boardVersion.value++;
    void processMenuDemoAiTurns();
  }

  async function processMenuDemoAiTurns(): Promise<void> {
    const token = ++aiRunToken;
    await delay(450);

    while (token === aiRunToken && showMainMenu.value) {
      if (gameState.value.winner !== null) {
        await delay(1800);
        if (token !== aiRunToken || !showMainMenu.value) return;
        const sameSeed = gameState.value.config.seed;
        latestEvents.value = [];
        gameState.value = createInitialGameState(
          createMenuDemoConfig(sameSeed),
        );
        mapResetVersion.value++;
        boardVersion.value++;
        await delay(450);
        continue;
      }

      const activeFaction = getActiveFaction(gameState.value);
      if (gameState.value.factions[activeFaction]?.isHuman) {
        break;
      }

      let safetySteps = 0;
      while (
        token === aiRunToken &&
        showMainMenu.value &&
        safetySteps < 28
      ) {
        safetySteps++;
        const step = runSingleAiStep(gameState.value);
        if (!step.performed) break;
        latestEvents.value = step.events;
        boardVersion.value++;
        if (gameState.value.winner !== null) break;
        await delay(220);
      }

      if (token !== aiRunToken || !showMainMenu.value) return;
      if (gameState.value.winner !== null) continue;

      const turnEvents = advanceTurn(gameState.value);
      latestEvents.value = turnEvents;
      boardVersion.value++;
      await delay(180);
    }
  }

  async function processAiTurnsIfNeeded(): Promise<void> {
    const token = ++aiRunToken;
    while (
      token === aiRunToken &&
      gameState.value.winner === null &&
      !gameState.value.factions[getActiveFaction(gameState.value)].isHuman
    ) {
      isAiThinking.value = true;
      const aiFaction = getActiveFaction(gameState.value);
      const dipEvents = runAiDiplomacyTurn(gameState.value, aiFaction);
      if (dipEvents.length > 0) {
        latestEvents.value = dipEvents;
        boardVersion.value++;
        triggerEventSounds(dipEvents);
      }

      await delay(220);
      if (token !== aiRunToken) return;

      let safetySteps = 0;
      while (token === aiRunToken && safetySteps < 28) {
        safetySteps++;
        const step = runSingleAiStep(gameState.value);
        if (!step.performed) break;
        latestEvents.value = step.events;
        boardVersion.value++;
        triggerEventSounds(step.events);
        if (gameState.value.winner !== null) break;
        await delay(175);
      }

      if (token !== aiRunToken) return;
      if (gameState.value.winner !== null) break;

      const turnEvents = advanceTurn(gameState.value);
      latestEvents.value = turnEvents;
      boardVersion.value++;
    }

    if (token === aiRunToken) {
      isAiThinking.value = false;
      undoStack.value = [];
      selectedUnitKey.value = null;
      activeTool.value = null;
      turnRemainingSeconds.value = turnTimeLimitSeconds.value;
      selectPrimaryProvinceForViewer();
      if (gameState.value.winner !== null) {
        soundService.playVictory();
      } else {
        flushTurnNoticesForActiveHuman();
      }
    }
  }

  function endTurn(): void {
    if (!isHumanTurn.value) return;
    selectedUnitKey.value = null;
    activeTool.value = null;
    turnDiplomaticNotices.value = [];

    if (isOnlineMode.value) {
      onlineCanUndo.value = false;
      wsClient.sendRaw({type: 'game:action', action: {kind: 'END_TURN'}});
      soundService.playTurnEnd();
      return;
    }

    undoStack.value = [];
    turnRemainingSeconds.value = turnTimeLimitSeconds.value;
    const events = advanceTurn(gameState.value);
    latestEvents.value = events;
    boardVersion.value++;
    soundService.playTurnEnd();

    if (gameState.value.winner !== null) {
      soundService.playVictory();
      return;
    }

    const nextFaction = getActiveFaction(gameState.value);
    if (gameState.value.factions[nextFaction].isHuman) {
      selectPrimaryProvinceForViewer();
      flushTurnNoticesForActiveHuman();
    } else {
      void processAiTurnsIfNeeded();
    }
  }

  function setCameraMode(mode: CameraMode): void {
    cameraMode.value = mode;
    soundService.playSelect();
  }

  function cycleCameraMode(): void {
    const order: readonly CameraMode[] = [
      CameraMode.AUTO,
      CameraMode.TOP_2D,
      CameraMode.ORTHO_3D,
    ];
    const idx = order.indexOf(cameraMode.value);
    setCameraMode(order[(idx + 1) % order.length]);
  }

  function setCameraZoom(zoom: number): void {
    cameraZoom.value = Math.max(0.55, Math.min(2.6, zoom));
  }

  function syncCameraTelemetry(zoom: number, tiltFactor: number): void {
    cameraZoom.value = zoom;
    cameraTiltFactor.value = tiltFactor;
  }

  function toggleSound(): void {
    soundEnabled.value = !soundEnabled.value;
    soundService.setEnabled(soundEnabled.value);
    if (soundEnabled.value) {
      soundService.playSelect();
    }
  }

  function setHoveredHex(key: HexKey | null): void {
    hoveredHexKey.value = key;
  }

  return {
    defaultGameConfig: DEFAULT_CONFIG,
    gameState,
    selectedProvinceId,
    selectedUnitKey,
    activeTool,
    hoveredHexKey,
    toastMessage,
    sonnerItems,
    isAiThinking,
    latestEvents,
    boardVersion,
    mapResetVersion,
    cameraMode,
    cameraZoom,
    cameraTiltFactor,
    soundEnabled,
    hudCollapsed,
    showMainMenu,
    showNewGameDialog,
    newGameDialogInitialTab,
    showPauseDialog,
    showRulesDialog,
    showDiplomacyDialog,
    showCountriesDialog,
    showIncomeDialog,
    showNotificationsDialog,
    showChatDialog,
    showMatchOverviewDialog,
    showSaveLoadDialog,
    showShortcutsDialog,
    showHistoryDialog,
    roomHistory,
    roomHistoryCreatedCount,
    roomHistoryMaxCreated,
    roomHistoryLoading,
    roomHistoryError,
    saveSlots,
    elapsedSeconds,
    turnRemainingSeconds,
    turnTimeLimitSeconds,
    isLoading,
    loadingLabel,
    turnDiplomaticNotices,
    areaPulseSignal,
    landPicker,
    landPickerCompleted,
    returningFromLandPicker,
    // Online state
    isOnlineMode,
    roomCode,
    roomName,
    roomStatus,
    roomHasPassword,
    roomConfig,
    localPlayerId,
    localPlayerFactionId,
    isLocalHost,
    localControlledFactions,
    onlinePlayers,
    factionControllers,
    waitingForFactionId,
    isRoomPaused,
    roomPausedBy,
    onlinePresenceByFaction,
    chatMessages,
    notifications,
    unreadNotificationCount,
    wsConnected,
    onlineBusy,
    onlineError,
    autoSaveSlot,
    lastAutoSaveAt,
    // Derived state
    activeFactionId,
    viewerFactionId,
    isViewerEliminated,
    visibleHexSet,
    activeFactionInfo,
    activeFactionPalette,
    viewerFactionInfo,
    viewerFactionPalette,
    isHumanTurn,
    canSendDiplomacy,
    canRespondDiplomacy,
    canUseDiplomacy,
    selectedProvince,
    selectedProvinceBreakdown,
    viewerActiveSubsidies,
    activeFactionProvinces,
    reachableHexMap,
    catapultTargetSet,
    buildableHexSet,
    hoveredTradingPostPreviewSet,
    demolishHexSet,
    landPickEligibleSet,
    landPickSelectedSet,
    hoveredCell,
    hoveredProtection,
    canUndo,
    readyUnitsCount,
    pendingMessagesCount,
    factionLeaderboard,
    // Actions
    getToolCost,
    getEntityCountInSelectedProvince,
    setSceneReady,
    dismissTurnNotices,
    dismissSonner,
    clearAllSonners,
    handleSonnerQuickAction,
    markNotificationRead,
    markNotificationsReadByCategories,
    markAllNotificationsRead,
    clearNotifications,
    createOnlineRoom,
    hostCurrentGameOnline,
    joinOnlineRoom,
    refreshRoomHistory,
    rejoinRoomFromHistory,
    kickOnlinePlayer,
    reassignOnlineFaction,
    setLocalFactionHuman,
    refreshSaveSlots,
    setAutoSaveSlot,
    saveCurrentGameToSlot,
    loadSavedGameFromSlot,
    removeSaveSlot,
    setOnlineGamePaused,
    disbandOnlineRoom,
    leaveOnlineGame,
    exitCurrentMatch,
    sendChatMessage,
    openNewGameMenu,
    startNewGame,
    selectTool,
    startLandPicker,
    toggleLandPickerHex,
    clearLandPickerSelection,
    finishLandPicker,
    cancelLandPicker,
    clearSelection,
    handleHexClick,
    declareWarOn,
    proposePeaceTo,
    proposeExchange,
    cancelSubsidy,
    surrenderCurrentFaction,
    getTransferableLandCount,
    hasBlackMarkWith,
    getFriendshipTurns,
    canBeFriendsWith,
    issueBlackMarkOn,
    sendGoldTo,
    sendNoteTo,
    respondToMessage,
    selectNextReadyUnit,
    undoLastAction,
    endTurn,
    setCameraMode,
    cycleCameraMode,
    setCameraZoom,
    syncCameraTelemetry,
    toggleSound,
    setHoveredHex,
  };
});
