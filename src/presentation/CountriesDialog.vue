<script setup lang="ts">
import {computed} from 'vue';
import {Coins, HelpCircle, Skull} from 'lucide-vue-next';
import {DiplomaticRelation, FactionId} from '@/domain/game/types';
import {useGameStore} from '@/application/stores/useGameStore';
import ModalDialog from '@/components/ui/dialog/ModalDialog.vue';
import {Button} from '@/components/ui/button';

const store = useGameStore();

const NON_FRIEND_BAR_COLOR = '#64748b';

function isRevealedCountry(
  fId: FactionId,
  rel: DiplomaticRelation,
): boolean {
  if (fId === store.viewerFactionId) return true;
  if (!store.gameState.config.diplomacyEnabled) return false;
  return rel === DiplomaticRelation.FRIEND;
}

const orderedCountries = computed(() => {
  void store.boardVersion;
  return [...store.factionLeaderboard].sort((a, b) => {
    if (a.id === store.viewerFactionId) return -1;
    if (b.id === store.viewerFactionId) return 1;
    const aRev = isRevealedCountry(a.id, a.relationToViewer);
    const bRev = isRevealedCountry(b.id, b.relationToViewer);
    if (aRev !== bRev) return aRev ? -1 : 1;
    if (a.isEliminated !== b.isEliminated) return a.isEliminated ? 1 : -1;
    return b.totalNetIncome - a.totalNetIncome;
  });
});

const viewerEntry = computed(() =>
  orderedCountries.value.find((c) => c.id === store.viewerFactionId),
);

const maxPositiveIncome = computed(() => {
  let maxVal = 10;
  for (const entry of orderedCountries.value) {
    if (!entry.isEliminated && entry.totalNetIncome > maxVal) {
      maxVal = entry.totalNetIncome;
    }
  }
  return maxVal;
});

const maxNegativeIncome = computed(() => {
  let maxNeg = 0;
  for (const entry of orderedCountries.value) {
    if (!entry.isEliminated && entry.totalNetIncome < 0) {
      maxNeg = Math.max(maxNeg, Math.abs(entry.totalNetIncome));
    }
  }
  return maxNeg;
});

const hasNegative = computed(() => maxNegativeIncome.value > 0);

function isColoredCountry(
  fId: FactionId,
  rel: DiplomaticRelation,
  isEliminated: boolean,
): boolean {
  if (isEliminated) return false;
  return isRevealedCountry(fId, rel);
}

function barColor(
  fId: FactionId,
  rel: DiplomaticRelation,
  tileHex: string,
  isEliminated: boolean,
): string {
  return isColoredCountry(fId, rel, isEliminated)
    ? tileHex
    : NON_FRIEND_BAR_COLOR;
}

function positiveBarHeightPercent(income: number, isEliminated: boolean): number {
  if (isEliminated || income <= 0) return 0;
  return Math.max(8, Math.round((income / maxPositiveIncome.value) * 100));
}

function negativeBarHeightPercent(income: number, isEliminated: boolean): number {
  if (isEliminated || income >= 0 || maxNegativeIncome.value <= 0) return 0;
  return Math.max(
    14,
    Math.round((Math.abs(income) / maxNegativeIncome.value) * 100),
  );
}

function formatIncome(income: number): string {
  return income >= 0 ? `+${income}` : `${income}`;
}
</script>

