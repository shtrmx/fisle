<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {
  Ban,
  Coins,
  Handshake,
  Trees,
  TrendingDown,
  TrendingUp,
} from 'lucide-vue-next';
import {FACTION_PALETTES} from '@/domain/game/rules';
import {useGameStore} from '@/application/stores/useGameStore';
import ModalDialog from '@/components/ui/dialog/ModalDialog.vue';
import {Button} from '@/components/ui/button';
import Separator from '@/components/ui/separator/Separator.vue';

const store = useGameStore();
const breakdown = computed(() => store.selectedProvinceBreakdown);
const confirmCancelId = ref<number | null>(null);

watch(
  () => store.showIncomeDialog,
  (isOpen) => {
    if (!isOpen) {
      confirmCancelId.value = null;
    }
  },
);

const canBreakTreaty = computed(
  () =>
    store.gameState.winner === null &&
    !store.isViewerEliminated &&
    (!store.isOnlineMode ||
      (store.roomStatus === 'PLAYING' && !store.isRoomPaused)),
);

const activeSubsidyRows = computed(() => {
  const subs = store.viewerActiveSubsidies;
  const rows: Array<{
    id: number;
    direction: 'incoming' | 'outgoing';
    partnerName: string;
    partnerColor: string;
    amountPerTurn: number;
    turnsRemaining: number;
  }> = [];

  for (const sub of subs.incoming) {
    rows.push({
      id: sub.id,
      direction: 'incoming',
      partnerName:
        store.gameState.factions[sub.fromFaction]?.name ??
        FACTION_PALETTES[sub.fromFaction]?.name ??
        'Держава',
      partnerColor: FACTION_PALETTES[sub.fromFaction]?.tileHex ?? '#94a3b8',
      amountPerTurn: sub.amountPerTurn,
      turnsRemaining: sub.turnsRemaining,
    });
  }

  for (const sub of subs.outgoing) {
    rows.push({
      id: sub.id,
      direction: 'outgoing',
      partnerName:
        store.gameState.factions[sub.toFaction]?.name ??
        FACTION_PALETTES[sub.toFaction]?.name ??
        'Держава',
      partnerColor: FACTION_PALETTES[sub.toFaction]?.tileHex ?? '#94a3b8',
      amountPerTurn: sub.amountPerTurn,
      turnsRemaining: sub.turnsRemaining,
    });
  }

  return rows;
});

function handleConfirmCancel(subsidyId: number): void {
  confirmCancelId.value = null;
  store.cancelSubsidy(subsidyId);
}
</script>

