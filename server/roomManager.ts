import type {WebSocket as WsSocket} from 'ws';
import {
  advanceTurn,
  cloneGameState,
  executeBuyAndPlace,
  executeCatapultFire,
  executeDemolishBuilding,
  executeLaunchFlare,
  executePlaceRegenerator,
  executeUnitMove,
  getActiveFaction,
} from '@/domain/game/gameEngine';
import {
  cancelDiplomaticSubsidy,
  declareWar,
  issueBlackMark,
  proposeExchangeDeal,
  proposePeace,
  respondToDiplomaticMessage,
  runAiDiplomacyTurn,
  sendDiplomaticNote,
  sendGoldExchange,
  surrenderFaction,
} from '@/domain/game/diplomacyService';
import {
  createInitialGameState,
  recalculateFactionSummaries,
} from '@/domain/game/mapGenerator';
import {
  FACTION_PALETTES,
  PLAYABLE_FACTIONS,
  getTurnTimeLimitSeconds,
} from '@/domain/game/rules';
import {
  FactionId,
  GameMode,
  type DiplomaticNotice,
  type GameConfig,
  type GameEvent,
  type GameState,
} from '@/domain/game/types';
import {runSingleAiStep} from '@/domain/ai/aiService';
import {generateRoomName} from '@/domain/multiplayer/roomNameGenerator';
import type {
  ChatMessage,
  ClientWsMessage,
  DiplomacyActionPayload,
  FactionController,
  GameActionPayload,
  GameNotification,
  NotificationCategory,
  OnlinePlayerSlot,
  RoomHistoryEntry,
  RoomHistoryResponse,
  RoomPreview,
  RoomSnapshot,
  RoomStatus,
  ServerStatusSummary,
  ServerWsMessage,
} from '@/domain/multiplayer/types';

interface ServerPlayer {
  playerId: string;
  cookieId: string | null;
  nickname: string;
  factionId: FactionId;
  isHost: boolean;
  online: boolean;
  left: boolean;
  socket: WsSocket | null;
}

interface ServerRoom {
  code: string;
  name: string;
  password: string;
  status: RoomStatus;
  config: GameConfig;
  creatorCookieId: string | null;
  createdAtMs: number;
  lastActivityAtMs: number;
  players: ServerPlayer[];
  factionControllers: Record<number, FactionController>;
  chat: ChatMessage[];
  state: GameState | null;
  undoStack: GameState[];
  startedAtMs: number | null;
  accumulatedSeconds: number;
  isPaused: boolean;
  pausedByNickname: string | null;
  pausedTurnRemainingSeconds: number | null;
  turnDeadlineMs: number | null;
  turnTimer: ReturnType<typeof setTimeout> | null;
  isAiRunning: boolean;
  aiRunToken: number;
}

interface SocketBinding {
  roomCode: string;
  playerId: string;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ROOMS_PER_CREATOR = 3;
const MAX_TOTAL_ROOMS = 100;
const EMPTY_ROOM_IDLE_TTL_MS = 60 * 60 * 1000;
const CLEANUP_SWEEP_INTERVAL_MS = 60 * 1000;
const VISITOR_ONLINE_TTL_MS = 60 * 1000;

function generateRoomCode(existing: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!existing.has(code)) return code;
  }
  return `R${Date.now().toString(36).slice(-5).toUpperCase()}`;
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function sanitizeNickname(raw: string, factionId: FactionId): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ').slice(0, 20);
  return cleaned || FACTION_PALETTES[factionId]?.name || 'Игрок';
}

function sanitizePassword(raw?: string): string {
  return typeof raw === 'string' ? raw.trim().slice(0, 32) : '';
}

function toPublicPlayer(p: ServerPlayer): OnlinePlayerSlot {
  return {
    playerId: p.playerId,
    nickname: p.nickname,
    factionId: p.factionId,
    isHost: p.isHost,
    online: p.online,
    left: p.left,
  };
}

function getRoomElapsedSeconds(room: ServerRoom): number {
  if (
    room.status === 'WAITING' ||
    room.status === 'FINISHED' ||
    room.isPaused ||
    room.startedAtMs === null
  ) {
    return room.accumulatedSeconds;
  }
  return (
    room.accumulatedSeconds +
    Math.max(0, Math.floor((Date.now() - room.startedAtMs) / 1000))
  );
}

function getTurnRemainingSeconds(room: ServerRoom): number {
  const limit = getTurnTimeLimitSeconds(room.config);
  if (limit <= 0) {
    return 0;
  }
  if (room.isPaused && room.pausedTurnRemainingSeconds !== null) {
    return Math.max(0, Math.min(limit, room.pausedTurnRemainingSeconds));
  }
  if (room.status !== 'PLAYING' || room.turnDeadlineMs === null) {
    return limit;
  }
  return Math.max(
    0,
    Math.min(limit, Math.ceil((room.turnDeadlineMs - Date.now()) / 1000)),
  );
}

function getWaitingForFactionId(room: ServerRoom): FactionId | null {
  if (room.status !== 'PLAYING' || !room.state || room.state.winner !== null) {
    return null;
  }
  const active = getActiveFaction(room.state);
  if (room.factionControllers[active] !== 'ONLINE') {
    return null;
  }
  const occupied = room.players.some(
    (p) => !p.left && p.factionId === active,
  );
  return occupied ? null : active;
}

function canPlayerControlFaction(
  room: ServerRoom,
  player: ServerPlayer,
  factionId: FactionId,
): boolean {
  if (player.factionId === factionId) return true;
  if (player.isHost && room.factionControllers[factionId] === 'HOTSEAT') {
    return true;
  }
  return false;
}

