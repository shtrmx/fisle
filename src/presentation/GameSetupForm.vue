<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  PlusCircle,
  Save,
  Search,
  Users,
} from 'lucide-vue-next';
import {
  AiDifficulty,
  FactionId,
  GameMode,
  MapSize,
  ScenarioId,
  TreeSpawnRate,
} from '@/domain/game/types';
import {
  FACTION_PALETTES,
  PLAYABLE_FACTIONS,
  TURN_TIME_LIMIT_OPTIONS,
  getTurnTimeLimitSeconds,
} from '@/domain/game/rules';
import type {RoomPreview} from '@/domain/multiplayer/types';
import {MAX_SAVE_SLOTS} from '@/infrastructure/storage/saveGameStorage';
import {wsClient} from '@/infrastructure/multiplayer/wsClient';
import {useGameStore} from '@/application/stores/useGameStore';
import {Button} from '@/components/ui/button';
import Slider from '@/components/ui/slider/Slider.vue';
import Select, {type SelectOption} from '@/components/ui/select/Select.vue';

export type SetupModeTab = 'create' | 'join';
export type CreateStep = 'settings' | 'online-profile' | 'online-password';
export type JoinStep = 'code' | 'password' | 'character';

export interface SetupHeaderState {
  readonly title: string;
  readonly stepText: string | null;
  readonly canGoBackInside: boolean;
}

const props = withDefaults(
  defineProps<{
    initialTab?: SetupModeTab;
    showTabs?: boolean;
    resetKey?: number;
  }>(),
  {
    initialTab: 'create',
    showTabs: true,
    resetKey: 0,
  },
);

const emit = defineEmits<{
  cancel: [];
  headerChange: [state: SetupHeaderState];
}>();

const store = useGameStore();

const DIFFICULTY_STEPS: readonly {id: AiDifficulty; label: string}[] = [
  {id: AiDifficulty.EASY, label: 'Спокойный'},
  {id: AiDifficulty.BALANCED, label: 'Тактик'},
  {id: AiDifficulty.HARD, label: 'Мастер'},
];

const MAP_SIZE_STEPS: readonly {id: MapSize; label: string}[] = [
  {id: MapSize.SMALL, label: 'Малая'},
  {id: MapSize.MEDIUM, label: 'Средняя'},
  {id: MapSize.LARGE, label: 'Большая'},
  {id: MapSize.GIANT, label: 'Гигантская'},
];

const TREE_RATE_STEPS: readonly {id: TreeSpawnRate; label: string}[] = [
  {id: TreeSpawnRate.NONE, label: 'Выкл'},
  {id: TreeSpawnRate.LOW, label: 'Мало'},
  {id: TreeSpawnRate.NORMAL, label: 'Обычно'},
  {id: TreeSpawnRate.HIGH, label: 'Много'},
];

const SCENARIO_OPTIONS: readonly SelectOption[] = [
  {value: ScenarioId.ARCHIPELAGO, label: 'Архипелаг'},
  {value: ScenarioId.TWIN_CONTINENTS, label: 'Два материка'},
  {value: ScenarioId.CITADEL_RING, label: 'Кольцо цитаделей'},
  {value: ScenarioId.RANDOM, label: 'Случайный материк'},
];

const TURN_LIMIT_SELECT_OPTIONS: readonly SelectOption[] =
  TURN_TIME_LIMIT_OPTIONS.map((opt) => ({
    value: String(opt.seconds),
    label: opt.label,
  }));

const modeTab = ref<SetupModeTab>(props.initialTab);
const createStep = ref<CreateStep>('settings');
const joinStep = ref<JoinStep>('code');

// Create tab state
const factionCount = ref<number>(store.gameState.config.factionCount);
const humanCount = ref<number>(store.gameState.config.humanCount);
const difficultyIdx = ref<number>(
  Math.max(
    0,
    DIFFICULTY_STEPS.findIndex(
      (d) => d.id === store.gameState.config.difficulty,
    ),
  ),
);
const mapSizeIdx = ref<number>(
  Math.max(
    0,
    MAP_SIZE_STEPS.findIndex((s) => s.id === store.gameState.config.mapSize),
  ),
);
const treeRateIdx = ref<number>(
  Math.max(
    0,
    TREE_RATE_STEPS.findIndex(
      (t) => t.id === store.gameState.config.treeSpawnRate,
    ),
  ),
);
const scenario = ref<ScenarioId>(store.gameState.config.scenario);
const turnTimeLimitSeconds = ref<number>(
  getTurnTimeLimitSeconds(store.gameState.config),
);
const diplomacyEnabled = ref<boolean>(store.gameState.config.diplomacyEnabled);
const fogOfWar = ref<boolean>(store.gameState.config.fogOfWar);
const seedInput = ref<string>('');
const autoSaveSlotStr = ref<string>('0');

function pickRandomFaction(): FactionId {
  return PLAYABLE_FACTIONS[
    Math.floor(Math.random() * PLAYABLE_FACTIONS.length)
  ];
}

const onlineMode = ref<boolean>(false);
const createNickname = ref<string>('');
const createPassword = ref<string>('');
const createFaction = ref<FactionId>(pickRandomFaction());
const createPasswordInputRef = ref<HTMLInputElement | null>(null);

