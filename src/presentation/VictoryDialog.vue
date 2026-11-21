<script setup lang="ts">
import {computed} from 'vue';
import {Clock, Crown, Handshake, Trophy} from 'lucide-vue-next';
import {FACTION_PALETTES} from '@/domain/game/rules';
import {useGameStore} from '@/application/stores/useGameStore';
import {Button} from '@/components/ui/button';

const store = useGameStore();

const winnerPalette = computed(() =>
  store.gameState.winner !== null
    ? FACTION_PALETTES[store.gameState.winner]
    : null,
);

const winnerName = computed(() =>
  store.gameState.winner !== null
    ? (store.gameState.factions[store.gameState.winner]?.name ??
      FACTION_PALETTES[store.gameState.winner].name)
    : '',
);

const isHumanWinner = computed(() => {
  if (store.gameState.winner === null) return false;
  if (store.isOnlineMode) {
    return store.localControlledFactions.includes(store.gameState.winner);
  }
  return Boolean(store.gameState.factions[store.gameState.winner]?.isHuman);
});

const isDiplomaticVictory = computed(
  () => store.gameState.victoryReason === 'DIPLOMACY',
);

const matchDurationFormatted = computed(() => {
  const safe = Math.max(0, Math.floor(store.elapsedSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
});

const winnerHexes = computed(() => {
  if (store.gameState.winner === null) return 0;
  return store.gameState.factions[store.gameState.winner]?.hexCount ?? 0;
});
</script>

<template>
  <div
    v-if="winnerPalette"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
  >
    <div
      class="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-2xl space-y-5"
    >
      <div
        class="mx-auto flex size-14 items-center justify-center rounded-full border-2 shadow-lg"
        :style="{
          backgroundColor: `${winnerPalette.tileHex}24`,
          borderColor: winnerPalette.tileHex,
          color: winnerPalette.tileHex,
        }"
      >
        <Handshake v-if="isDiplomaticVictory" class="size-7" />
        <Trophy v-else class="size-7" />
      </div>

      <div class="space-y-2">
        <h2
          class="font-display text-2xl font-extrabold tracking-tight text-foreground"
        >
          {{ isHumanWinner ? 'Победа' : 'Партия завершена' }}
        </h2>

        <div
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-sm font-bold text-foreground"
        >
          <span
            class="inline-block size-3.5 rounded-xs border border-white/25"
            :style="{backgroundColor: winnerPalette.tileHex}"
          />
          <span>{{ winnerName }}</span>
        </div>

        <div
          class="flex items-center justify-center gap-1.5 text-xs font-medium"
          :class="isDiplomaticVictory ? 'text-emerald-400' : 'text-amber-300'"
        >
          <Handshake v-if="isDiplomaticVictory" class="size-3.5" />
          <Crown v-else class="size-3.5" />
          <span>
            {{
              isDiplomaticVictory
                ? 'Дипломатическая победа · Все в союзе'
                : 'Господство · Единственная фракция'
            }}
          </span>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2.5 text-left">
        <div class="rounded-lg border border-border bg-secondary/50 p-3">
          <div class="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock class="size-3" />
            <span>Длительность</span>
          </div>
          <div class="font-mono text-lg font-bold tabular-nums text-foreground">
            {{ matchDurationFormatted }}
          </div>
        </div>
        <div class="rounded-lg border border-border bg-secondary/50 p-3">
          <div class="text-xs text-muted-foreground">Ходы</div>
          <div class="font-mono text-lg font-bold tabular-nums text-foreground">
            {{ store.gameState.stats.turnsPlayed }}
          </div>
        </div>
        <div class="rounded-lg border border-border bg-secondary/50 p-3">
          <div class="text-xs text-muted-foreground">Территория</div>
          <div class="font-mono text-lg font-bold tabular-nums text-foreground">
            {{ winnerHexes }}
          </div>
        </div>
        <div class="rounded-lg border border-border bg-secondary/50 p-3">
          <div class="text-xs text-muted-foreground">Юниты / Фермы</div>
          <div class="font-mono text-lg font-bold tabular-nums text-foreground">
            {{ store.gameState.stats.unitsRecruited }}
            <span class="text-muted-foreground font-normal">/</span>
            {{ store.gameState.stats.farmsBuilt }}
          </div>
        </div>
      </div>

      <div class="flex items-center justify-center gap-2.5 pt-1">
        <Button variant="outline" @click="store.showNewGameDialog = true">
          Настроить
        </Button>
        <Button
          v-if="store.isOnlineMode"
          variant="default"
          @click="store.leaveOnlineGame()"
        >
          Выйти
        </Button>
        <Button v-else variant="default" @click="store.exitCurrentMatch()">
          В меню
        </Button>
      </div>
    </div>
  </div>
</template>
