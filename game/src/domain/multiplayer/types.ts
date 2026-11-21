import type {HexKey} from '@/domain/hex/hexCoordinates';
import type {
  ExchangeOffer,
  FactionId,
  GameConfig,
  GameEvent,
  GameState,
  PurchasableEntity,
} from '@/domain/game/types';

export type RoomStatus = 'WAITING' | 'PLAYING' | 'FINISHED';

export type FactionController = 'AI' | 'HOTSEAT' | 'ONLINE';

export interface OnlinePlayerSlot {
  readonly playerId: string;
  readonly nickname: string;
  readonly factionId: FactionId;
  readonly isHost: boolean;
  readonly online: boolean;
  readonly left?: boolean;
}

export interface ChatMessage {
  readonly id: string;
  readonly playerId: string;
  readonly factionId: FactionId;
  readonly nickname: string;
  readonly text: string;
  readonly timestamp: number;
  readonly turn: number;
}

export type NotificationCategory =
  | 'WAR'
  | 'FRIEND'
  | 'NEUTRAL'
  | 'BLACK_MARK'
  | 'EXCHANGE'
  | 'MESSAGE'
  | 'REJECTED'
  | 'CHAT'
  | 'SYSTEM';

export type NotificationActionKind =
  | 'DIPLOMACY_RESPONSE'
  | 'OPEN_CHAT'
  | 'OPEN_DIPLOMACY';

export interface GameNotification {
  readonly id: string;
  readonly category: NotificationCategory;
  readonly fromFaction?: FactionId;
  readonly fromName?: string;
  readonly text: string;
  readonly turn: number;
  readonly timestamp: number;
  readonly messageId?: number;
  readonly actionKind?: NotificationActionKind;
  read: boolean;
}

export interface RoomPreview {
  readonly code: string;
  readonly name: string;
  readonly status: RoomStatus;
  readonly hasPassword: boolean;
  readonly config: GameConfig;
  readonly players: OnlinePlayerSlot[];
  readonly allowedFactions: FactionId[];
  readonly takenFactions: FactionId[];
  readonly openOnlineFactions: FactionId[];
  readonly aiFactions: FactionId[];
  readonly slotsTotal: number;
  readonly slotsFilled: number;
}

export interface RoomSnapshot {
  readonly code: string;
  readonly name: string;
  readonly status: RoomStatus;
  readonly hasPassword: boolean;
  readonly config: GameConfig;
  readonly players: OnlinePlayerSlot[];
  readonly factionControllers: Record<number, FactionController>;
  readonly waitingForFactionId: FactionId | null;
  readonly chat: ChatMessage[];
  readonly state: GameState | null;
  readonly elapsedSeconds: number;
  readonly turnRemainingSeconds: number;
  readonly canUndo: boolean;
  readonly isPaused?: boolean;
  readonly pausedByNickname?: string | null;
}

export interface OnlineSessionCredentials {
  readonly roomCode: string;
  readonly roomName?: string;
  readonly playerId: string;
  readonly nickname: string;
  readonly factionId: FactionId;
  readonly autoSaveSlot?: number | null;
}

export interface RoomHistoryEntry {
  readonly code: string;
  readonly name: string;
  readonly status: RoomStatus;
  readonly turn: number;
  readonly factionId: FactionId;
  readonly nickname: string;
  readonly isHost: boolean;
  readonly isCreator: boolean;
  readonly isPaused: boolean;
  readonly onlineCount: number;
  readonly totalPlayers: number;
  readonly lastActivityAt: number;
  readonly canRejoin: boolean;
}

export interface RoomHistoryResponse {
  readonly rooms: RoomHistoryEntry[];
  readonly createdCount: number;
  readonly maxCreatedRooms: number;
}

export interface ServerStatusSummary {
  readonly onlineUsers: number;
  readonly activeRooms: number;
  readonly freeRooms: number;
  readonly maxRooms: number;
}

export type GameActionPayload =
  | {readonly kind: 'MOVE_UNIT'; readonly fromKey: HexKey; readonly toKey: HexKey}
  | {
      readonly kind: 'BUY_PLACE';
      readonly provinceId: string;
      readonly entity: PurchasableEntity;
      readonly targetKey: HexKey;
    }
  | {
      readonly kind: 'CATAPULT_FIRE';
      readonly catapultKey: HexKey;
      readonly targetKey: HexKey;
    }
  | {
      readonly kind: 'DEMOLISH';
      readonly provinceId: string;
      readonly targetKey: HexKey;
    }
  | {
      readonly kind: 'LAUNCH_FLARE';
      readonly provinceId: string;
      readonly targetKey: HexKey;
    }
  | {
      readonly kind: 'PLACE_REGENERATOR';
      readonly provinceId: string;
      readonly targetKey: HexKey;
    }
  | {readonly kind: 'UNDO'}
  | {readonly kind: 'END_TURN'};

