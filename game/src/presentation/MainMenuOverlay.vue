<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {
  ArrowLeft,
  FolderOpen,
  History,
  Keyboard,
  LogIn,
  PlusCircle,
} from 'lucide-vue-next';
import {APP_VERSION} from '@/domain/app/version';
import type {ServerStatusSummary} from '@/domain/multiplayer/types';
import {MAX_SAVE_SLOTS} from '@/infrastructure/storage/saveGameStorage';
import {wsClient} from '@/infrastructure/multiplayer/wsClient';
import {useGameStore} from '@/application/stores/useGameStore';
import {Button} from '@/components/ui/button';
import GameSetupForm, {
  type SetupHeaderState,
} from '@/presentation/GameSetupForm.vue';
import PwaInstallButton from '@/presentation/PwaInstallButton.vue';

const store = useGameStore();

type CardView = 'home' | 'create' | 'join';
const view = ref<CardView>('home');
const formResetKey = ref(0);
const setupFormRef = ref<{goBack: () => void} | null>(null);
const setupHeader = ref<SetupHeaderState>({
  title: 'Новая игра',
  stepText: null,
  canGoBackInside: false,
});

const serverConnected = ref(false);
const serverStatus = ref<ServerStatusSummary | null>(null);
const serverStatusRefreshing = ref(false);
let statusPollTimer = 0;

async function refreshServerStatus(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    serverConnected.value = false;
    serverStatus.value = null;
    return;
  }
  serverStatusRefreshing.value = true;
  try {
    const data = await wsClient.fetchServerStatus();
    serverStatus.value = data;
    serverConnected.value = true;
  } catch {
    serverConnected.value = false;
    serverStatus.value = null;
  } finally {
    serverStatusRefreshing.value = false;
  }
}

function startStatusPolling(): void {
  stopStatusPolling();
  void refreshServerStatus();
  statusPollTimer = window.setInterval(() => {
    void refreshServerStatus();
  }, 15000);
}

function handleManualStatusRefresh(): void {
  startStatusPolling();
}

function stopStatusPolling(): void {
  if (statusPollTimer) {
    window.clearInterval(statusPollTimer);
    statusPollTimer = 0;
  }
}

function handleBrowserOnline(): void {
  if (store.showMainMenu) {
    void refreshServerStatus();
  }
}

function handleBrowserOffline(): void {
  serverConnected.value = false;
  serverStatus.value = null;
}

const savedCount = computed(
  () => store.saveSlots.filter((s) => s !== null).length,
);

watch(
  () => store.showMainMenu,
  (visible) => {
    if (visible) {
      view.value = 'home';
      formResetKey.value += 1;
      store.refreshSaveSlots();
      void store.refreshRoomHistory();
      startStatusPolling();
    } else {
      stopStatusPolling();
    }
  },
  {immediate: true},
);

onMounted(() => {
  window.addEventListener('online', handleBrowserOnline);
  window.addEventListener('offline', handleBrowserOffline);
});

onBeforeUnmount(() => {
  stopStatusPolling();
  window.removeEventListener('online', handleBrowserOnline);
  window.removeEventListener('offline', handleBrowserOffline);
});

function switchView(next: CardView): void {
  view.value = next;
  if (next !== 'home') {
    formResetKey.value += 1;
  }
}

function handleSetupBack(): void {
  if (setupFormRef.value) {
    setupFormRef.value.goBack();
  } else {
    switchView('home');
  }
}
</script>

