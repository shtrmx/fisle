<script setup lang="ts">
import {computed, reactive, ref, watch} from 'vue';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpDown,
  Check,
  ChevronRight,
  Flag,
  Handshake,
  Lock,
  Mail,
  MapPin,
  Send,
  Skull,
  Swords,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-vue-next';
import type {HexKey} from '@/domain/hex/hexCoordinates';
import {
  DiplomaticMessageStatus,
  DiplomaticRelation,
  ExchangeItemType,
  FactionId,
} from '@/domain/game/types';
import {
  BLACK_MARK_COST,
  FACTION_PALETTES,
  getRelation,
} from '@/domain/game/rules';
import {
  DEFAULT_FRIENDSHIP_DURATION,
  MAX_FRIENDSHIP_DURATION,
  MAX_SUBSIDY_DURATION,
  MIN_FRIENDSHIP_DURATION,
  MIN_SUBSIDY_DURATION,
  SUBSIDY_DURATION_TURNS,
} from '@/domain/game/diplomacyService';
import {useGameStore} from '@/application/stores/useGameStore';
import ModalDialog from '@/components/ui/dialog/ModalDialog.vue';
import {Button} from '@/components/ui/button';
import Select, {type SelectOption} from '@/components/ui/select/Select.vue';
import Slider from '@/components/ui/slider/Slider.vue';
import IncomeSparkline from '@/presentation/IncomeSparkline.vue';

const store = useGameStore();

type DialogScreen = 'list' | 'country' | 'exchange' | 'inbox';

const screen = ref<DialogScreen>('list');
const selectedFactionId = ref<FactionId | null>(null);
const confirmAction = ref<'war' | 'black_mark' | 'message' | null>(null);
const confirmSurrender = ref(false);
const messageDraft = ref('');

const exchangeForm = reactive<{
  targetType: ExchangeItemType;
  targetAmount: number;
  targetDuration: number;
  targetHexKeys: HexKey[];
  targetWarOn: string;
  proposerType: ExchangeItemType;
  proposerAmount: number;
  proposerDuration: number;
  proposerHexKeys: HexKey[];
  proposerWarOn: string;
}>({
  targetType: ExchangeItemType.NOTHING,
  targetAmount: 10,
  targetDuration: SUBSIDY_DURATION_TURNS,
  targetHexKeys: [],
  targetWarOn: '',
  proposerType: ExchangeItemType.NOTHING,
  proposerAmount: 10,
  proposerDuration: SUBSIDY_DURATION_TURNS,
  proposerHexKeys: [],
  proposerWarOn: '',
});

watch(
  () => store.landPickerCompleted,
  (result) => {
    if (!result) return;
    if (result.side === 'target') {
      exchangeForm.targetHexKeys = [...result.hexKeys];
      exchangeForm.targetAmount = result.hexKeys.length;
    } else {
      exchangeForm.proposerHexKeys = [...result.hexKeys];
      exchangeForm.proposerAmount = result.hexKeys.length;
    }
  },
);

watch(
  () => store.showDiplomacyDialog,
  (isOpen) => {
    if (!isOpen) return;
    store.markNotificationsReadByCategories([
      'WAR',
      'FRIEND',
      'NEUTRAL',
      'BLACK_MARK',
      'EXCHANGE',
      'MESSAGE',
      'REJECTED',
    ]);
    if (store.returningFromLandPicker) {
      store.returningFromLandPicker = false;
      return;
    }
    screen.value = store.pendingMessagesCount > 0 ? 'inbox' : 'list';
    selectedFactionId.value = null;
    confirmAction.value = null;
    confirmSurrender.value = false;
    messageDraft.value = '';
  },
);

watch(screen, () => {
  confirmSurrender.value = false;
});

function getFactionDisplayName(fId: FactionId): string {
  return store.gameState.factions[fId]?.name ?? FACTION_PALETTES[fId].name;
}

const rivalCountries = computed(() => {
  void store.boardVersion;
  const me = store.viewerFactionId;
  return store.gameState.turnOrder
    .filter((fId) => fId !== me)
    .map((fId) => {
      const info = store.gameState.factions[fId];
      const rel = getRelation(store.gameState, me, fId);
      const hasMarkPair = store.hasBlackMarkWith(fId);
      const markTurns = store.gameState.diplomacy.blackMarks[fId] ?? 0;
      const friendTurns = store.getFriendshipTurns(fId);
      const onlineSlot = store.onlinePresenceByFaction[fId] ?? null;
      return {
        id: fId,
        name: info.name,
        isHuman: info.isHuman,
        isEliminated: info.isEliminated,
        totalNetIncome: info.totalNetIncome,
        palette: FACTION_PALETTES[fId],
        relation: rel,
        friendTurns,
        hasBlackMark: hasMarkPair || markTurns > 0,
        blackMarkTurns: markTurns,
        onlineSlot,
      };
    });
});

const selectedCountry = computed(() => {
  if (selectedFactionId.value === null) return null;
  return (
    rivalCountries.value.find((c) => c.id === selectedFactionId.value) ?? null
  );
});