// Join tab state
const joinCode = ref<string>('');
const joinNickname = ref<string>('');
const joinPassword = ref<string>('');
const joinFaction = ref<FactionId>(FactionId.EMERALD);
const roomPreview = ref<RoomPreview | null>(null);
const previewLoading = ref<boolean>(false);
const previewError = ref<string | null>(null);
const passwordChecking = ref<boolean>(false);
const passwordError = ref<string | null>(null);
const passwordVerified = ref<boolean>(false);
const skipAutoLookupOnce = ref<boolean>(false);
const joinPasswordInputRef = ref<HTMLInputElement | null>(null);
const joinNicknameInputRef = ref<HTMLInputElement | null>(null);

const autoSaveSlotOptions = computed<SelectOption[]>(() => {
  const opts: SelectOption[] = [{value: '0', label: 'Без автосохранения'}];
  for (let slot = 1; slot <= MAX_SAVE_SLOTS; slot++) {
    const existing = store.saveSlots[slot - 1];
    opts.push({
      value: String(slot),
      label: existing
        ? `Слот ${slot} · ${existing.label}`
        : `Слот ${slot} (пустой)`,
    });
  }
  return opts;
});

const selectedAutoSaveSlot = computed<number | null>(() => {
  const num = Number.parseInt(autoSaveSlotStr.value, 10);
  return Number.isFinite(num) && num >= 1 && num <= MAX_SAVE_SLOTS
    ? num
    : null;
});

function syncFromConfig(tab: SetupModeTab): void {
  const cfg = store.gameState.config;
  store.refreshSaveSlots();
  modeTab.value = tab;
  createStep.value = 'settings';
  joinStep.value = 'code';
  factionCount.value = cfg.factionCount;
  humanCount.value = Math.min(cfg.humanCount, cfg.factionCount);
  difficultyIdx.value = Math.max(
    0,
    DIFFICULTY_STEPS.findIndex((d) => d.id === cfg.difficulty),
  );
  mapSizeIdx.value = Math.max(
    0,
    MAP_SIZE_STEPS.findIndex((s) => s.id === cfg.mapSize),
  );
  treeRateIdx.value = Math.max(
    0,
    TREE_RATE_STEPS.findIndex((t) => t.id === cfg.treeSpawnRate),
  );
  scenario.value = cfg.scenario;
  turnTimeLimitSeconds.value = getTurnTimeLimitSeconds(cfg);
  diplomacyEnabled.value = cfg.diplomacyEnabled;
  fogOfWar.value = cfg.fogOfWar;
  seedInput.value = '';
  autoSaveSlotStr.value = '0';
  onlineMode.value = false;
  createPassword.value = '';
  createFaction.value = pickRandomFaction();
  joinCode.value = '';
  joinPassword.value = '';
  roomPreview.value = null;
  previewError.value = null;
  passwordError.value = null;
  passwordVerified.value = false;
  skipAutoLookupOnce.value = false;
  store.onlineError = null;
}

watch(
  () => [props.initialTab, props.resetKey] as const,
  ([nextTab]) => {
    syncFromConfig(nextTab);
  },
  {immediate: true},
);

watch(factionCount, (nextTotal) => {
  if (humanCount.value > nextTotal) {
    humanCount.value = nextTotal;
  }
});

watch(humanCount, (nextHumans) => {
  if (nextHumans < 2) {
    onlineMode.value = false;
  }
});

const botCount = computed(() =>
  Math.max(0, factionCount.value - humanCount.value),
);

const canEnableOnline = computed(() => humanCount.value >= 2);

const headerState = computed<SetupHeaderState>(() => {
  if (modeTab.value === 'create') {
    if (createStep.value === 'online-profile') {
      return {
        title: 'Онлайн-профиль',
        stepText: 'Шаг 2 из 3',
        canGoBackInside: true,
      };
    }
    if (createStep.value === 'online-password') {
      return {
        title: 'Пароль комнаты',
        stepText: 'Шаг 3 из 3',
        canGoBackInside: true,
      };
    }
    return {
      title: 'Новая игра',
      stepText:
        canEnableOnline.value && onlineMode.value ? 'Шаг 1 из 3' : null,
      canGoBackInside: false,
    };
  }

  const totalJoinSteps = roomPreview.value?.hasPassword ? 3 : 2;
  if (joinStep.value === 'password') {
    return {
      title: 'Пароль комнаты',
      stepText: 'Шаг 2 из 3',
      canGoBackInside: true,
    };
  }
  if (joinStep.value === 'character') {
    return {
      title: 'Настройка персонажа',
      stepText: `Шаг ${totalJoinSteps} из ${totalJoinSteps}`,
      canGoBackInside: true,
    };
  }
  return {
    title: 'Присоединиться',
    stepText: 'Шаг 1',
    canGoBackInside: false,
  };
});

watch(
  headerState,
  (next) => {
    emit('headerChange', next);
  },
  {immediate: true},
);

function switchTab(next: SetupModeTab): void {
  modeTab.value = next;
  createStep.value = 'settings';
  joinStep.value = 'code';
  store.onlineError = null;
  previewError.value = null;
  passwordError.value = null;
}