function sendJson(socket: WsSocket | null, payload: ServerWsMessage): void {
  if (!socket || socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // Ignore closed socket race
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, ServerRoom>();
  private readonly socketBindings = new WeakMap<WsSocket, SocketBinding>();
  private readonly socketCookieIds = new WeakMap<WsSocket, string>();
  private readonly connectedSockets = new Set<WsSocket>();
  private readonly recentVisitors = new Map<string, number>();
  private readonly sweepInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.sweepInterval = setInterval(() => {
      this.cleanupStaleRooms();
    }, CLEANUP_SWEEP_INTERVAL_MS);
    if (typeof this.sweepInterval.unref === 'function') {
      this.sweepInterval.unref();
    }
  }

  public attachSocketCookie(socket: WsSocket, cookieId: string | null): void {
    this.connectedSockets.add(socket);
    if (cookieId) {
      this.socketCookieIds.set(socket, cookieId);
      this.recordClientHeartbeat(cookieId);
    }
  }

  public detachSocket(socket: WsSocket): void {
    this.connectedSockets.delete(socket);
  }

  public recordClientHeartbeat(clientId: string | null): void {
    if (!clientId) return;
    this.recentVisitors.set(clientId, Date.now());
  }

  public getServerStatus(visitorCookieId?: string | null): ServerStatusSummary {
    this.cleanupStaleRooms();
    const now = Date.now();
    if (visitorCookieId) {
      this.recentVisitors.set(visitorCookieId, now);
    }

    const activeIdentities = new Set<string>();
    for (const [id, lastSeen] of this.recentVisitors.entries()) {
      if (now - lastSeen <= VISITOR_ONLINE_TTL_MS) {
        activeIdentities.add(id);
      } else {
        this.recentVisitors.delete(id);
      }
    }

    for (const socket of this.connectedSockets) {
      if (socket.readyState !== 1) continue;
      const cid = this.socketCookieIds.get(socket);
      if (cid) {
        this.recentVisitors.set(cid, now);
        activeIdentities.add(cid);
      }
    }

    for (const room of this.rooms.values()) {
      for (const player of room.players) {
        if (player.online && !player.left && player.cookieId) {
          this.recentVisitors.set(player.cookieId, now);
          activeIdentities.add(player.cookieId);
        }
      }
    }

    const activeRooms = this.rooms.size;
    return {
      onlineUsers: activeIdentities.size,
      activeRooms,
      freeRooms: Math.max(0, MAX_TOTAL_ROOMS - activeRooms),
      maxRooms: MAX_TOTAL_ROOMS,
    };
  }

  private getSocketCookieId(socket: WsSocket): string | null {
    return this.socketCookieIds.get(socket) ?? null;
  }

  private touchRoom(room: ServerRoom): void {
    room.lastActivityAtMs = Date.now();
  }

  private cleanupStaleRooms(): void {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      const hasOnline = room.players.some((p) => p.online && !p.left);
      if (!hasOnline && now - room.lastActivityAtMs >= EMPTY_ROOM_IDLE_TTL_MS) {
        this.destroyRoom(room);
      }
    }
  }

  private checkRoomCreationLimits(
    socket: WsSocket,
    cookieId: string | null,
  ): boolean {
    this.cleanupStaleRooms();
    if (this.rooms.size >= MAX_TOTAL_ROOMS) {
      sendJson(socket, {
        type: 'error',
        code: 'ROOM_LIMIT_GLOBAL',
        message: `На сервере достигнут лимит в ${MAX_TOTAL_ROOMS} активных комнат. Попробуйте позже.`,
      });
      return false;
    }
    if (cookieId) {
      let createdByPlayer = 0;
      for (const r of this.rooms.values()) {
        if (r.creatorCookieId === cookieId) {
          createdByPlayer++;
        }
      }
      if (createdByPlayer >= MAX_ROOMS_PER_CREATOR) {
        sendJson(socket, {
          type: 'error',
          code: 'ROOM_LIMIT_PLAYER',
          message: `Можно создать не более ${MAX_ROOMS_PER_CREATOR} активных комнат одновременно. Зайдите в одну из своих комнат через «Историю» и распустите её.`,
        });
        return false;
      }
    }
    return true;
  }

  public getPlayerRoomHistory(cookieId: string): RoomHistoryResponse {
    this.cleanupStaleRooms();
    const entries: RoomHistoryEntry[] = [];
    let createdCount = 0;

    for (const room of this.rooms.values()) {
      const isCreator = room.creatorCookieId === cookieId;
      if (isCreator) {
        createdCount++;
      }
      const myPlayer = room.players.find((p) => p.cookieId === cookieId);
      if (!isCreator && !myPlayer) continue;

      const onlineCount = room.players.filter((p) => p.online && !p.left).length;
      const totalPlayers =
        room.status === 'WAITING'
          ? room.config.humanCount
          : room.state
            ? room.state.turnOrder.length
            : room.config.factionCount;

      const factionId = myPlayer?.factionId ?? room.players[0]?.factionId ?? FactionId.EMERALD;
      const nickname =
        myPlayer?.nickname ?? FACTION_PALETTES[factionId]?.name ?? 'Игрок';

      // Verify whether player can still rejoin their seat
      let canRejoin = true;
      if (myPlayer && myPlayer.left && room.status === 'PLAYING' && room.state) {
        const seatTaken = room.players.some(
          (p) => !p.left && p.factionId === myPlayer.factionId,
        );
        const fInfo = room.state.factions[myPlayer.factionId];
        if (seatTaken && fInfo && !fInfo.isEliminated) {
          canRejoin = false;
        }
      }

      entries.push({
        code: room.code,
        name: room.name,
        status: room.status,
        turn: room.state?.turn ?? 0,
        factionId,
        nickname,
        isHost: Boolean(myPlayer?.isHost),
        isCreator,
        isPaused: room.isPaused,
        onlineCount,
        totalPlayers,
        lastActivityAt: room.lastActivityAtMs,
        canRejoin,
      });
    }

    entries.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    return {
      rooms: entries,
      createdCount,
      maxCreatedRooms: MAX_ROOMS_PER_CREATOR,
    };
  }

  public getRoomPreview(rawCode: string): RoomPreview | null {
    this.cleanupStaleRooms();
    const code = rawCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return null;
    const activePlayers = room.players.filter((p) => !p.left);

    if (room.status === 'PLAYING' && room.state) {
      const openOnlineFactions: FactionId[] = [];
      const aiFactions: FactionId[] = [];
      const occupiedFactions = new Set(activePlayers.map((p) => p.factionId));

      for (const fId of room.state.turnOrder) {
        const info = room.state.factions[fId];
        if (!info || info.isEliminated) continue;
        const ctrl = room.factionControllers[fId] ?? (info.isHuman ? 'ONLINE' : 'AI');
        if (ctrl === 'ONLINE' && !occupiedFactions.has(fId)) {
          openOnlineFactions.push(fId);
        } else if (ctrl === 'AI') {
          aiFactions.push(fId);
        }
      }

      const joinable = new Set([...openOnlineFactions, ...aiFactions]);
      const takenFactions = PLAYABLE_FACTIONS.filter((f) => !joinable.has(f));

      return {
        code: room.code,
        name: room.name,
        status: room.status,
        hasPassword: room.password.length > 0,
        config: room.config,
        players: activePlayers.map(toPublicPlayer),
        allowedFactions: [...room.state.turnOrder],
        takenFactions,
        openOnlineFactions,
        aiFactions,
        slotsTotal: activePlayers.length + openOnlineFactions.length,
        slotsFilled: activePlayers.length,
      };
    }

    return {
      code: room.code,
      name: room.name,
      status: room.status,
      hasPassword: room.password.length > 0,
      config: room.config,
      players: activePlayers.map(toPublicPlayer),
      allowedFactions: [...PLAYABLE_FACTIONS],
      takenFactions: activePlayers.map((p) => p.factionId),
      openOnlineFactions: [],
      aiFactions: [],
      slotsTotal: room.config.humanCount,
      slotsFilled: activePlayers.length,
    };
  }

  public verifyRoomPassword(
    rawCode: string,
    rawPassword: string,
  ): {
    ok: boolean;
    statusCode?: number;
    error?: string;
    preview?: RoomPreview;
  } {
    this.cleanupStaleRooms();
    const code = rawCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      return {
        ok: false,
        statusCode: 404,
        error: 'Комната не найдена.',
      };
    }
    if (
      room.password.length > 0 &&
      sanitizePassword(rawPassword) !== room.password
    ) {
      return {
        ok: false,
        statusCode: 401,
        error: 'Неверный пароль комнаты.',
      };
    }
    const preview = this.getRoomPreview(code);
    if (!preview) {
      return {
        ok: false,
        statusCode: 404,
        error: 'Комната не найдена.',
      };
    }
    return {ok: true, preview};
  }

  public handleMessage(socket: WsSocket, raw: string): void {
    let msg: ClientWsMessage;
    try {
      msg = JSON.parse(raw) as ClientWsMessage;
    } catch {
      sendJson(socket, {
        type: 'error',
        code: 'BAD_JSON',
        message: 'Некорректный формат сообщения.',
      });
      return;
    }

    this.recordClientHeartbeat(this.getSocketCookieId(socket));

    switch (msg.type) {
      case 'ping':
        sendJson(socket, {type: 'pong'});
        return;
      case 'room:create':
        this.handleCreateRoom(
          socket,
          msg.config,
          msg.nickname,
          msg.factionId,
          msg.password,
        );
        return;
      case 'room:host_existing':
        this.handleHostExistingGame(
          socket,
          msg.state,
          msg.elapsedSeconds,
          msg.nickname,
          msg.primaryFactionId,
          msg.factionControllers,
          msg.password,
        );
        return;
      case 'room:join':
        this.handleJoinRoom(
          socket,
          msg.code,
          msg.nickname,
          msg.factionId,
          msg.password,
        );
        return;
      case 'room:reconnect':
        this.handleReconnect(socket, msg.code, msg.playerId);
        return;
      case 'room:rejoin':
        this.handleRejoinByCookie(socket, msg.code);
        return;
      case 'room:kick_player':
        this.handleKickPlayer(socket, msg.targetPlayerId);
        return;
      case 'room:reassign_faction':
        this.handleReassignFaction(socket, msg.factionId, msg.controller);
        return;
      case 'room:set_paused':
        this.handleSetPaused(socket, Boolean(msg.paused));
        return;
      case 'room:disband':
        this.handleDisbandRoom(socket);
        return;
      case 'room:leave':
        this.handleLeaveRoom(socket);
        return;
      case 'game:action':
        this.handleGameAction(socket, msg.action);
        return;
      case 'diplomacy:action':
        this.handleDiplomacyAction(socket, msg.action);
        return;
      case 'chat:send':
        this.handleChatSend(socket, msg.text);
        return;
      default:
        break;
    }
  }

  public handleDisconnect(socket: WsSocket): void {
    const binding = this.socketBindings.get(socket);
    if (!binding) return;
    this.socketBindings.delete(socket);

    const room = this.rooms.get(binding.roomCode);
    if (!room) return;

    const player = room.players.find((p) => p.playerId === binding.playerId);
    if (!player) return;

    if (player.socket === socket) {
      player.socket = null;
      player.online = false;
      this.touchRoom(room);
      this.broadcastPresence(room);
      this.pauseRoomIfCompletelyEmpty(room);
    }
  }

  private detachSocketFromCurrentRoom(socket: WsSocket): void {
    const existing = this.socketBindings.get(socket);
    if (!existing) return;
    this.handleDisconnect(socket);
  }

  private createSnapshot(room: ServerRoom): RoomSnapshot {
    return {
      code: room.code,
      name: room.name,
      status: room.status,
      hasPassword: room.password.length > 0,
      config: room.config,
      players: room.players.map(toPublicPlayer),
      factionControllers: {...room.factionControllers},
      waitingForFactionId: getWaitingForFactionId(room),
      chat: room.chat.slice(-100),
      state: room.state,
      elapsedSeconds: getRoomElapsedSeconds(room),
      turnRemainingSeconds: getTurnRemainingSeconds(room),
      canUndo: room.undoStack.length > 0,
      isPaused: room.isPaused,
      pausedByNickname: room.pausedByNickname,
    };
  }

  private destroyRoom(room: ServerRoom): void {
    room.aiRunToken++;
    room.isAiRunning = false;
    this.clearTurnTimer(room);
    this.rooms.delete(room.code);
  }

  private pauseRoomIfCompletelyEmpty(room: ServerRoom): void {
    const hasOnline = room.players.some((p) => p.online && !p.left);
    if (hasOnline) return;
    // Freeze active timers and AI while nobody is connected so idle empty rooms wait safely for 1h
    if (room.status === 'PLAYING' && !room.isPaused) {
      room.accumulatedSeconds = getRoomElapsedSeconds(room);
      room.startedAtMs = null;
      const rem = getTurnRemainingSeconds(room);
      this.clearTurnTimer(room);
      room.pausedTurnRemainingSeconds = rem;
      if (room.isAiRunning) {
        room.aiRunToken++;
        room.isAiRunning = false;
      }
    }
  }

  private resumeRoomAfterReturn(room: ServerRoom): void {
    if (
      room.status === 'PLAYING' &&
      !room.isPaused &&
      room.state &&
      room.state.winner === null &&
      room.startedAtMs === null
    ) {
      room.startedAtMs = Date.now();
      const rem = room.pausedTurnRemainingSeconds;
      room.pausedTurnRemainingSeconds = null;
      const active = getActiveFaction(room.state);
      if (room.factionControllers[active] === 'AI' && !room.isAiRunning) {
        void this.runServerAiTurns(room);
      } else {
        this.resetTurnTimer(room, rem ?? undefined);
      }
    }
  }

  private broadcast(
    room: ServerRoom,
    payload: ServerWsMessage,
    excludePlayerId?: string,
  ): void {
    for (const p of room.players) {
      if (p.left || !p.socket) continue;
      if (excludePlayerId && p.playerId === excludePlayerId) continue;
      sendJson(p.socket, payload);
    }
  }

  private broadcastPresence(room: ServerRoom): void {
    this.broadcast(room, {
      type: 'room:presence',
      players: room.players.map(toPublicPlayer),
      factionControllers: {...room.factionControllers},
      waitingForFactionId: getWaitingForFactionId(room),
      isPaused: room.isPaused,
      pausedByNickname: room.pausedByNickname,
    });
  }

  private clearTurnTimer(room: ServerRoom): void {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
    room.turnDeadlineMs = null;
  }

  private resetTurnTimer(room: ServerRoom, overrideSeconds?: number): void {
    this.clearTurnTimer(room);
    if (
      room.status !== 'PLAYING' ||
      room.isPaused ||
      !room.state ||
      room.state.winner !== null ||
      room.isAiRunning
    ) {
      return;
    }
    if (getWaitingForFactionId(room) !== null) {
      return;
    }
    const active = getActiveFaction(room.state);
    if (!room.state.factions[active]?.isHuman) {
      return;
    }

    const limit = getTurnTimeLimitSeconds(room.config);
    if (limit <= 0) {
      return;
    }

    const durationSec =
      typeof overrideSeconds === 'number' && Number.isFinite(overrideSeconds)
        ? Math.max(1, Math.min(limit, Math.ceil(overrideSeconds)))
        : limit;

    room.turnDeadlineMs = Date.now() + durationSec * 1000;
    room.turnTimer = setTimeout(() => {
      this.handleTurnTimeout(room);
    }, durationSec * 1000);
  }

  private handleTurnTimeout(room: ServerRoom): void {
    this.clearTurnTimer(room);
    if (
      room.status !== 'PLAYING' ||
      room.isPaused ||
      !room.state ||
      room.state.winner !== null ||
      room.isAiRunning ||
      getWaitingForFactionId(room) !== null
    ) {
      return;
    }

    const timedOutFaction = getActiveFaction(room.state);
    const factionName =
      room.state.factions[timedOutFaction]?.name ??
      FACTION_PALETTES[timedOutFaction]?.name ??
      'Игрок';

    room.undoStack = [];
    const events = advanceTurn(room.state);

    if (room.state.winner !== null) {
      room.accumulatedSeconds = getRoomElapsedSeconds(room);
      room.status = 'FINISHED';
    } else {
      this.resetTurnTimer(room);
    }

    const notification: GameNotification = {
      id: generateId('notif'),
      category: 'SYSTEM',
      fromFaction: timedOutFaction,
      fromName: factionName,
      text: `Время хода (${factionName}) истекло — ход передан автоматически.`,
      turn: room.state.turn,
      timestamp: Date.now(),
      read: false,
    };
    this.broadcast(room, {type: 'notification:new', notification});

    this.broadcast(room, {
      type: 'game:state_updated',
      state: room.state,
      events,
      elapsedSeconds: getRoomElapsedSeconds(room),
      turnRemainingSeconds: getTurnRemainingSeconds(room),
      waitingForFactionId: getWaitingForFactionId(room),
      factionControllers: {...room.factionControllers},
      canUndo: false,
    });
    this.clearTurnNoticesForActiveFaction(room);

    if (room.status === 'PLAYING' && room.state.winner === null) {
      const nextFaction = getActiveFaction(room.state);
      if (room.factionControllers[nextFaction] === 'AI') {
        void this.runServerAiTurns(room);
      }
    }
  }

  private handleCreateRoom(
    socket: WsSocket,
    rawConfig: GameConfig,
    rawNickname: string,
    factionId: FactionId,
    rawPassword?: string,
  ): void {
    const cookieId = this.getSocketCookieId(socket);
    if (!this.checkRoomCreationLimits(socket, cookieId)) {
      return;
    }
    this.detachSocketFromCurrentRoom(socket);

    const factionCount = Math.max(
      2,
      Math.min(PLAYABLE_FACTIONS.length, Number(rawConfig.factionCount) || 4),
    );
    const humanCount = Math.max(
      2,
      Math.min(factionCount, Number(rawConfig.humanCount) || 2),
    );
    if (!PLAYABLE_FACTIONS.includes(factionId)) {
      sendJson(socket, {
        type: 'error',
        code: 'INVALID_FACTION',
        message: 'Выбран некорректный цвет державы.',
      });
      return;
    }

    const code = generateRoomCode(new Set(this.rooms.keys()));
    const config: GameConfig = {
      ...rawConfig,
      mode: GameMode.HOTSEAT,
      factionCount,
      humanCount,
      riversAndLakes: true,
      seed:
        rawConfig.seed && Number.isFinite(rawConfig.seed) && rawConfig.seed > 0
          ? Math.floor(rawConfig.seed)
          : Math.floor(Date.now() % 1_000_000) + Math.floor(Math.random() * 9999),
    };

    const playerId = generateId('p');
    const nickname = sanitizeNickname(rawNickname, factionId);
    const hostPlayer: ServerPlayer = {
      playerId,
      cookieId,
      nickname,
      factionId,
      isHost: true,
      online: true,
      left: false,
      socket,
    };

    const now = Date.now();
    const existingNames = new Set(
      [...this.rooms.values()].map((r) => r.name),
    );
    const name = generateRoomName(existingNames);
    const room: ServerRoom = {
      code,
      name,
      password: sanitizePassword(rawPassword),
      status: 'WAITING',
      config,
      creatorCookieId: cookieId,
      createdAtMs: now,
      lastActivityAtMs: now,
      players: [hostPlayer],
      factionControllers: {[factionId]: 'ONLINE'},
      chat: [],
      state: null,
      undoStack: [],
      startedAtMs: null,
      accumulatedSeconds: 0,
      isPaused: false,
      pausedByNickname: null,
      pausedTurnRemainingSeconds: null,
      turnDeadlineMs: null,
      turnTimer: null,
      isAiRunning: false,
      aiRunToken: 0,
    };

    this.rooms.set(code, room);
    this.socketBindings.set(socket, {roomCode: code, playerId});

    sendJson(socket, {
      type: 'room:joined',
      credentials: {
        roomCode: code,
        roomName: name,
        playerId,
        nickname,
        factionId,
      },
      snapshot: this.createSnapshot(room),
    });
  }

  private handleHostExistingGame(
    socket: WsSocket,
    rawState: GameState,
    rawElapsedSeconds: number,
    rawNickname: string,
    primaryFactionId: FactionId,
    rawControllers: Record<number, FactionController>,
    rawPassword?: string,
  ): void {
    if (!rawState || !Array.isArray(rawState.turnOrder) || !rawState.cells) {
      sendJson(socket, {
        type: 'error',
        code: 'INVALID_STATE',
        message: 'Некорректное состояние партии.',
      });
      return;
    }
    if (!rawState.turnOrder.includes(primaryFactionId)) {
      sendJson(socket, {
        type: 'error',
        code: 'INVALID_FACTION',
        message: 'Выбранная держава не участвует в партии.',
      });
      return;
    }

    const cookieId = this.getSocketCookieId(socket);
    if (!this.checkRoomCreationLimits(socket, cookieId)) {
      return;
    }

    this.detachSocketFromCurrentRoom(socket);

    const state = cloneGameState(rawState);
    if (!Array.isArray(state.flares)) state.flares = [];
    if (!Array.isArray(state.regenerators)) state.regenerators = [];
    if (!state.nextRegeneratorId) state.nextRegeneratorId = 1;

    const controllers: Record<number, FactionController> = {};
    let humanSlots = 0;

    for (const fId of state.turnOrder) {
      const info = state.factions[fId];
      if (!info) continue;
      if (fId === primaryFactionId) {
        controllers[fId] = 'ONLINE';
        info.isHuman = true;
        humanSlots++;
      } else {
        const req = rawControllers?.[fId];
        const ctrl: FactionController =
          req === 'HOTSEAT' || req === 'ONLINE' || req === 'AI'
            ? req
            : info.isHuman
              ? 'HOTSEAT'
              : 'AI';
        controllers[fId] = ctrl;
        info.isHuman = ctrl !== 'AI';
        if (ctrl !== 'AI') humanSlots++;
      }
    }

    const nickname = sanitizeNickname(rawNickname, primaryFactionId);
    if (state.factions[primaryFactionId]) {
      state.factions[primaryFactionId].name = nickname;
    }

    recalculateFactionSummaries(state);

    const code = generateRoomCode(new Set(this.rooms.keys()));
    const playerId = generateId('p');
    const hostPlayer: ServerPlayer = {
      playerId,
      cookieId,
      nickname,
      factionId: primaryFactionId,
      isHost: true,
      online: true,
      left: false,
      socket,
    };

    const config: GameConfig = {
      ...state.config,
      mode: GameMode.HOTSEAT,
      humanCount: Math.max(1, humanSlots),
    };
    state.config = config;

    const now = Date.now();
    const existingNames = new Set(
      [...this.rooms.values()].map((r) => r.name),
    );
    const name = generateRoomName(existingNames);
    const room: ServerRoom = {
      code,
      name,
      password: sanitizePassword(rawPassword),
      status: state.winner !== null ? 'FINISHED' : 'PLAYING',
      config,
      creatorCookieId: cookieId,
      createdAtMs: now,
      lastActivityAtMs: now,
      players: [hostPlayer],
      factionControllers: controllers,
      chat: [],
      state,
      undoStack: [],
      startedAtMs: now,
      accumulatedSeconds: Math.max(0, Math.floor(rawElapsedSeconds || 0)),
      isPaused: false,
      pausedByNickname: null,
      pausedTurnRemainingSeconds: null,
      turnDeadlineMs: null,
      turnTimer: null,
      isAiRunning: false,
      aiRunToken: 0,
    };

    this.rooms.set(code, room);
    this.socketBindings.set(socket, {roomCode: code, playerId});

    if (room.status === 'PLAYING') {
      this.resetTurnTimer(room);
    }

    sendJson(socket, {
      type: 'room:joined',
      credentials: {
        roomCode: code,
        roomName: name,
        playerId,
        nickname,
        factionId: primaryFactionId,
      },
      snapshot: this.createSnapshot(room),
    });

    if (room.status === 'PLAYING' && room.state && room.state.winner === null) {
      const active = getActiveFaction(room.state);
      if (room.factionControllers[active] === 'AI') {
        void this.runServerAiTurns(room);
      }
    }
  }

  private handleJoinRoom(
    socket: WsSocket,
    rawCode: string,
    rawNickname: string,
    factionId: FactionId,
    rawPassword?: string,
  ): void {
    const code = rawCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      sendJson(socket, {
        type: 'error',
        code: 'ROOM_NOT_FOUND',
        message: `Комната «${code}» не найдена.`,
      });
      return;
    }

    if (room.password.length > 0 && sanitizePassword(rawPassword) !== room.password) {
      sendJson(socket, {
        type: 'error',
        code: 'WRONG_PASSWORD',
        message: 'Неверный пароль комнаты.',
      });
      return;
    }

    if (room.status === 'FINISHED') {
      sendJson(socket, {
        type: 'error',
        code: 'ROOM_FINISHED',
        message: 'Партия в этой комнате уже завершена.',
      });
      return;
    }

    if (!PLAYABLE_FACTIONS.includes(factionId)) {
      sendJson(socket, {
        type: 'error',
        code: 'INVALID_FACTION',
        message: 'Выбран некорректный цвет.',
      });
      return;
    }

    // Mid-game join into an open ONLINE slot or replacing an AI faction!
    if (room.status === 'PLAYING' && room.state) {
      if (!room.state.turnOrder.includes(factionId)) {
        sendJson(socket, {
          type: 'error',
          code: 'INVALID_FACTION',
          message: 'Эта фракция не участвует в партии.',
        });
        return;
      }
      const fInfo = room.state.factions[factionId];
      if (!fInfo || fInfo.isEliminated) {
        sendJson(socket, {
          type: 'error',
          code: 'FACTION_ELIMINATED',
          message: 'Эта фракция уже выбыла из партии.',
        });
        return;
      }
      const occupied = room.players.some(
        (p) => !p.left && p.factionId === factionId,
      );
      const ctrl = room.factionControllers[factionId] ?? 'AI';
      if (occupied || ctrl === 'HOTSEAT') {
        sendJson(socket, {
          type: 'error',
          code: 'COLOR_TAKEN',
          message: 'Этот цвет уже занят игроком.',
        });
        return;
      }

      this.detachSocketFromCurrentRoom(socket);

      const cookieId = this.getSocketCookieId(socket);
      const playerId = generateId('p');
      const nickname = sanitizeNickname(rawNickname, factionId);
      const hasExistingHost = room.players.some((p) => !p.left && p.isHost);
      const newPlayer: ServerPlayer = {
        playerId,
        cookieId,
        nickname,
        factionId,
        isHost: !hasExistingHost,
        online: true,
        left: false,
        socket,
      };

      const wasAi = ctrl === 'AI';
      room.factionControllers[factionId] = 'ONLINE';
      fInfo.isHuman = true;
      fInfo.name = nickname;
      room.players.push(newPlayer);
      this.socketBindings.set(socket, {roomCode: code, playerId});
      this.touchRoom(room);
      this.resumeRoomAfterReturn(room);

      const active = getActiveFaction(room.state);
      if (active === factionId && room.isAiRunning) {
        room.aiRunToken++;
        room.isAiRunning = false;
      }
      if (active === factionId) {
        this.resetTurnTimer(room);
      }

      const snapshot = this.createSnapshot(room);
      sendJson(socket, {
        type: 'room:joined',
        credentials: {
          roomCode: code,
          roomName: room.name,
          playerId,
          nickname,
          factionId,
        },
        snapshot,
      });

      const notification: GameNotification = {
        id: generateId('notif'),
        category: 'SYSTEM',
        fromFaction: factionId,
        fromName: nickname,
        text: wasAi
          ? `${nickname} заменил ИИ (${FACTION_PALETTES[factionId].name}).`
          : `${nickname} присоединился (${FACTION_PALETTES[factionId].name}).`,
        turn: room.state.turn,
        timestamp: Date.now(),
        read: false,
      };
      this.broadcast(room, {type: 'notification:new', notification}, playerId);
      this.broadcast(room, {type: 'room:sync', snapshot}, playerId);
      return;
    }

    // Standard WAITING room join
    const activePlayers = room.players.filter((p) => !p.left);
    if (activePlayers.length >= room.config.humanCount) {
      sendJson(socket, {
        type: 'error',
        code: 'ROOM_FULL',
        message: 'Комната уже заполнена.',
      });
      return;
    }

    if (activePlayers.some((p) => p.factionId === factionId)) {
      sendJson(socket, {
        type: 'error',
        code: 'COLOR_TAKEN',
        message: 'Этот цвет уже занят другим игроком.',
      });
      return;
    }

    this.detachSocketFromCurrentRoom(socket);

    const cookieId = this.getSocketCookieId(socket);
    const playerId = generateId('p');
    const nickname = sanitizeNickname(rawNickname, factionId);
    const hasExistingHost = room.players.some((p) => !p.left && p.isHost);
    const newPlayer: ServerPlayer = {
      playerId,
      cookieId,
      nickname,
      factionId,
      isHost: !hasExistingHost,
      online: true,
      left: false,
      socket,
    };

    room.players.push(newPlayer);
    room.factionControllers[factionId] = 'ONLINE';
    this.socketBindings.set(socket, {roomCode: code, playerId});
    this.touchRoom(room);

    sendJson(socket, {
      type: 'room:joined',
      credentials: {
        roomCode: code,
        roomName: room.name,
        playerId,
        nickname,
        factionId,
      },
      snapshot: this.createSnapshot(room),
    });

    const currentActive = room.players.filter((p) => !p.left);
    if (currentActive.length >= room.config.humanCount) {
      this.startRoomMatch(room);
    } else {
      this.broadcast(
        room,
        {
          type: 'room:sync',
          snapshot: this.createSnapshot(room),
        },
        playerId,
      );
    }
  }

  private startRoomMatch(room: ServerRoom): void {
    const activePlayers = room.players.filter((p) => !p.left);
    room.state = createInitialGameState(
      room.config,
      activePlayers.map((p) => ({
        factionId: p.factionId,
        nickname: p.nickname,
      })),
    );
    room.factionControllers = {};
    const playerFactions = new Set(activePlayers.map((p) => p.factionId));
    for (const fId of room.state.turnOrder) {
      room.factionControllers[fId] = playerFactions.has(fId) ? 'ONLINE' : 'AI';
    }
    room.status = 'PLAYING';
    room.startedAtMs = Date.now();
    room.accumulatedSeconds = 0;
    room.undoStack = [];
    this.resetTurnTimer(room);

    const snapshot = this.createSnapshot(room);
    this.broadcast(room, {
      type: 'room:started',
      snapshot,
    });
  }

  private handleReconnect(
    socket: WsSocket,
    rawCode: string,
    playerId: string,
  ): void {
    const code = rawCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      sendJson(socket, {
        type: 'room:left',
        reason: 'Комната не найдена.',
      });
      return;
    }

    const player = room.players.find(
      (p) => p.playerId === playerId && !p.left,
    );
    if (!player) {
      sendJson(socket, {
        type: 'room:left',
        reason: 'Сессия в этой комнате завершена.',
      });
      return;
    }

    if (player.socket && player.socket !== socket) {
      this.socketBindings.delete(player.socket);
      try {
        player.socket.close();
      } catch {
        // Ignore
      }
    }

    player.socket = socket;
    player.online = true;
    const cookieId = this.getSocketCookieId(socket);
    if (cookieId && !player.cookieId) {
      player.cookieId = cookieId;
    }
    this.socketBindings.set(socket, {roomCode: code, playerId});
    this.touchRoom(room);
    this.resumeRoomAfterReturn(room);

    sendJson(socket, {
      type: 'room:joined',
      credentials: {
        roomCode: code,
        roomName: room.name,
        playerId: player.playerId,
        nickname: player.nickname,
        factionId: player.factionId,
      },
      snapshot: this.createSnapshot(room),
    });

    this.broadcastPresence(room);
  }

  private handleRejoinByCookie(socket: WsSocket, rawCode: string): void {
    this.cleanupStaleRooms();
    const cookieId = this.getSocketCookieId(socket);
    if (!cookieId) {
      sendJson(socket, {
        type: 'error',
        code: 'NO_IDENTITY',
        message: 'Идентификатор игрока не найден. Обновите страницу.',
      });
      return;
    }

    const code = rawCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      sendJson(socket, {
        type: 'error',
        code: 'ROOM_NOT_FOUND',
        message: 'Эта комната больше не активна.',
      });
      return;
    }

    const player = room.players.find((p) => p.cookieId === cookieId);
    if (!player) {
      sendJson(socket, {
        type: 'error',
        code: 'FORBIDDEN',
        message: 'Вы не участвовали в этой комнате.',
      });
      return;
    }

    this.detachSocketFromCurrentRoom(socket);

    if (player.left) {
      if (room.status === 'WAITING') {
        const activePlayers = room.players.filter((p) => !p.left);
        if (activePlayers.length >= room.config.humanCount) {
          sendJson(socket, {
            type: 'error',
            code: 'ROOM_FULL',
            message: 'Комната уже заполнена.',
          });
          return;
        }
        const taken = new Set(activePlayers.map((p) => p.factionId));
        if (taken.has(player.factionId)) {
          const fallback = PLAYABLE_FACTIONS.find((f) => !taken.has(f));
          if (fallback === undefined) {
            sendJson(socket, {
              type: 'error',
              code: 'ROOM_FULL',
              message: 'Нет свободных цветов в комнате.',
            });
            return;
          }
          player.factionId = fallback;
        }
        player.left = false;
        room.factionControllers[player.factionId] = 'ONLINE';
      } else if (room.status === 'PLAYING' && room.state) {
        const seatTaken = room.players.some(
          (p) => !p.left && p.factionId === player.factionId,
        );
        const fInfo = room.state.factions[player.factionId];
        if (seatTaken && fInfo && !fInfo.isEliminated) {
          sendJson(socket, {
            type: 'error',
            code: 'COLOR_TAKEN',
            message: 'Ваше место уже занял другой игрок.',
          });
          return;
        }
        player.left = false;
        if (fInfo && !fInfo.isEliminated) {
          room.factionControllers[player.factionId] = 'ONLINE';
          fInfo.isHuman = true;
          fInfo.name = player.nickname;
          const active = getActiveFaction(room.state);
          if (active === player.factionId && room.isAiRunning) {
            room.aiRunToken++;
            room.isAiRunning = false;
          }
        }
      } else {
        player.left = false;
      }
    }

    const hasHost = room.players.some((p) => !p.left && p.isHost);
    if (!hasHost) {
      player.isHost = true;
    }

    if (player.socket && player.socket !== socket) {
      this.socketBindings.delete(player.socket);
      try {
        player.socket.close();
      } catch {
        // Ignore
      }
    }

    player.socket = socket;
    player.online = true;
    this.socketBindings.set(socket, {roomCode: code, playerId: player.playerId});
    this.touchRoom(room);
    this.resumeRoomAfterReturn(room);

    const snapshot = this.createSnapshot(room);
    sendJson(socket, {
      type: 'room:joined',
      credentials: {
        roomCode: code,
        roomName: room.name,
        playerId: player.playerId,
        nickname: player.nickname,
        factionId: player.factionId,
      },
      snapshot,
    });

    if (
      room.status === 'WAITING' &&
      room.players.filter((p) => !p.left).length >= room.config.humanCount
    ) {
      this.startRoomMatch(room);
      return;
    }

    this.broadcast(room, {type: 'room:sync', snapshot}, player.playerId);
  }

  private evictPlayerToController(
    room: ServerRoom,
    target: ServerPlayer,
    nextController: FactionController,
    reason: string,
  ): void {
    if (target.socket) {
      this.socketBindings.delete(target.socket);
      sendJson(target.socket, {
        type: 'room:left',
        reason,
      });
    }
    target.left = true;
    target.online = false;
    target.socket = null;
    target.cookieId = null;

    room.factionControllers[target.factionId] = nextController;
    if (room.state && room.state.factions[target.factionId]) {
      room.state.factions[target.factionId].isHuman = nextController !== 'AI';
      room.state.factions[target.factionId].name =
        FACTION_PALETTES[target.factionId]?.name ?? 'Держава';
    }
  }

  private handleKickPlayer(socket: WsSocket, targetPlayerId: string): void {
    const ctx = this.getBoundContext(socket);
    if (!ctx) return;
    const {room, player} = ctx;

    if (!player.isHost) {
      sendJson(socket, {
        type: 'error',
        code: 'FORBIDDEN',
        message: 'Только хост может исключать игроков.',
      });
      return;
    }

    const target = room.players.find(
      (p) => p.playerId === targetPlayerId && !p.left,
    );
    if (!target || target.playerId === player.playerId) return;

    if (room.status === 'WAITING') {
      if (target.socket) {
        this.socketBindings.delete(target.socket);
        sendJson(target.socket, {
          type: 'room:left',
          reason: 'Вы были исключены из комнаты.',
        });
      }
      room.players = room.players.filter((p) => p.playerId !== targetPlayerId);
      delete room.factionControllers[target.factionId];
      this.broadcast(room, {
        type: 'room:sync',
        snapshot: this.createSnapshot(room),
      });
      return;
    }

    this.evictPlayerToController(
      room,
      target,
      'AI',
      'Вы были исключены хостом (фракция передана ИИ).',
    );

    const notification: GameNotification = {
      id: generateId('notif'),
      category: 'SYSTEM',
      fromFaction: target.factionId,
      fromName: target.nickname,
      text: `${target.nickname} исключён из комнаты (передан ИИ).`,
      turn: room.state?.turn ?? 1,
      timestamp: Date.now(),
      read: false,
    };
    this.broadcast(room, {type: 'notification:new', notification});
    this.broadcast(room, {
      type: 'room:sync',
      snapshot: this.createSnapshot(room),
    });

    if (
      room.state &&
      room.status === 'PLAYING' &&
      !room.isPaused &&
      room.state.winner === null
    ) {
      const activeF = getActiveFaction(room.state);
      if (activeF === target.factionId && !room.isAiRunning) {
        this.clearTurnTimer(room);
        void this.runServerAiTurns(room);
      }
    }
  }

  private handleReassignFaction(
    socket: WsSocket,
    factionId: FactionId,
    controller: FactionController,
  ): void {
    const ctx = this.getBoundContext(socket);
    if (!ctx) return;
    const {room, player} = ctx;

    if (!player.isHost || !room.state || room.status !== 'PLAYING') {
      return;
    }
    if (!room.state.turnOrder.includes(factionId)) return;
    const info = room.state.factions[factionId];
    if (!info || info.isEliminated) return;

    // Host's own primary faction cannot be handed off to AI or unassigned
    if (factionId === player.factionId) return;

    const existingRemote = room.players.find(
      (p) => !p.left && p.factionId === factionId && p.playerId !== player.playerId,
    );

    if (existingRemote && controller !== 'ONLINE') {
      this.evictPlayerToController(
        room,
        existingRemote,
        controller,
        controller === 'AI'
          ? 'Хост передал вашу фракцию ИИ.'
          : 'Хост перевёл вашу фракцию в локальный хотсит.',
      );
    }

    room.factionControllers[factionId] = controller;
    info.isHuman = controller !== 'AI';
    if (!existingRemote || controller !== 'ONLINE') {
      info.name = FACTION_PALETTES[factionId]?.name ?? info.name;
    }

    const active = getActiveFaction(room.state);
    if (active === factionId) {
      if (controller === 'AI') {
        this.clearTurnTimer(room);
      } else {
        if (room.isAiRunning) {
          room.aiRunToken++;
          room.isAiRunning = false;
        }
        this.resetTurnTimer(room);
      }
    }

    const label =
      controller === 'AI'
        ? 'ИИ'
        : controller === 'HOTSEAT'
          ? 'Хотсит'
          : 'Онлайн (ожидание)';
    const notification: GameNotification = {
      id: generateId('notif'),
      category: 'SYSTEM',
      fromFaction: factionId,
      fromName: FACTION_PALETTES[factionId]?.name,
      text: `${FACTION_PALETTES[factionId]?.name ?? 'Фракция'} → ${label}.`,
      turn: room.state.turn,
      timestamp: Date.now(),
      read: false,
    };
    this.broadcast(room, {type: 'notification:new', notification});
    this.broadcast(room, {
      type: 'room:sync',
      snapshot: this.createSnapshot(room),
    });

    if (
      active === factionId &&
      controller === 'AI' &&
      !room.isPaused &&
      room.state.winner === null &&
      !room.isAiRunning
    ) {
      void this.runServerAiTurns(room);
    }
  }

  private handleSetPaused(socket: WsSocket, paused: boolean): void {
    const ctx = this.getBoundContext(socket);
    if (!ctx) return;
    const {room, player} = ctx;

    if (!player.isHost) {
      sendJson(socket, {
        type: 'error',
        code: 'FORBIDDEN',
        message: 'Только администратор комнаты может управлять паузой.',
      });
      return;
    }
    if (
      room.status !== 'PLAYING' ||
      !room.state ||
      room.state.winner !== null
    ) {
      return;
    }
    if (room.isPaused === paused) {
      return;
    }

    if (paused) {
      room.accumulatedSeconds = getRoomElapsedSeconds(room);
      room.startedAtMs = null;
      const remaining = getTurnRemainingSeconds(room);
      this.clearTurnTimer(room);
      room.pausedTurnRemainingSeconds = remaining;
      if (room.isAiRunning) {
        room.aiRunToken++;
        room.isAiRunning = false;
      }
      room.isPaused = true;
      room.pausedByNickname = player.nickname;
    } else {
      room.isPaused = false;
      room.pausedByNickname = null;
      room.startedAtMs = Date.now();
      const resumeRemaining = room.pausedTurnRemainingSeconds;
      room.pausedTurnRemainingSeconds = null;
      this.resetTurnTimer(room, resumeRemaining ?? undefined);
    }

    const notification: GameNotification = {
      id: generateId('notif'),
      category: 'SYSTEM',
      fromFaction: player.factionId,
      fromName: player.nickname,
      text: paused
        ? `${player.nickname} поставил игру на паузу.`
        : `${player.nickname} возобновил игру.`,
      turn: room.state.turn,
      timestamp: Date.now(),
      read: false,
    };

    this.touchRoom(room);

    const snapshot = this.createSnapshot(room);
    this.broadcast(room, {type: 'room:sync', snapshot});
    this.broadcast(room, {type: 'notification:new', notification});

    if (!paused && room.status === 'PLAYING' && room.state.winner === null) {
      const active = getActiveFaction(room.state);
      if (room.factionControllers[active] === 'AI' && !room.isAiRunning) {
        void this.runServerAiTurns(room);
      }
    }
  }

  private handleDisbandRoom(socket: WsSocket): void {
    const ctx = this.getBoundContext(socket);
    if (!ctx) return;
    const {room, player} = ctx;

    if (!player.isHost) {
      sendJson(socket, {
        type: 'error',
        code: 'FORBIDDEN',
        message: 'Только администратор может распустить комнату.',
      });
      return;
    }

    for (const p of room.players) {
      if (p.left) continue;
      if (p.socket) {
        this.socketBindings.delete(p.socket);
        sendJson(p.socket, {
          type: 'room:left',
          reason:
            p.playerId === player.playerId
              ? 'Комната распущена и удалена.'
              : `Администратор (${player.nickname}) распустил комнату.`,
        });
      }
      p.left = true;
      p.online = false;
      p.isHost = false;
      p.socket = null;
    }

    this.destroyRoom(room);
  }

  private handleLeaveRoom(socket: WsSocket): void {
    const binding = this.socketBindings.get(socket);
    if (!binding) {
      sendJson(socket, {type: 'room:left'});
      return;
    }
    this.socketBindings.delete(socket);

    const room = this.rooms.get(binding.roomCode);
    if (!room) {
      sendJson(socket, {type: 'room:left'});
      return;
    }

    const idx = room.players.findIndex((p) => p.playerId === binding.playerId);
    if (idx === -1) {
      sendJson(socket, {type: 'room:left'});
      return;
    }

    const leaving = room.players[idx];
    const wasHost = leaving.isHost;
    sendJson(socket, {type: 'room:left'});
    this.touchRoom(room);

    if (room.status === 'WAITING') {
      leaving.left = true;
      leaving.online = false;
      leaving.isHost = false;
      leaving.socket = null;
      delete room.factionControllers[leaving.factionId];

      const remainingWaiting = room.players.filter((p) => !p.left);
      if (remainingWaiting.length === 0) {
        // Keep room alive for up to 1h of inactivity so players can return from History
        return;
      }
      let nextHost: ServerPlayer | null = null;
      if (wasHost) {
        nextHost =
          remainingWaiting.find((p) => p.online) ?? remainingWaiting[0] ?? null;
        if (nextHost) {
          for (const p of room.players) p.isHost = false;
          nextHost.isHost = true;
        }
      }
      this.broadcast(room, {
        type: 'room:sync',
        snapshot: this.createSnapshot(room),
      });
      if (nextHost) {
        this.broadcast(room, {
          type: 'notification:new',
          notification: {
            id: generateId('notif'),
            category: 'SYSTEM',
            fromFaction: nextHost.factionId,
            fromName: nextHost.nickname,
            text: `${leaving.nickname} покинул комнату. Новый администратор: ${nextHost.nickname}.`,
            turn: 0,
            timestamp: Date.now(),
            read: false,
          },
        });
      }
      return;
    }

    leaving.left = true;
    leaving.online = false;
    leaving.isHost = false;
    leaving.socket = null;
    room.factionControllers[leaving.factionId] = 'AI';

    if (room.state && room.state.factions[leaving.factionId]) {
      room.state.factions[leaving.factionId].isHuman = false;
    }

    const remainingHumans = room.players.filter((p) => !p.left);
    if (remainingHumans.length === 0) {
      // Do NOT delete immediately — keep room alive until empty + >1h since last activity
      this.pauseRoomIfCompletelyEmpty(room);
      return;
    }

    let nextHost: ServerPlayer | null = null;
    if (wasHost) {
      nextHost =
        remainingHumans.find((p) => p.online) ?? remainingHumans[0] ?? null;
      if (nextHost) {
        for (const p of room.players) p.isHost = false;
        nextHost.isHost = true;
      }
      // Convert any leftover HOTSEAT factions owned by old host to AI
      if (room.state) {
        for (const fId of room.state.turnOrder) {
          if (room.factionControllers[fId] === 'HOTSEAT') {
            room.factionControllers[fId] = 'AI';
            if (room.state.factions[fId]) {
              room.state.factions[fId].isHuman = false;
            }
          }
        }
      }
    }

    const notification: GameNotification = {
      id: generateId('notif'),
      category: 'SYSTEM',
      fromFaction: leaving.factionId,
      fromName: leaving.nickname,
      text: nextHost
        ? `${leaving.nickname} покинул партию (передан ИИ). Новый администратор: ${nextHost.nickname}.`
        : `${leaving.nickname} покинул партию (передан ИИ).`,
      turn: room.state?.turn ?? 1,
      timestamp: Date.now(),
      read: false,
    };

    this.broadcast(room, {
      type: 'room:sync',
      snapshot: this.createSnapshot(room),
    });
    this.broadcast(room, {type: 'notification:new', notification});

    const anyOnline = remainingHumans.some((p) => p.online);
    if (!anyOnline) {
      this.pauseRoomIfCompletelyEmpty(room);
      return;
    }

    if (room.state && !room.isPaused) {
      const activeF = getActiveFaction(room.state);
      if (
        room.status === 'PLAYING' &&
        room.state.winner === null &&
        room.factionControllers[activeF] === 'AI' &&
        !room.isAiRunning
      ) {
        this.clearTurnTimer(room);
        void this.runServerAiTurns(room);
      }
    }
  }

  private getBoundContext(
    socket: WsSocket,
  ): {room: ServerRoom; player: ServerPlayer} | null {
    const binding = this.socketBindings.get(socket);
    if (!binding) return null;
    const room = this.rooms.get(binding.roomCode);
    if (!room) return null;
    const player = room.players.find(
      (p) => p.playerId === binding.playerId && !p.left,
    );
    if (!player) return null;
    return {room, player};
  }

  private handleGameAction(socket: WsSocket, action: GameActionPayload): void {
    const ctx = this.getBoundContext(socket);
    if (!ctx) return;
    const {room, player} = ctx;

    if (room.isPaused) {
      sendJson(socket, {
        type: 'error',
        code: 'GAME_PAUSED',
        message: 'Игра поставлена на паузу администратором.',
      });
      return;
    }

    if (
      room.status !== 'PLAYING' ||
      !room.state ||
      room.state.winner !== null ||
      room.isAiRunning ||
      getWaitingForFactionId(room) !== null
    ) {
      return;
    }

    const activeFaction = getActiveFaction(room.state);
    if (!canPlayerControlFaction(room, player, activeFaction)) {
      sendJson(socket, {
        type: 'error',
        code: 'NOT_YOUR_TURN',
        message: 'Сейчас ход другого игрока.',
      });
      return;
    }

    let events: GameEvent[] = [];

    switch (action.kind) {
      case 'MOVE_UNIT': {
        const snap = cloneGameState(room.state);
        events = executeUnitMove(room.state, action.fromKey, action.toKey);
        if (events.length > 0) {
          room.undoStack = [...room.undoStack.slice(-19), snap];
        }
        break;
      }
      case 'BUY_PLACE': {
        const snap = cloneGameState(room.state);
        events = executeBuyAndPlace(
          room.state,
          action.provinceId,
          action.entity,
          action.targetKey,
        );
        if (events.length > 0) {
          room.undoStack = [...room.undoStack.slice(-19), snap];
        }
        break;
      }
      case 'CATAPULT_FIRE': {
        const snap = cloneGameState(room.state);
        events = executeCatapultFire(
          room.state,
          action.catapultKey,
          action.targetKey,
        );
        if (events.length > 0) {
          room.undoStack = [...room.undoStack.slice(-19), snap];
        }
        break;
      }
      case 'DEMOLISH': {
        const snap = cloneGameState(room.state);
        events = executeDemolishBuilding(
          room.state,
          action.provinceId,
          action.targetKey,
        );
        if (events.length > 0) {
          room.undoStack = [...room.undoStack.slice(-19), snap];
        }
        break;
      }
      case 'LAUNCH_FLARE': {
        events = executeLaunchFlare(
          room.state,
          action.provinceId,
          action.targetKey,
        );
        // Launching illumination Light cannot be undone to prevent free fog scouting
        if (events.length > 0) {
          room.undoStack = [];
        }
        break;
      }
      case 'PLACE_REGENERATOR': {
        const snap = cloneGameState(room.state);
        events = executePlaceRegenerator(
          room.state,
          action.provinceId,
          action.targetKey,
        );
        if (events.length > 0) {
          room.undoStack = [...room.undoStack.slice(-19), snap];
        }
        break;
      }
      case 'UNDO': {
        const prev = room.undoStack.pop();
        if (!prev) return;
        room.state = prev;
        break;
      }
      case 'END_TURN': {
        room.undoStack = [];
        events = advanceTurn(room.state);
        break;
      }
    }

    this.touchRoom(room);

    if (room.state.winner !== null) {
      room.accumulatedSeconds = getRoomElapsedSeconds(room);
      room.status = 'FINISHED';
      this.clearTurnTimer(room);
    } else if (action.kind === 'END_TURN') {
      this.resetTurnTimer(room);
    }

    this.broadcast(room, {
      type: 'game:state_updated',
      state: room.state,
      events,
      elapsedSeconds: getRoomElapsedSeconds(room),
      turnRemainingSeconds: getTurnRemainingSeconds(room),
      waitingForFactionId: getWaitingForFactionId(room),
      factionControllers: {...room.factionControllers},
      canUndo: room.undoStack.length > 0,
    });
    if (action.kind === 'END_TURN') {
      this.clearTurnNoticesForActiveFaction(room);
    }

    if (
      action.kind === 'END_TURN' &&
      room.status === 'PLAYING' &&
      room.state.winner === null
    ) {
      const nextFaction = getActiveFaction(room.state);
      if (room.factionControllers[nextFaction] === 'AI') {
        this.clearTurnTimer(room);
        void this.runServerAiTurns(room);
      }
    }
  }

  /**
   * Clears deferred start-of-turn notices for the newly active human faction
   * right after broadcasting the turn-transition state so they are never
   * re-sent on subsequent turns.
   */
  private clearTurnNoticesForActiveFaction(room: ServerRoom): void {
    if (!room.state) return;
    const nextFaction = getActiveFaction(room.state);
    if (
      room.factionControllers[nextFaction] === 'AI' ||
      getWaitingForFactionId(room) === nextFaction
    ) {
      return;
    }
    if (room.state.diplomacy.pendingNotices[nextFaction]?.length) {
      room.state.diplomacy.pendingNotices[nextFaction] = [];
    }
  }

  private dispatchNewPendingNotices(
    room: ServerRoom,
    previousNoticeCounts: Record<number, number>,
  ): void {
    if (!room.state) return;
    const activeFaction = getActiveFaction(room.state);
    const hostPlayer = room.players.find((p) => !p.left && p.isHost) ?? null;
    for (const fId of room.state.turnOrder) {
      const list = room.state.diplomacy.pendingNotices[fId] ?? [];
      const prevCount = previousNoticeCounts[fId] ?? 0;
      if (list.length <= prevCount) continue;

      const ownerPlayer =
        room.players.find((p) => !p.left && p.factionId === fId) ??
        (room.factionControllers[fId] === 'HOTSEAT' ? hostPlayer : null);

      const kept = list.slice(0, prevCount);
      const added = list.slice(prevCount);
      const immediate: DiplomaticNotice[] = [];
      const deferred: DiplomaticNotice[] = [];

      for (const notice of added) {
        const isTurnSummaryCategory =
          notice.category === 'FRIEND' ||
          notice.category === 'WAR' ||
          notice.category === 'REJECTED';
        const deliverNow =
          notice.messageId !== undefined ||
          fId === activeFaction ||
          !isTurnSummaryCategory;

        if (deliverNow) {
          immediate.push(notice);
        } else {
          deferred.push(notice);
        }
      }

      // Keep only deferred start-of-turn summary notices; remove already-dispatched immediate ones
      room.state.diplomacy.pendingNotices[fId] = [...kept, ...deferred];

      if (ownerPlayer) {
        for (const notice of immediate) {
          this.sendNoticeNotification(room, ownerPlayer, notice);
        }
      }
    }
  }

  private sendNoticeNotification(
    room: ServerRoom,
    recipient: ServerPlayer,
    notice: DiplomaticNotice,
  ): void {
    const senderInfo = room.state?.factions[notice.fromFaction];
    const fromName =
      senderInfo?.name ?? FACTION_PALETTES[notice.fromFaction]?.name ?? 'Держава';
    const categoryMap: Record<DiplomaticNotice['category'], NotificationCategory> = {
      WAR: 'WAR',
      FRIEND: 'FRIEND',
      NEUTRAL: 'NEUTRAL',
      BLACK_MARK: 'BLACK_MARK',
      EXCHANGE: 'EXCHANGE',
      MESSAGE: 'MESSAGE',
      REJECTED: 'REJECTED',
    };
    const notification: GameNotification = {
      id: generateId('notif'),
      category: categoryMap[notice.category] ?? 'MESSAGE',
      fromFaction: notice.fromFaction,
      fromName,
      text: notice.text,
      turn: notice.turn,
      timestamp: Date.now(),
      messageId: notice.messageId,
      actionKind:
        notice.messageId !== undefined
          ? 'DIPLOMACY_RESPONSE'
          : 'OPEN_DIPLOMACY',
      read: false,
    };
    sendJson(recipient.socket, {
      type: 'notification:new',
      notification,
    });
  }

  private snapshotNoticeCounts(state: GameState): Record<number, number> {
    const counts: Record<number, number> = {};
    for (const fId of state.turnOrder) {
      counts[fId] = state.diplomacy.pendingNotices[fId]?.length ?? 0;
    }
    return counts;
  }

  private findRichestProvinceId(
    state: GameState,
    factionId: FactionId,
    preferredId?: string,
  ): string | undefined {
    if (
      preferredId &&
      state.provinces[preferredId]?.faction === factionId
    ) {
      return preferredId;
    }
    const provs = Object.values(state.provinces)
      .filter((p) => p.faction === factionId)
      .sort((a, b) => b.money - a.money);
    return provs[0]?.id;
  }

  private handleDiplomacyAction(
    socket: WsSocket,
    action: DiplomacyActionPayload,
  ): void {
    const ctx = this.getBoundContext(socket);
    if (!ctx) return;
    const {room, player} = ctx;

    if (room.isPaused) {
      sendJson(socket, {
        type: 'error',
        code: 'GAME_PAUSED',
        message: 'Игра поставлена на паузу администратором.',
      });
      return;
    }

    if (
      room.status !== 'PLAYING' ||
      !room.state ||
      room.state.winner !== null
    ) {
      return;
    }
    if (action.kind !== 'SURRENDER' && !room.state.config.diplomacyEnabled) {
      return;
    }

    const activeFaction = getActiveFaction(room.state);
    const beforeCounts = this.snapshotNoticeCounts(room.state);
    let events: GameEvent[] = [];
    let turnAdvancedBySurrender = false;

    // Accepting/rejecting incoming requests, cancelling subsidies, and surrendering are allowed at ANY moment
    if (action.kind === 'RESPOND_MESSAGE') {
      const targetMsg = room.state.diplomacy.messages.find(
        (m) => m.id === action.messageId,
      );
      if (
        !targetMsg ||
        !canPlayerControlFaction(room, player, targetMsg.toFaction) ||
        room.state.factions[targetMsg.toFaction]?.isEliminated
      ) {
        return;
      }
      events = respondToDiplomaticMessage(
        room.state,
        action.messageId,
        action.accept,
      );
    } else if (action.kind === 'CANCEL_SUBSIDY') {
      const sub = room.state.diplomacy.subsidies.find(
        (s) => s.id === action.subsidyId,
      );
      if (!sub) return;
      const actorFaction = canPlayerControlFaction(room, player, sub.fromFaction)
        ? sub.fromFaction
        : canPlayerControlFaction(room, player, sub.toFaction)
          ? sub.toFaction
          : null;
      if (
        actorFaction === null ||
        room.state.factions[actorFaction]?.isEliminated
      ) {
        return;
      }
      events = cancelDiplomaticSubsidy(room.state, actorFaction, action.subsidyId);
    } else if (action.kind === 'SURRENDER') {
      const actorFaction = canPlayerControlFaction(room, player, activeFaction)
        ? activeFaction
        : player.factionId;
      if (
        !canPlayerControlFaction(room, player, actorFaction) ||
        room.state.factions[actorFaction]?.isEliminated
      ) {
        return;
      }
      const wasActive = activeFaction === actorFaction;
      if (wasActive) {
        room.undoStack = [];
      }
      events = surrenderFaction(room.state, actorFaction);
      turnAdvancedBySurrender =
        wasActive &&
        room.state.winner === null &&
        getActiveFaction(room.state) !== actorFaction;
    } else {
      // Sending any outgoing request is ONLY allowed on the player's own turn
      if (
        room.isAiRunning ||
        getWaitingForFactionId(room) !== null ||
        !canPlayerControlFaction(room, player, activeFaction)
      ) {
        sendJson(socket, {
          type: 'error',
          code: 'NOT_YOUR_TURN',
          message: 'Отправлять запросы можно только в свой ход.',
        });
        return;
      }

      const actorFaction = activeFaction;
      if (room.state.factions[actorFaction]?.isEliminated) return;

      switch (action.kind) {
        case 'DECLARE_WAR':
          events = declareWar(room.state, actorFaction, action.target);
          break;
        case 'PROPOSE_PEACE': {
          const provId = this.findRichestProvinceId(
            room.state,
            actorFaction,
            action.provinceId,
          );
          events = proposePeace(
            room.state,
            actorFaction,
            action.target,
            action.goldOffer,
            provId,
          );
          break;
        }
        case 'PROPOSE_EXCHANGE': {
          const provId = this.findRichestProvinceId(
            room.state,
            actorFaction,
            action.provinceId,
          );
          events = proposeExchangeDeal(
            room.state,
            actorFaction,
            action.target,
            action.offer,
            provId,
          );
          break;
        }
        case 'ISSUE_BLACK_MARK': {
          const provId = this.findRichestProvinceId(
            room.state,
            actorFaction,
            action.provinceId,
          );
          events = issueBlackMark(
            room.state,
            actorFaction,
            action.target,
            provId,
          );
          if (events.length === 0) {
            sendJson(socket, {
              type: 'error',
              code: 'INSUFFICIENT_GOLD',
              message: 'Недостаточно золота для Чёрной метки (нужно 10 монет).',
            });
            return;
          }
          break;
        }
        case 'SEND_GOLD': {
          const provId = this.findRichestProvinceId(
            room.state,
            actorFaction,
            action.provinceId,
          );
          if (!provId) return;
          events = sendGoldExchange(
            room.state,
            provId,
            action.target,
            action.amount,
            action.note,
          );
          break;
        }
        case 'SEND_NOTE':
          events = sendDiplomaticNote(
            room.state,
            actorFaction,
            action.target,
            action.text,
          );
          break;
      }
    }

    if (events.length === 0) return;

    this.touchRoom(room);

    if (room.state.winner !== null) {
      room.accumulatedSeconds = getRoomElapsedSeconds(room);
      room.status = 'FINISHED';
      this.clearTurnTimer(room);
    } else if (turnAdvancedBySurrender) {
      this.resetTurnTimer(room);
    }

    this.dispatchNewPendingNotices(room, beforeCounts);

    this.broadcast(room, {
      type: 'game:state_updated',
      state: room.state,
      events,
      elapsedSeconds: getRoomElapsedSeconds(room),
      turnRemainingSeconds: getTurnRemainingSeconds(room),
      waitingForFactionId: getWaitingForFactionId(room),
      factionControllers: {...room.factionControllers},
      canUndo: room.undoStack.length > 0,
    });

    if (
      turnAdvancedBySurrender &&
      room.status === 'PLAYING' &&
      room.state.winner === null
    ) {
      this.clearTurnNoticesForActiveFaction(room);
      const nextFaction = getActiveFaction(room.state);
      if (room.factionControllers[nextFaction] === 'AI' && !room.isAiRunning) {
        this.clearTurnTimer(room);
        void this.runServerAiTurns(room);
      }
    }
  }

  private handleChatSend(socket: WsSocket, rawText: string): void {
    const ctx = this.getBoundContext(socket);
    if (!ctx) return;
    const {room, player} = ctx;

    const text = rawText.trim().slice(0, 240);
    if (!text) return;

    const message: ChatMessage = {
      id: generateId('chat'),
      playerId: player.playerId,
      factionId: player.factionId,
      nickname: player.nickname,
      text,
      timestamp: Date.now(),
      turn: room.state?.turn ?? 0,
    };

    this.touchRoom(room);
    room.chat = [...room.chat.slice(-99), message];
    this.broadcast(room, {
      type: 'chat:message',
      message,
    });

    const notification: GameNotification = {
      id: generateId('notif'),
      category: 'CHAT',
      fromFaction: player.factionId,
      fromName: player.nickname,
      text: `${player.nickname}: ${text}`,
      turn: message.turn,
      timestamp: message.timestamp,
      actionKind: 'OPEN_CHAT',
      read: false,
    };
    this.broadcast(room, {type: 'notification:new', notification}, player.playerId);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async runServerAiTurns(room: ServerRoom): Promise<void> {
    if (!room.state) return;
    const token = ++room.aiRunToken;
    room.isAiRunning = true;
    this.clearTurnTimer(room);

    try {
      while (
        token === room.aiRunToken &&
        room.status === 'PLAYING' &&
        !room.isPaused &&
        room.state &&
        room.state.winner === null &&
        room.factionControllers[getActiveFaction(room.state)] === 'AI'
      ) {
        const aiFaction = getActiveFaction(room.state);
        const beforeCounts = this.snapshotNoticeCounts(room.state);
        const dipEvents = runAiDiplomacyTurn(room.state, aiFaction);
        if (dipEvents.length > 0) {
          this.dispatchNewPendingNotices(room, beforeCounts);
          if (room.state.winner !== null) {
            room.accumulatedSeconds = getRoomElapsedSeconds(room);
            room.status = 'FINISHED';
          }
          this.broadcast(room, {
            type: 'game:state_updated',
            state: room.state,
            events: dipEvents,
            elapsedSeconds: getRoomElapsedSeconds(room),
            turnRemainingSeconds: getTurnTimeLimitSeconds(room.config),
            waitingForFactionId: null,
            factionControllers: {...room.factionControllers},
            canUndo: false,
            isAiStep: true,
          });
          if (room.state.winner !== null) break;
        }

        await this.delay(220);
        if (token !== room.aiRunToken || !room.state || room.isPaused) return;
        if (room.factionControllers[aiFaction] !== 'AI') break;

        let safetySteps = 0;
        while (
          token === room.aiRunToken &&
          room.state &&
          !room.isPaused &&
          safetySteps < 28
        ) {
          if (room.factionControllers[aiFaction] !== 'AI') break;
          safetySteps++;
          const step = runSingleAiStep(room.state);
          if (!step.performed) break;
          this.broadcast(room, {
            type: 'game:state_updated',
            state: room.state,
            events: step.events,
            elapsedSeconds: getRoomElapsedSeconds(room),
            turnRemainingSeconds: getTurnTimeLimitSeconds(room.config),
            waitingForFactionId: null,
            factionControllers: {...room.factionControllers},
            canUndo: false,
            isAiStep: true,
          });
          if (room.state.winner !== null) break;
          await this.delay(175);
        }

        if (token !== room.aiRunToken || !room.state || room.isPaused) return;
        if (room.factionControllers[aiFaction] !== 'AI') break;
        if (room.state.winner !== null) {
          room.accumulatedSeconds = getRoomElapsedSeconds(room);
          room.status = 'FINISHED';
          this.broadcast(room, {
            type: 'game:state_updated',
            state: room.state,
            events: [],
            elapsedSeconds: getRoomElapsedSeconds(room),
            turnRemainingSeconds: getTurnTimeLimitSeconds(room.config),
            waitingForFactionId: null,
            factionControllers: {...room.factionControllers},
            canUndo: false,
          });
          break;
        }

        const turnEvents = advanceTurn(room.state);
        if (room.state.winner !== null) {
          room.accumulatedSeconds = getRoomElapsedSeconds(room);
          room.status = 'FINISHED';
        }
        const nextWaiting = getWaitingForFactionId(room);
        if (
          room.status === 'PLAYING' &&
          !room.isPaused &&
          room.state.winner === null &&
          room.factionControllers[getActiveFaction(room.state)] !== 'AI' &&
          nextWaiting === null
        ) {
          this.resetTurnTimer(room);
        }
        this.broadcast(room, {
          type: 'game:state_updated',
          state: room.state,
          events: turnEvents,
          elapsedSeconds: getRoomElapsedSeconds(room),
          turnRemainingSeconds: getTurnRemainingSeconds(room),
          waitingForFactionId: nextWaiting,
          factionControllers: {...room.factionControllers},
          canUndo: false,
        });
        this.clearTurnNoticesForActiveFaction(room);
      }
    } finally {
      if (token === room.aiRunToken) {
        room.isAiRunning = false;
        if (
          room.status === 'PLAYING' &&
          !room.isPaused &&
          room.state &&
          room.state.winner === null
        ) {
          this.resetTurnTimer(room);
        }
      }
    }
  }
}
