<script setup lang="ts">
import {computed, type Component} from 'vue';
import {
  Clock,
  Coins,
  Crosshair,
  Eye,
  Footprints,
  Hexagon,
  RotateCcw,
  Shield,
  Sparkles,
  Swords,
  TrendingDown,
  TrendingUp,
} from 'lucide-vue-next';
import {
  EntityType,
  FactionId,
  type PurchasableEntity,
} from '@/domain/game/types';
import {
  CATAPULT_MIN_RANGE,
  CATAPULT_RANGE,
  ENTITY_META,
  FARM_COST_STEP,
  FLARE_COST,
  FLARE_DURATION_TURNS,
  FLARE_RADIUS,
  REGENERATOR_COST,
  REGENERATOR_DURATION_TURNS,
  REGENERATOR_FARM_BONUS,
  REGENERATOR_RADIUS,
  REGENERATOR_STRENGTH_BONUS,
  REGENERATOR_UPKEEP,
  TRADING_POST_BASE_INCOME,
  TRADING_POST_COST_STEP,
  TRADING_POST_FARM_SYNERGY,
  TRADING_POST_HEX_COUNT,
} from '@/domain/game/rules';
import {useGameStore} from '@/application/stores/useGameStore';
import type {PreviewToolId} from '@/infrastructure/three/figurinePreviewRenderer';
import FigurineCanvas3D from '@/presentation/FigurineCanvas3D.vue';
import ModalDialog from '@/components/ui/dialog/ModalDialog.vue';
import {Button} from '@/components/ui/button';
import Separator from '@/components/ui/separator/Separator.vue';