<template>
  <ModalDialog
    :open="store.showCountriesDialog"
    title="Доход держав"
    content-class="w-[min(95vw,580px)] max-h-[86vh] overflow-y-auto"
    @update:open="(val) => (store.showCountriesDialog = val)"
  >
    <div class="space-y-4">
      <!-- Own treasury summary (rival treasuries stay hidden) -->
      <div
        v-if="viewerEntry"
        class="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3.5 py-2 text-xs"
      >
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="inline-block size-3 shrink-0 rounded-xs border border-white/25"
            :style="{backgroundColor: viewerEntry.palette.tileHex}"
          />
          <span
            v-if="store.isOnlineMode && viewerEntry.onlineSlot"
            class="inline-block size-2 shrink-0 rounded-full"
            :class="
              viewerEntry.onlineSlot.online ? 'bg-emerald-400' : 'bg-zinc-500'
            "
          />
          <span class="font-semibold text-foreground truncate">
            {{ viewerEntry.name }}
          </span>
        </div>
        <div class="flex items-center gap-3 font-mono tabular-nums shrink-0">
          <span class="inline-flex items-center gap-1 font-bold text-primary">
            <Coins class="size-3.5" />
            {{ viewerEntry.totalMoney }}
          </span>
          <span
            class="font-semibold"
            :class="
              viewerEntry.totalNetIncome >= 0
                ? 'text-emerald-400'
                : 'text-rose-400'
            "
          >
            {{ formatIncome(viewerEntry.totalNetIncome) }}/ход
          </span>
        </div>
      </div>

      <!-- Vertical Comparison Bar Chart (Non-friends are anonymous grey bars) -->
      <div class="rounded-lg border border-border bg-secondary/25 px-3 pt-4 pb-3">
        <!-- Upper (Positive) Chart Area -->
        <div class="relative flex items-end justify-around gap-2 h-44 px-1">
          <div
            class="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border/50"
          />
          <div
            class="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/40"
          />

          <div
            v-for="entry in orderedCountries"
            :key="`pos-${entry.id}`"
            class="relative z-10 flex flex-1 flex-col items-center justify-end h-full max-w-[78px]"
            :class="entry.isEliminated ? 'opacity-45' : ''"
          >
            <span
              v-if="!entry.isEliminated && entry.totalNetIncome >= 0"
              class="mb-1.5 font-mono text-xs font-bold tabular-nums leading-none"
              :class="
                isColoredCountry(
                  entry.id,
                  entry.relationToViewer,
                  entry.isEliminated,
                )
                  ? 'text-foreground'
                  : 'text-slate-400'
              "
            >
              {{ formatIncome(entry.totalNetIncome) }}
            </span>

            <div class="flex w-full flex-1 items-end justify-center">
              <div
                v-if="!entry.isEliminated && entry.totalNetIncome > 0"
                class="w-full max-w-[42px] rounded-t-md border border-b-0 border-white/20 shadow-sm transition-all duration-300"
                :style="{
                  height: `${positiveBarHeightPercent(entry.totalNetIncome, entry.isEliminated)}%`,
                  backgroundColor: barColor(
                    entry.id,
                    entry.relationToViewer,
                    entry.palette.tileHex,
                    entry.isEliminated,
                  ),
                }"
              />
              <div
                v-else-if="!entry.isEliminated && entry.totalNetIncome === 0"
                class="w-full max-w-[42px] h-1 rounded-t-xs"
                :style="{
                  backgroundColor: barColor(
                    entry.id,
                    entry.relationToViewer,
                    entry.palette.tileHex,
                    entry.isEliminated,
                  ),
                }"
              />
            </div>
          </div>
        </div>

        <!-- Zero Baseline -->
        <div class="h-0.5 w-full bg-border" />

        <!-- Lower (Negative) Chart Area -->
        <div
          v-if="hasNegative"
          class="flex items-start justify-around gap-2 h-20 px-1"
        >
          <div
            v-for="entry in orderedCountries"
            :key="`neg-${entry.id}`"
            class="flex flex-1 flex-col items-center justify-start h-full max-w-[78px]"
            :class="entry.isEliminated ? 'opacity-45' : ''"
          >
            <div class="flex w-full flex-1 items-start justify-center">
              <div
                v-if="!entry.isEliminated && entry.totalNetIncome < 0"
                class="w-full max-w-[42px] rounded-b-md border border-t-0 border-white/20 shadow-sm transition-all duration-300"
                :style="{
                  height: `${negativeBarHeightPercent(entry.totalNetIncome, entry.isEliminated)}%`,
                  backgroundColor: barColor(
                    entry.id,
                    entry.relationToViewer,
                    entry.palette.tileHex,
                    entry.isEliminated,
                  ),
                }"
              />
            </div>
            <span
              v-if="!entry.isEliminated && entry.totalNetIncome < 0"
              class="mt-1 font-mono text-xs font-bold tabular-nums leading-none text-rose-400"
            >
              {{ formatIncome(entry.totalNetIncome) }}
            </span>
          </div>
        </div>

        <!-- Country Labels under each column (Hidden for Non-Friends!) -->
        <div class="mt-2.5 flex items-start justify-around gap-1.5 px-1">
          <div
            v-for="entry in orderedCountries"
            :key="`lbl-${entry.id}`"
            class="flex flex-1 flex-col items-center gap-1 min-w-0 max-w-[78px] text-center"
            :class="entry.isEliminated ? 'opacity-45' : ''"
          >
            <!-- Revealed Identity (Own Country or Friend) -->
            <template v-if="isRevealedCountry(entry.id, entry.relationToViewer)">
              <div class="flex items-center justify-center gap-1 max-w-full">
                <span
                  v-if="store.isOnlineMode && entry.onlineSlot"
                  class="inline-block size-1.5 shrink-0 rounded-full"
                  :class="
                    entry.onlineSlot.online ? 'bg-emerald-400' : 'bg-zinc-500'
                  "
                  :title="entry.onlineSlot.online ? 'В сети' : 'Офлайн'"
                />
                <span
                  class="inline-block size-2.5 shrink-0 rounded-xs border border-white/20"
                  :style="{backgroundColor: entry.palette.tileHex}"
                />
                <span class="text-[11px] font-semibold truncate text-foreground">
                  {{ entry.name }}
                </span>
              </div>

              <span
                v-if="entry.id === store.viewerFactionId"
                class="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary leading-none"
              >
                Вы
              </span>
              <span
                v-else-if="entry.isEliminated"
                class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground leading-none"
              >
                Выбыла
              </span>
              <span
                v-else
                class="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-300"
              >
                Друг
              </span>

              <span
                v-if="entry.blackMarkTurns > 0 && !entry.isEliminated"
                class="inline-flex items-center gap-0.5 text-[10px] text-rose-400"
                title="Чёрная метка"
              >
                <Skull class="size-3" />
              </span>
            </template>

            <!-- Hidden Identity (Not a Friend — Anonymous Grey Column) -->
            <template v-else>
              <div
                class="flex items-center justify-center gap-1 text-slate-400"
                title="Страна скрыта (не союзник)"
              >
                <HelpCircle class="size-3.5 shrink-0 opacity-75" />
                <span class="text-[11px] font-semibold">???</span>
              </div>
              <span
                v-if="entry.isEliminated"
                class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground leading-none"
              >
                Выбыла
              </span>
            </template>
          </div>
        </div>
      </div>

      <div class="flex justify-end">
        <Button
          variant="default"
          size="sm"
          @click="store.showCountriesDialog = false"
        >
          Закрыть
        </Button>
      </div>
    </div>
  </ModalDialog>
</template>