<template>
  <ModalDialog
    :open="store.showIncomeDialog"
    title="Экономика"
    content-class="w-[min(94vw,520px)] max-h-[86vh] overflow-y-auto"
    @update:open="(val) => (store.showIncomeDialog = val)"
  >
    <div v-if="breakdown" class="space-y-4">
      <!-- Top Summary KPIs -->
      <div class="grid grid-cols-3 gap-2">
        <div class="rounded-lg border border-border bg-secondary/50 p-2.5">
          <div class="text-[11px] text-muted-foreground">В казне</div>
          <div class="mt-0.5 flex items-center gap-1 font-mono text-base font-bold text-primary tabular-nums">
            <Coins class="size-4" />
            {{ breakdown.money }}
          </div>
        </div>
        <div class="rounded-lg border border-border bg-secondary/50 p-2.5">
          <div class="text-[11px] text-muted-foreground">Баланс / ход</div>
          <div
            class="mt-0.5 font-mono text-base font-bold tabular-nums"
            :class="
              breakdown.netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'
            "
          >
            {{
              breakdown.netIncome >= 0
                ? `+${breakdown.netIncome}`
                : breakdown.netIncome
            }}
          </div>
        </div>
        <div class="rounded-lg border border-border bg-secondary/50 p-2.5">
          <div class="text-[11px] text-muted-foreground">Следующий ход</div>
          <div
            class="mt-0.5 font-mono text-base font-bold tabular-nums"
            :class="
              breakdown.projectedMoney >= 0 ? 'text-foreground' : 'text-rose-400'
            "
          >
            {{ breakdown.projectedMoney }}
            <span
              v-if="breakdown.projectedMoney < 0"
              class="text-[10px] font-normal text-rose-300"
            >
              (банкрот!)
            </span>
          </div>
        </div>
      </div>

      <!-- Income Section -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between text-xs font-semibold text-emerald-400">
          <span class="flex items-center gap-1.5">
            <TrendingUp class="size-3.5" />
            Доход
          </span>
          <span class="font-mono tabular-nums">+{{ breakdown.totalIncome }}</span>
        </div>
        <div class="divide-y divide-border/60 rounded-lg border border-border bg-secondary/35">
          <div
            v-for="item in breakdown.incomeItems"
            :key="item.label"
            class="flex items-center justify-between px-3 py-2 text-xs"
          >
            <div>
              <span class="font-medium text-foreground">{{ item.label }}</span>
              <span class="ml-2 font-mono text-muted-foreground tabular-nums">
                {{ item.count }} × +{{ item.perUnit }}
              </span>
            </div>
            <span class="font-mono font-semibold text-emerald-400 tabular-nums">
              +{{ item.total }}
            </span>
          </div>
          <div
            v-if="breakdown.incomeItems.length === 0"
            class="px-3 py-2 text-xs text-muted-foreground"
          >
            Нет
          </div>
        </div>
      </div>

      <!-- Upkeep / Expenses Section -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between text-xs font-semibold text-rose-400">
          <span class="flex items-center gap-1.5">
            <TrendingDown class="size-3.5" />
            Содержание
          </span>
          <span class="font-mono tabular-nums">-{{ breakdown.totalUpkeep }}</span>
        </div>
        <div class="divide-y divide-border/60 rounded-lg border border-border bg-secondary/35">
          <div
            v-for="item in breakdown.upkeepItems"
            :key="item.label"
            class="flex items-center justify-between px-3 py-2 text-xs"
          >
            <div>
              <span class="font-medium text-foreground">{{ item.label }}</span>
              <span class="ml-2 font-mono text-muted-foreground tabular-nums">
                {{ item.count }} × {{ item.perUnit }}
              </span>
            </div>
            <span class="font-mono font-semibold text-rose-400 tabular-nums">
              {{ item.total }}
            </span>
          </div>
          <div
            v-if="breakdown.upkeepItems.length === 0"
            class="px-3 py-2 text-xs text-muted-foreground"
          >
            Нет
          </div>
        </div>
      </div>

      <!-- Active Subsidy Treaties (cancellable at any time by either party) -->
      <div v-if="activeSubsidyRows.length > 0" class="space-y-1.5">
        <div class="flex items-center justify-between text-xs font-semibold text-sky-300">
          <span class="flex items-center gap-1.5">
            <Handshake class="size-3.5" />
            Договоры о дотациях
          </span>
          <span class="font-mono text-[11px] text-muted-foreground tabular-nums">
            {{ activeSubsidyRows.length }}
          </span>
        </div>
        <div class="divide-y divide-border/60 rounded-lg border border-border bg-secondary/35">
          <div
            v-for="row in activeSubsidyRows"
            :key="row.id"
            class="flex items-center justify-between gap-2 px-3 py-2 text-xs"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="inline-block size-2.5 shrink-0 rounded-xs border border-white/25"
                :style="{backgroundColor: row.partnerColor}"
              />
              <div class="min-w-0">
                <div class="truncate font-medium text-foreground">
                  {{
                    row.direction === 'incoming'
                      ? `От «${row.partnerName}»`
                      : `Для «${row.partnerName}»`
                  }}
                </div>
                <div class="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
                  <span
                    :class="
                      row.direction === 'incoming'
                        ? 'text-emerald-400 font-semibold'
                        : 'text-rose-400 font-semibold'
                    "
                  >
                    {{
                      row.direction === 'incoming'
                        ? `+${row.amountPerTurn}`
                        : `-${row.amountPerTurn}`
                    }}
                    / ход
                  </span>
                  <span class="text-muted-foreground">
                    · {{ row.turnsRemaining }} х.
                  </span>
                </div>
              </div>
            </div>

            <div v-if="canBreakTreaty" class="flex items-center gap-1 shrink-0">
              <template v-if="confirmCancelId === row.id">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 px-2 text-[11px]"
                  @click="confirmCancelId = null"
                >
                  Нет
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  class="h-7 px-2 text-[11px]"
                  @click="handleConfirmCancel(row.id)"
                >
                  Разорвать
                </Button>
              </template>
              <Button
                v-else
                variant="outline"
                size="sm"
                class="h-7 gap-1 border-rose-500/35 px-2 text-[11px] text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
                @click="confirmCancelId = row.id"
              >
                <Ban class="size-3 shrink-0" />
                <span>Прервать</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- Blocked Hexes (Trees / Graves) -->
      <div v-if="breakdown.blockedItems.length > 0" class="space-y-1.5">
        <div class="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
          <Trees class="size-3.5" />
          Заблокировано
        </div>
        <div class="divide-y divide-border/60 rounded-lg border border-border bg-secondary/25">
          <div
            v-for="item in breakdown.blockedItems"
            :key="item.label"
            class="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground"
          >
            <span>{{ item.label }}</span>
            <span class="font-mono tabular-nums">{{ item.count }}</span>
          </div>
        </div>
      </div>

      <Separator />

      <div class="flex items-center justify-between text-xs">
        <span class="text-muted-foreground">
          Гексов:
          <strong class="font-mono text-foreground">{{ breakdown.hexCount }}</strong>
        </span>
        <Button variant="default" size="sm" @click="store.showIncomeDialog = false">
          Ок
        </Button>
      </div>
    </div>

    <div v-else class="py-4 text-center text-xs text-muted-foreground">
      Выберите провинцию
    </div>
  </ModalDialog>
</template>
