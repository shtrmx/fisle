import type {HexKey} from '@/domain/hex/hexCoordinates';

export enum FactionId {
  NEUTRAL = 0,
  EMERALD = 1,
  CRIMSON = 2,
  COBALT = 3,
  AMBER = 4,
  VIOLET = 5,
  TEAL = 6,
}

export enum EntityType {
  NONE = 'NONE',
  PINE = 'PINE',
  PALM = 'PALM',
  GRAVE = 'GRAVE',
  TOWN = 'TOWN',
  FARM = 'FARM',
  TRADING_POST = 'TRADING_POST',
  TOWER = 'TOWER',
  STRONG_TOWER = 'STRONG_TOWER',
  BEACON = 'BEACON',
  PEASANT = 'PEASANT',
  SPEARMAN = 'SPEARMAN',
  BARON = 'BARON',
  KNIGHT = 'KNIGHT',
  CATAPULT = 'CATAPULT',
}

export enum AiDifficulty {
  EASY = 'EASY',
  BALANCED = 'BALANCED',
  HARD = 'HARD',
}

export enum MapSize {
  SMALL = 'SMALL',
  MEDIUM = 'MEDIUM',
  LARGE = 'LARGE',
  GIANT = 'GIANT',
}

export enum ScenarioId {
  RANDOM = 'RANDOM',
  ARCHIPELAGO = 'ARCHIPELAGO',
  TWIN_CONTINENTS = 'TWIN_CONTINENTS',
  CITADEL_RING = 'CITADEL_RING',
}

export enum GameMode {
  SKIRMISH = 'SKIRMISH',
  HOTSEAT = 'HOTSEAT',
}

export enum TreeSpawnRate {
  NONE = 'NONE',
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
}

export enum DiplomaticRelation {
  NEUTRAL = 'NEUTRAL',
  FRIEND = 'FRIEND',
  WAR = 'WAR',
}

export enum DiplomaticMessageType {
  PEACE_OFFER = 'PEACE_OFFER',
  WAR_DECLARED = 'WAR_DECLARED',
  TRADE_GOLD = 'TRADE_GOLD',
  EXCHANGE_OFFER = 'EXCHANGE_OFFER',
  BLACK_MARK = 'BLACK_MARK',
  NOTE = 'NOTE',
}

export enum ExchangeItemType {
  NOTHING = 'NOTHING',
  MONEY = 'MONEY',
  LAND = 'LAND',
  FRIENDSHIP = 'FRIENDSHIP',
  DECLARE_WAR = 'DECLARE_WAR',
  END_WAR = 'END_WAR',
  REMOVE_BLACK_MARK = 'REMOVE_BLACK_MARK',
  SUBSIDY = 'SUBSIDY',
}

export enum DiplomaticMessageStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  INFO = 'INFO',
}

export enum CameraMode {
  AUTO = 'AUTO',
  TOP_2D = 'TOP_2D',
  ORTHO_3D = 'ORTHO_3D',
}

export enum GameEventType {
  UNIT_MOVED = 'UNIT_MOVED',
  UNIT_MERGED = 'UNIT_MERGED',
  UNIT_BOUGHT = 'UNIT_BOUGHT',
  BUILDING_BUILT = 'BUILDING_BUILT',
  BUILDING_DEMOLISHED = 'BUILDING_DEMOLISHED',
  CATAPULT_FIRED = 'CATAPULT_FIRED',
  FLARE_LAUNCHED = 'FLARE_LAUNCHED',
  REGENERATOR_PLACED = 'REGENERATOR_PLACED',
  HEX_CAPTURED = 'HEX_CAPTURED',
  TREE_CHOPPED = 'TREE_CHOPPED',
  TREE_GROWN = 'TREE_GROWN',
  PROVINCE_BANKRUPT = 'PROVINCE_BANKRUPT',
  DIPLOMACY_UPDATED = 'DIPLOMACY_UPDATED',
  TURN_CHANGED = 'TURN_CHANGED',
  GAME_WON = 'GAME_WON',
}

export type VictoryReason = 'DOMINATION' | 'DIPLOMACY';

export type PurchasableEntity =
  | EntityType.PEASANT
  | EntityType.SPEARMAN
  | EntityType.BARON
  | EntityType.KNIGHT
  | EntityType.CATAPULT
  | EntityType.FARM
  | EntityType.TRADING_POST
  | EntityType.TOWER
  | EntityType.STRONG_TOWER
  | EntityType.BEACON;

export type ActiveToolType =
  | PurchasableEntity
  | 'DEMOLISH'
  | 'FLARE'
  | 'REGENERATOR';

export interface HexCell {
  key: HexKey;
  q: number;
  r: number;
  faction: FactionId;
  entity: EntityType;
  unitMoved: boolean;
  provinceId: string | null;
  elevation: number;
  isCoastal: boolean;
}

export interface Province {
  id: string;
  faction: FactionId;
  hexKeys: HexKey[];
  townKey: HexKey;
  money: number;
  income: number;
  upkeep: number;
  netIncome: number;
  farmCount: number;
  tradingPostCount?: number;
}