const selectedIncomeHistory = computed<number[]>(() => {
  void store.boardVersion;
  if (selectedFactionId.value === null) return [0];
  const hist = store.gameState.incomeHistory[selectedFactionId.value];
  if (hist && hist.length > 0) return hist;
  const current =
    store.gameState.factions[selectedFactionId.value]?.totalNetIncome ?? 0;
  return [current];
});

const countryMessages = computed(() => {
  void store.boardVersion;
  if (selectedFactionId.value === null) return [];
  const me = store.viewerFactionId;
  const them = selectedFactionId.value;
  return store.gameState.diplomacy.messages.filter(
    (m) =>
      (m.fromFaction === me && m.toFaction === them) ||
      (m.fromFaction === them && m.toFaction === me),
  );
});

const pendingInboxMessages = computed(() => {
  void store.boardVersion;
  const me = store.viewerFactionId;
  return store.gameState.diplomacy.messages.filter(
    (m) =>
      m.toFaction === me && m.status === DiplomaticMessageStatus.PENDING,
  );
});

const ownMoney = computed(() => store.selectedProvince?.money ?? 0);

const ownTransferableLands = computed(() => {
  if (selectedFactionId.value === null) return 0;
  return store.getTransferableLandCount(
    store.viewerFactionId,
    selectedFactionId.value,
  );
});

const targetTransferableLands = computed(() => {
  if (selectedFactionId.value === null) return 0;
  return store.getTransferableLandCount(
    selectedFactionId.value,
    store.viewerFactionId,
  );
});

const thirdPartyFactions = computed<SelectOption[]>(() => {
  if (selectedFactionId.value === null) return [];
  return store.gameState.turnOrder
    .filter(
      (fId) =>
        fId !== store.viewerFactionId &&
        fId !== selectedFactionId.value &&
        !store.gameState.factions[fId]?.isEliminated,
    )
    .map((fId) => ({
      value: String(fId),
      label: getFactionDisplayName(fId),
    }));
});

const friendshipEligibility = computed(() => {
  if (selectedFactionId.value === null) return {allowed: false};
  return store.canBeFriendsWith(selectedFactionId.value);
});

function buildSideOptions(isTargetSide: boolean): SelectOption[] {
  const c = selectedCountry.value;
  if (!c) return [];

  const isFriend = c.relation === DiplomaticRelation.FRIEND;
  const isWar = c.relation === DiplomaticRelation.WAR;
  const canLand = isTargetSide
    ? isFriend && targetTransferableLands.value > 0
    : ownTransferableLands.value > 0;
  const landHint = isTargetSide
    ? !isFriend
      ? 'Друзья'
      : targetTransferableLands.value === 0
        ? '0'
        : `${targetTransferableLands.value}`
    : `${ownTransferableLands.value}`;

  return [
    {value: ExchangeItemType.NOTHING, label: 'Ничего'},
    {
      value: ExchangeItemType.MONEY,
      label: 'Деньги',
      disabled: !isTargetSide && ownMoney.value < 1,
    },
    {
      value: ExchangeItemType.LAND,
      label: 'Земли',
      hint: landHint,
      disabled: !canLand,
    },
    {
      value: ExchangeItemType.FRIENDSHIP,
      label: 'Дружба',
      hint: !friendshipEligibility.value.allowed ? 'Метка' : undefined,
      disabled: isFriend || !friendshipEligibility.value.allowed,
    },
    {
      value: ExchangeItemType.DECLARE_WAR,
      label: 'Война против',
      disabled: thirdPartyFactions.value.length === 0,
    },
    {
      value: ExchangeItemType.END_WAR,
      label: 'Мир',
      disabled: !isWar,
    },
    {
      value: ExchangeItemType.REMOVE_BLACK_MARK,
      label: 'Снять метку',
      disabled: !c.hasBlackMark,
    },
    {
      value: ExchangeItemType.SUBSIDY,
      label: 'Дотации',
    },
  ];
}

const targetExchangeOptions = computed(() => buildSideOptions(true));
const proposerExchangeOptions = computed(() => buildSideOptions(false));

function relationBadge(rel: DiplomaticRelation): {
  label: string;
  className: string;
} {
  switch (rel) {
    case DiplomaticRelation.FRIEND:
      return {
        label: 'Друг',
        className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/35',
      };
    case DiplomaticRelation.WAR:
      return {
        label: 'Война',
        className: 'bg-rose-500/20 text-rose-300 border-rose-500/35',
      };
    default:
      return {
        label: 'Нейтраль',
        className: 'bg-secondary text-muted-foreground border-border',
      };
  }
}

function selectCountry(fId: FactionId): void {
  const c = rivalCountries.value.find((r) => r.id === fId);
  if (!c || c.isEliminated) return;
  selectedFactionId.value = fId;
  confirmAction.value = null;
  messageDraft.value = '';
  screen.value = 'country';
}