export type DiplomacyActionPayload =
  | {readonly kind: 'DECLARE_WAR'; readonly target: FactionId}
  | {
      readonly kind: 'PROPOSE_PEACE';
      readonly target: FactionId;
      readonly goldOffer: number;
      readonly provinceId?: string;
    }
  | {
      readonly kind: 'PROPOSE_EXCHANGE';
      readonly target: FactionId;
      readonly offer: ExchangeOffer;
      readonly provinceId?: string;
    }
  | {
      readonly kind: 'ISSUE_BLACK_MARK';
      readonly target: FactionId;
      readonly provinceId?: string;
    }
  | {
      readonly kind: 'SEND_GOLD';
      readonly provinceId: string;
      readonly target: FactionId;
      readonly amount: number;
      readonly note?: string;
    }
  | {
      readonly kind: 'SEND_NOTE';
      readonly target: FactionId;
      readonly text: string;
    }
  | {
      readonly kind: 'RESPOND_MESSAGE';
      readonly messageId: number;
      readonly accept: boolean;
    }
  | {
      readonly kind: 'CANCEL_SUBSIDY';
      readonly subsidyId: number;
    }
  | {
      readonly kind: 'SURRENDER';
    };

export type ClientWsMessage =
  | {
      readonly type: 'room:create';
      readonly config: GameConfig;
      readonly nickname: string;
      readonly factionId: FactionId;
      readonly password?: string;
    }
  | {
      readonly type: 'room:host_existing';
      readonly state: GameState;
      readonly elapsedSeconds: number;
      readonly nickname: string;
      readonly primaryFactionId: FactionId;
      readonly factionControllers: Record<number, FactionController>;
      readonly password?: string;
    }
  | {
      readonly type: 'room:join';
      readonly code: string;
      readonly nickname: string;
      readonly factionId: FactionId;
      readonly password?: string;
    }
  | {
      readonly type: 'room:reconnect';
      readonly code: string;
      readonly playerId: string;
    }
  | {
      readonly type: 'room:rejoin';
      readonly code: string;
    }
  | {
      readonly type: 'room:kick_player';
      readonly targetPlayerId: string;
    }
  | {
      readonly type: 'room:reassign_faction';
      readonly factionId: FactionId;
      readonly controller: FactionController;
    }
  | {readonly type: 'room:set_paused'; readonly paused: boolean}
  | {readonly type: 'room:disband'}
  | {readonly type: 'room:leave'}
  | {readonly type: 'game:action'; readonly action: GameActionPayload}
  | {readonly type: 'diplomacy:action'; readonly action: DiplomacyActionPayload}
  | {readonly type: 'chat:send'; readonly text: string}
  | {readonly type: 'ping'};

export type ServerWsMessage =
  | {
      readonly type: 'room:joined';
      readonly credentials: OnlineSessionCredentials;
      readonly snapshot: RoomSnapshot;
    }
  | {
      readonly type: 'room:sync';
      readonly snapshot: RoomSnapshot;
    }
  | {
      readonly type: 'room:started';
      readonly snapshot: RoomSnapshot;
    }
  | {
      readonly type: 'room:presence';
      readonly players: OnlinePlayerSlot[];
      readonly factionControllers?: Record<number, FactionController>;
      readonly waitingForFactionId?: FactionId | null;
      readonly isPaused?: boolean;
      readonly pausedByNickname?: string | null;
    }
  | {
      readonly type: 'room:left';
      readonly reason?: string;
    }
  | {
      readonly type: 'game:state_updated';
      readonly state: GameState;
      readonly events: GameEvent[];
      readonly elapsedSeconds: number;
      readonly turnRemainingSeconds: number;
      readonly waitingForFactionId?: FactionId | null;
      readonly factionControllers?: Record<number, FactionController>;
      readonly canUndo: boolean;
      readonly isAiStep?: boolean;
    }
  | {
      readonly type: 'chat:message';
      readonly message: ChatMessage;
    }
  | {
      readonly type: 'notification:new';
      readonly notification: GameNotification;
    }
  | {
      readonly type: 'error';
      readonly code: string;
      readonly message: string;
    }
  | {readonly type: 'pong'};
