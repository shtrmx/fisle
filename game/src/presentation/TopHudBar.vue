<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';
import {
  Bell,
  Clock,
  Coins,
  Handshake,
  Hourglass,
  Keyboard,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pause,
  Timer,
  TrendingDown,
  TrendingUp,
} from 'lucide-vue-next';
import {useGameStore} from '@/application/stores/useGameStore';
import {Button} from '@/components/ui/button';
import Separator from '@/components/ui/separator/Separator.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';

const store = useGameStore();
const isFullscreen = ref(false);

const provinceIncomeText = computed(() => {
  const prov = store.selectedProvince;
  if (!prov) return '0';
  return prov.netIncome >= 0 ? `+${prov.netIncome}` : `${prov.netIncome}`;
});

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

const activeTurnName = computed(
  () => store.activeFactionInfo?.name ?? store.activeFactionPalette.name,
);

const activeOnlineSlot = computed(
  () => store.onlinePresenceByFaction[store.activeFactionId] ?? null,
);

function syncFullscreenState(): void {
  isFullscreen.value = Boolean(document.fullscreenElement);
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch {
    // Fullscreen API may be restricted in some embedded environments
  }
}

onMounted(() => {
  syncFullscreenState();
  document.addEventListener('fullscreenchange', syncFullscreenState);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreenState);
});
</script>