function resetExchangeDefaults(presetFriendship: boolean): void {
  const defaultWarTarget = thirdPartyFactions.value[0]?.value ?? '';
  exchangeForm.targetWarOn = defaultWarTarget;
  exchangeForm.proposerWarOn = defaultWarTarget;
  exchangeForm.targetHexKeys = [];
  exchangeForm.proposerHexKeys = [];

  if (presetFriendship) {
    exchangeForm.targetType = ExchangeItemType.FRIENDSHIP;
    exchangeForm.targetAmount = 0;
    exchangeForm.targetDuration = DEFAULT_FRIENDSHIP_DURATION;
    exchangeForm.proposerType = ExchangeItemType.SUBSIDY;
    exchangeForm.proposerAmount = 5;
    exchangeForm.proposerDuration = SUBSIDY_DURATION_TURNS;
  } else {
    exchangeForm.targetType = ExchangeItemType.NOTHING;
    exchangeForm.targetAmount = 10;
    exchangeForm.targetDuration = SUBSIDY_DURATION_TURNS;
    exchangeForm.proposerType = ExchangeItemType.NOTHING;
    exchangeForm.proposerAmount = Math.min(10, Math.max(1, ownMoney.value));
    exchangeForm.proposerDuration = SUBSIDY_DURATION_TURNS;
  }
}

function openExchange(presetFriendship = false): void {
  if (!selectedCountry.value) return;
  confirmAction.value = null;
  resetExchangeDefaults(presetFriendship);
  screen.value = 'exchange';
}

function clampSideAmount(side: 'target' | 'proposer'): void {
  const type =
    side === 'target' ? exchangeForm.targetType : exchangeForm.proposerType;
  const max = getMaxForType(type, side === 'target');
  if (side === 'target') {
    if (type === ExchangeItemType.LAND) {
      exchangeForm.targetHexKeys = [];
      exchangeForm.targetAmount = 0;
    } else if (type === ExchangeItemType.FRIENDSHIP) {
      exchangeForm.targetDuration = DEFAULT_FRIENDSHIP_DURATION;
    } else if (type === ExchangeItemType.SUBSIDY) {
      exchangeForm.targetDuration = SUBSIDY_DURATION_TURNS;
      exchangeForm.targetAmount = Math.max(
        1,
        Math.min(max, exchangeForm.targetAmount || 1),
      );
    } else {
      exchangeForm.targetAmount = Math.max(
        1,
        Math.min(max, exchangeForm.targetAmount || 1),
      );
    }
  } else {
    if (type === ExchangeItemType.LAND) {
      exchangeForm.proposerHexKeys = [];
      exchangeForm.proposerAmount = 0;
    } else if (type === ExchangeItemType.FRIENDSHIP) {
      exchangeForm.proposerDuration = DEFAULT_FRIENDSHIP_DURATION;
    } else if (type === ExchangeItemType.SUBSIDY) {
      exchangeForm.proposerDuration = SUBSIDY_DURATION_TURNS;
      exchangeForm.proposerAmount = Math.max(
        1,
        Math.min(max, exchangeForm.proposerAmount || 1),
      );
    } else {
      exchangeForm.proposerAmount = Math.max(
        1,
        Math.min(max, exchangeForm.proposerAmount || 1),
      );
    }
  }
}

function getMaxForType(type: ExchangeItemType, isTarget: boolean): number {
  if (type === ExchangeItemType.MONEY) {
    return isTarget ? 100 : Math.max(1, ownMoney.value);
  }
  if (type === ExchangeItemType.SUBSIDY) {
    return 30;
  }
  return 1;
}

function needsAmountSlider(type: ExchangeItemType): boolean {
  return type === ExchangeItemType.MONEY || type === ExchangeItemType.SUBSIDY;
}

function sliderUnitLabel(type: ExchangeItemType, value: number): string {
  if (type === ExchangeItemType.MONEY) return `${value} зол.`;
  if (type === ExchangeItemType.SUBSIDY) return `${value} / ход`;
  return '';
}

function openMapLandPicker(side: 'target' | 'proposer'): void {
  if (!selectedCountry.value) return;
  if (side === 'target') {
    store.startLandPicker(
      'target',
      selectedCountry.value.id,
      store.viewerFactionId,
      exchangeForm.targetHexKeys,
    );
  } else {
    store.startLandPicker(
      'proposer',
      store.viewerFactionId,
      selectedCountry.value.id,
      exchangeForm.proposerHexKeys,
    );
  }
}

function onTargetTypeChange(val: string): void {
  exchangeForm.targetType = val as ExchangeItemType;
  clampSideAmount('target');
}

function onProposerTypeChange(val: string): void {
  exchangeForm.proposerType = val as ExchangeItemType;
  clampSideAmount('proposer');
}

const canSubmitExchange = computed(() => {
  if (!selectedCountry.value || !store.canSendDiplomacy) return false;
  if (
    exchangeForm.targetType === ExchangeItemType.NOTHING &&
    exchangeForm.proposerType === ExchangeItemType.NOTHING
  ) {
    return false;
  }
  if (
    exchangeForm.targetType === ExchangeItemType.LAND &&
    exchangeForm.targetHexKeys.length === 0
  ) {
    return false;
  }
  if (
    exchangeForm.proposerType === ExchangeItemType.LAND &&
    exchangeForm.proposerHexKeys.length === 0
  ) {
    return false;
  }
  return true;
});