function toggleOnlineMode(): void {
  if (!onlineMode.value) {
    if (humanCount.value < 2) {
      humanCount.value = 2;
    }
    onlineMode.value = true;
  } else {
    onlineMode.value = false;
  }
}

function goBack(): void {
  store.onlineError = null;
  if (modeTab.value === 'create') {
    if (createStep.value === 'online-password') {
      createStep.value = 'online-profile';
      return;
    }
    if (createStep.value === 'online-profile') {
      createStep.value = 'settings';
      return;
    }
    emit('cancel');
    return;
  }

  if (joinStep.value === 'character') {
    if (roomPreview.value?.hasPassword) {
      joinStep.value = 'password';
      passwordVerified.value = false;
      passwordError.value = null;
      return;
    }
    skipAutoLookupOnce.value = true;
    joinStep.value = 'code';
    return;
  }
  if (joinStep.value === 'password') {
    skipAutoLookupOnce.value = true;
    joinStep.value = 'code';
    passwordError.value = null;
    return;
  }
  emit('cancel');
}

defineExpose({goBack});

function advanceCreateFromSettings(): void {
  store.onlineError = null;
  if (canEnableOnline.value && onlineMode.value) {
    createStep.value = 'online-profile';
    return;
  }
  launchCreate();
}

function advanceCreateToPassword(): void {
  store.onlineError = null;
  createStep.value = 'online-password';
  void nextTick(() => {
    createPasswordInputRef.value?.focus();
  });
}

const takenJoinFactions = computed(
  () => new Set(roomPreview.value?.takenFactions ?? []),
);

const aiJoinFactions = computed(
  () => new Set(roomPreview.value?.aiFactions ?? []),
);

const openOnlineJoinFactions = computed(
  () => new Set(roomPreview.value?.openOnlineFactions ?? []),
);

const isMidGameJoin = computed(() => roomPreview.value?.status === 'PLAYING');

function selectDefaultJoinFaction(preview: RoomPreview): string | null {
  const taken = new Set(preview.takenFactions);
  if (preview.status === 'PLAYING') {
    const preferred =
      preview.openOnlineFactions[0] ?? preview.aiFactions[0] ?? undefined;
    if (preferred !== undefined) {
      joinFaction.value = preferred;
      return null;
    }
    return 'Нет свободных фракций или ИИ для замены.';
  }
  if (preview.status === 'WAITING') {
    if (preview.slotsFilled >= preview.slotsTotal) {
      return 'Нет свободных мест в комнате.';
    }
    const firstFree = PLAYABLE_FACTIONS.find((f) => !taken.has(f));
    if (firstFree !== undefined) {
      joinFaction.value = firstFree;
      return null;
    }
    return 'Нет свободных цветов.';
  }
  return 'Партия уже завершена.';
}

const canJoinNow = computed(() => {
  const preview = roomPreview.value;
  if (!preview || joinStep.value !== 'character') return false;
  if (preview.hasPassword && !passwordVerified.value) return false;
  if (preview.status === 'WAITING') {
    if (preview.slotsFilled >= preview.slotsTotal) return false;
  } else if (preview.status === 'PLAYING') {
    if (
      preview.openOnlineFactions.length === 0 &&
      preview.aiFactions.length === 0
    ) {
      return false;
    }
  } else {
    return false;
  }
  if (takenJoinFactions.value.has(joinFaction.value)) return false;
  return joinNickname.value.trim().length > 0 && !store.onlineBusy;
});

async function lookupRoom(): Promise<void> {
  const code = joinCode.value.trim().toUpperCase();
  joinCode.value = code;
  if (code.length < 4) {
    previewError.value = 'Введите код комнаты.';
    roomPreview.value = null;
    return;
  }

  previewLoading.value = true;
  previewError.value = null;
  passwordError.value = null;
  passwordVerified.value = false;
  store.onlineError = null;

  try {
    const preview = await wsClient.fetchRoomPreview(code);
    roomPreview.value = preview;
    const availabilityErr = selectDefaultJoinFaction(preview);
    if (availabilityErr) {
      previewError.value = availabilityErr;
      return;
    }

    if (preview.hasPassword) {
      joinPassword.value = '';
      joinStep.value = 'password';
      void nextTick(() => {
        joinPasswordInputRef.value?.focus();
      });
    } else {
      passwordVerified.value = true;
      joinStep.value = 'character';
      void nextTick(() => {
        joinNicknameInputRef.value?.focus();
      });
    }
  } catch (err) {
    roomPreview.value = null;
    previewError.value =
      err instanceof Error ? err.message : 'Комната не найдена.';
  } finally {
    previewLoading.value = false;
  }
}

