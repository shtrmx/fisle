<script setup lang="ts">
import { computed, reactive, ref, watch, type Component } from 'vue';
import {
  Bell,
  Box,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Crosshair,
  Eye,
  Handshake,
  Hexagon,
  Hourglass,
  Info,
  LogOut,
  Map as MapIcon,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Shield,
  SkipForward,
  Sparkles,
  Swords,
  TrendingDown,
  TrendingUp,
  Undo2,
} from 'lucide-vue-next';
import {
  CameraMode,
  EntityType,
  FactionId,
  type ActiveToolType,
  type PurchasableEntity,
} from '@/domain/game/types';
import {
  CATAPULT_MIN_RANGE,
  CATAPULT_RANGE,
  ENTITY_META,
  FACTION_PALETTES,
  FLARE_COST,
  FLARE_DURATION_TURNS,
  FLARE_RADIUS,
  REGENERATOR_COST,
  REGENERATOR_DURATION_TURNS,
  REGENERATOR_FARM_BONUS,
  REGENERATOR_STRENGTH_BONUS,
  REGENERATOR_UPKEEP,
  TRADING_POST_BASE_INCOME,
  TRADING_POST_FARM_SYNERGY,
  TRADING_POST_HEX_COUNT,
  countTradingPostAdjacentFarms,
  getDemolishRefund,
  getEffectiveUnitStrength,
  getTradingPostClusterAt,
  isDemolishable,
  isHexInRegeneratorRadius,
  isUnit,
} from '@/domain/game/rules';
import { useGameStore } from '@/application/stores/useGameStore';
import type { PreviewToolId } from '@/infrastructure/three/figurinePreviewRenderer';
import FigurineCanvas3D from '@/presentation/FigurineCanvas3D.vue';
import EntityInfoDialog from '@/presentation/EntityInfoDialog.vue';
import { Button } from '@/components/ui/button';
import Separator from '@/components/ui/separator/Separator.vue';
import Tooltip from '@/components/ui/tooltip/Tooltip.vue';

const emit = defineEmits<{
  focusNextUnit: [];
}>();

const store = useGameStore();

const infoDialogOpen = ref(false);
const infoDialogTool = ref<PreviewToolId | null>(null);

function openToolInfo(tool: PreviewToolId): void {
  infoDialogTool.value = tool;
  infoDialogOpen.value = true;
}

type GroupId = 'units' | 'economy' | 'defense' | 'extra';

const UNIT_CYCLE: readonly PreviewToolId[] = [
  EntityType.PEASANT,
  EntityType.SPEARMAN,
  EntityType.BARON,
  EntityType.KNIGHT,
  EntityType.CATAPULT,
];

const ECONOMY_CYCLE: readonly PreviewToolId[] = [
  EntityType.FARM,
  EntityType.TRADING_POST,
];

const DEFENSE_CYCLE: readonly PreviewToolId[] = [
  EntityType.TOWER,
  EntityType.STRONG_TOWER,
];

const extraCycle = computed<readonly PreviewToolId[]>(
  () => [EntityType.BEACON, 'FLARE', 'REGENERATOR', 'DEMOLISH'] as const,
);

const groupIndices = reactive<Record<GroupId, number>>({
  units: 0,
  economy: 0,
  defense: 0,
  extra: 0,
});

function resetAllSelectors(): void {
  groupIndices.units = 0;
  groupIndices.economy = 0;
  groupIndices.defense = 0;
  groupIndices.extra = 0;
}

function getItemsForGroup(groupId: GroupId): readonly PreviewToolId[] {
  if (groupId === 'units') return UNIT_CYCLE;
  if (groupId === 'economy') return ECONOMY_CYCLE;
  if (groupId === 'defense') return DEFENSE_CYCLE;
  return extraCycle.value;
}

const isWaitingForOtherPlayer = computed(
  () =>
    store.isOnlineMode &&
    store.roomStatus === 'PLAYING' &&
    !store.isHumanTurn &&
    store.gameState.winner === null,
);

const activeTurnPlayerName = computed(
  () => store.activeFactionInfo?.name ?? store.activeFactionPalette.name,
);

const activeTurnOnlineSlot = computed(
  () => store.onlinePresenceByFaction[store.activeFactionId] ?? null,
);

