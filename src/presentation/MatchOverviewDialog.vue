<script setup lang="ts">
import {computed} from 'vue';
import {
  Bot,
  Clock,
  Crown,
  Globe,
  Hourglass,
  Laptop,
  Timer,
  Users,
} from 'lucide-vue-next';
import {FactionId} from '@/domain/game/types';
import {FACTION_PALETTES} from '@/domain/game/rules';
import {useGameStore} from '@/application/stores/useGameStore';
import ModalDialog from '@/components/ui/dialog/ModalDialog.vue';

const store = useGameStore();

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const matchTimeFormatted = computed(() => formatClock(store.elapsedSeconds));

const turnTimeFormatted = computed(() =>
  formatClock(store.turnRemainingSeconds),
);

const totalLandHexes = computed(() => {
  void store.boardVersion;
  return Math.max(1, Object.keys(store.gameState.cells).length);
});

const neutralHexCount = computed(() => {
  void store.boardVersion;
  let count = 0;
  for (const cell of Object.values(store.gameState.cells)) {
    if (cell.faction === FactionId.NEUTRAL) count++;
  }
  return count;
});

interface FactionRow {
  readonly factionId: FactionId;
  readonly name: string;
  readonly colorHex: string;
  readonly hexCount: number;
  readonly sharePct: number;
  readonly isActiveTurn: boolean;
  readonly isEliminated: boolean;
  readonly isLocal: boolean;
  readonly isHostSlot: boolean;
  readonly onlinePresence: boolean | null;
  readonly roleLabel: string;
  readonly roleKind: 'self' | 'hotseat' | 'online' | 'waiting' | 'ai' | 'dead';
}

const factionRows = computed<FactionRow[]>(() => {
  void store.boardVersion;
  const total = totalLandHexes.value;
  const localSet = new Set(store.localControlledFactions);

  return store.gameState.turnOrder.map((factionId) => {
    const info = store.gameState.factions[factionId];
    const palette = FACTION_PALETTES[factionId];
    const hexCount = info?.hexCount ?? 0;
    const sharePct = Math.round((hexCount / total) * 100);
    const isActiveTurn =
      store.gameState.winner === null && store.activeFactionId === factionId;
    const isEliminated = Boolean(info?.isEliminated);
    const slot = store.onlinePresenceByFaction[factionId] ?? null;

    let roleLabel = 'ИИ';
    let roleKind: FactionRow['roleKind'] = 'ai';
    let onlinePresence: boolean | null = null;
    let isLocal = false;
    let isHostSlot = false;

    if (isEliminated) {
      roleLabel = 'Выбыл';
      roleKind = 'dead';
    } else if (store.isOnlineMode) {
      const controller = store.factionControllers[factionId];
      if (slot) {
        onlinePresence = slot.online;
        isHostSlot = slot.isHost;
        if (slot.playerId === store.localPlayerId) {
          isLocal = true;
          roleLabel = 'Вы';
          roleKind = 'self';
        } else {
          roleLabel = slot.online ? 'Онлайн' : 'Офлайн';
          roleKind = 'online';
        }
      } else if (controller === 'HOTSEAT') {
        isLocal = localSet.has(factionId);
        roleLabel = isLocal ? 'Хотсит (Вы)' : 'Хотсит';
        roleKind = 'hotseat';
      } else if (controller === 'ONLINE') {
        roleLabel = 'Ожидание';
        roleKind = 'waiting';
      } else {
        roleLabel = 'ИИ';
        roleKind = 'ai';
      }
    } else if (info?.isHuman) {
      isLocal = true;
      roleLabel = store.gameState.config.humanCount > 1 ? 'Хотсит' : 'Игрок';
      roleKind = store.gameState.config.humanCount > 1 ? 'hotseat' : 'self';
    } else {
      roleLabel = 'ИИ';
      roleKind = 'ai';
    }

    return {
      factionId,
      name: slot?.nickname ?? info?.name ?? palette.name,
      colorHex: palette.tileHex,
      hexCount,
      sharePct,
      isActiveTurn,
      isEliminated,
      isLocal,
      isHostSlot,
      onlinePresence,
      roleLabel,
      roleKind,
    };
  });
});

const territorySegments = computed(() => {
  const total = totalLandHexes.value;
  const segs = factionRows.value
    .filter((row) => row.hexCount > 0)
    .map((row) => ({
      key: `f-${row.factionId}`,
      label: row.name,
      colorHex: row.colorHex,
      hexCount: row.hexCount,
      widthPct: (row.hexCount / total) * 100,
      sharePct: row.sharePct,
    }));

  if (neutralHexCount.value > 0) {
    segs.push({
      key: 'neutral',
      label: 'Нейтральные',
      colorHex: '#64748b',
      hexCount: neutralHexCount.value,
      widthPct: (neutralHexCount.value / total) * 100,
      sharePct: Math.round((neutralHexCount.value / total) * 100),
    });
  }
  return segs;
});
</script>