async function verifyPasswordStep(): Promise<void> {
  if (!roomPreview.value) return;
  const pwd = joinPassword.value.trim();
  if (!pwd) {
    passwordError.value = 'Введите пароль комнаты.';
    return;
  }

  passwordChecking.value = true;
  passwordError.value = null;
  store.onlineError = null;
  try {
    const freshPreview = await wsClient.verifyRoomPassword(
      roomPreview.value.code,
      pwd,
    );
    roomPreview.value = freshPreview;
    const availabilityErr = selectDefaultJoinFaction(freshPreview);
    if (availabilityErr) {
      passwordError.value = availabilityErr;
      return;
    }
    passwordVerified.value = true;
    joinStep.value = 'character';
    void nextTick(() => {
      joinNicknameInputRef.value?.focus();
    });
  } catch (err) {
    passwordVerified.value = false;
    passwordError.value =
      err instanceof Error ? err.message : 'Неверный пароль комнаты.';
  } finally {
    passwordChecking.value = false;
  }
}

watch(joinCode, (val) => {
  const upper = val.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (upper !== val) {
    joinCode.value = upper;
    return;
  }
  if (skipAutoLookupOnce.value) {
    skipAutoLookupOnce.value = false;
    return;
  }
  if (upper.length === 6 && joinStep.value === 'code') {
    void lookupRoom();
  } else if (upper.length < 6) {
    roomPreview.value = null;
    previewError.value = null;
    passwordVerified.value = false;
  }
});

function buildGameConfig() {
  const trimmedSeed = seedInput.value.trim();
  const parsedSeed =
    trimmedSeed.length > 0 && /^\d+$/.test(trimmedSeed)
      ? Number.parseInt(trimmedSeed, 10)
      : undefined;

  return {
    mode: humanCount.value > 1 ? GameMode.HOTSEAT : GameMode.SKIRMISH,
    scenario: scenario.value,
    mapSize: MAP_SIZE_STEPS[mapSizeIdx.value].id,
    factionCount: factionCount.value,
    humanCount: humanCount.value,
    difficulty: DIFFICULTY_STEPS[difficultyIdx.value].id,
    treeSpawnRate: TREE_RATE_STEPS[treeRateIdx.value].id,
    riversAndLakes: true,
    diplomacyEnabled: diplomacyEnabled.value,
    fogOfWar: fogOfWar.value,
    turnTimeLimitSeconds: turnTimeLimitSeconds.value,
    seed: parsedSeed ?? 0,
  };
}

function launchCreate(): void {
  const cfg = buildGameConfig();
  if (canEnableOnline.value && onlineMode.value) {
    const nick =
      createNickname.value.trim() ||
      FACTION_PALETTES[createFaction.value]?.name ||
      'Игрок';
    void store.createOnlineRoom(
      cfg,
      nick,
      createFaction.value,
      createPassword.value.trim() || undefined,
      selectedAutoSaveSlot.value,
    );
    return;
  }

  store.startNewGame(
    {
      ...cfg,
      seed: cfg.seed > 0 ? cfg.seed : undefined,
    },
    selectedAutoSaveSlot.value,
  );
}

function launchJoin(): void {
  if (!roomPreview.value || !canJoinNow.value) return;
  void store.joinOnlineRoom(
    roomPreview.value.code,
    joinNickname.value.trim(),
    joinFaction.value,
    joinPassword.value.trim() || undefined,
  );
}
</script>