<template>
  <div
    v-if="store.showMainMenu && !store.isLoading"
    class="fixed inset-0 z-30 flex flex-col items-center justify-between bg-background/25 px-3 pt-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4"
  >
    <!-- Top spacer for clean vertical centering above pinned bottom credits -->
    <div class="h-4 shrink-0" aria-hidden="true" />

    <!-- Single Morphing Base Card (Background Map Stays Visible) -->
    <div
      class="w-full min-w-0 rounded-2xl border border-border bg-card/95 shadow-2xl transition-[max-width] duration-200 overflow-hidden"
      :class="view === 'home' ? 'max-w-sm' : 'max-w-[460px]'"
    >
      <div
        class="max-h-[calc(100dvh-7.5rem)] w-full min-w-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6"
      >
        <!-- Home View -->
        <div v-if="view === 'home'" class="space-y-5">
          <div class="flex flex-col items-center gap-2.5">
            <img
              src="/favicon.svg"
              alt="Fisle"
              class="size-14 select-none drop-shadow-md"
            />
            <div class="flex flex-col items-center gap-0.5">
              <h1
                class="font-display text-center text-2xl font-extrabold tracking-tight text-foreground"
              >
                Fisle
              </h1>
              <span
                class="font-mono text-[11px] font-medium tabular-nums text-muted-foreground"
              >
                v{{ APP_VERSION }}
              </span>
            </div>
          </div>

          <div class="flex flex-col gap-2.5">
            <Button
              variant="default"
              size="lg"
              class="h-11 w-full justify-center gap-2 text-sm font-semibold"
              @click="switchView('create')"
            >
              <PlusCircle class="size-4 shrink-0" />
              <span>Новая игра</span>
            </Button>

            <Button
              variant="outline"
              size="lg"
              class="h-11 w-full justify-center gap-2 text-sm font-semibold"
              @click="switchView('join')"
            >
              <LogIn class="size-4 shrink-0 text-primary" />
              <span>Присоединиться</span>
            </Button>

            <Button
              variant="secondary"
              size="lg"
              class="h-11 w-full justify-center gap-2 text-sm font-semibold"
              @click="store.showSaveLoadDialog = true"
            >
              <FolderOpen class="size-4 shrink-0 text-primary" />
              <span>Загрузить</span>
              <span
                v-if="savedCount > 0"
                class="font-mono text-[11px] tabular-nums text-muted-foreground"
              >
                · {{ savedCount }}/{{ MAX_SAVE_SLOTS }}
              </span>
            </Button>

            <Button
              variant="outline"
              size="lg"
              class="h-11 w-full justify-center gap-2 text-sm font-semibold"
              @click="store.showHistoryDialog = true"
            >
              <History class="size-4 shrink-0 text-primary" />
              <span>История</span>
              <span
                v-if="store.roomHistory.length > 0"
                class="font-mono text-[11px] font-semibold tabular-nums text-primary"
              >
                · {{ store.roomHistory.length }}
              </span>
            </Button>

            <PwaInstallButton
              size="lg"
              button-class="h-10 text-sm font-semibold"
            />
          </div>
        </div>

        <!-- Inline Step-by-Step Create / Join Wizard Inside the Same Base Card -->
        <div v-else class="w-full min-w-0 space-y-4">
          <div class="flex items-center justify-between gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 -ml-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer whitespace-nowrap shrink-0"
              @click="handleSetupBack"
            >
              <ArrowLeft class="size-4 shrink-0" />
              <span>Назад</span>
            </button>

            <h2
              class="font-display text-base font-bold tracking-tight text-foreground truncate"
            >
              {{ setupHeader.title }}
            </h2>

            <span
              class="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground whitespace-nowrap"
            >
              {{ setupHeader.stepText ?? '' }}
            </span>
          </div>

          <GameSetupForm
            ref="setupFormRef"
            :initial-tab="view"
            :show-tabs="false"
            :reset-key="formResetKey"
            @header-change="(h) => (setupHeader = h)"
            @cancel="switchView('home')"
          />
        </div>
      </div>
    </div>

    <!-- Bottom Row: Server Status Plain-Text Column (Left) & Credits (Center on sm+, Right on mobile) -->
    <div
      class="w-full shrink-0 pt-3 flex items-end justify-between gap-2 sm:justify-center"
    >
      <!-- Plain-Text Server Status & Online Stats (Bottom-Left Column, Click to Refresh Immediately) -->
      <button
        type="button"
        class="flex flex-col items-start text-left text-[11px] leading-snug text-foreground/85 hover:text-foreground drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] tabular-nums transition-opacity cursor-pointer sm:fixed sm:bottom-4 sm:left-5"
        :class="serverStatusRefreshing ? 'opacity-65' : 'opacity-100'"
        title="Нажмите, чтобы обновить статус сервера, онлайн и комнаты"
        @click="handleManualStatusRefresh"
      >
        <div>
          Сервер:
          <span
            class="font-medium"
            :class="serverConnected ? 'text-emerald-300' : 'text-rose-300'"
          >
            {{ serverConnected ? 'подключено' : 'нет' }}
          </span>
        </div>
        <div>
          Онлайн:
          <span class="font-mono font-medium text-foreground">
            {{ serverConnected && serverStatus ? serverStatus.onlineUsers : '—' }}
          </span>
        </div>
        <div>
          Свободно комнат:
          <span class="font-mono font-medium text-foreground">
            {{ serverConnected && serverStatus ? serverStatus.freeRooms : '—' }}
          </span>
        </div>
      </button>

      <!-- Credits Pinned at the Very Bottom of the Page -->
      <footer
        class="text-right sm:text-center text-[11px] leading-snug text-foreground/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] space-y-0.5"
      >
        <div>
          Original game:
          <a
            href="https://github.com/yiotro/Antiyoy"
            target="_blank"
            rel="noopener noreferrer"
            class="font-semibold text-foreground underline decoration-foreground/40 underline-offset-2 hover:text-primary hover:decoration-primary transition-colors"
          >
            Antiyoy by yiotro
          </a>
        </div>
        <div>
          Made by
          <a
            href="https://github.com/shtrmx"
            target="_blank"
            rel="noopener noreferrer"
            class="font-semibold text-foreground underline decoration-foreground/40 underline-offset-2 hover:text-primary hover:decoration-primary transition-colors"
          >
            Shtrmx
          </a>
          with AI
        </div>
      </footer>
    </div>

    <!-- Desktop (lg+) Keyboard Shortcuts Trigger -->
    <button
      type="button"
      class="hidden lg:inline-flex fixed bottom-4 right-5 items-center gap-2 rounded-lg border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur-xs transition-colors hover:border-primary/60 hover:text-foreground cursor-pointer"
      aria-label="Горячие клавиши"
      @click="store.showShortcutsDialog = true"
    >
      <Keyboard class="size-3.5 text-primary shrink-0" />
      <span>Клавиши</span>
      <span class="inline-flex items-center gap-0.5 font-mono text-[10px]">
        <kbd
          class="rounded border border-border bg-background/80 px-1 py-0.5 font-semibold text-foreground"
        >
          Ctrl
        </kbd>
        <span>+</span>
        <kbd
          class="rounded border border-border bg-background/80 px-1 py-0.5 font-semibold text-foreground"
        >
          /
        </kbd>
      </span>
    </button>
  </div>
</template>
