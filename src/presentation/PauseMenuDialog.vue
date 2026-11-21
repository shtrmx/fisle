<script setup lang="ts">
import {computed, nextTick, reactive, ref, watch} from 'vue';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Copy,
  Crown,
  Globe,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  LogOut,
  Pause,
  Play,
  Save,
  Trash2,
  UserX,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-vue-next';
import {APP_VERSION} from '@/domain/app/version';
import {FACTION_PALETTES} from '@/domain/game/rules';
import {FactionId, MapSize} from '@/domain/game/types';
import type {FactionController} from '@/domain/multiplayer/types';
import {MAX_SAVE_SLOTS} from '@/infrastructure/storage/saveGameStorage';
import {useGameStore} from '@/application/stores/useGameStore';
import ModalDialog from '@/components/ui/dialog/ModalDialog.vue';
import {Button} from '@/components/ui/button';
import Select, {type SelectOption} from '@/components/ui/select/Select.vue';
import PwaInstallButton from '@/presentation/PwaInstallButton.vue';

type PauseCardView =
  | 'main'
  | 'players'
  | 'host-online'
  | 'host-password'
  | 'confirm-exit';

const store = useGameStore();
const pauseView = ref<PauseCardView>('main');
const copiedSeed = ref(false);
const copiedRoom = ref(false);
let copySeedTimer = 0;
let copyRoomTimer = 0;

// Offline -> Host Online state
const confirmDisbandRoom = ref(false);
const hostNickname = ref('');
const hostPassword = ref('');
const hostPrimaryFaction = ref<FactionId>(FactionId.EMERALD);
const hostAutoSaveSlotVal = ref<string>('0');
const draftControllers = reactive<Record<number, FactionController>>({});
const hostPasswordInputRef = ref<HTMLInputElement | null>(null);

const MAP_SIZE_LABELS: Record<MapSize, string> = {
  [MapSize.SMALL]: 'Малая',
  [MapSize.MEDIUM]: 'Средняя',
  [MapSize.LARGE]: 'Большая',
  [MapSize.GIANT]: 'Гигантская',
};

const dialogTitle = computed(() => {
  switch (pauseView.value) {
    case 'players':
      return 'Игроки';
    case 'host-online':
      return 'Включить онлайн';
    case 'host-password':
      return 'Пароль комнаты';
    case 'confirm-exit':
      return 'Выйти из игры';
    default:
      return 'Пауза';
  }
});

const currentSeed = computed(() => store.gameState.config.seed);

const matchTimeFormatted = computed(() => {
  const total = store.elapsedSeconds;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
});

const hexCount = computed(() => Object.keys(store.gameState.cells).length);

const savedCount = computed(
  () => store.saveSlots.filter((slot) => slot !== null).length,
);

const livingFactions = computed(() => {
  void store.boardVersion;
  return store.gameState.turnOrder
    .map((factionId) => ({
      factionId,
      info: store.gameState.factions[factionId],
      palette: FACTION_PALETTES[factionId],
      onlineSlot: store.onlinePresenceByFaction[factionId] ?? null,
    }))
    .filter((item) => item.info && !item.info.isEliminated);
});

const livingHumanCount = computed(
  () => livingFactions.value.filter((f) => f.info.isHuman).length,
);

const livingAiCount = computed(() =>
  Math.max(0, livingFactions.value.length - livingHumanCount.value),
);

const onlinePlayersConnectedCount = computed(
  () => livingFactions.value.filter((f) => f.onlineSlot?.online).length,
);

const playersRowSummary = computed(() => {
  if (store.isOnlineMode) {
    return `${onlinePlayersConnectedCount.value} в сети · ${livingFactions.value.length} фр.`;
  }
  return `${livingHumanCount.value} чел. · ${livingAiCount.value} ИИ`;
});