const spectatorLandStats = computed(() => {
  void store.boardVersion;
  const cells = Object.values(store.gameState.cells);
  const totalLand = Math.max(1, cells.length);
  const counts = new Map<FactionId, number>();
  let neutralCount = 0;

  for (const cell of cells) {
    if (cell.faction === FactionId.NEUTRAL) {
      neutralCount++;
    } else {
      counts.set(cell.faction, (counts.get(cell.faction) ?? 0) + 1);
    }
  }

  const factions = store.gameState.turnOrder
    .map((factionId) => {
      const hexCount = counts.get(factionId) ?? 0;
      const palette = FACTION_PALETTES[factionId];
      const slot = store.onlinePresenceByFaction[factionId];
      const info = store.gameState.factions[factionId];
      return {
        factionId,
        name: slot?.nickname ?? info?.name ?? palette.name,
        colorHex: palette.tileHex,
        hexCount,
        widthPct: (hexCount / totalLand) * 100,
        sharePct: Math.round((hexCount / totalLand) * 100),
        isActiveTurn: store.activeFactionId === factionId,
      };
    })
    .filter((f) => f.hexCount > 0)
    .sort((a, b) => b.hexCount - a.hexCount);

  const segments = factions.map((f) => ({
    key: `f-${f.factionId}`,
    label: f.name,
    colorHex: f.colorHex,
    hexCount: f.hexCount,
    widthPct: f.widthPct,
    sharePct: f.sharePct,
  }));

  if (neutralCount > 0) {
    segments.push({
      key: 'neutral',
      label: 'Нейтральные',
      colorHex: '#64748b',
      hexCount: neutralCount,
      widthPct: (neutralCount / totalLand) * 100,
      sharePct: Math.round((neutralCount / totalLand) * 100),
    });
  }

  return { factions, segments };
});

const activeGroupId = computed<GroupId | null>(() => {
  const tool = store.activeTool;
  if (!tool) return null;
  if (UNIT_CYCLE.includes(tool as PreviewToolId)) return 'units';
  if (ECONOMY_CYCLE.includes(tool as PreviewToolId)) return 'economy';
  if (DEFENSE_CYCLE.includes(tool as PreviewToolId)) return 'defense';
  if (extraCycle.value.includes(tool as PreviewToolId)) return 'extra';
  return null;
});

watch(
  () => store.activeTool,
  (tool) => {
    if (!tool) {
      resetAllSelectors();
      return;
    }
    const uIdx = UNIT_CYCLE.indexOf(tool as PreviewToolId);
    if (uIdx !== -1) {
      resetAllSelectors();
      groupIndices.units = uIdx;
      return;
    }
    const ecoIdx = ECONOMY_CYCLE.indexOf(tool as PreviewToolId);
    if (ecoIdx !== -1) {
      resetAllSelectors();
      groupIndices.economy = ecoIdx;
      return;
    }
    const defIdx = DEFENSE_CYCLE.indexOf(tool as PreviewToolId);
    if (defIdx !== -1) {
      resetAllSelectors();
      groupIndices.defense = defIdx;
      return;
    }
    const eIdx = extraCycle.value.indexOf(tool as PreviewToolId);
    if (eIdx !== -1) {
      resetAllSelectors();
      groupIndices.extra = eIdx;
    }
  },
);

watch(
  () => [
    store.gameState.turn,
    store.activeFactionId,
    store.selectedUnitKey,
    store.mapResetVersion,
  ],
  () => {
    resetAllSelectors();
  },
);

function handleGroupClick(groupId: GroupId): void {
  if (!store.isHumanTurn) return;
  const items = getItemsForGroup(groupId);
  if (activeGroupId.value === groupId) {
    groupIndices[groupId] = (groupIndices[groupId] + 1) % items.length;
  } else {
    resetAllSelectors();
  }
  const nextTool = items[groupIndices[groupId] % items.length];
  store.selectTool(nextTool as ActiveToolType, false);
}

interface StatChip {
  key: string;
  title: string;
  icon: Component;
  value: string;
  tone?: 'default' | 'gold' | 'emerald' | 'rose';
}

interface ToolBadgeMeta {
  title: string;
  shortTitle: string;
  costLabel: string;
  priceTone: 'gold' | 'emerald' | 'rose';
  affordable: boolean;
  description: string;
  stats: StatChip[];
}

