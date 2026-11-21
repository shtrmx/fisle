<script setup lang="ts">
import {watch} from 'vue';
import {
  Clock,
  Crown,
  History,
  LogIn,
  Pause,
  RefreshCw,
  Users,
} from 'lucide-vue-next';
import {FACTION_PALETTES} from '@/domain/game/rules';
import type {RoomHistoryEntry} from '@/domain/multiplayer/types';
import {useGameStore} from '@/application/stores/useGameStore';
import ModalDialog from '@/components/ui/dialog/ModalDialog.vue';
import {Button} from '@/components/ui/button';

const store = useGameStore();

watch(
  () => store.showHistoryDialog,
  (isOpen) => {
    if (isOpen) {
      void store.refreshRoomHistory();
    }
  },
);

function statusBadge(item: RoomHistoryEntry): {
  label: string;
  className: string;
} {
  if (item.status === 'FINISHED') {
    return {
      label: 'Завершена',
      className: 'border-border bg-muted text-muted-foreground',
    };
  }
  if (item.isPaused) {
    return {
      label: 'Пауза',
      className: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
    };
  }
  if (item.status === 'PLAYING') {
    return {
      label: `Ход ${item.turn}`,
      className: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
    };
  }
  return {
    label: 'Лобби',
    className: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
  };
}

function formatRelativeTime(timestampMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return 'только что';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  return `${hours} ч назад`;
}
</script>

<template>
  <ModalDialog
    :open="store.showHistoryDialog"
    title="История партий"
    content-class="w-[min(95vw,520px)] max-h-[86vh] overflow-y-auto"
    @update:open="(val) => (store.showHistoryDialog = val)"
  >
    <div class="space-y-3">
      <!-- Quota & Refresh Bar -->
      <div
        class="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs"
      >
        <div class="flex items-center gap-2 text-muted-foreground min-w-0">
          <History class="size-3.5 shrink-0 text-primary" />
          <span class="truncate">
            Создано комнат:
            <strong class="font-mono text-foreground tabular-nums">
              {{ store.roomHistoryCreatedCount }}/{{
                store.roomHistoryMaxCreated
              }}
            </strong>
          </span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          class="h-7 gap-1.5 px-2 text-xs"
          :disabled="store.roomHistoryLoading"
          @click="store.refreshRoomHistory()"
        >
          <RefreshCw
            class="size-3.5"
            :class="store.roomHistoryLoading ? 'animate-spin' : ''"
          />
          <span>Обновить</span>
        </Button>
      </div>

      <div
        v-if="store.roomHistoryError"
        class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
      >
        {{ store.roomHistoryError }}
      </div>

      <!-- Loading State -->
      <div
        v-if="store.roomHistoryLoading && store.roomHistory.length === 0"
        class="py-8 text-center text-xs text-muted-foreground"
      >
        Загрузка активных партий...
      </div>

      <!-- Empty State -->
      <div
        v-else-if="store.roomHistory.length === 0"
        class="rounded-lg border border-dashed border-border bg-secondary/20 px-4 py-8 text-center space-y-1.5"
      >
        <p class="text-sm font-medium text-foreground">Активных партий нет</p>
        <p class="text-xs text-muted-foreground">
          Созданные и сыгранные онлайн-комнаты сохраняются здесь, пока в них есть активность или не прошёл 1 час после выхода всех игроков.
        </p>
      </div>

      <!-- Active Matches List -->
      <div v-else class="space-y-2 max-h-[54vh] overflow-y-auto pr-0.5">
        <div
          v-for="item in store.roomHistory"
          :key="item.code"
          class="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/45 px-3.5 py-2.5"
        >
          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-display text-sm font-bold text-foreground truncate">
                {{ item.name || item.code }}
              </span>
              <code
                class="rounded border border-border/80 bg-background/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-widest text-muted-foreground"
              >
                {{ item.code }}
              </code>
              <span
                class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold"
                :class="statusBadge(item).className"
              >
                <Pause v-if="item.isPaused" class="size-2.5" />
                {{ statusBadge(item).label }}
              </span>
              <span
                v-if="item.isCreator"
                class="inline-flex items-center gap-1 rounded-md border border-primary/35 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                title="Создана вами"
              >
                <Crown class="size-2.5" />
                Моя
              </span>
            </div>

            <div
              class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
            >
              <span
                class="inline-flex items-center gap-1.5 text-foreground/90"
              >
                <span
                  class="inline-block size-2.5 rounded-xs border border-white/25"
                  :style="{
                    backgroundColor:
                      FACTION_PALETTES[item.factionId]?.tileHex ?? '#94a3b8',
                  }"
                />
                <span class="truncate max-w-[120px]">
                  {{ item.nickname || FACTION_PALETTES[item.factionId]?.name }}
                </span>
              </span>

              <span class="inline-flex items-center gap-1 tabular-nums">
                <Users class="size-3" />
                {{ item.onlineCount }}/{{ item.totalPlayers }} в сети
              </span>

              <span class="inline-flex items-center gap-1">
                <Clock class="size-3" />
                {{ formatRelativeTime(item.lastActivityAt) }}
              </span>
            </div>
          </div>

          <Button
            variant="default"
            size="sm"
            class="h-8 shrink-0 gap-1.5 px-3 text-xs font-semibold"
            :disabled="!item.canRejoin || store.onlineBusy"
            @click="store.rejoinRoomFromHistory(item.code)"
          >
            <LogIn class="size-3.5" />
            <span>Вернуться</span>
          </Button>
        </div>
      </div>

      <p class="text-[11px] leading-snug text-muted-foreground">
        Пустые комнаты автоматически удаляются через 1 час бездействия. Максимум {{ store.roomHistoryMaxCreated }} активные созданные комнаты на игрока.
      </p>
    </div>
  </ModalDialog>
</template>