<template>
  <div class="w-full min-w-0 space-y-3.5">
    <!-- Optional Mode Switcher (used inside modal dialog) -->
    <div
      v-if="showTabs && createStep === 'settings' && joinStep === 'code'"
      class="grid grid-cols-2 gap-1 rounded-lg border border-border bg-secondary/45 p-1"
    >
      <button
        type="button"
        class="flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
        :class="
          modeTab === 'create'
            ? 'bg-primary text-primary-foreground shadow-xs'
            : 'text-muted-foreground hover:text-foreground'
        "
        @click="switchTab('create')"
      >
        <PlusCircle class="size-3.5 shrink-0" />
        <span class="truncate">Создать</span>
      </button>

      <button
        type="button"
        class="flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
        :class="
          modeTab === 'join'
            ? 'bg-primary text-primary-foreground shadow-xs'
            : 'text-muted-foreground hover:text-foreground'
        "
        @click="switchTab('join')"
      >
        <LogIn class="size-3.5 shrink-0" />
        <span class="truncate">Присоединиться</span>
      </button>
    </div>

    <!-- ==================== CREATE GAME (STEP-BY-STEP) ==================== -->
    <template v-if="modeTab === 'create'">
      <!-- CREATE STEP 1: MAP & MATCH SETTINGS -->
      <template v-if="createStep === 'settings'">
        <div
          class="space-y-3 rounded-lg border border-border bg-secondary/30 p-3"
        >
          <!-- Factions count (2..6) -->
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium text-foreground">Фракции</span>
              <span class="font-mono font-semibold tabular-nums text-primary">
                {{ factionCount }}
              </span>
            </div>
            <Slider
              :model-value="[factionCount]"
              :min="2"
              :max="6"
              :step="1"
              @update:model-value="(v) => (factionCount = v[0])"
            />
          </div>

          <!-- Players count (1..factionCount) -->
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium text-foreground">Игроки</span>
              <span
                class="font-mono font-semibold tabular-nums text-foreground"
              >
                {{ humanCount }}
                <span class="text-muted-foreground font-normal">
                  · {{ botCount }} ИИ
                </span>
                <span
                  v-if="humanCount > 1"
                  class="text-primary font-medium ml-1"
                >
                  · {{ onlineMode ? 'Онлайн' : 'Хотсит' }}
                </span>
              </span>
            </div>
            <Slider
              :model-value="[humanCount]"
              :min="1"
              :max="factionCount"
              :step="1"
              @update:model-value="(v) => (humanCount = v[0])"
            />
          </div>

          <!-- AI Difficulty -->
          <div v-if="botCount > 0" class="space-y-1.5">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium text-foreground">ИИ</span>
              <span class="font-semibold text-primary">
                {{ DIFFICULTY_STEPS[difficultyIdx].label }}
              </span>
            </div>
            <Slider
              :model-value="[difficultyIdx]"
              :min="0"
              :max="DIFFICULTY_STEPS.length - 1"
              :step="1"
              @update:model-value="(v) => (difficultyIdx = v[0])"
            />
          </div>

          <!-- Map Size -->
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium text-foreground">Размер</span>
              <span class="font-semibold text-primary">
                {{ MAP_SIZE_STEPS[mapSizeIdx].label }}
              </span>
            </div>
            <Slider
              :model-value="[mapSizeIdx]"
              :min="0"
              :max="MAP_SIZE_STEPS.length - 1"
              :step="1"
              @update:model-value="(v) => (mapSizeIdx = v[0])"
            />
          </div>

          <!-- Trees Amount -->
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium text-foreground">Деревья</span>
              <span class="font-semibold text-primary">
                {{ TREE_RATE_STEPS[treeRateIdx].label }}
              </span>
            </div>
            <Slider
              :model-value="[treeRateIdx]"
              :min="0"
              :max="TREE_RATE_STEPS.length - 1"
              :step="1"
              @update:model-value="(v) => (treeRateIdx = v[0])"
            />
          </div>
        </div>

        <!-- Map Geography, Turn Timer & Optional Seed -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div class="min-w-0 space-y-1">
            <label class="text-xs font-medium text-muted-foreground">
              Карта
            </label>
            <Select
              :model-value="scenario"
              :options="SCENARIO_OPTIONS"
              @update:model-value="(v) => (scenario = v as ScenarioId)"
            />
          </div>

          <div class="min-w-0 space-y-1">
            <label class="text-xs font-medium text-muted-foreground">
              На ход
            </label>
            <Select
              :model-value="String(turnTimeLimitSeconds)"
              :options="TURN_LIMIT_SELECT_OPTIONS"
              @update:model-value="
                (v) => (turnTimeLimitSeconds = Number.parseInt(v, 10) || 0)
              "
            />
          </div>

          <div class="min-w-0 space-y-1">
            <label
              for="opt-seed"
              class="text-xs font-medium text-muted-foreground"
            >
              Сид
            </label>
            <input
              id="opt-seed"
              v-model="seedInput"
              type="text"
              inputmode="numeric"
              placeholder="Случайный"
              class="flex h-9 w-full min-w-0 rounded-md border border-border bg-secondary/50 px-3 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>

        <!-- Options Checkboxes -->
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            role="checkbox"
            :aria-checked="diplomacyEnabled"
            class="flex h-10 min-w-0 items-center justify-between gap-2 rounded-lg border px-3 text-xs font-medium transition-colors cursor-pointer select-none"
            :class="
              diplomacyEnabled
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground'
            "
            @click="diplomacyEnabled = !diplomacyEnabled"
          >
            <span class="truncate">Дипломатия</span>
            <span
              class="flex size-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors"
              :class="
                diplomacyEnabled
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background'
              "
            >
              <Check v-if="diplomacyEnabled" class="size-3.5 stroke-[2.75]" />
            </span>
          </button>

          <button
            type="button"
            role="checkbox"
            :aria-checked="fogOfWar"
            class="flex h-10 min-w-0 items-center justify-between gap-2 rounded-lg border px-3 text-xs font-medium transition-colors cursor-pointer select-none"
            :class="
              fogOfWar
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground'
            "
            @click="fogOfWar = !fogOfWar"
          >
            <span class="truncate">Туман войны</span>
            <span
              class="flex size-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors"
              :class="
                fogOfWar
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background'
              "
            >
              <Check v-if="fogOfWar" class="size-3.5 stroke-[2.75]" />
            </span>
          </button>
        </div>

        <!-- Solo/Hotseat Auto-save Slot Selector (when offline) -->
        <div v-if="!onlineMode" class="min-w-0 space-y-1">
          <label
            class="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
          >
            <Save class="size-3 text-primary" />
            <span>Автосохранение (раз в 5 мин)</span>
          </label>
          <Select
            :model-value="autoSaveSlotStr"
            :options="autoSaveSlotOptions"
            @update:model-value="(v) => (autoSaveSlotStr = v)"
          />
        </div>

        <!-- Online Mode Toggle (Configures online in next steps) -->
        <button
          type="button"
          role="checkbox"
          :aria-checked="onlineMode"
          class="flex min-h-11 w-full items-center justify-between gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer select-none"
          :class="
            onlineMode
              ? 'border-primary/60 bg-primary/12'
              : 'border-primary/35 bg-primary/6 hover:bg-primary/10'
          "
          @click="toggleOnlineMode"
        >
          <span
            class="flex flex-1 min-w-0 items-center gap-2 text-xs font-semibold text-foreground"
          >
            <Globe class="size-4 text-primary shrink-0" />
            <span class="truncate">Онлайн-комната</span>
            <span
              v-if="onlineMode"
              class="text-[11px] font-normal text-muted-foreground truncate"
            >
              · настройка далее
            </span>
          </span>
          <span
            class="flex size-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors"
            :class="
              onlineMode
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background'
            "
          >
            <Check v-if="onlineMode" class="size-3.5 stroke-[2.75]" />
          </span>
        </button>

        <div class="flex justify-end gap-2 pt-0.5">
          <Button variant="ghost" size="sm" @click="emit('cancel')">
            Отмена
          </Button>
          <Button
            variant="default"
            size="sm"
            class="gap-1.5"
            :disabled="store.onlineBusy"
            @click="advanceCreateFromSettings"
          >
            <span>
              {{ canEnableOnline && onlineMode ? 'Далее' : 'Начать' }}
            </span>
            <ArrowRight
              v-if="canEnableOnline && onlineMode"
              class="size-3.5"
            />
          </Button>
        </div>
      </template>

      <!-- CREATE STEP 2: ONLINE HOST PROFILE (NICKNAME, COLOR, AUTO-SAVE SLOT) -->
      <template v-else-if="createStep === 'online-profile'">
        <div
          class="flex items-center justify-between text-xs text-muted-foreground border-b border-border/60 pb-2"
        >
          <span>
            {{ MAP_SIZE_STEPS[mapSizeIdx].label }} · {{ factionCount }} фр. ·
            {{ humanCount }} чел.
          </span>
          <span class="font-mono tabular-nums text-primary font-medium">
            2 / 3
          </span>
        </div>

        <div class="space-y-3.5">
          <div class="space-y-1.5">
            <label
              for="create-nick"
              class="text-xs font-medium text-foreground"
            >
              Ваше имя
            </label>
            <input
              id="create-nick"
              v-model="createNickname"
              type="text"
              maxlength="20"
              :placeholder="FACTION_PALETTES[createFaction]?.name ?? 'Никнейм'"
              class="flex h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              @keydown.enter="advanceCreateToPassword"
            />
          </div>

          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium text-foreground">Цвет державы</span>
              <span class="text-muted-foreground">
                {{ FACTION_PALETTES[createFaction]?.name }}
              </span>
            </div>
            <div class="grid grid-cols-6 gap-2">
              <button
                v-for="fId in PLAYABLE_FACTIONS"
                :key="fId"
                type="button"
                class="relative flex h-10 items-center justify-center rounded-md border-2 transition-all cursor-pointer"
                :style="{backgroundColor: FACTION_PALETTES[fId].tileHex}"
                :class="
                  createFaction === fId
                    ? 'border-white scale-105 shadow-md'
                    : 'border-transparent opacity-75 hover:opacity-100'
                "
                :title="FACTION_PALETTES[fId].name"
                @click="createFaction = fId"
              >
                <Check
                  v-if="createFaction === fId"
                  class="size-4 text-white drop-shadow"
                />
              </button>
            </div>
          </div>

          <div class="space-y-1.5">
            <label
              class="inline-flex items-center gap-1.5 text-xs font-medium text-foreground"
            >
              <Save class="size-3.5 text-primary" />
              <span>Ячейка автосохранения хоста (раз в 5 мин)</span>
            </label>
            <Select
              :model-value="autoSaveSlotStr"
              :options="autoSaveSlotOptions"
              @update:model-value="(v) => (autoSaveSlotStr = v)"
            />
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 pt-1">
          <Button variant="ghost" size="sm" class="gap-1.5" @click="goBack">
            <ArrowLeft class="size-3.5" />
            <span>Назад</span>
          </Button>
          <Button
            variant="default"
            size="sm"
            class="gap-1.5"
            @click="advanceCreateToPassword"
          >
            <span>Далее</span>
            <ArrowRight class="size-3.5" />
          </Button>
        </div>
      </template>

      <!-- CREATE STEP 3: OPTIONAL ROOM PASSWORD -->
      <template v-else>
        <div
          class="flex items-center justify-between text-xs text-muted-foreground border-b border-border/60 pb-2"
        >
          <span class="inline-flex items-center gap-1.5 truncate">
            <span
              class="inline-block size-2.5 shrink-0 rounded-xs"
              :style="{
                backgroundColor: FACTION_PALETTES[createFaction]?.tileHex,
              }"
            />
            <span class="truncate text-foreground font-medium">
              {{
                createNickname.trim() ||
                FACTION_PALETTES[createFaction]?.name ||
                'Игрок'
              }}
            </span>
            <template v-if="selectedAutoSaveSlot">
              <span>· Слот {{ selectedAutoSaveSlot }}</span>
            </template>
          </span>
          <span class="font-mono tabular-nums text-primary font-medium shrink-0">
            3 / 3
          </span>
        </div>

        <div class="space-y-3">
          <div class="space-y-1.5">
            <label
              for="create-pass"
              class="inline-flex items-center gap-1.5 text-xs font-medium text-foreground"
            >
              <Lock class="size-3.5 text-primary" />
              <span>Пароль для входа в комнату</span>
            </label>
            <input
              id="create-pass"
              ref="createPasswordInputRef"
              v-model="createPassword"
              type="password"
              maxlength="24"
              placeholder="Оставьте пустым для открытого входа"
              class="flex h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              @keydown.enter="launchCreate"
            />
            <p class="text-[11px] leading-snug text-muted-foreground">
              Комната получит случайное название и код для приглашения. Пароль
              необязателен.
            </p>
          </div>
        </div>

        <div
          v-if="store.onlineError"
          class="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 break-words"
        >
          {{ store.onlineError }}
        </div>

        <div class="flex items-center justify-between gap-2 pt-1">
          <Button variant="ghost" size="sm" class="gap-1.5" @click="goBack">
            <ArrowLeft class="size-3.5" />
            <span>Назад</span>
          </Button>
          <Button
            variant="default"
            size="sm"
            class="gap-1.5"
            :disabled="store.onlineBusy"
            @click="launchCreate"
          >
            <Loader2 v-if="store.onlineBusy" class="size-4 animate-spin" />
            <span>
              {{
                createPassword.trim().length > 0
                  ? 'Создать с паролем'
                  : 'Создать комнату'
              }}
            </span>
          </Button>
        </div>
      </template>
    </template>

    <!-- ==================== JOIN EXISTING ROOM (STEP-BY-STEP) ==================== -->
    <template v-else>
      <!-- JOIN STEP 1: ENTER ROOM CODE -->
      <template v-if="joinStep === 'code'">
        <div class="space-y-3 rounded-lg border border-border bg-secondary/30 p-3">
          <div class="space-y-1.5">
            <label for="join-code" class="text-xs font-medium text-foreground">
              Код комнаты
            </label>
            <div class="flex w-full min-w-0 items-center gap-2">
              <input
                id="join-code"
                v-model="joinCode"
                type="text"
                maxlength="8"
                placeholder="Например, A7K4P2"
                class="flex h-10 w-full min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-sm font-bold uppercase tracking-wider text-foreground placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                @keydown.enter="lookupRoom"
              />
              <Button
                variant="secondary"
                size="sm"
                class="h-10 shrink-0 px-3 gap-1.5"
                :disabled="previewLoading || joinCode.trim().length < 4"
                @click="lookupRoom"
              >
                <Loader2 v-if="previewLoading" class="size-4 animate-spin" />
                <Search v-else class="size-4" />
                <span class="text-xs">Найти</span>
              </Button>
            </div>
          </div>

          <div
            v-if="previewError"
            class="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 break-words"
          >
            {{ previewError }}
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-0.5">
          <Button variant="ghost" size="sm" @click="emit('cancel')">
            Отмена
          </Button>
          <Button
            variant="default"
            size="sm"
            class="gap-1.5"
            :disabled="previewLoading || joinCode.trim().length < 4"
            @click="lookupRoom"
          >
            <Loader2 v-if="previewLoading" class="size-3.5 animate-spin" />
            <span>Далее</span>
            <ArrowRight v-if="!previewLoading" class="size-3.5" />
          </Button>
        </div>
      </template>

      <!-- JOIN STEP 2: VERIFY ROOM PASSWORD FIRST -->
      <template v-else-if="joinStep === 'password' && roomPreview">
        <div
          class="space-y-3 rounded-lg border border-primary/35 bg-card/85 p-3.5"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div
                class="flex items-center gap-1.5 text-sm font-bold text-foreground truncate"
              >
                <Lock class="size-3.5 shrink-0 text-amber-300" />
                <span class="truncate">{{ roomPreview.name }}</span>
              </div>
              <div class="text-xs text-muted-foreground font-mono tabular-nums">
                {{ roomPreview.code }} ·
                {{ isMidGameJoin ? 'В игре' : 'Лобби' }} ·
                {{ roomPreview.slotsFilled }}/{{ roomPreview.slotsTotal }}
              </div>
            </div>
          </div>

          <div class="space-y-1.5 pt-1 border-t border-border/60">
            <label
              for="join-pass"
              class="inline-flex items-center gap-1.5 text-xs font-medium text-foreground"
            >
              <KeyRound class="size-3.5 text-primary" />
              <span>Введите пароль комнаты</span>
            </label>
            <input
              id="join-pass"
              ref="joinPasswordInputRef"
              v-model="joinPassword"
              type="password"
              maxlength="24"
              placeholder="Пароль"
              class="flex h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              @keydown.enter="verifyPasswordStep"
            />
          </div>

          <div
            v-if="passwordError"
            class="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 break-words"
          >
            {{ passwordError }}
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 pt-0.5">
          <Button variant="ghost" size="sm" class="gap-1.5" @click="goBack">
            <ArrowLeft class="size-3.5" />
            <span>Назад</span>
          </Button>
          <Button
            variant="default"
            size="sm"
            class="gap-1.5"
            :disabled="passwordChecking || joinPassword.trim().length === 0"
            @click="verifyPasswordStep"
          >
            <Loader2 v-if="passwordChecking" class="size-3.5 animate-spin" />
            <span>Проверить</span>
            <ArrowRight v-if="!passwordChecking" class="size-3.5" />
          </Button>
        </div>
      </template>

      <!-- JOIN STEP 3: CHARACTER SETUP (NICKNAME & COLOR) -->
      <template v-else-if="joinStep === 'character' && roomPreview">
        <div
          class="space-y-3.5 rounded-lg border border-primary/35 bg-card/85 p-3.5"
        >
          <!-- Room Identity Header -->
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div
                class="flex items-center gap-1.5 text-sm font-bold text-foreground truncate"
              >
                <Users class="size-4 shrink-0 text-primary" />
                <span class="truncate">{{ roomPreview.name }}</span>
                <Lock
                  v-if="roomPreview.hasPassword"
                  class="size-3 shrink-0 text-emerald-400"
                  title="Пароль подтверждён"
                />
              </div>
              <div
                class="text-xs text-muted-foreground font-mono tabular-nums"
              >
                {{ roomPreview.code }} ·
                {{ isMidGameJoin ? 'В игре' : 'Ожидание игроков' }} ·
                {{ roomPreview.slotsFilled }}/{{ roomPreview.slotsTotal }}
              </div>
            </div>
          </div>

          <!-- Players already in room -->
          <div
            v-if="roomPreview.players.length > 0"
            class="flex flex-wrap gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground"
          >
            <div
              v-for="p in roomPreview.players"
              :key="p.playerId"
              class="inline-flex max-w-full items-center gap-1.5"
            >
              <span
                class="inline-block size-2.5 shrink-0 rounded-xs border border-white/20"
                :style="{
                  backgroundColor:
                    FACTION_PALETTES[p.factionId]?.tileHex ?? '#94a3b8',
                }"
              />
              <span class="truncate font-medium text-foreground">
                {{ p.nickname }}
              </span>
            </div>
          </div>

          <!-- Joiner Nickname -->
          <div class="space-y-1.5 border-t border-border/60 pt-2.5">
            <label for="join-nick" class="text-xs font-medium text-foreground">
              Ваше имя
            </label>
            <input
              id="join-nick"
              ref="joinNicknameInputRef"
              v-model="joinNickname"
              type="text"
              maxlength="20"
              placeholder="Введите никнейм"
              class="flex h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              @keydown.enter="launchJoin"
            />
          </div>

          <!-- Joiner Color Swatch Picker -->
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium text-foreground">
                {{ isMidGameJoin ? 'Фракция (слот или ИИ)' : 'Цвет державы' }}
              </span>
              <span
                v-if="isMidGameJoin && aiJoinFactions.has(joinFaction)"
                class="text-amber-300"
              >
                Заменить ИИ
              </span>
              <span
                v-else-if="
                  isMidGameJoin && openOnlineJoinFactions.has(joinFaction)
                "
                class="text-emerald-400"
              >
                Свободный слот
              </span>
              <span v-else class="text-muted-foreground">
                {{ FACTION_PALETTES[joinFaction]?.name }}
              </span>
            </div>
            <div class="grid grid-cols-6 gap-2">
              <button
                v-for="fId in PLAYABLE_FACTIONS"
                :key="fId"
                type="button"
                :disabled="takenJoinFactions.has(fId)"
                class="relative flex h-10 items-center justify-center rounded-md border-2 transition-all cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                :style="{backgroundColor: FACTION_PALETTES[fId].tileHex}"
                :class="
                  joinFaction === fId && !takenJoinFactions.has(fId)
                    ? 'border-white scale-105 shadow-md'
                    : 'border-transparent opacity-80 hover:opacity-100'
                "
                :title="
                  takenJoinFactions.has(fId)
                    ? `${FACTION_PALETTES[fId].name} (занят)`
                    : aiJoinFactions.has(fId)
                      ? `${FACTION_PALETTES[fId].name} (заменить ИИ)`
                      : FACTION_PALETTES[fId].name
                "
                @click="joinFaction = fId"
              >
                <Check
                  v-if="joinFaction === fId && !takenJoinFactions.has(fId)"
                  class="size-4 text-white drop-shadow"
                />
                <Bot
                  v-else-if="
                    isMidGameJoin &&
                    aiJoinFactions.has(fId) &&
                    !takenJoinFactions.has(fId)
                  "
                  class="size-3.5 text-white/90 drop-shadow"
                />
              </button>
            </div>
          </div>
        </div>

        <div
          v-if="store.onlineError"
          class="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 break-words"
        >
          {{ store.onlineError }}
        </div>

        <div class="flex items-center justify-between gap-2 pt-0.5">
          <Button variant="ghost" size="sm" class="gap-1.5" @click="goBack">
            <ArrowLeft class="size-3.5" />
            <span>Назад</span>
          </Button>
          <Button
            variant="default"
            size="sm"
            class="gap-1.5"
            :disabled="!canJoinNow"
            @click="launchJoin"
          >
            <Loader2 v-if="store.onlineBusy" class="size-4 animate-spin" />
            <span>Войти в комнату</span>
          </Button>
        </div>
      </template>
    </template>
  </div>
</template>