function getToolDetails(tool: PreviewToolId): ToolBadgeMeta {
  const money = store.selectedProvince?.money ?? 0;

  if (tool === 'FLARE') {
    const affordable = money >= FLARE_COST;
    return {
      title: 'Освещение',
      shortTitle: 'Свет',
      costLabel: `${FLARE_COST}`,
      priceTone: affordable ? 'gold' : 'rose',
      affordable,
      description: 'Раскрывает туман войны в любой точке карты.',
      stats: [
        { key: 'vision', title: 'Радиус обзора', icon: Eye, value: `${FLARE_RADIUS}` },
        { key: 'turns', title: 'Длительность (ходы)', icon: Clock, value: `${FLARE_DURATION_TURNS}` },
      ],
    };
  }

  if (tool === 'REGENERATOR') {
    const affordable = money >= REGENERATOR_COST;
    return {
      title: 'Регенератор',
      shortTitle: 'Реген.',
      costLabel: `${REGENERATOR_COST}`,
      priceTone: affordable ? 'gold' : 'rose',
      affordable,
      description: 'Усиливает юнитов и фермы в радиусе 2 на 3 хода.',
      stats: [
        {
          key: 'strength',
          title: 'Бонус силы юнитов',
          icon: Swords,
          value: `+${REGENERATOR_STRENGTH_BONUS}`,
          tone: 'emerald',
        },
        {
          key: 'farm',
          title: 'Бонус к доходу ферм',
          icon: TrendingUp,
          value: `+${REGENERATOR_FARM_BONUS}`,
          tone: 'emerald',
        },
        {
          key: 'upkeep',
          title: 'Расход за ход',
          icon: TrendingDown,
          value: `-${REGENERATOR_UPKEEP}`,
          tone: 'rose',
        },
        {
          key: 'turns',
          title: 'Длительность (ходы)',
          icon: Clock,
          value: `${REGENERATOR_DURATION_TURNS}`,
        },
      ],
    };
  }

  if (tool === 'DEMOLISH') {
    const hasTargets =
      store.demolishHexSet.size > 0 ||
      Boolean(
        store.selectedProvince?.hexKeys.some((k) =>
          isDemolishable(store.gameState.cells[k]?.entity ?? EntityType.NONE),
        ),
      );
    return {
      title: 'Снос постройки',
      shortTitle: 'Снос',
      costLabel: '+25%',
      priceTone: 'emerald',
      affordable: hasTargets,
      description: 'Удаляет постройку с возвратом 25% стоимости.',
      stats: [
        { key: 'refund', title: 'Возврат стоимости', icon: RotateCcw, value: '25%', tone: 'emerald' },
      ],
    };
  }

  const entity = tool as PurchasableEntity;
  const meta = ENTITY_META[entity];
  const cost = store.getToolCost(entity);
  const affordable = money >= cost;
  const stats: StatChip[] = [];

  if (meta.strength > 0) {
    stats.push({ key: 'strength', title: 'Сила атаки', icon: Swords, value: `${meta.strength}` });
  }
  if (meta.defense > 0) {
    stats.push({ key: 'defense', title: 'Защита', icon: Shield, value: `${meta.defense}` });
  }
  if (entity === EntityType.FARM) {
    stats.push({
      key: 'income',
      title: 'Доход за ход',
      icon: TrendingUp,
      value: `+${meta.income}`,
      tone: 'emerald',
    });
  }
  if (entity === EntityType.TRADING_POST) {
    stats.push(
      {
        key: 'income',
        title: 'Базовый доход за ход',
        icon: TrendingUp,
        value: `+${TRADING_POST_BASE_INCOME}`,
        tone: 'emerald',
      },
      {
        key: 'synergy',
        title: 'Бонус за каждую соседнюю ферму',
        icon: Sparkles,
        value: `+${TRADING_POST_FARM_SYNERGY}`,
        tone: 'emerald',
      },
      {
        key: 'size',
        title: 'Занимает 3 смежных гекса',
        icon: Hexagon,
        value: `${TRADING_POST_HEX_COUNT}`,
      },
    );
  }
  if (meta.upkeep > 0) {
    stats.push({
      key: 'upkeep',
      title: 'Содержание за ход',
      icon: TrendingDown,
      value: `-${meta.upkeep}`,
      tone: 'rose',
    });
  }
  if (entity !== EntityType.TRADING_POST) {
    stats.push({
      key: 'vision',
      title: 'Обзор',
      icon: Eye,
      value: `${meta.visionRadius}`,
    });
  }
  if (entity === EntityType.CATAPULT) {
    stats.push({
      key: 'range',
      title: 'Дальность обстрела (гексы)',
      icon: Crosshair,
      value: `${CATAPULT_MIN_RANGE}–${CATAPULT_RANGE}`,
    });
  }

  return {
    title: meta.label,
    shortTitle: meta.shortLabel,
    costLabel: `${cost}`,
    priceTone: affordable ? 'gold' : 'rose',
    affordable,
    description: meta.description,
    stats,
  };
}

interface GroupButtonView {
  id: GroupId;
  groupLabel: string;
  currentTool: PreviewToolId;
  index: number;
  total: number;
  isActive: boolean;
  meta: ToolBadgeMeta;
}