<template>
  <header
    class="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-center justify-between gap-1.5 pt-[max(1.25rem,calc(env(safe-area-inset-top)+0.75rem))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:gap-3 sm:px-6 sm:pt-3"
  >
    <!-- Zone 1: Clickable Active Turn Player, Presence Dot, Turn, Match Time & Turn Countdown -->
    <button
      type="button"
      class="pointer-events-auto flex h-9 sm:h-10 items-center gap-1.5 sm:gap-2 rounded-lg border border-border bg-card/95 px-2.5 sm:px-3 text-xs text-muted-foreground shadow-lg whitespace-nowrap shrink-0 transition-colors hover:border-primary/60 hover:bg-card cursor-pointer"
      title="Партия, игроки и территории"
      @click="store.showMatchOverviewDialog = true"
    >
      <span
        class="inline-block size-2.5 shrink-0 rounded-xs border border-white/25"
        :style="{backgroundColor: store.activeFactionPalette.tileHex}"
      />
      <span
        v-if="store.isOnlineMode && activeOnlineSlot"
        class="inline-block size-2 shrink-0 rounded-full"
        :class="activeOnlineSlot.online ? 'bg-emerald-400' : 'bg-zinc-500'"
        :title="activeOnlineSlot.online ? 'В сети' : 'Офлайн'"
      />
      <span
        class="hidden sm:inline font-semibold text-foreground max-w-[100px] truncate"
      >
        {{ activeTurnName }}
      </span>
      <span class="hidden md:inline" aria-hidden="true">·</span>
      <span class="hidden md:inline font-mono tabular-nums">
        Ход {{ store.gameState.turn }}
      </span>
      <span class="hidden lg:inline" aria-hidden="true">·</span>
      <span
        class="hidden lg:inline-flex items-center gap-1 font-mono text-xs tabular-nums text-foreground/80"
      >
        <Clock class="size-3.5 text-muted-foreground shrink-0" />
        {{ matchTimeFormatted }}
      </span>
      <template v-if="store.isOnlineMode && store.isRoomPaused">
        <span aria-hidden="true">·</span>
        <span
          class="inline-flex items-center gap-1 font-medium text-amber-300"
          title="Игра поставлена на паузу"
        >
          <Pause class="size-3 shrink-0" />
          <span class="hidden sm:inline">Пауза</span>
        </span>
      </template>
      <template v-else-if="store.waitingForFactionId !== null">
        <span aria-hidden="true">·</span>
        <span
          class="inline-flex items-center gap-1 font-medium text-amber-300"
        >
          <Hourglass class="size-3 shrink-0" />
          <span class="hidden sm:inline">Ожидание</span>
        </span>
      </template>
      <template v-else-if="store.isAiThinking">
        <span aria-hidden="true">·</span>
        <span class="text-primary font-medium">ИИ</span>
      </template>
      <template
        v-else-if="
          store.gameState.winner === null && store.turnTimeLimitSeconds > 0
        "
      >
        <span aria-hidden="true">·</span>
        <span
          class="inline-flex items-center gap-1 font-mono text-[11px] sm:text-xs font-semibold tabular-nums"
          :class="
            store.turnRemainingSeconds <= 30
              ? 'text-rose-400'
              : store.turnRemainingSeconds <= 120
                ? 'text-amber-300'
                : 'text-foreground/90'
          "
          title="Осталось времени на ход"
        >
          <Timer class="size-3 sm:size-3.5 shrink-0 opacity-80" />
          {{ turnTimeFormatted }}
        </span>
      </template>
    </button>

    <!-- Zone 2: Own Treasury & Net Income (Hidden When Viewer Has No Province / Eliminated) -->
    <div
      v-if="store.selectedProvince"
      class="pointer-events-auto flex h-9 sm:h-10 items-center gap-1 sm:gap-1.5 rounded-lg border border-border bg-card/95 px-1.5 sm:px-2 shadow-lg min-w-0"
    >
      <Tooltip side="bottom">
        <template #trigger>
          <button
            type="button"
            class="flex h-7 sm:h-8 items-center gap-1 sm:gap-1.5 rounded-md px-1.5 sm:px-2 transition-colors hover:bg-accent cursor-pointer"
            @click="store.showCountriesDialog = true"
          >
            <Coins class="size-3.5 sm:size-4 text-primary shrink-0" />
            <span
              class="font-mono text-xs sm:text-sm font-bold tabular-nums text-foreground"
            >
              {{ store.selectedProvince.money }}
            </span>
          </button>
        </template>
        <span>Сводка по всем странам</span>
      </Tooltip>

      <Separator orientation="vertical" class="h-4" />

      <Tooltip side="bottom">
        <template #trigger>
          <button
            type="button"
            class="flex h-7 sm:h-8 items-center gap-1 sm:gap-1.5 rounded-md px-1.5 sm:px-2 transition-colors hover:bg-accent cursor-pointer"
            @click="store.showIncomeDialog = true"
          >
            <TrendingUp
              v-if="store.selectedProvince.netIncome >= 0"
              class="size-3.5 sm:size-4 text-emerald-400 shrink-0"
            />
            <TrendingDown
              v-else
              class="size-3.5 sm:size-4 text-rose-400 shrink-0"
            />
            <span
              class="font-mono text-xs sm:text-sm font-semibold tabular-nums"
              :class="
                store.selectedProvince.netIncome >= 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              "
            >
              {{ provinceIncomeText }}
            </span>
          </button>
        </template>
        <span>Доходы и расходы провинции</span>
      </Tooltip>
    </div>

    <!-- Zone 3: Diplomacy, Notifications Bell, Chat (Online), Fullscreen (mobile), Pause Menu -->
    <div
      class="pointer-events-auto flex h-9 sm:h-10 items-center gap-0.5 sm:gap-1 rounded-lg border border-border bg-card/95 px-1 shadow-lg shrink-0"
    >
      <Button
        v-if="store.gameState.config.diplomacyEnabled"
        variant="ghost"
        size="sm"
        class="hidden sm:inline-flex h-8 px-2 text-xs"
        @click="store.showDiplomacyDialog = true"
      >
        <Handshake class="size-3.5 text-primary" />
        <span class="hidden md:inline">Дипломатия</span>
        <span
          v-if="store.pendingMessagesCount > 0"
          class="font-mono text-xs font-bold tabular-nums text-primary"
        >
          ({{ store.pendingMessagesCount }})
        </span>
      </Button>

      <!-- Notifications Bell Right Next to Diplomacy -->
      <Tooltip side="bottom">
        <template #trigger>
          <button
            type="button"
            class="hidden sm:inline-flex relative size-8 items-center justify-center rounded-md text-foreground/90 hover:bg-accent transition-colors cursor-pointer"
            aria-label="Уведомления"
            @click="store.showNotificationsDialog = true"
          >
            <Bell
              class="size-4"
              :class="
                store.unreadNotificationCount > 0
                  ? 'text-primary'
                  : 'text-muted-foreground'
              "
            />
            <span
              v-if="store.unreadNotificationCount > 0"
              class="absolute top-0.5 right-0.5 flex min-w-4 h-4 items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[10px] font-bold leading-none text-white tabular-nums"
            >
              {{
                store.unreadNotificationCount > 9
                  ? '9+'
                  : store.unreadNotificationCount
              }}
            </span>
          </button>
        </template>
        <span>Уведомления и события</span>
      </Tooltip>

      <!-- Online Room Chat Button (Always Available Independent of Turn) -->
      <Tooltip v-if="store.isOnlineMode" side="bottom">
        <template #trigger>
          <button
            type="button"
            class="hidden sm:inline-flex relative size-8 items-center justify-center rounded-md text-foreground/90 hover:bg-accent transition-colors cursor-pointer"
            aria-label="Чат комнаты"
            @click="store.showChatDialog = true"
          >
            <MessageSquare class="size-4 text-sky-400" />
          </button>
        </template>
        <span>Чат комнаты</span>
      </Tooltip>

      <!-- Desktop (lg+) Keyboard Shortcuts Trigger -->
      <Tooltip side="bottom">
        <template #trigger>
          <button
            type="button"
            class="hidden lg:inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            aria-label="Горячие клавиши"
            @click="store.showShortcutsDialog = true"
          >
            <Keyboard class="size-3.5 text-primary shrink-0" />
            <kbd
              class="rounded border border-border bg-background/80 px-1 py-0.5 font-mono text-[10px] font-semibold text-foreground leading-none"
            >
              Ctrl+/
            </kbd>
          </button>
        </template>
        <span>Горячие клавиши (Ctrl + /)</span>
      </Tooltip>

      <Button
        variant="ghost"
        size="icon"
        class="flex md:hidden size-7 sm:size-8"
        :aria-label="
          isFullscreen ? 'Выйти из полноэкранного режима' : 'Полноэкранный режим'
        "
        @click="toggleFullscreen()"
      >
        <Minimize2 v-if="isFullscreen" class="size-3.5 sm:size-4" />
        <Maximize2 v-else class="size-3.5 sm:size-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        class="size-7 sm:size-8"
        aria-label="Пауза"
        @click="store.showPauseDialog = true"
      >
        <Pause class="size-3.5 sm:size-4" />
      </Button>
    </div>
  </header>
</template>