<template>
  <ModalDialog
    :open="store.showMatchOverviewDialog"
    title="Партия и игроки"
    content-class="w-[min(94vw,460px)] max-h-[86vh] overflow-y-auto"
    @update:open="(val) => (store.showMatchOverviewDialog = val)"
  >
    <div class="space-y-4">
      <!-- Top Metrics: Turn, Duration, Turn Timer -->
      <div class="grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
        <div
          class="flex flex-col gap-0.5 rounded-lg border border-border bg-secondary/35 px-3 py-2"
        >
          <span class="font-sans text-[11px] text-muted-foreground">Ход</span>
          <span class="text-sm font-bold text-foreground">
            {{ store.gameState.turn }}
          </span>
        </div>

        <div
          class="flex flex-col gap-0.5 rounded-lg border border-border bg-secondary/35 px-3 py-2"
        >
          <span
            class="inline-flex items-center gap-1 font-sans text-[11px] text-muted-foreground"
          >
            <Clock class="size-3" />
            Длительность
          </span>
          <span class="text-sm font-bold text-foreground">
            {{ matchTimeFormatted }}
          </span>
        </div>

        <div
          class="flex flex-col gap-0.5 rounded-lg border border-border bg-secondary/35 px-3 py-2"
        >
          <span
            class="inline-flex items-center gap-1 font-sans text-[11px] text-muted-foreground"
          >
            <Timer class="size-3" />
            На ход
          </span>
          <span
            class="text-sm font-bold"
            :class="
              store.turnTimeLimitSeconds <= 0
                ? 'text-foreground'
                : store.turnRemainingSeconds <= 30
                  ? 'text-rose-400'
                  : store.turnRemainingSeconds <= 120
                    ? 'text-amber-300'
                    : 'text-foreground'
            "
          >
            {{
              store.waitingForFactionId !== null
                ? 'Пауза'
                : store.turnTimeLimitSeconds <= 0
                  ? '∞'
                  : turnTimeFormatted
            }}
          </span>
        </div>
      </div>

      <!-- Territory Ownership Stacked Progress Bar -->
      <div
        class="space-y-2 rounded-lg border border-border bg-secondary/30 p-3"
      >
        <div class="flex items-center justify-between text-xs">
          <span class="font-medium text-foreground">Территория</span>
          <span class="font-mono text-[11px] text-muted-foreground tabular-nums">
            {{ totalLandHexes }} гексов
          </span>
        </div>

        <div
          class="flex h-3.5 w-full overflow-hidden rounded-md bg-background/80 ring-1 ring-border"
        >
          <div
            v-for="seg in territorySegments"
            :key="seg.key"
            class="h-full transition-all duration-300"
            :style="{
              width: `${seg.widthPct}%`,
              backgroundColor: seg.colorHex,
            }"
            :title="`${seg.label}: ${seg.hexCount} (${seg.sharePct}%)`"
          />
        </div>

        <div class="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <div
            v-for="seg in territorySegments"
            :key="`leg-${seg.key}`"
            class="inline-flex items-center gap-1 text-muted-foreground"
          >
            <span
              class="inline-block size-2 rounded-xs shrink-0"
              :style="{backgroundColor: seg.colorHex}"
            />
            <span class="font-mono font-semibold tabular-nums text-foreground">
              {{ seg.sharePct }}%
            </span>
          </div>
        </div>
      </div>

      <!-- Players / Factions List -->
      <div class="space-y-1.5">
        <div
          class="flex items-center justify-between text-xs text-muted-foreground px-0.5"
        >
          <span class="inline-flex items-center gap-1.5 font-medium">
            <Users class="size-3.5 text-primary" />
            Участники
          </span>
          <span v-if="store.isOnlineMode && store.roomCode" class="font-mono">
            {{ store.roomCode }}
          </span>
        </div>

        <div
          v-for="row in factionRows"
          :key="row.factionId"
          class="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-colors"
          :class="
            row.isActiveTurn
              ? 'border-primary/60 bg-primary/10'
              : row.isEliminated
                ? 'border-border/50 bg-secondary/15 opacity-55'
                : 'border-border bg-secondary/35'
          "
        >
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="inline-block size-3 shrink-0 rounded-xs border border-white/25"
              :style="{backgroundColor: row.colorHex}"
            />

            <span
              v-if="row.onlinePresence !== null"
              class="inline-block size-2 shrink-0 rounded-full"
              :class="row.onlinePresence ? 'bg-emerald-400' : 'bg-zinc-500'"
              :title="row.onlinePresence ? 'В сети' : 'Офлайн'"
            />

            <span class="font-semibold text-foreground truncate">
              {{ row.name }}
            </span>

            <Crown
              v-if="row.isHostSlot"
              class="size-3.5 shrink-0 text-amber-400"
              title="Хост"
            />

            <span
              v-if="row.isActiveTurn"
              class="inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground shrink-0"
            >
              Ходит
            </span>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <span
              class="inline-flex items-center gap-1 rounded border border-border/80 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium"
              :class="
                row.roleKind === 'self'
                  ? 'text-primary border-primary/40'
                  : row.roleKind === 'online'
                    ? 'text-emerald-400 border-emerald-500/30'
                    : row.roleKind === 'waiting'
                      ? 'text-amber-300 border-amber-500/35'
                      : 'text-muted-foreground'
              "
            >
              <Globe v-if="row.roleKind === 'online'" class="size-2.5" />
              <Hourglass
                v-else-if="row.roleKind === 'waiting'"
                class="size-2.5"
              />
              <Laptop v-else-if="row.roleKind === 'hotseat'" class="size-2.5" />
              <Bot v-else-if="row.roleKind === 'ai'" class="size-2.5" />
              {{ row.roleLabel }}
            </span>

            <span
              class="min-w-[54px] text-right font-mono text-[11px] font-semibold tabular-nums text-foreground"
            >
              {{ row.hexCount }}
              <span class="text-muted-foreground font-normal">
                ({{ row.sharePct }}%)
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  </ModalDialog>
</template>