function submitExchange(): void {
  if (!selectedCountry.value || !canSubmitExchange.value) return;
  store.proposeExchange(selectedCountry.value.id, {
    targetGives: {
      type: exchangeForm.targetType,
      amount:
        exchangeForm.targetType === ExchangeItemType.LAND
          ? exchangeForm.targetHexKeys.length
          : needsAmountSlider(exchangeForm.targetType)
            ? exchangeForm.targetAmount
            : 0,
      duration:
        exchangeForm.targetType === ExchangeItemType.SUBSIDY ||
        exchangeForm.targetType === ExchangeItemType.FRIENDSHIP
          ? exchangeForm.targetDuration
          : undefined,
      hexKeys:
        exchangeForm.targetType === ExchangeItemType.LAND
          ? [...exchangeForm.targetHexKeys]
          : undefined,
      warTargetFaction:
        exchangeForm.targetType === ExchangeItemType.DECLARE_WAR &&
        exchangeForm.targetWarOn
          ? (Number(exchangeForm.targetWarOn) as FactionId)
          : undefined,
    },
    proposerGives: {
      type: exchangeForm.proposerType,
      amount:
        exchangeForm.proposerType === ExchangeItemType.LAND
          ? exchangeForm.proposerHexKeys.length
          : needsAmountSlider(exchangeForm.proposerType)
            ? exchangeForm.proposerAmount
            : 0,
      duration:
        exchangeForm.proposerType === ExchangeItemType.SUBSIDY ||
        exchangeForm.proposerType === ExchangeItemType.FRIENDSHIP
          ? exchangeForm.proposerDuration
          : undefined,
      hexKeys:
        exchangeForm.proposerType === ExchangeItemType.LAND
          ? [...exchangeForm.proposerHexKeys]
          : undefined,
      warTargetFaction:
        exchangeForm.proposerType === ExchangeItemType.DECLARE_WAR &&
        exchangeForm.proposerWarOn
          ? (Number(exchangeForm.proposerWarOn) as FactionId)
          : undefined,
    },
  });
  store.showDiplomacyDialog = false;
  screen.value = 'list';
}

function confirmDeclareWar(): void {
  if (!selectedCountry.value || !store.canSendDiplomacy) return;
  store.declareWarOn(selectedCountry.value.id);
  confirmAction.value = null;
  store.showDiplomacyDialog = false;
}

function confirmBlackMark(): void {
  if (!selectedCountry.value || !store.canSendDiplomacy) return;
  store.issueBlackMarkOn(selectedCountry.value.id);
  confirmAction.value = null;
  store.showDiplomacyDialog = false;
}

function submitCountryMessage(): void {
  if (
    !selectedCountry.value ||
    !messageDraft.value.trim() ||
    !store.canSendDiplomacy
  ) {
    return;
  }
  store.sendNoteTo(selectedCountry.value.id, messageDraft.value);
  messageDraft.value = '';
  confirmAction.value = null;
  store.showDiplomacyDialog = false;
}

const canSurrender = computed(
  () =>
    !store.isViewerEliminated &&
    store.gameState.winner === null &&
    (!store.isOnlineMode ||
      (store.roomStatus === 'PLAYING' && !store.isRoomPaused)),
);

function confirmSurrenderAction(): void {
  if (!canSurrender.value) return;
  confirmSurrender.value = false;
  store.surrenderCurrentFaction();
}
</script>