export interface FactionInfo {
  id: FactionId;
  name: string;
  isHuman: boolean;
  isEliminated: boolean;
  hexCount: number;
  totalMoney: number;
  totalNetIncome: number;
}

export interface ExchangeSideOffer {
  type: ExchangeItemType;
  amount: number;
  duration?: number;
  hexKeys?: HexKey[];
  warTargetFaction?: FactionId;
}

export interface ExchangeOffer {
  proposerGives: ExchangeSideOffer;
  targetGives: ExchangeSideOffer;
}

export interface DiplomaticSubsidy {
  id: number;
  fromFaction: FactionId;
  toFaction: FactionId;
  amountPerTurn: number;
  turnsRemaining: number;
}

export interface BlackMarkPair {
  issuer: FactionId;
  target: FactionId;
  turnsRemaining: number;
}

export interface DiplomaticNotice {
  id: number;
  turn: number;
  fromFaction: FactionId;
  toFaction: FactionId;
  category:
    | 'WAR'
    | 'FRIEND'
    | 'NEUTRAL'
    | 'BLACK_MARK'
    | 'EXCHANGE'
    | 'MESSAGE'
    | 'REJECTED';
  text: string;
  messageId?: number;
}

export interface DiplomaticMessage {
  id: number;
  turn: number;
  fromFaction: FactionId;
  toFaction: FactionId;
  type: DiplomaticMessageType;
  status: DiplomaticMessageStatus;
  text: string;
  goldAmount?: number;
  targetHexKey?: HexKey;
  exchangeOffer?: ExchangeOffer;
}

export interface DiplomaticPairMemory {
  pastFriendshipTurns: number;
  friendshipsCompleted: number;
  warsFought: number;
  lastWarEndedTurn: number;
  dealsAccepted: number;
}

export interface DiplomaticTrustRecord {
  betrayals: number;
  subsidiesBroken: number;
  rejectedDeals: number;
  giftsGiven: number;
}

export interface DiplomacyState {
  relations: Record<string, DiplomaticRelation>;
  friendshipTurns: Record<string, number>; // RelationKey -> remaining turns of friendship
  blackMarks: Record<number, number>; // FactionId -> max turns remaining
  blackMarkPairs: BlackMarkPair[]; // Pairwise black-mark prohibitions
  subsidies: DiplomaticSubsidy[];
  messages: DiplomaticMessage[];
  pendingNotices: Record<number, DiplomaticNotice[]>; // FactionId -> unread notices shown at turn start
  pairMemory?: Record<string, DiplomaticPairMemory>; // RelationKey -> symmetric relationship history
  trustLog?: Record<string, DiplomaticTrustRecord>; // `${actor}->${target}` -> directional trust memory
  nextMessageId: number;
  nextSubsidyId: number;
  nextNoticeId: number;
}

export interface ActiveFlare {
  id: number;
  faction: FactionId;
  centerKey: HexKey;
  radius: number;
  turnsRemaining: number;
}

export interface ActiveRegenerator {
  id: number;
  faction: FactionId;
  centerKey: HexKey;
  radius: number;
  turnsRemaining: number;
}

export interface TradingPostCluster {
  id: number;
  faction: FactionId;
  anchorKey: HexKey;
  hexKeys: [HexKey, HexKey, HexKey];
}

export interface GameConfig {
  mode: GameMode;
  scenario: ScenarioId;
  mapSize: MapSize;
  factionCount: number;
  humanCount: number;
  difficulty: AiDifficulty;
  treeSpawnRate: TreeSpawnRate;
  riversAndLakes: boolean;
  diplomacyEnabled: boolean;
  fogOfWar: boolean;
  turnTimeLimitSeconds?: number;
  seed: number;
}

export interface GameStats {
  turnsPlayed: number;
  hexesCaptured: number;
  unitsRecruited: number;
  farmsBuilt: number;
  treesChopped: number;
  catapultShots: number;
  buildingsDemolished: number;
}

export interface GameEvent {
  id: number;
  type: GameEventType;
  faction: FactionId;
  fromKey?: HexKey;
  toKey?: HexKey;
  entity?: EntityType;
  amount?: number;
  path?: HexKey[];
  note?: string;
}

export interface GameState {
  config: GameConfig;
  turn: number;
  activeFactionIndex: number;
  turnOrder: FactionId[];
  factions: Record<number, FactionInfo>;
  cells: Record<HexKey, HexCell>;
  provinces: Record<string, Province>;
  diplomacy: DiplomacyState;
  incomeHistory: Record<number, number[]>;
  flares: ActiveFlare[];
  nextFlareId: number;
  regenerators: ActiveRegenerator[];
  nextRegeneratorId: number;
  tradingPosts?: TradingPostCluster[];
  nextTradingPostId?: number;
  winner: FactionId | null;
  victoryReason?: VictoryReason | null;
  stats: GameStats;
  nextEventId: number;
  prngState: number;
}