const groupButtons = computed<GroupButtonView[]>(() => {
  void store.boardVersion;
  const configs: Array<{ id: GroupId; label: string }> = [
    { id: 'units', label: 'Юниты' },
    { id: 'economy', label: 'Прибыль' },
    { id: 'defense', label: 'Защита' },
    { id: 'extra', label: 'Дополнительно' },
  ];
  return configs.map((cfg) => {
    const items = getItemsForGroup(cfg.id);
    const idx = groupIndices[cfg.id] % items.length;
    const tool = items[idx];
    return {
      id: cfg.id,
      groupLabel: cfg.label,
      currentTool: tool,
      index: idx,
      total: items.length,
      isActive: activeGroupId.value === cfg.id,
      meta: getToolDetails(tool),
    };
  });
});

const activeInspector = computed<GroupButtonView | null>(
  () => groupButtons.value.find((g) => g.isActive) ?? null,
);

const hoveredInfoText = computed(() => {
  const cell = store.hoveredCell;
  if (!cell) return null;
  const owner =
    store.gameState.factions[cell.faction]?.name ??
    FACTION_PALETTES[cell.faction].name;
  const ent = ENTITY_META[cell.entity].label;
  const prot = store.hoveredProtection;
  const boostedStrength =
    isUnit(cell.entity) &&
      isHexInRegeneratorRadius(store.gameState, cell.faction, cell.key)
      ? getEffectiveUnitStrength(
        store.gameState,
        cell.faction,
        cell.entity,
        cell.key,
      )
      : null;

  let tradingPostIncomeHint: string | null = null;
  if (cell.entity === EntityType.TRADING_POST) {
    const cluster = getTradingPostClusterAt(store.gameState, cell.key);
    if (cluster) {
      const adjFarms = countTradingPostAdjacentFarms(
        store.gameState,
        cluster.faction,
        cluster.hexKeys,
      );
      const total =
        TRADING_POST_BASE_INCOME + adjFarms * TRADING_POST_FARM_SYNERGY;
      tradingPostIncomeHint =
        adjFarms > 0
          ? `+${total} (${TRADING_POST_BASE_INCOME}+${adjFarms * TRADING_POST_FARM_SYNERGY})`
          : `+${TRADING_POST_BASE_INCOME}`;
    }
  }

  const demolishHint =
    store.activeTool === 'DEMOLISH' &&
      isDemolishable(cell.entity) &&
      cell.provinceId === store.selectedProvinceId
      ? `+${getDemolishRefund(
        cell.entity,
        store.getEntityCountInSelectedProvince(cell.entity),
      )}`
      : null;
  return {
    owner,
    ownerHex: FACTION_PALETTES[cell.faction].tileHex,
    entity: ent,
    protection: prot,
    boostedStrength,
    tradingPostIncomeHint,
    demolishHint,
  };
});
</script>