const props = defineProps<{
  open: boolean;
  tool: PreviewToolId | null;
  faction: FactionId;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const store = useGameStore();

interface CharacteristicRow {
  key: string;
  label: string;
  value: string;
  icon: Component;
  tone?: 'default' | 'gold' | 'emerald' | 'rose' | 'sky';
}

interface DetailedToolInfo {
  title: string;
  category: string;
  description: string;
  mechanicsNote: string | null;
  costText: string;
  costTone: 'gold' | 'emerald' | 'rose';
  rows: CharacteristicRow[];
}

function getCategoryLabel(tool: PreviewToolId): string {
  if (
    tool === EntityType.PEASANT ||
    tool === EntityType.SPEARMAN ||
    tool === EntityType.BARON ||
    tool === EntityType.KNIGHT ||
    tool === EntityType.CATAPULT
  ) {
    return 'Юнит';
  }
  if (tool === EntityType.FARM || tool === EntityType.TRADING_POST) {
    return 'Прибыль и экономика';
  }
  if (tool === EntityType.TOWER || tool === EntityType.STRONG_TOWER) {
    return 'Защита и укрепления';
  }
  return 'Дополнительный инструмент';
}

function getMechanicsNote(tool: PreviewToolId): string | null {
  switch (tool) {
    case EntityType.PEASANT:
      return 'Двух крестьян можно объединить в копейщика. Вырубка дерева приносит +3 золота сразу в казну.';
    case EntityType.SPEARMAN:
      return 'Удерживает линию фронта и пробивает защиту крестьян и вражеской столицы (защита 1).';
    case EntityType.BARON:
      return 'Способен штурмовать обычные сторожевые башни (защита 2). Следите за расходом на содержание.';
    case EntityType.KNIGHT:
      return 'Максимальный ранг пехоты — пробивает даже крепкие цитадели (защита 3).';
    case EntityType.CATAPULT:
      return `Стреляет только по видимым целям на дистанции ${CATAPULT_MIN_RANGE}–${CATAPULT_RANGE} гексов. Не атакует соседние клетки (дистанция 1) и уязвима в ближнем бою.`;
    case EntityType.FARM:
      return `Строится рядом со столицей, другой фермой или торговым посадом. Каждая новая ферма в провинции дороже на +${FARM_COST_STEP} золота. Соседние с посадом фермы дают дополнительную синергию +${TRADING_POST_FARM_SYNERGY} золота.`;
    case EntityType.TRADING_POST:
      return `Апгрейд фермы на ${TRADING_POST_HEX_COUNT} смежных гексах треугольником (минимум один из гексов должен быть фермой). Каждая уникальная обычная ферма, граничащая с посадом, добавляет +${TRADING_POST_FARM_SYNERGY} золота за ход. При сносе или попадании катапульты разрушается весь посад. Следующий посад в провинции дороже на +${TRADING_POST_COST_STEP} золота.`;
    case EntityType.TOWER:
      return 'Защищает свою клетку и все 6 соседних гексов вашей провинции силой защиты 2. Может быть улучшена до крепкой башни.';
    case EntityType.STRONG_TOWER:
      return 'Прикрывает себя и все 6 соседних гексов силой защиты 3 — пробить её может только рыцарь или ослабить катапульта.';
    case EntityType.BEACON:
      return 'Обеспечивает постоянный обзор в радиусе 5 гексов сквозь туман войны, но не даёт боевой защиты.';
    case 'FLARE':
      return `Мгновенно освещает выбранную область радиусом ${FLARE_RADIUS} гексов на ${FLARE_DURATION_TURNS} хода для всех игроков — помогает разведывать тыл соперника и наводить катапульты.`;
    case 'REGENERATOR':
      return `Устанавливается на свободную клетку провинции. Усиливает ваши фермы (+${REGENERATOR_FARM_BONUS} золота) и всех ваших юнитов (+${REGENERATOR_STRENGTH_BONUS} к силе) в радиусе ${REGENERATOR_RADIUS} гексов на ${REGENERATOR_DURATION_TURNS} хода.`;
    case 'DEMOLISH':
      return 'Освобождает гекс и снимает содержание с устаревших построек. Возвращает 25% от текущей стоимости аналогичной постройки. Столицу снести нельзя.';
    default:
      return null;
  }
}

const details = computed<DetailedToolInfo | null>(() => {
  void store.boardVersion;
  const tool = props.tool;
  if (!tool) return null;

  const money = store.selectedProvince?.money ?? 0;
  const category = getCategoryLabel(tool);
  const mechanicsNote = getMechanicsNote(tool);

  if (tool === 'FLARE') {
    const affordable = money >= FLARE_COST;
    return {
      title: 'Освещение (Свет)',
      category,
      description:
        'Временная световая вспышка для разведки: рассеивает туман войны в любой точке карты, даже вдали от ваших границ.',
      mechanicsNote,
      costText: `${FLARE_COST} золота`,
      costTone: affordable ? 'gold' : 'rose',
      rows: [
        {
          key: 'cost',
          label: 'Стоимость запуска',
          value: `${FLARE_COST} золота`,
          icon: Coins,
          tone: affordable ? 'gold' : 'rose',
        },
        {
          key: 'radius',
          label: 'Радиус освещения',
          value: `${FLARE_RADIUS} гекса`,
          icon: Eye,
          tone: 'sky',
        },
        {
          key: 'duration',
          label: 'Длительность действия',
          value: `${FLARE_DURATION_TURNS} хода`,
          icon: Clock,
        },
        {
          key: 'upkeep',
          label: 'Содержание за ход',
          value: 'Нет (0)',
          icon: TrendingDown,
        },
      ],
    };
  }

  if (tool === 'REGENERATOR') {
    const affordable = money >= REGENERATOR_COST;
    return {
      title: 'Регенератор',
      category,
      description:
        'Временный энергетический усилитель территории: одновременно повышает доход ближайших ферм и боевую силу ваших воинов.',
      mechanicsNote,
      costText: `${REGENERATOR_COST} золота`,
      costTone: affordable ? 'gold' : 'rose',
      rows: [
        {
          key: 'cost',
          label: 'Стоимость установки',
          value: `${REGENERATOR_COST} золота`,
          icon: Coins,
          tone: affordable ? 'gold' : 'rose',
        },
        {
          key: 'farm-bonus',
          label: 'Бонус к доходу ферм',
          value: `+${REGENERATOR_FARM_BONUS} золота / ход`,
          icon: TrendingUp,
          tone: 'emerald',
        },
        {
          key: 'str-bonus',
          label: 'Бонус силы юнитов',
          value: `+${REGENERATOR_STRENGTH_BONUS} к силе`,
          icon: Swords,
          tone: 'emerald',
        },
        {
          key: 'upkeep',
          label: 'Содержание за ход',
          value: `-${REGENERATOR_UPKEEP} золота / ход`,
          icon: TrendingDown,
          tone: 'rose',
        },
        {
          key: 'radius',
          label: 'Радиус действия',
          value: `${REGENERATOR_RADIUS} гекса`,
          icon: Sparkles,
          tone: 'sky',
        },
        {
          key: 'duration',
          label: 'Длительность действия',
          value: `${REGENERATOR_DURATION_TURNS} хода`,
          icon: Clock,
        },
      ],
    };
  }

  if (tool === 'DEMOLISH') {
    return {
      title: 'Снос постройки',
      category,
      description:
        'Разбирает выбранную постройку в вашей провинции (ферму, торговый посад, башню, цитадель или маяк), возвращая четверть её стоимости и убирая содержание.',
      mechanicsNote,
      costText: 'Возврат 25%',
      costTone: 'emerald',
      rows: [
        {
          key: 'refund',
          label: 'Возврат стоимости',
          value: '25% от текущей цены',
          icon: RotateCcw,
          tone: 'emerald',
        },
        {
          key: 'cost',
          label: 'Затраты на снос',
          value: 'Бесплатно (0)',
          icon: Coins,
        },
      ],
    };
  }

  const entity = tool as PurchasableEntity;
  const meta = ENTITY_META[entity];
  const currentCost = store.getToolCost(entity);
  const affordable = money >= currentCost;

  const rows: CharacteristicRow[] = [
    {
      key: 'cost',
      label: 'Текущая стоимость',
      value: `${currentCost} золота`,
      icon: Coins,
      tone: affordable ? 'gold' : 'rose',
    },
  ];

  if (entity === EntityType.TRADING_POST) {
    rows.push(
      {
        key: 'base-income',
        label: 'Базовый доход',
        value: `+${TRADING_POST_BASE_INCOME} золота / ход`,
        icon: TrendingUp,
        tone: 'emerald',
      },
      {
        key: 'synergy',
        label: 'Синергия с фермами',
        value: `+${TRADING_POST_FARM_SYNERGY} за соседнюю ферму`,
        icon: Sparkles,
        tone: 'emerald',
      },
      {
        key: 'size',
        label: 'Занимаемая площадь',
        value: `${TRADING_POST_HEX_COUNT} гекса (треугольник)`,
        icon: Hexagon,
        tone: 'sky',
      },
    );
  } else if (meta.income > 0) {
    rows.push({
      key: 'income',
      label: 'Доход за ход',
      value: `+${meta.income} золота / ход`,
      icon: TrendingUp,
      tone: 'emerald',
    });
  }

  if (meta.strength > 0) {
    rows.push({
      key: 'strength',
      label: 'Сила атаки',
      value: `${meta.strength}`,
      icon: Swords,
    });
  }

  if (meta.defense > 0) {
    rows.push({
      key: 'defense',
      label: 'Уровень защиты',
      value: `${meta.defense}`,
      icon: Shield,
      tone: 'sky',
    });
  }

  rows.push({
    key: 'upkeep',
    label: 'Содержание за ход',
    value: meta.upkeep > 0 ? `-${meta.upkeep} золота / ход` : 'Нет (0)',
    icon: TrendingDown,
    tone: meta.upkeep > 0 ? 'rose' : 'default',
  });

  if (meta.moveRange > 0) {
    rows.push({
      key: 'move',
      label: 'Дальность хода',
      value: `${meta.moveRange} ${meta.moveRange === 1 ? 'гекс' : 'гекса'}`,
      icon: Footprints,
    });
  }

  if (entity === EntityType.CATAPULT) {
    rows.push({
      key: 'range',
      label: 'Дальность обстрела',
      value: `${CATAPULT_MIN_RANGE}–${CATAPULT_RANGE} гекса`,
      icon: Crosshair,
      tone: 'gold',
    });
  }

  rows.push({
    key: 'vision',
    label: 'Радиус обзора',
    value: `${meta.visionRadius} ${meta.visionRadius === 1 ? 'гекс' : meta.visionRadius <= 4 ? 'гекса' : 'гексов'}`,
    icon: Eye,
  });

  return {
    title: meta.label,
    category,
    description: meta.description,
    mechanicsNote,
    costText: `${currentCost} золота`,
    costTone: affordable ? 'gold' : 'rose',
    rows,
  };
});
</script>

<template>
  <ModalDialog
    :open="props.open && Boolean(details)"
    :title="details?.title ?? 'Информация'"
    content-class="w-[min(94vw,540px)] max-h-[88vh] overflow-y-auto"
    @update:open="(val) => emit('update:open', val)"
  >
    <div v-if="details && props.tool" class="space-y-4">
      <!-- Top Header Block: 3D Preview Stage + Identity + Full Structured Description -->
      <div class="flex flex-col sm:flex-row items-center sm:items-start gap-4">
        <div
          class="relative flex size-28 sm:size-32 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/45 shadow-inner overflow-hidden"
        >
          <FigurineCanvas3D :tool="props.tool" :faction="props.faction" />
        </div>

        <div class="flex-1 min-w-0 space-y-2 text-center sm:text-left">
          <div
            class="flex flex-wrap items-center justify-center sm:justify-between gap-2"
          >
            <span
              class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {{ details.category }}
            </span>

            <span
              class="inline-flex items-center gap-1 font-mono text-sm font-bold tabular-nums"
              :class="
                details.costTone === 'emerald'
                  ? 'text-emerald-400'
                  : details.costTone === 'gold'
                    ? 'text-amber-300'
                    : 'text-rose-400'
              "
            >
              <Coins class="size-4 shrink-0" />
              <span>{{ details.costText }}</span>
            </span>
          </div>

          <p class="text-sm leading-relaxed text-foreground">
            {{ details.description }}
          </p>
        </div>
      </div>

      <Separator />

      <!-- Full Text-Labeled Characteristics Grid -->
      <div class="space-y-2">
        <h3
          class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Характеристики
        </h3>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div
            v-for="row in details.rows"
            :key="row.key"
            class="flex items-center justify-between gap-3 rounded-lg border border-border/80 bg-secondary/35 px-3 py-2"
          >
            <div class="flex items-center gap-2 min-w-0 text-xs text-muted-foreground">
              <component
                :is="row.icon"
                class="size-4 shrink-0 text-foreground/80"
              />
              <span class="truncate">{{ row.label }}</span>
            </div>

            <span
              class="shrink-0 font-mono text-xs font-semibold tabular-nums"
              :class="
                row.tone === 'emerald'
                  ? 'text-emerald-400'
                  : row.tone === 'gold'
                    ? 'text-amber-300'
                    : row.tone === 'rose'
                      ? 'text-rose-400'
                      : row.tone === 'sky'
                        ? 'text-sky-300'
                        : 'text-foreground'
              "
            >
              {{ row.value }}
            </span>
          </div>
        </div>
      </div>

      <!-- Mechanics / Strategy Note -->
      <div
        v-if="details.mechanicsNote"
        class="rounded-lg border border-border bg-secondary/30 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground"
      >
        <div class="mb-1 font-semibold text-foreground">Особенности и тактика</div>
        <p>{{ details.mechanicsNote }}</p>
      </div>

      <div class="flex justify-end pt-1">
        <Button
          variant="secondary"
          size="sm"
          class="cursor-pointer"
          @click="emit('update:open', false)"
        >
          Закрыть
        </Button>
      </div>
    </div>
  </ModalDialog>
</template>