const autoSaveSlotOptions = computed<SelectOption[]>(() => {
  const options: SelectOption[] = [{value: '0', label: 'Выключено'}];
  for (let i = 1; i <= MAX_SAVE_SLOTS; i++) {
    const existing = store.saveSlots[i - 1];
    options.push({
      value: String(i),
      label: existing
        ? `Слот ${i} · ${existing.label} (перезапись)`
        : `Слот ${i} (пусто)`,
    });
  }
  return options;
});

const otherLivingFactionsForHost = computed(() =>
  livingFactions.value.filter(
    (item) => item.factionId !== hostPrimaryFaction.value,
  ),
);

function initHostOnlineDraft(): void {
  const living = livingFactions.value;
  const preferred =
    living.find((f) => f.factionId === store.viewerFactionId)?.factionId ??
    living.find((f) => f.info.isHuman)?.factionId ??
    living[0]?.factionId ??
    FactionId.EMERALD;
  hostPrimaryFaction.value = preferred;
  hostPassword.value = '';
  hostAutoSaveSlotVal.value =
    store.autoSaveSlot !== null ? String(store.autoSaveSlot) : '0';
  store.onlineError = null;
  for (const key of Object.keys(draftControllers)) {
    delete draftControllers[Number(key)];
  }
  for (const item of living) {
    if (item.factionId === preferred) {
      draftControllers[item.factionId] = 'ONLINE';
    } else if (item.info.isHuman) {
      draftControllers[item.factionId] = 'HOTSEAT';
    } else {
      draftControllers[item.factionId] = 'AI';
    }
  }
}

watch(
  () => store.showPauseDialog,
  (open) => {
    confirmDisbandRoom.value = false;
    pauseView.value = 'main';
    if (open) {
      store.refreshSaveSlots();
      initHostOnlineDraft();
    }
  },
);

watch(
  () => store.isOnlineMode,
  (online) => {
    if (
      online &&
      (pauseView.value === 'host-online' ||
        pauseView.value === 'host-password' ||
        pauseView.value === 'confirm-exit')
    ) {
      pauseView.value = 'main';
    }
  },
);

function openHostOnlineView(): void {
  initHostOnlineDraft();
  pauseView.value = 'host-online';
}

function openHostPasswordView(): void {
  pauseView.value = 'host-password';
  void nextTick(() => {
    hostPasswordInputRef.value?.focus();
  });
}

function clearHostPasswordAndBack(): void {
  hostPassword.value = '';
  pauseView.value = 'host-online';
}

function selectHostPrimaryFaction(factionId: FactionId): void {
  const prev = hostPrimaryFaction.value;
  hostPrimaryFaction.value = factionId;
  if (prev !== factionId) {
    draftControllers[prev] = store.gameState.factions[prev]?.isHuman
      ? 'HOTSEAT'
      : 'AI';
  }
  draftControllers[factionId] = 'ONLINE';
}

function setDraftController(
  factionId: FactionId,
  controller: FactionController,
): void {
  if (factionId === hostPrimaryFaction.value) return;
  draftControllers[factionId] = controller;
}

async function launchHostExistingOnline(): Promise<void> {
  const nick =
    hostNickname.value.trim() ||
    FACTION_PALETTES[hostPrimaryFaction.value]?.name ||
    'Хост';
  const controllers: Record<number, FactionController> = {};
  for (const item of livingFactions.value) {
    if (item.factionId === hostPrimaryFaction.value) {
      controllers[item.factionId] = 'ONLINE';
    } else {
      controllers[item.factionId] = draftControllers[item.factionId] ?? 'AI';
    }
  }
  const slotNum = Number(hostAutoSaveSlotVal.value);
  const chosenSlot = slotNum >= 1 && slotNum <= MAX_SAVE_SLOTS ? slotNum : null;
  await store.hostCurrentGameOnline(
    nick,
    hostPrimaryFaction.value,
    controllers,
    hostPassword.value.trim() || undefined,
    chosenSlot,
  );
}

