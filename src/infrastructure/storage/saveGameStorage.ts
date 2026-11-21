import type {FactionId, GameState} from '@/domain/game/types';

export const MAX_SAVE_SLOTS = 10;
const SAVE_STORAGE_KEY = 'fisle_save_slots_v1';

export interface SaveSlotSummary {
  readonly slot: number;
  readonly savedAt: number;
  readonly label: string;
  readonly turn: number;
  readonly elapsedSeconds: number;
  readonly factionCount: number;
  readonly humanCount: number;
  readonly viewerFactionId: FactionId;
  readonly wasOnline: boolean;
}

export interface SaveSlotRecord extends SaveSlotSummary {
  readonly state: GameState;
}

type StoredSlotMap = Record<string, SaveSlotRecord>;

function readAllRaw(): StoredSlotMap {
  try {
    const raw = window.localStorage.getItem(SAVE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as StoredSlotMap;
  } catch {
    return {};
  }
}

function writeAllRaw(map: StoredSlotMap): void {
  window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(map));
}

function normalizeLoadedState(state: GameState): GameState {
  return {
    ...state,
    flares: Array.isArray(state.flares) ? state.flares : [],
    nextFlareId: state.nextFlareId ?? 1,
    regenerators: Array.isArray(state.regenerators) ? state.regenerators : [],
    nextRegeneratorId: state.nextRegeneratorId ?? 1,
    victoryReason: state.victoryReason ?? null,
  };
}

/**
 * Lists all 10 save slots (index 1..10), returning null for empty slots.
 */
export function listSaveSlots(): Array<SaveSlotSummary | null> {
  const map = readAllRaw();
  const result: Array<SaveSlotSummary | null> = [];
  for (let slot = 1; slot <= MAX_SAVE_SLOTS; slot++) {
    const rec = map[String(slot)];
    if (rec && rec.state && typeof rec.turn === 'number') {
      result.push({
        slot,
        savedAt: rec.savedAt,
        label: rec.label,
        turn: rec.turn,
        elapsedSeconds: rec.elapsedSeconds ?? 0,
        factionCount: rec.factionCount ?? rec.state.turnOrder.length,
        humanCount: rec.humanCount ?? 1,
        viewerFactionId: rec.viewerFactionId,
        wasOnline: Boolean(rec.wasOnline),
      });
    } else {
      result.push(null);
    }
  }
  return result;
}

export function countUsedSaveSlots(): number {
  return listSaveSlots().filter(Boolean).length;
}

export function saveGameToSlot(
  slot: number,
  payload: {
    label: string;
    state: GameState;
    elapsedSeconds: number;
    viewerFactionId: FactionId;
    wasOnline: boolean;
  },
): SaveSlotSummary {
  const clampedSlot = Math.max(1, Math.min(MAX_SAVE_SLOTS, Math.floor(slot)));
  const clonedState = normalizeLoadedState(
    JSON.parse(JSON.stringify(payload.state)) as GameState,
  );
  const humanCount = clonedState.turnOrder.filter(
    (fId) => clonedState.factions[fId]?.isHuman,
  ).length;

  const record: SaveSlotRecord = {
    slot: clampedSlot,
    savedAt: Date.now(),
    label: payload.label.trim().slice(0, 32) || `Слот ${clampedSlot}`,
    turn: clonedState.turn,
    elapsedSeconds: Math.max(0, Math.floor(payload.elapsedSeconds)),
    factionCount: clonedState.turnOrder.length,
    humanCount: Math.max(1, humanCount),
    viewerFactionId: payload.viewerFactionId,
    wasOnline: payload.wasOnline,
    state: clonedState,
  };

  const map = readAllRaw();
  map[String(clampedSlot)] = record;
  writeAllRaw(map);

  return {
    slot: record.slot,
    savedAt: record.savedAt,
    label: record.label,
    turn: record.turn,
    elapsedSeconds: record.elapsedSeconds,
    factionCount: record.factionCount,
    humanCount: record.humanCount,
    viewerFactionId: record.viewerFactionId,
    wasOnline: record.wasOnline,
  };
}

export function loadGameFromSlot(slot: number): SaveSlotRecord | null {
  const map = readAllRaw();
  const rec = map[String(slot)];
  if (!rec || !rec.state) return null;
  return {
    ...rec,
    state: normalizeLoadedState(
      JSON.parse(JSON.stringify(rec.state)) as GameState,
    ),
  };
}

export function deleteSaveSlot(slot: number): void {
  const map = readAllRaw();
  delete map[String(slot)];
  writeAllRaw(map);
}