<template>
  <ModalDialog
    :open="store.showDiplomacyDialog"
    title="Дипломатия"
    content-class="w-[min(95vw,520px)] max-h-[86vh] overflow-y-auto"
    @update:open="(val) => (store.showDiplomacyDialog = val)"
  >
    <!-- Screen 1: Minimal Country List -->
    <div v-if="screen === 'list'" class="space-y-2.5">
      <div
        v-if="pendingInboxMessages.length > 0"
        class="flex items-center justify-between rounded-lg border border-primary/45 bg-primary/10 px-3 py-2 text-xs"
      >
        <span class="font-medium text-foreground">
          Входящие: {{ pendingInboxMessages.length }}
        </span>
        <Button size="sm" class="h-7 px-2.5 text-xs" @click="screen = 'inbox'">
          Открыть
        </Button>
      </div>

      <div class="space-y-1.5">
        <button
          v-for="country in rivalCountries"
          :key="country.id"
          type="button"
          :disabled="country.isEliminated"
          class="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-secondary/45 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/70 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
          @click="selectCountry(country.id)"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <span
              class="inline-block size-3.5 shrink-0 rounded-xs border border-white/25"
              :style="{backgroundColor: country.palette.tileHex}"
            />
            <span
              v-if="store.isOnlineMode && country.onlineSlot"
              class="inline-block size-2 shrink-0 rounded-full"
              :class="
                country.onlineSlot.online ? 'bg-emerald-400' : 'bg-zinc-500'
              "
              :title="country.onlineSlot.online ? 'В сети' : 'Офлайн'"
            />
            <span class="truncate text-sm font-semibold text-foreground">
              {{ country.name }}
            </span>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <span
              v-if="country.hasBlackMark && !country.isEliminated"
              class="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-300"
            >
              <Skull class="size-3" />
              Чёрная метка
            </span>
            <span
              v-if="country.isEliminated"
              class="rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              Выбыла
            </span>
            <span
              v-else
              class="rounded-md border px-2 py-0.5 text-[11px] font-semibold"
              :class="relationBadge(country.relation).className"
            >
              {{ relationBadge(country.relation).label
              }}<template
                v-if="
                  country.relation === DiplomaticRelation.FRIEND &&
                  country.friendTurns > 0
                "
              >
                · {{ country.friendTurns }} х.
              </template>
            </span>
            <ChevronRight
              v-if="!country.isEliminated"
              class="size-4 text-muted-foreground"
            />
          </div>
        </button>
      </div>

      <!-- Surrender Footer (with inline confirmation) -->
      <div
        v-if="canSurrender"
        class="border-t border-border pt-3"
      >
        <div
          v-if="!confirmSurrender"
          class="flex items-center justify-end"
        >
          <Button
            variant="outline"
            size="sm"
            class="h-8 gap-1.5 border-rose-500/35 text-xs text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
            @click="confirmSurrender = true"
          >
            <Flag class="size-3.5 shrink-0" />
            <span>Сдаться</span>
          </Button>
        </div>

        <div
          v-else
          class="flex flex-col gap-2.5 rounded-lg border border-rose-500/45 bg-rose-500/10 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="flex items-start gap-2 text-rose-200 min-w-0">
            <AlertTriangle class="size-4 shrink-0 text-rose-400 mt-0.5" />
            <span class="leading-snug">
              Сдаться? Все ваши земли станут нейтральными, а вы перейдёте в режим наблюдателя.
            </span>
          </div>
          <div class="flex items-center justify-end gap-1.5 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-2.5 text-xs"
              @click="confirmSurrender = false"
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              size="sm"
              class="h-7 px-2.5 text-xs"
              @click="confirmSurrenderAction"
            >
              Да, сдаться
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- Screen 2: Selected Country (Income Visible ONLY for Friends!) -->
    <div v-else-if="screen === 'country' && selectedCountry" class="space-y-4">
      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          @click="screen = 'list'"
        >
          <ArrowLeft class="size-3.5" />
          <span>Страны</span>
        </button>

        <div class="flex items-center gap-2 min-w-0">
          <span
            v-if="store.isOnlineMode && selectedCountry.onlineSlot"
            class="inline-block size-2 shrink-0 rounded-full"
            :class="
              selectedCountry.onlineSlot.online
                ? 'bg-emerald-400'
                : 'bg-zinc-500'
            "
            :title="selectedCountry.onlineSlot.online ? 'В сети' : 'Офлайн'"
          />
          <span
            class="inline-block size-3 shrink-0 rounded-xs border border-white/25"
            :style="{backgroundColor: selectedCountry.palette.tileHex}"
          />
          <span class="text-sm font-bold text-foreground truncate">
            {{ selectedCountry.name }}
          </span>
          <span
            class="rounded-md border px-2 py-0.5 text-[11px] font-semibold shrink-0"
            :class="relationBadge(selectedCountry.relation).className"
          >
            {{ relationBadge(selectedCountry.relation).label
            }}<template
              v-if="
                selectedCountry.relation === DiplomaticRelation.FRIEND &&
                selectedCountry.friendTurns > 0
              "
            >
              · {{ selectedCountry.friendTurns }} х.
            </template>
          </span>
        </div>
      </div>

      <!-- Net Income Chart: Revealed ONLY for Friendly Countries -->
      <div
        v-if="selectedCountry.relation === DiplomaticRelation.FRIEND"
        class="rounded-lg border border-border bg-secondary/35 p-3 space-y-2"
      >
        <div class="flex items-center justify-between text-xs">
          <span class="text-muted-foreground">Доход за ход</span>
          <span
            class="inline-flex items-center gap-1 font-mono text-sm font-bold tabular-nums"
            :class="
              selectedCountry.totalNetIncome >= 0
                ? 'text-emerald-400'
                : 'text-rose-400'
            "
          >
            <TrendingUp
              v-if="selectedCountry.totalNetIncome >= 0"
              class="size-3.5"
            />
            <TrendingDown v-else class="size-3.5" />
            {{
              selectedCountry.totalNetIncome >= 0
                ? `+${selectedCountry.totalNetIncome}`
                : selectedCountry.totalNetIncome
            }}
          </span>
        </div>
        <IncomeSparkline
          :values="selectedIncomeHistory"
          :color="selectedCountry.palette.tileHex"
          :height="68"
        />
      </div>

      <!-- Hidden Income Stub for Non-Friends -->
      <div
        v-else
        class="flex items-center gap-2 rounded-lg border border-border bg-secondary/25 px-3 py-2 text-xs text-muted-foreground"
      >
        <Lock class="size-3.5 shrink-0 opacity-75" />
        <span>Доход скрыт</span>
      </div>

      <!-- Outgoing Actions Grid (Own Turn Only; Single Column on Mobile) -->
      <div
        v-if="store.canSendDiplomacy"
        class="grid grid-cols-1 sm:grid-cols-2 gap-2"
      >
        <Button
          variant="outline"
          size="sm"
          class="h-10 sm:h-9 w-full justify-start gap-2.5 text-xs"
          @click="openExchange(false)"
        >
          <ArrowLeftRight class="size-4 sm:size-3.5 shrink-0 text-primary" />
          <span>Обмен</span>
        </Button>

        <Button
          v-if="selectedCountry.relation !== DiplomaticRelation.FRIEND"
          variant="outline"
          size="sm"
          class="h-10 sm:h-9 w-full justify-start gap-2.5 text-xs"
          :disabled="!friendshipEligibility.allowed"
          @click="openExchange(true)"
        >
          <Handshake class="size-4 sm:size-3.5 shrink-0 text-emerald-400" />
          <span>Дружба</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          class="h-10 sm:h-9 w-full justify-start gap-2.5 text-xs"
          @click="
            confirmAction = confirmAction === 'message' ? null : 'message'
          "
        >
          <Mail class="size-4 sm:size-3.5 shrink-0 text-sky-400" />
          <span>Сообщение</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          class="h-10 sm:h-9 w-full justify-start gap-2.5 text-xs"
          @click="
            confirmAction = confirmAction === 'black_mark' ? null : 'black_mark'
          "
        >
          <Skull class="size-4 sm:size-3.5 shrink-0 text-rose-400" />
          <span>Чёрная метка</span>
        </Button>

        <Button
          v-if="selectedCountry.relation !== DiplomaticRelation.WAR"
          variant="outline"
          size="sm"
          class="sm:col-span-2 h-10 sm:h-9 w-full justify-start gap-2.5 border-rose-500/35 text-xs text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
          @click="confirmAction = confirmAction === 'war' ? null : 'war'"
        >
          <Swords class="size-4 sm:size-3.5 shrink-0" />
          <span>Война</span>
        </Button>
      </div>
      <div
        v-else
        class="rounded-lg border border-border bg-secondary/25 px-3 py-2 text-xs text-muted-foreground"
      >
        Отправка запросов только в свой ход
      </div>

      <!-- Friendship blocked by Black Mark hint -->
      <div
        v-if="
          selectedCountry.relation !== DiplomaticRelation.FRIEND &&
          !friendshipEligibility.allowed &&
          friendshipEligibility.reason
        "
        class="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
      >
        {{ friendshipEligibility.reason }}
      </div>

      <!-- Warning: Black Mark -->
      <div
        v-if="confirmAction === 'black_mark'"
        class="flex items-center justify-between gap-2 rounded-lg border border-rose-500/45 bg-rose-500/10 px-3 py-2.5 text-xs"
      >
        <div class="flex items-center gap-2 text-rose-200 min-w-0">
          <AlertTriangle class="size-4 shrink-0 text-rose-400" />
          <span class="truncate">Чёрная метка ({{ BLACK_MARK_COST }})</span>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-xs"
            @click="confirmAction = null"
          >
            Нет
          </Button>
          <Button
            variant="destructive"
            size="sm"
            class="h-7 px-2.5 text-xs"
            :disabled="ownMoney < BLACK_MARK_COST"
            @click="confirmBlackMark"
          >
            Да
          </Button>
        </div>
      </div>

      <!-- Warning: Declare War -->
      <div
        v-if="confirmAction === 'war'"
        class="flex items-center justify-between gap-2 rounded-lg border border-rose-500/45 bg-rose-500/10 px-3 py-2.5 text-xs"
      >
        <div class="flex items-center gap-2 text-rose-200 min-w-0">
          <Swords class="size-4 shrink-0 text-rose-400" />
          <span class="truncate">
            Война: {{ selectedCountry.name
            }}<template
              v-if="selectedCountry.relation === DiplomaticRelation.FRIEND"
            >
              · Метка
            </template>
          </span>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-xs"
            @click="confirmAction = null"
          >
            Нет
          </Button>
          <Button
            variant="destructive"
            size="sm"
            class="h-7 px-2.5 text-xs"
            @click="confirmDeclareWar"
          >
            Война
          </Button>
        </div>
      </div>

      <!-- Message Composer + Conversation Log -->
      <div
        v-if="confirmAction === 'message' || countryMessages.length > 0"
        class="space-y-2 border-t border-border pt-3"
      >
        <div v-if="confirmAction === 'message'" class="flex items-center gap-2">
          <input
            v-model="messageDraft"
            type="text"
            placeholder="Сообщение..."
            class="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-ring"
            @keydown.enter="submitCountryMessage"
          />
          <Button size="sm" class="h-8 text-xs" @click="submitCountryMessage">
            <Send class="size-3.5" />
          </Button>
        </div>

        <div
          v-if="countryMessages.length > 0"
          class="space-y-1.5 max-h-40 overflow-y-auto pr-1"
        >
          <div
            v-for="msg in countryMessages"
            :key="msg.id"
            class="rounded-md border border-border bg-secondary/35 px-2.5 py-2 text-xs space-y-1.5"
          >
            <div class="flex items-center justify-between text-[11px] text-muted-foreground">
              <span class="font-medium text-foreground">
                {{ getFactionDisplayName(msg.fromFaction) }}
              </span>
              <span class="font-mono tabular-nums">Ход {{ msg.turn }}</span>
            </div>
            <p class="text-foreground/90 leading-snug">{{ msg.text }}</p>
            <div
              v-if="
                msg.status === DiplomaticMessageStatus.PENDING &&
                msg.toFaction === store.viewerFactionId &&
                store.canRespondDiplomacy
              "
              class="flex items-center gap-1.5 pt-0.5"
            >
              <Button
                size="sm"
                class="h-6 px-2 text-[11px]"
                @click="store.respondToMessage(msg.id, true)"
              >
                <Check class="size-3" />
                <span>Принять</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="h-6 px-2 text-[11px]"
                @click="store.respondToMessage(msg.id, false)"
              >
                <X class="size-3" />
                <span>Отклонить</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Screen 3: Exchange Dialog -->
    <div v-else-if="screen === 'exchange' && selectedCountry" class="space-y-3">
      <div class="flex items-center justify-between">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          @click="screen = 'country'"
        >
          <ArrowLeft class="size-3.5" />
          <span>Назад</span>
        </button>
        <span class="text-xs font-semibold text-foreground">Обмен</span>
      </div>

      <!-- Top Box: Selected Country Gives -->
      <div class="rounded-lg border border-border bg-secondary/40 p-3 space-y-2.5">
        <div class="flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <span
              class="inline-block size-2.5 rounded-xs border border-white/25"
              :style="{backgroundColor: selectedCountry.palette.tileHex}"
            />
            <span class="font-semibold text-foreground">
              {{ selectedCountry.name }}
            </span>
          </div>
          <span class="text-muted-foreground">Отдаёт</span>
        </div>

        <Select
          :model-value="exchangeForm.targetType"
          :options="targetExchangeOptions"
          @update:model-value="onTargetTypeChange"
        />

        <div
          v-if="needsAmountSlider(exchangeForm.targetType)"
          class="space-y-1.5 pt-1"
        >
          <div class="flex items-center justify-between text-xs">
            <span class="text-muted-foreground">
              {{
                exchangeForm.targetType === ExchangeItemType.SUBSIDY
                  ? 'За ход'
                  : 'Сумма'
              }}
            </span>
            <span class="font-mono font-semibold tabular-nums text-primary">
              {{
                sliderUnitLabel(
                  exchangeForm.targetType,
                  exchangeForm.targetAmount,
                )
              }}
            </span>
          </div>
          <Slider
            :model-value="[exchangeForm.targetAmount]"
            :min="1"
            :max="getMaxForType(exchangeForm.targetType, true)"
            :step="1"
            @update:model-value="(v) => (exchangeForm.targetAmount = v[0])"
          />
        </div>

        <div
          v-if="
            exchangeForm.targetType === ExchangeItemType.SUBSIDY ||
            exchangeForm.targetType === ExchangeItemType.FRIENDSHIP
          "
          class="space-y-1.5 pt-1"
        >
          <div class="flex items-center justify-between text-xs">
            <span class="text-muted-foreground">Срок</span>
            <span class="font-mono font-semibold tabular-nums text-primary">
              {{ exchangeForm.targetDuration }} х.
            </span>
          </div>
          <Slider
            :model-value="[exchangeForm.targetDuration]"
            :min="
              exchangeForm.targetType === ExchangeItemType.FRIENDSHIP
                ? MIN_FRIENDSHIP_DURATION
                : MIN_SUBSIDY_DURATION
            "
            :max="
              exchangeForm.targetType === ExchangeItemType.FRIENDSHIP
                ? MAX_FRIENDSHIP_DURATION
                : MAX_SUBSIDY_DURATION
            "
            :step="1"
            @update:model-value="(v) => (exchangeForm.targetDuration = v[0])"
          />
        </div>

        <div
          v-else-if="exchangeForm.targetType === ExchangeItemType.LAND"
          class="flex items-center justify-between gap-2 pt-1"
        >
          <span class="font-mono text-xs tabular-nums text-foreground">
            {{ exchangeForm.targetHexKeys.length }} кл.
          </span>
          <Button
            variant="outline"
            size="sm"
            class="h-8 gap-1.5 text-xs"
            @click="openMapLandPicker('target')"
          >
            <MapPin class="size-3.5 text-primary" />
            <span>На карте</span>
          </Button>
        </div>

        <div
          v-else-if="exchangeForm.targetType === ExchangeItemType.DECLARE_WAR"
          class="space-y-1 pt-1"
        >
          <span class="text-[11px] text-muted-foreground">Цель</span>
          <Select
            :model-value="exchangeForm.targetWarOn"
            :options="thirdPartyFactions"
            @update:model-value="(v) => (exchangeForm.targetWarOn = v)"
          />
        </div>
      </div>

      <!-- Center Exchange Arrows -->
      <div class="flex items-center justify-center">
        <div
          class="flex size-8 items-center justify-center rounded-full border border-border bg-card text-primary shadow-xs"
        >
          <ArrowUpDown class="size-4" />
        </div>
      </div>

      <!-- Bottom Box: We Give -->
      <div class="rounded-lg border border-primary/40 bg-secondary/40 p-3 space-y-2.5">
        <div class="flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <span
              class="inline-block size-2.5 rounded-xs border border-white/25"
              :style="{backgroundColor: store.viewerFactionPalette.tileHex}"
            />
            <span class="font-semibold text-foreground">
              {{ getFactionDisplayName(store.viewerFactionId) }}
            </span>
          </div>
          <span class="text-muted-foreground">Отдаём</span>
        </div>

        <Select
          :model-value="exchangeForm.proposerType"
          :options="proposerExchangeOptions"
          @update:model-value="onProposerTypeChange"
        />

        <div
          v-if="needsAmountSlider(exchangeForm.proposerType)"
          class="space-y-1.5 pt-1"
        >
          <div class="flex items-center justify-between text-xs">
            <span class="text-muted-foreground">
              {{
                exchangeForm.proposerType === ExchangeItemType.SUBSIDY
                  ? 'За ход'
                  : 'Сумма'
              }}
            </span>
            <span class="font-mono font-semibold tabular-nums text-primary">
              {{
                sliderUnitLabel(
                  exchangeForm.proposerType,
                  exchangeForm.proposerAmount,
                )
              }}
            </span>
          </div>
          <Slider
            :model-value="[exchangeForm.proposerAmount]"
            :min="1"
            :max="getMaxForType(exchangeForm.proposerType, false)"
            :step="1"
            @update:model-value="(v) => (exchangeForm.proposerAmount = v[0])"
          />
        </div>

        <div
          v-if="
            exchangeForm.proposerType === ExchangeItemType.SUBSIDY ||
            exchangeForm.proposerType === ExchangeItemType.FRIENDSHIP
          "
          class="space-y-1.5 pt-1"
        >
          <div class="flex items-center justify-between text-xs">
            <span class="text-muted-foreground">Срок</span>
            <span class="font-mono font-semibold tabular-nums text-primary">
              {{ exchangeForm.proposerDuration }} х.
            </span>
          </div>
          <Slider
            :model-value="[exchangeForm.proposerDuration]"
            :min="
              exchangeForm.proposerType === ExchangeItemType.FRIENDSHIP
                ? MIN_FRIENDSHIP_DURATION
                : MIN_SUBSIDY_DURATION
            "
            :max="
              exchangeForm.proposerType === ExchangeItemType.FRIENDSHIP
                ? MAX_FRIENDSHIP_DURATION
                : MAX_SUBSIDY_DURATION
            "
            :step="1"
            @update:model-value="(v) => (exchangeForm.proposerDuration = v[0])"
          />
        </div>

        <div
          v-else-if="exchangeForm.proposerType === ExchangeItemType.LAND"
          class="flex items-center justify-between gap-2 pt-1"
        >
          <span class="font-mono text-xs tabular-nums text-foreground">
            {{ exchangeForm.proposerHexKeys.length }} кл.
          </span>
          <Button
            variant="outline"
            size="sm"
            class="h-8 gap-1.5 text-xs"
            @click="openMapLandPicker('proposer')"
          >
            <MapPin class="size-3.5 text-primary" />
            <span>На карте</span>
          </Button>
        </div>

        <div
          v-else-if="exchangeForm.proposerType === ExchangeItemType.DECLARE_WAR"
          class="space-y-1 pt-1"
        >
          <span class="text-[11px] text-muted-foreground">Цель</span>
          <Select
            :model-value="exchangeForm.proposerWarOn"
            :options="thirdPartyFactions"
            @update:model-value="(v) => (exchangeForm.proposerWarOn = v)"
          />
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" @click="screen = 'country'">
          Отмена
        </Button>
        <Button
          variant="default"
          size="sm"
          :disabled="!canSubmitExchange"
          @click="submitExchange"
        >
          Отправить
        </Button>
      </div>
    </div>

    <!-- Screen 4: Pending Incoming Proposals -->
    <div v-else-if="screen === 'inbox'" class="space-y-3">
      <div class="flex items-center justify-between">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          @click="screen = 'list'"
        >
          <ArrowLeft class="size-3.5" />
          <span>Страны</span>
        </button>
        <span class="text-xs font-semibold text-foreground">Входящие</span>
      </div>

      <div
        v-if="pendingInboxMessages.length === 0"
        class="py-6 text-center text-xs text-muted-foreground"
      >
        Пусто
      </div>

      <div v-else class="space-y-2 max-h-72 overflow-y-auto pr-1">
        <div
          v-for="msg in pendingInboxMessages"
          :key="msg.id"
          class="rounded-lg border border-border bg-secondary/45 p-3 text-xs space-y-2"
        >
          <div class="flex items-center justify-between text-muted-foreground">
            <div class="flex items-center gap-1.5">
              <span
                class="inline-block size-2.5 rounded-xs"
                :style="{
                  backgroundColor: FACTION_PALETTES[msg.fromFaction].tileHex,
                }"
              />
              <span class="font-semibold text-foreground">
                {{ getFactionDisplayName(msg.fromFaction) }}
              </span>
            </div>
            <span class="font-mono tabular-nums">Ход {{ msg.turn }}</span>
          </div>
          <p class="text-foreground leading-relaxed">{{ msg.text }}</p>
          <div
            v-if="store.canRespondDiplomacy"
            class="flex items-center gap-2 pt-0.5"
          >
            <Button
              size="sm"
              class="h-7 px-2.5 text-xs"
              @click="store.respondToMessage(msg.id, true)"
            >
              <Check class="size-3.5" />
              <span>Принять</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-7 px-2.5 text-xs"
              @click="store.respondToMessage(msg.id, false)"
            >
              <X class="size-3.5" />
              <span>Отклонить</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  </ModalDialog>
</template>