function getOnlineControllerForFaction(
  factionId: FactionId,
): FactionController {
  return store.factionControllers[factionId] ?? 'AI';
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

async function copySeed(): Promise<void> {
  await copyText(String(currentSeed.value));
  copiedSeed.value = true;
  window.clearTimeout(copySeedTimer);
  copySeedTimer = window.setTimeout(() => {
    copiedSeed.value = false;
  }, 1800);
}

async function copyRoomCode(): Promise<void> {
  if (!store.roomCode) return;
  await copyText(store.roomCode);
  copiedRoom.value = true;
  window.clearTimeout(copyRoomTimer);
  copyRoomTimer = window.setTimeout(() => {
    copiedRoom.value = false;
  }, 1800);
}

function openSaveSlots(): void {
  store.showPauseDialog = false;
  store.showSaveLoadDialog = true;
}

function confirmExitSoloMatch(): void {
  pauseView.value = 'main';
  store.exitCurrentMatch();
}
</script>

<template>
  <ModalDialog
    :open="store.showPauseDialog"
    :title="dialogTitle"
    content-class="w-[min(94vw,460px)] max-h-[88vh] overflow-y-auto"
    @update:open="(val) => (store.showPauseDialog = val)"
  >
    <!-- ==================== VIEW 1: MAIN PAUSE MENU ==================== -->
    <div v-if="pauseView === 'main'" class="space-y-3.5">
      <!-- ONLINE ROOM CARD -->
      <div
        v-if="store.isOnlineMode && store.roomCode"
        class="rounded-lg border border-primary/35 bg-primary/8 px-3 py-2.5 space-y-2.5"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0 space-y-0.5">
            <div class="flex items-center gap-1.5 min-w-0">
              <Globe class="size-3.5 shrink-0 text-primary" />
              <span
                class="font-display text-sm font-bold text-foreground truncate"
              >
                {{ store.roomName || 'Комната' }}
              </span>
              <Lock
                v-if="store.roomHasPassword"
                class="size-3 shrink-0 text-amber-300"
                title="Защищена паролем"
              />
            </div>
            <div class="text-[11px] text-muted-foreground">
              Онлайн-комната
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <code
              class="rounded border border-border bg-background px-2 py-0.5 font-mono text-xs font-bold tracking-widest text-primary"
            >
              {{ store.roomCode }}
            </code>
            <button
              type="button"
              class="inline-flex size-7 items-center justify-center rounded border border-border bg-secondary/70 text-foreground hover:bg-accent cursor-pointer"
              aria-label="Копировать код комнаты"
              @click="copyRoomCode"
            >
              <Check v-if="copiedRoom" class="size-3.5 text-emerald-400" />
              <Copy v-else class="size-3.5" />
            </button>
          </div>
        </div>

        <!-- Online Match Pause Control (Admin) / Paused Banner (Guests) -->
        <div
          v-if="
            store.roomStatus === 'PLAYING' && store.gameState.winner === null
          "
        >
          <Button
            v-if="store.isLocalHost"
            :variant="store.isRoomPaused ? 'default' : 'outline'"
            size="sm"
            class="w-full justify-center gap-2 text-xs"
            @click="store.setOnlineGamePaused(!store.isRoomPaused)"
          >
            <Play v-if="store.isRoomPaused" class="size-3.5" />
            <Pause v-else class="size-3.5 text-amber-300" />
            <span>
              {{
                store.isRoomPaused
                  ? 'Возобновить онлайн-игру'
                  : 'Поставить игру на паузу'
              }}
            </span>
          </Button>
          <div
            v-else-if="store.isRoomPaused"
            class="flex items-center justify-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-200"
          >
            <Pause class="size-3.5 shrink-0" />
            <span>
              Игра на паузе
              <template v-if="store.roomPausedBy">
                ({{ store.roomPausedBy }})
              </template>
            </span>
          </div>
        </div>
      </div>

      <!-- SUB-VIEW NAVIGATION ROWS -->
      <div class="space-y-2">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-secondary/35 px-3 py-2.5 text-left transition-colors hover:bg-secondary/60 cursor-pointer"
          @click="pauseView = 'players'"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <Users class="size-4 shrink-0 text-primary" />
            <div class="min-w-0">
              <div class="text-xs font-semibold text-foreground">Игроки</div>
              <div class="font-mono text-[11px] text-muted-foreground tabular-nums">
                {{ playersRowSummary }}
              </div>
            </div>
          </div>
          <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
        </button>

        <button
          v-if="!store.isOnlineMode"
          type="button"
          class="flex w-full items-center justify-between gap-3 rounded-lg border border-primary/35 bg-primary/8 px-3 py-2.5 text-left transition-colors hover:bg-primary/14 cursor-pointer"
          @click="openHostOnlineView"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <Globe class="size-4 shrink-0 text-primary" />
            <div class="min-w-0">
              <div class="text-xs font-semibold text-primary">
                Включить онлайн
              </div>
              <div class="text-[11px] text-muted-foreground">
                Перевести текущую партию в онлайн-комнату
              </div>
            </div>
          </div>
          <ChevronRight class="size-4 shrink-0 text-primary/80" />
        </button>
      </div>

      <!-- MAP SEED & MATCH INFO BLOCK -->
      <div
        class="rounded-lg border border-border bg-secondary/40 px-3 py-2.5 space-y-2"
      >
        <div
          class="flex items-center justify-between text-xs text-muted-foreground"
        >
          <span class="font-medium">Сид</span>
          <span class="font-mono tabular-nums">
            {{ MAP_SIZE_LABELS[store.gameState.config.mapSize] }} ·
            {{ hexCount }} · Ход {{ store.gameState.turn }} ·
            {{ matchTimeFormatted }}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <code
            class="flex-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm font-bold tracking-wider tabular-nums text-primary select-all"
          >
            {{ currentSeed }}
          </code>
          <Button
            variant="secondary"
            size="icon"
            class="size-9 shrink-0"
            aria-label="Копировать сид"
            @click="copySeed"
          >
            <Check v-if="copiedSeed" class="size-4 text-emerald-400" />
            <Copy v-else class="size-4" />
          </Button>
        </div>

        <div
          v-if="
            store.autoSaveSlot !== null &&
            (!store.isOnlineMode || store.isLocalHost)
          "
          class="flex items-center justify-between pt-0.5 text-[11px] text-muted-foreground"
        >
          <span>Автосохранение (раз в 5 мин)</span>
          <span class="font-mono font-medium text-primary tabular-nums">
            Слот {{ store.autoSaveSlot }}
          </span>
        </div>
      </div>

      <!-- PRIMARY PAUSE ACTIONS -->
      <div class="flex flex-col gap-2">
        <Button
          variant="default"
          class="w-full justify-center gap-2"
          @click="store.showPauseDialog = false"
        >
          <Play class="size-4" />
          Продолжить
        </Button>

        <Button
          variant="secondary"
          class="w-full justify-center gap-2"
          @click="openSaveSlots"
        >
          <Save class="size-4 text-primary" />
          <span>Сохранить / Загрузить</span>
          <span class="font-mono text-xs text-muted-foreground tabular-nums">
            ({{ savedCount }}/{{ MAX_SAVE_SLOTS }})
          </span>
        </Button>

        <Button
          variant="outline"
          class="w-full justify-center gap-2"
          @click="store.toggleSound()"
        >
          <Volume2 v-if="store.soundEnabled" class="size-4" />
          <VolumeX v-else class="size-4 text-muted-foreground" />
          {{ store.soundEnabled ? 'Звук включён' : 'Без звука' }}
        </Button>

        <PwaInstallButton />

        <!-- ONLINE: Leave + Host Disband -->
        <template v-if="store.isOnlineMode">
          <div
            v-if="confirmDisbandRoom && store.isLocalHost"
            class="rounded-lg border border-destructive/50 bg-destructive/10 p-2.5 space-y-2"
          >
            <p class="text-xs font-medium text-foreground text-center">
              Распустить и удалить комнату для всех игроков?
            </p>
            <div class="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                class="w-full justify-center text-xs"
                @click="confirmDisbandRoom = false"
              >
                Отмена
              </Button>
              <Button
                variant="destructive"
                size="sm"
                class="w-full justify-center gap-1.5 text-xs"
                @click="
                  confirmDisbandRoom = false;
                  store.disbandOnlineRoom();
                "
              >
                <Trash2 class="size-3.5" />
                Удалить
              </Button>
            </div>
          </div>

          <div v-else class="flex items-center gap-2">
            <Button
              variant="destructive"
              class="flex-1 justify-center gap-2"
              @click="store.leaveOnlineGame()"
            >
              <LogOut class="size-4" />
              Выйти
            </Button>
            <Button
              v-if="store.isLocalHost"
              variant="outline"
              size="icon"
              class="size-9 shrink-0 border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
              aria-label="Распустить и удалить комнату"
              title="Распустить и удалить комнату"
              @click="confirmDisbandRoom = true"
            >
              <Trash2 class="size-4" />
            </Button>
          </div>
        </template>

        <!-- SOLO / OFFLINE: Exit with Save Warning -->
        <Button
          v-else
          variant="destructive"
          class="w-full justify-center gap-2"
          @click="pauseView = 'confirm-exit'"
        >
          <LogOut class="size-4" />
          Выйти
        </Button>
      </div>

      <div
        class="pt-1 text-center font-mono text-[11px] tabular-nums text-muted-foreground/80"
      >
        Fisle v{{ APP_VERSION }}
      </div>
    </div>

    <!-- ==================== VIEW 2: PLAYERS MANAGEMENT ==================== -->
    <div v-else-if="pauseView === 'players'" class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          class="-ml-2 h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          @click="pauseView = 'main'"
        >
          <ArrowLeft class="size-3.5" />
          Назад
        </Button>
        <span class="font-mono text-xs text-muted-foreground tabular-nums">
          {{ playersRowSummary }}
        </span>
      </div>

      <!-- Online Players List -->
      <div v-if="store.isOnlineMode" class="space-y-1.5">
        <div
          v-for="item in livingFactions"
          :key="item.factionId"
          class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/75 bg-secondary/35 px-3 py-2 text-xs"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="inline-block size-3 shrink-0 rounded-xs border border-white/25"
              :style="{backgroundColor: item.palette.tileHex}"
            />
            <span
              v-if="item.onlineSlot"
              class="inline-block size-2 shrink-0 rounded-full"
              :class="
                item.onlineSlot.online ? 'bg-emerald-400' : 'bg-zinc-500'
              "
            />
            <span class="font-medium text-foreground truncate max-w-[120px]">
              {{ item.onlineSlot?.nickname ?? item.info.name }}
            </span>
            <Crown
              v-if="item.onlineSlot?.isHost"
              class="size-3 text-amber-400 shrink-0"
              title="Администратор комнаты"
            />
            <span
              v-if="item.onlineSlot?.playerId === store.localPlayerId"
              class="text-[10px] font-semibold text-primary shrink-0"
            >
              Вы
            </span>
          </div>

          <!-- Host Controls for Other Factions -->
          <div
            v-if="
              store.isLocalHost &&
              item.factionId !== store.localPlayerFactionId
            "
            class="flex items-center gap-1 shrink-0"
          >
            <button
              v-if="item.onlineSlot"
              type="button"
              class="inline-flex h-6 items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/20 cursor-pointer"
              title="Выгнать (заменить на ИИ)"
              @click="store.kickOnlinePlayer(item.onlineSlot.playerId)"
            >
              <UserX class="size-3" />
              Кик
            </button>

            <div
              class="inline-flex rounded border border-border bg-background/70 p-0.5 text-[10px]"
            >
              <button
                type="button"
                class="rounded px-1.5 py-0.5 font-medium transition-colors cursor-pointer"
                :class="
                  getOnlineControllerForFaction(item.factionId) === 'AI'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                "
                @click="store.reassignOnlineFaction(item.factionId, 'AI')"
              >
                ИИ
              </button>
              <button
                type="button"
                class="rounded px-1.5 py-0.5 font-medium transition-colors cursor-pointer"
                :class="
                  getOnlineControllerForFaction(item.factionId) === 'HOTSEAT'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                "
                @click="store.reassignOnlineFaction(item.factionId, 'HOTSEAT')"
              >
                Хотсит
              </button>
              <button
                type="button"
                class="rounded px-1.5 py-0.5 font-medium transition-colors cursor-pointer"
                :class="
                  getOnlineControllerForFaction(item.factionId) === 'ONLINE'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                "
                @click="store.reassignOnlineFaction(item.factionId, 'ONLINE')"
              >
                Онлайн
              </button>
            </div>
          </div>

          <!-- Read-only Status (Self or Guest) -->
          <span v-else class="text-[11px] text-muted-foreground shrink-0">
            <template v-if="item.onlineSlot">
              {{ item.onlineSlot.online ? 'В сети' : 'Офлайн' }}
            </template>
            <template
              v-else-if="
                getOnlineControllerForFaction(item.factionId) === 'HOTSEAT'
              "
            >
              Хотсит
            </template>
            <template
              v-else-if="
                getOnlineControllerForFaction(item.factionId) === 'ONLINE'
              "
            >
              Ожидание
            </template>
            <template v-else>ИИ</template>
          </span>
        </div>
      </div>

      <!-- Offline Players List -->
      <template v-else>
        <div class="space-y-1.5">
          <div
            v-for="item in livingFactions"
            :key="item.factionId"
            class="flex items-center justify-between gap-2 rounded-lg border border-border/75 bg-secondary/35 px-3 py-2 text-xs"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="inline-block size-3 shrink-0 rounded-xs border border-white/25"
                :style="{backgroundColor: item.palette.tileHex}"
              />
              <span class="font-medium text-foreground truncate">
                {{ item.info.name }}
              </span>
            </div>

            <div
              class="inline-flex rounded border border-border bg-background/70 p-0.5 text-[10px] shrink-0"
            >
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors cursor-pointer"
                :class="
                  item.info.isHuman
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                "
                @click="store.setLocalFactionHuman(item.factionId, true)"
              >
                <Laptop class="size-2.5" />
                Игрок
              </button>
              <button
                type="button"
                :disabled="item.info.isHuman && livingHumanCount <= 1"
                class="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                :class="
                  !item.info.isHuman
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                "
                @click="store.setLocalFactionHuman(item.factionId, false)"
              >
                <Bot class="size-2.5" />
                ИИ
              </button>
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          class="w-full justify-center gap-2 border-primary/40 text-primary hover:bg-primary/10"
          @click="openHostOnlineView"
        >
          <Globe class="size-4" />
          Включить онлайн
        </Button>
      </template>
    </div>

    <!-- ==================== VIEW 3: HOST ONLINE SETUP ==================== -->
    <div v-else-if="pauseView === 'host-online'" class="space-y-3.5">
      <div class="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          class="-ml-2 h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          @click="pauseView = 'main'"
        >
          <ArrowLeft class="size-3.5" />
          Назад
        </Button>
        <span class="text-[11px] text-muted-foreground">
          Профиль хоста
        </span>
      </div>

      <!-- Host Nickname -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-foreground">Ваше имя</label>
        <input
          v-model="hostNickname"
          type="text"
          maxlength="20"
          :placeholder="FACTION_PALETTES[hostPrimaryFaction]?.name ?? 'Хост'"
          class="flex h-9 w-full min-w-0 rounded-md border border-border bg-secondary/45 px-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <!-- Choose Host Color / Faction -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-foreground">Ваш цвет</label>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            v-for="item in livingFactions"
            :key="`pick-${item.factionId}`"
            type="button"
            class="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors cursor-pointer"
            :class="
              hostPrimaryFaction === item.factionId
                ? 'border-primary bg-primary/14 text-foreground'
                : 'border-border bg-secondary/30 text-muted-foreground hover:border-border/90 hover:text-foreground'
            "
            @click="selectHostPrimaryFaction(item.factionId)"
          >
            <span
              class="inline-block size-3.5 shrink-0 rounded-xs border border-white/25"
              :style="{backgroundColor: item.palette.tileHex}"
            />
            <span class="truncate font-medium flex-1">
              {{ item.info.name }}
            </span>
            <Check
              v-if="hostPrimaryFaction === item.factionId"
              class="size-3.5 shrink-0 text-primary"
            />
          </button>
        </div>
      </div>

      <!-- Roles for Other Living Factions -->
      <div v-if="otherLivingFactionsForHost.length > 0" class="space-y-1.5">
        <div class="text-xs font-medium text-foreground">
          Роли остальных стран
        </div>
        <div class="space-y-1">
          <div
            v-for="item in otherLivingFactionsForHost"
            :key="`role-${item.factionId}`"
            class="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-secondary/30 px-2.5 py-1.5 text-[11px]"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="inline-block size-2.5 shrink-0 rounded-xs border border-white/25"
                :style="{backgroundColor: item.palette.tileHex}"
              />
              <span class="truncate font-medium text-foreground">
                {{ item.info.name }}
              </span>
            </div>

            <div
              class="inline-flex rounded border border-border bg-background/70 p-0.5 text-[10px] shrink-0"
            >
              <button
                type="button"
                class="rounded px-1.5 py-0.5 font-medium cursor-pointer"
                :class="
                  draftControllers[item.factionId] === 'AI'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground'
                "
                @click="setDraftController(item.factionId, 'AI')"
              >
                ИИ
              </button>
              <button
                type="button"
                class="rounded px-1.5 py-0.5 font-medium cursor-pointer"
                :class="
                  draftControllers[item.factionId] === 'HOTSEAT'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground'
                "
                @click="setDraftController(item.factionId, 'HOTSEAT')"
              >
                Хотсит
              </button>
              <button
                type="button"
                class="rounded px-1.5 py-0.5 font-medium cursor-pointer"
                :class="
                  draftControllers[item.factionId] === 'ONLINE'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground'
                "
                @click="setDraftController(item.factionId, 'ONLINE')"
              >
                Онлайн
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Optional Host Auto-Save Slot -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-foreground">
          Автосохранение хоста (раз в 5 мин)
        </label>
        <Select
          v-model="hostAutoSaveSlotVal"
          :options="autoSaveSlotOptions"
          placeholder="Выключено"
        />
      </div>

      <!-- Dedicated Set Password Button -->
      <button
        type="button"
        class="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-secondary/35 px-3 py-2.5 text-left transition-colors hover:bg-secondary/60 cursor-pointer"
        @click="openHostPasswordView"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <Lock
            v-if="hostPassword.trim().length > 0"
            class="size-4 shrink-0 text-amber-300"
          />
          <KeyRound v-else class="size-4 shrink-0 text-muted-foreground" />
          <div class="min-w-0">
            <div class="text-xs font-semibold text-foreground">
              {{
                hostPassword.trim().length > 0
                  ? 'Пароль установлен'
                  : 'Установить пароль'
              }}
            </div>
            <div class="text-[11px] text-muted-foreground">
              {{
                hostPassword.trim().length > 0
                  ? 'Нажмите, чтобы изменить или убрать пароль'
                  : 'Необязательно · защита входа в комнату'
              }}
            </div>
          </div>
        </div>
        <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
      </button>

      <div
        v-if="store.onlineError"
        class="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
      >
        {{ store.onlineError }}
      </div>

      <Button
        variant="default"
        class="w-full justify-center gap-2"
        :disabled="store.onlineBusy"
        @click="launchHostExistingOnline"
      >
        <Loader2 v-if="store.onlineBusy" class="size-4 animate-spin" />
        <Globe v-else class="size-4" />
        <span>Создать онлайн-комнату</span>
      </Button>
    </div>

    <!-- ==================== VIEW 4: HOST PASSWORD SUB-VIEW ==================== -->
    <div v-else-if="pauseView === 'host-password'" class="space-y-4">
      <div class="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          class="-ml-2 h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          @click="pauseView = 'host-online'"
        >
          <ArrowLeft class="size-3.5" />
          Назад
        </Button>
      </div>

      <div
        class="rounded-lg border border-border bg-secondary/35 p-3.5 space-y-3"
      >
        <div class="flex items-start gap-2.5">
          <Lock class="mt-0.5 size-4 shrink-0 text-amber-300" />
          <div class="space-y-1">
            <div class="text-xs font-semibold text-foreground">
              Защита комнаты паролем
            </div>
            <p class="text-[11px] leading-relaxed text-muted-foreground">
              Другим игрокам потребуется ввести этот пароль перед выбором цвета
              и имени. Оставьте поле пустым, чтобы комната была открытой.
            </p>
          </div>
        </div>

        <input
          ref="hostPasswordInputRef"
          v-model="hostPassword"
          type="password"
          maxlength="24"
          placeholder="Введите пароль"
          class="flex h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          @keydown.enter.prevent="pauseView = 'host-online'"
        />
      </div>

      <div class="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          class="w-full justify-center text-xs"
          @click="clearHostPasswordAndBack"
        >
          Без пароля
        </Button>
        <Button
          variant="default"
          class="w-full justify-center text-xs"
          @click="pauseView = 'host-online'"
        >
          Готово
        </Button>
      </div>
    </div>

    <!-- ==================== VIEW 5: SOLO EXIT WARNING ==================== -->
    <div v-else-if="pauseView === 'confirm-exit'" class="space-y-4">
      <div class="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          class="-ml-2 h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          @click="pauseView = 'main'"
        >
          <ArrowLeft class="size-3.5" />
          Назад
        </Button>
      </div>

      <div
        class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-2"
      >
        <div class="flex items-center gap-2 text-amber-300">
          <AlertTriangle class="size-4 shrink-0" />
          <span class="text-sm font-semibold text-foreground">
            Текущая игра будет удалена
          </span>
        </div>
        <p class="text-xs leading-relaxed text-muted-foreground">
          Несохранённый прогресс этой партии будет потерян. Сохраните игру перед
          выходом, если планируете вернуться к ней позже.
        </p>
        <p
          v-if="store.autoSaveSlot !== null"
          class="text-[11px] text-amber-200/90"
        >
          Автосохранение привязано к слоту {{ store.autoSaveSlot }} (последние
          ходы лучше сохранить вручную).
        </p>
      </div>

      <div class="flex flex-col gap-2">
        <Button
          variant="default"
          class="w-full justify-center gap-2"
          @click="openSaveSlots"
        >
          <Save class="size-4" />
          Сохранить игру
        </Button>

        <Button
          variant="destructive"
          class="w-full justify-center gap-2"
          @click="confirmExitSoloMatch"
        >
          <LogOut class="size-4" />
          Выйти и удалить
        </Button>

        <Button
          variant="outline"
          class="w-full justify-center"
          @click="pauseView = 'main'"
        >
          Отмена
        </Button>
      </div>
    </div>
  </ModalDialog>
</template>