<template>
  <!-- Subtle hovered hex inspector (desktop bottom-left) -->
  <div v-if="hoveredInfoText && !store.hudCollapsed"
    class="pointer-events-none fixed bottom-28 left-4 z-20 hidden lg:flex items-center gap-2 rounded-md border border-border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-md">
    <span class="inline-block size-2.5 rounded-xs" :style="{ backgroundColor: hoveredInfoText.ownerHex }" />
    <span class="font-medium text-foreground">{{ hoveredInfoText.owner }}</span>
    <span aria-hidden="true">·</span>
    <span>{{ hoveredInfoText.entity }}</span>
    <template v-if="hoveredInfoText.boostedStrength !== null">
      <span aria-hidden="true">·</span>
      <span class="inline-flex items-center gap-1 font-mono tabular-nums text-emerald-400" title="Усилен регенератором">
        <Swords class="size-3" />
        {{ hoveredInfoText.boostedStrength }} (+{{ REGENERATOR_STRENGTH_BONUS }})
      </span>
    </template>
    <template v-if="hoveredInfoText.protection > 0">
      <span aria-hidden="true">·</span>
      <span class="inline-flex items-center gap-1 font-mono tabular-nums text-amber-300" title="Защита">
        <Shield class="size-3" />
        {{ hoveredInfoText.protection }}
      </span>
    </template>
    <template v-if="hoveredInfoText.tradingPostIncomeHint">
      <span aria-hidden="true">·</span>
      <span class="inline-flex items-center gap-1 font-mono tabular-nums text-emerald-400"
        title="Доход торгового посада (база + соседние фермы)">
        <TrendingUp class="size-3" />
        {{ hoveredInfoText.tradingPostIncomeHint }}
      </span>
    </template>
    <template v-if="hoveredInfoText.demolishHint">
      <span aria-hidden="true">·</span>
      <span class="inline-flex items-center gap-1 font-mono tabular-nums text-emerald-300" title="Возврат при сносе">
        <RotateCcw class="size-3" />
        {{ hoveredInfoText.demolishHint }}
      </span>
    </template>
  </div>

  <!-- Unified Collapsible Bottom Tactical Dock (Hidden while picking land hexes) -->
  <div v-if="!store.landPicker"
    class="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-3 sm:pb-3">
    <!-- Active Object Characteristics Card + Icon-Only Info Button (Mobile & Desktop) -->
    <div v-if="activeInspector && !store.hudCollapsed && !isWaitingForOtherPlayer"
      class="pointer-events-auto mb-2 flex h-[56px] sm:h-[60px] w-full max-w-[490px] items-center rounded-xl border border-primary/50 bg-card/95 px-3 sm:px-3.5 shadow-xl overflow-hidden">
      <div class="flex w-full items-center justify-between gap-2 sm:gap-3 min-w-0">
        <div class="min-w-0 flex-1 flex items-center gap-2">
          <span class="font-display text-sm sm:text-base font-bold text-foreground truncate">
            {{ activeInspector.meta.title }}
          </span>

          <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <span v-for="stat in activeInspector.meta.stats" :key="stat.key" :title="stat.title"
              class="inline-flex items-center gap-0.5 font-mono text-xs font-semibold tabular-nums" :class="stat.tone === 'emerald'
                  ? 'text-emerald-400'
                  : stat.tone === 'rose'
                    ? 'text-rose-400'
                    : 'text-foreground'
                ">
              <component :is="stat.icon" class="size-3.5 shrink-0 opacity-85" />
              {{ stat.value }}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <!-- Icon-Only Info Button (Mobile & Desktop) -->
          <Tooltip>
            <template #trigger>
              <Button variant="outline" size="icon" class="size-9 shrink-0 cursor-pointer"
                aria-label="Подробная информация" @click="openToolInfo(activeInspector.currentTool)">
                <Info class="size-4" />
              </Button>
            </template>
            <span>Подробное описание и характеристики</span>
          </Tooltip>

          <!-- Prominent Large Price Callout -->
          <div
            class="flex h-[38px] sm:h-[40px] min-w-[62px] sm:min-w-[68px] shrink-0 items-center justify-center rounded-lg bg-background/70 px-2 sm:px-2.5">
            <div
              class="flex items-center gap-1 sm:gap-1.5 font-mono text-base sm:text-xl font-black leading-none tabular-nums"
              :class="activeInspector.meta.priceTone === 'emerald'
                  ? 'text-emerald-400'
                  : activeInspector.meta.priceTone === 'gold'
                    ? 'text-amber-300'
                    : 'text-rose-400'
                ">
              <Coins class="size-3.5 sm:size-4 shrink-0" />
              <span>{{ activeInspector.meta.costLabel }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Floating Row Directly Above Dock: Mobile Diplomacy+Bell+Chat (Left), Flush Collapse Tab (Center), Camera Icons (Right) -->
    <div class="pointer-events-none relative flex min-h-10 w-full max-w-[1000px] items-end justify-center"
      :class="store.hudCollapsed ? 'mb-1' : 'mb-0'">
      <!-- Mobile-only Diplomacy + Bell + Chat buttons on the left above the dock -->
      <div class="pointer-events-auto sm:hidden absolute left-0 bottom-1.5 flex items-center gap-1">
        <button v-if="store.gameState.config.diplomacyEnabled" type="button"
          class="relative flex size-9 items-center justify-center rounded-lg border border-border bg-card/95 text-primary shadow-lg active:scale-95 transition-transform cursor-pointer"
          aria-label="Дипломатия" @click="store.showDiplomacyDialog = true">
          <Handshake class="size-4" />
          <span v-if="store.pendingMessagesCount > 0"
            class="absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-bold text-primary-foreground tabular-nums">
            {{ store.pendingMessagesCount }}
          </span>
        </button>

        <!-- Bell Right Next to Diplomacy on Mobile -->
        <button type="button"
          class="relative flex size-9 items-center justify-center rounded-lg border border-border bg-card/95 shadow-lg active:scale-95 transition-transform cursor-pointer"
          aria-label="Уведомления" @click="store.showNotificationsDialog = true">
          <Bell class="size-4" :class="store.unreadNotificationCount > 0
              ? 'text-primary'
              : 'text-muted-foreground'
            " />
          <span v-if="store.unreadNotificationCount > 0"
            class="absolute -top-1 -right-1 flex min-w-4 h-4 items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[10px] font-bold leading-none text-white tabular-nums">
            {{
              store.unreadNotificationCount > 9
                ? '9+'
                : store.unreadNotificationCount
            }}
          </span>
        </button>

        <!-- Chat Button on Mobile in Online Mode -->
        <button v-if="store.isOnlineMode" type="button"
          class="relative flex size-9 items-center justify-center rounded-lg border border-border bg-card/95 text-sky-400 shadow-lg active:scale-95 transition-transform cursor-pointer"
          aria-label="Чат комнаты" @click="store.showChatDialog = true">
          <MessageSquare class="size-4" />
        </button>
      </div>

      <!-- Flush Collapse / Expand Dock Handle (Bottom Edge Touches Dock Seamlessly!) -->
      <button type="button"
        class="pointer-events-auto relative z-10 flex items-center gap-1 border border-border bg-card/95 px-2.5 py-0.5 sm:px-3 sm:py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        :class="store.hudCollapsed
            ? 'rounded-md shadow-lg'
            : '-mb-px rounded-t-md border-b-0'
          " @click="store.hudCollapsed = !store.hudCollapsed">
        <ChevronDown v-if="!store.hudCollapsed" class="size-3.5" />
        <ChevronUp v-else class="size-3.5" />
        <span class="hidden sm:inline">
          {{ store.hudCollapsed ? 'Показать' : 'Скрыть' }}
        </span>
      </button>

      <!-- Floating Icon-Only Camera Mode Switcher (Auto / 2D / 3D) -->
      <div
        class="pointer-events-auto absolute right-0 bottom-1.5 flex items-center gap-0.5 rounded-lg border border-border bg-card/95 p-0.5 shadow-lg">
        <Tooltip>
          <template #trigger>
            <button type="button"
              class="flex size-8 items-center justify-center rounded-md transition-colors cursor-pointer" :class="store.cameraMode === CameraMode.AUTO
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                " aria-label="Авторежим камеры" @click="store.setCameraMode(CameraMode.AUTO)">
              <Sparkles class="size-4" />
            </button>
          </template>
          <span>Авто (2D → 3D при приближении)</span>
        </Tooltip>

        <Tooltip>
          <template #trigger>
            <button type="button"
              class="flex size-8 items-center justify-center rounded-md transition-colors cursor-pointer" :class="store.cameraMode === CameraMode.TOP_2D
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                " aria-label="Вид 2D сверху" @click="store.setCameraMode(CameraMode.TOP_2D)">
              <MapIcon class="size-4" />
            </button>
          </template>
          <span>2D вид сверху</span>
        </Tooltip>

        <Tooltip>
          <template #trigger>
            <button type="button"
              class="flex size-8 items-center justify-center rounded-md transition-colors cursor-pointer" :class="store.cameraMode === CameraMode.ORTHO_3D
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                " aria-label="3D ортографический вид" @click="store.setCameraMode(CameraMode.ORTHO_3D)">
              <Box class="size-4" />
            </button>
          </template>
          <span>3D ортографический вид</span>
        </Tooltip>
      </div>
    </div>

    <!-- Main Dock Body -->
    <div
      class="pointer-events-auto w-full max-w-[1000px] rounded-xl border border-border bg-card/95 px-1.5 py-1.5 sm:px-2.5 sm:py-2 shadow-2xl transition-all duration-200"
      :class="store.hudCollapsed
          ? 'translate-y-4 opacity-0 pointer-events-none h-0 overflow-hidden py-0 border-0'
          : 'translate-y-0 opacity-100'
        ">
      <!-- Online Match Paused Banner -->
      <div v-if="store.isOnlineMode && store.isRoomPaused"
        class="flex h-14 sm:h-16 items-center justify-center gap-2.5 px-3 text-sm">
        <Pause class="size-4 text-amber-300 shrink-0" />
        <span class="font-medium text-foreground">
          Игра на паузе
          <span v-if="store.roomPausedBy" class="hidden sm:inline font-normal text-muted-foreground">
            ({{ store.roomPausedBy }})
          </span>
        </span>
        <Button v-if="store.isLocalHost" variant="default" size="sm" class="gap-1.5 text-xs shrink-0"
          @click="store.setOnlineGamePaused(false)">
          <Play class="size-3.5" />
          <span>Возобновить</span>
        </Button>
      </div>

      <!-- Eliminated Player Spectator Bar: Territory Statistics + Quick Exit -->
      <div v-else-if="store.isViewerEliminated && store.gameState.winner === null"
        class="flex min-h-14 sm:min-h-16 items-center justify-between gap-2.5 sm:gap-4 px-2 sm:px-3 py-1.5">
        <button type="button"
          class="flex-1 min-w-0 flex flex-col gap-1.5 text-left rounded-lg px-1.5 py-1 transition-colors hover:bg-accent/40 cursor-pointer"
          title="Открыть подробную сводку по партиям и землям" @click="store.showMatchOverviewDialog = true">
          <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
            <span class="inline-flex items-center gap-1.5 font-semibold text-foreground shrink-0">
              <Eye class="size-3.5 text-primary shrink-0" />
              <span>Наблюдение</span>
            </span>
            <span class="hidden sm:inline text-muted-foreground" aria-hidden="true">·</span>
            <div class="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 min-w-0">
              <span v-for="row in spectatorLandStats.factions" :key="row.factionId"
                class="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums" :class="row.isActiveTurn
                    ? 'text-foreground font-bold'
                    : 'text-muted-foreground font-medium'
                  ">
                <span class="inline-block size-2.5 shrink-0 rounded-xs border border-white/25"
                  :style="{ backgroundColor: row.colorHex }" />
                <span class="hidden md:inline max-w-[78px] truncate font-sans text-foreground/90">
                  {{ row.name }}
                </span>
                <span>{{ row.sharePct }}%</span>
                <span class="hidden lg:inline text-[10px] opacity-70">
                  ({{ row.hexCount }})
                </span>
              </span>
            </div>
          </div>

          <div class="flex h-2.5 w-full overflow-hidden rounded-full border border-border/70 bg-secondary/70">
            <div v-for="seg in spectatorLandStats.segments" :key="seg.key" class="h-full transition-all duration-300"
              :style="{
                width: `${seg.widthPct}%`,
                backgroundColor: seg.colorHex,
              }" :title="`${seg.label}: ${seg.hexCount} кл. (${seg.sharePct}%)`" />
          </div>
        </button>

        <Button variant="destructive" size="sm"
          class="h-9 sm:h-10 shrink-0 gap-1.5 px-3 text-xs font-semibold cursor-pointer"
          @click="store.exitCurrentMatch()">
          <LogOut class="size-3.5 sm:size-4 shrink-0" />
          <span>Выйти</span>
        </Button>
      </div>

      <!-- Online Off-Turn / Open Slot Waiting Banner -->
      <div v-else-if="isWaitingForOtherPlayer"
        class="flex h-14 sm:h-16 items-center justify-center gap-2.5 px-3 text-sm">
        <Hourglass class="size-4 text-primary shrink-0" />
        <span class="text-muted-foreground">
          {{ store.waitingForFactionId !== null ? 'Ожидание игрока:' : 'Ход:' }}
        </span>
        <div class="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-2.5 py-1">
          <span v-if="activeTurnOnlineSlot" class="inline-block size-2 rounded-full shrink-0"
            :class="activeTurnOnlineSlot.online ? 'bg-emerald-400' : 'bg-zinc-500'"
            :title="activeTurnOnlineSlot.online ? 'В сети' : 'Офлайн'" />
          <span class="inline-block size-3 rounded-xs border border-white/25 shrink-0"
            :style="{ backgroundColor: store.activeFactionPalette.tileHex }" />
          <span class="font-semibold text-foreground max-w-[160px] truncate">
            {{ activeTurnPlayerName }}
          </span>
        </div>
        <code v-if="store.waitingForFactionId !== null && store.roomCode"
          class="hidden sm:inline-block rounded border border-border bg-background px-2 py-0.5 font-mono text-xs font-bold tracking-widest text-primary">
        {{ store.roomCode }}
      </code>
      </div>

      <!-- Active Player Controls (Normal Single Row) -->
      <div v-else class="flex flex-nowrap items-center justify-between gap-1.5 sm:gap-2.5">
        <!-- 4 Cycling 3D-Figurine Groups: Юниты, Прибыль, Защита, Дополнительно -->
        <div class="flex flex-nowrap items-center gap-1 sm:gap-1.5 lg:gap-2">
          <button v-for="group in groupButtons" :key="group.id" type="button"
            class="group relative flex items-center gap-0 md:gap-2 rounded-lg sm:rounded-xl border px-0.5 py-0.5 sm:px-1.5 md:px-2 md:py-1 text-left transition-all duration-150 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            :class="group.isActive
                ? 'border-primary/80 bg-primary/15 ring-1 ring-primary shadow-md'
                : 'border-transparent bg-secondary/45 hover:bg-accent/70'
              " :aria-label="`${group.groupLabel}: ${group.meta.title}`" :disabled="!store.isHumanTurn"
            @click="handleGroupClick(group.id)">
            <!-- Live Rotating 3D Figurine Canvas -->
            <div
              class="relative flex size-[50px] sm:size-14 md:size-12 lg:size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg">
              <FigurineCanvas3D :tool="group.currentTool" :faction="store.viewerFactionId" />

              <!-- Compact Mobile/Tablet Price Overlay (top-right) -->
              <span
                class="md:hidden absolute top-0.5 right-0.5 rounded bg-card/90 px-1 py-0.5 font-mono text-[10px] sm:text-[11px] font-black leading-none tabular-nums shadow-xs pointer-events-none"
                :class="group.meta.priceTone === 'emerald'
                    ? 'text-emerald-400'
                    : group.meta.priceTone === 'gold'
                      ? 'text-amber-300'
                      : 'text-rose-400'
                  ">
                {{ group.meta.costLabel }}
              </span>

              <!-- Compact cycle dots along bottom edge (Mobile/Tablet) -->
              <div
                class="md:hidden absolute inset-x-0 bottom-0.5 flex items-center justify-center gap-0.5 pointer-events-none"
                aria-hidden="true">
                <span v-for="step in group.total" :key="step" class="inline-block size-1 rounded-full" :class="step - 1 === group.index
                    ? group.isActive
                      ? 'bg-primary'
                      : 'bg-foreground/85'
                    : 'bg-muted-foreground/35'
                  " />
              </div>
            </div>

            <!-- Desktop Text Column (Visible from md+) -->
            <div class="hidden md:flex min-w-[74px] lg:min-w-[88px] flex-col gap-0.5">
              <span class="text-[10px] font-mediumtracking-wider text-muted-foreground truncate">
                {{ group.groupLabel }}
              </span>
              <span class="text-xs font-semibold leading-tight text-foreground whitespace-nowrap">
                {{ group.meta.shortTitle }}
              </span>
              <div class="flex items-center justify-between gap-1.5 pt-0.5">
                <span
                  class="inline-flex items-center gap-1 font-mono text-sm lg:text-base font-black leading-none tabular-nums"
                  :class="group.meta.priceTone === 'emerald'
                      ? 'text-emerald-400'
                      : group.meta.priceTone === 'gold'
                        ? 'text-amber-300'
                        : 'text-rose-400'
                    ">
                  <Coins class="size-3.5 shrink-0" />
                  {{ group.meta.costLabel }}
                </span>

                <div class="flex items-center gap-0.5 lg:gap-1" aria-hidden="true">
                  <span v-for="step in group.total" :key="step"
                    class="inline-block size-1.5 rounded-full transition-colors" :class="step - 1 === group.index
                        ? group.isActive
                          ? 'bg-primary'
                          : 'bg-foreground/80'
                        : 'bg-muted-foreground/35'
                      " />
                </div>
              </div>
            </div>
          </button>
        </div>

        <!-- Turn Controls -->
        <div class="flex items-center gap-1 sm:gap-2 shrink-0">
          <Separator orientation="vertical" class="hidden sm:block h-9" />

          <div class="flex items-center gap-1 sm:gap-1.5">
            <Tooltip v-if="store.readyUnitsCount > 0">
              <template #trigger>
                <Button variant="outline" size="sm" class="hidden lg:inline-flex h-10 px-2.5"
                  :disabled="!store.isHumanTurn" @click="emit('focusNextUnit')">
                  <Crosshair class="size-4" />
                  <span class="font-mono text-xs tabular-nums">
                    {{ store.readyUnitsCount }}
                  </span>
                </Button>
              </template>
              <span>Выбрать свободного воина</span>
            </Tooltip>

            <Tooltip>
              <template #trigger>
                <Button variant="outline" size="icon" class="size-9 sm:size-10" :disabled="!store.canUndo"
                  aria-label="Отменить действие" @click="store.undoLastAction()">
                  <Undo2 class="size-4" />
                </Button>
              </template>
              <span>Отменить действие (Z)</span>
            </Tooltip>

            <Tooltip>
              <template #trigger>
                <Button variant="default" size="icon" class="size-9 sm:size-10" :disabled="!store.isHumanTurn"
                  aria-label="Конец хода" @click="store.endTurn()">
                  <SkipForward class="size-4" />
                </Button>
              </template>
              <span>Конец хода (Space)</span>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Full Entity / Tool Info Modal (Opened via Icon-Only Info Button on Mobile & Desktop) -->
  <EntityInfoDialog :open="infoDialogOpen" :tool="infoDialogTool" :faction="store.viewerFactionId"
    @update:open="(val) => (infoDialogOpen = val)" />
</template>
