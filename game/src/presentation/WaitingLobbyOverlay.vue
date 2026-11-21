<script setup lang="ts">
import {computed, ref} from 'vue';
import {
  Check,
  Copy,
  Crown,
  Loader2,
  Lock,
  LogOut,
  MessageSquare,
  Trash2,
  UserX,
  Users,
} from 'lucide-vue-next';
import {FACTION_PALETTES} from '@/domain/game/rules';
import {MapSize} from '@/domain/game/types';
import {useGameStore} from '@/application/stores/useGameStore';
import {Button} from '@/components/ui/button';

const store = useGameStore();
const copied = ref(false);
const confirmDisband = ref(false);
let copyTimer = 0;

const MAP_SIZE_LABELS: Record<MapSize, string> = {
  [MapSize.SMALL]: 'Малая',
  [MapSize.MEDIUM]: 'Средняя',
  [MapSize.LARGE]: 'Большая',
  [MapSize.GIANT]: 'Гигантская',
};

const isVisible = computed(
  () => store.isOnlineMode && store.roomStatus === 'WAITING',
);

const totalHumans = computed(() => store.roomConfig?.humanCount ?? 2);
const totalFactions = computed(() => store.roomConfig?.factionCount ?? 2);
const botCount = computed(() =>
  Math.max(0, totalFactions.value - totalHumans.value),
);

const activePlayers = computed(() =>
  store.onlinePlayers.filter((p) => !p.left),
);

const remainingSlots = computed(() =>
  Math.max(0, totalHumans.value - activePlayers.value.length),
);

async function copyRoomCode(): Promise<void> {
  if (!store.roomCode) return;
  try {
    await navigator.clipboard.writeText(store.roomCode);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = store.roomCode;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
  copied.value = true;
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => {
    copied.value = false;
  }, 1800);
}
</script>

<template>
  <div
    v-if="isVisible"
    class="fixed inset-0 z-30 flex items-center justify-center bg-background/95 p-4"
  >
    <div
      class="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl space-y-4"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <Users class="size-5 shrink-0 text-primary" />
          <h2 class="font-display text-lg font-bold text-foreground truncate">
            {{ store.roomName || 'Комната' }}
          </h2>
          <Lock
            v-if="store.roomHasPassword"
            class="size-3.5 shrink-0 text-amber-300"
            title="Защищена паролем"
          />
        </div>
        <span
          class="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-2 py-1 font-mono text-xs font-semibold tabular-nums text-foreground"
        >
          {{ activePlayers.length }} / {{ totalHumans }}
        </span>
      </div>

      <!-- Shareable Room Code -->
      <div
        class="rounded-lg border border-border bg-secondary/40 p-3.5 space-y-2"
      >
        <div class="flex items-center justify-between text-xs text-muted-foreground">
          <span>Код комнаты</span>
          <span v-if="store.roomConfig" class="font-mono tabular-nums">
            {{ MAP_SIZE_LABELS[store.roomConfig.mapSize] }} ·
            {{ totalFactions }} фр.
            <template v-if="botCount > 0"> ({{ botCount }} ИИ)</template>
          </span>
        </div>

        <div class="flex items-center gap-2">
          <code
            class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-center font-mono text-xl font-black tracking-[0.22em] text-primary select-all"
          >
            {{ store.roomCode }}
          </code>
          <Button
            variant="secondary"
            size="sm"
            class="h-11 px-3 shrink-0"
            @click="copyRoomCode"
          >
            <Check v-if="copied" class="size-4 text-emerald-400" />
            <Copy v-else class="size-4" />
            <span class="text-xs">{{ copied ? 'Готово' : 'Код' }}</span>
          </Button>
        </div>
      </div>

      <!-- Connected Players + Empty Slots -->
      <div class="space-y-1.5">
        <div
          v-for="player in activePlayers"
          :key="player.playerId"
          class="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/45 px-3 py-2 text-xs"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <span
              class="inline-block size-3.5 shrink-0 rounded-xs border border-white/25"
              :style="{
                backgroundColor:
                  FACTION_PALETTES[player.factionId]?.tileHex ?? '#94a3b8',
              }"
            />
            <span class="font-semibold text-foreground truncate">
              {{ player.nickname }}
            </span>
            <span
              v-if="player.playerId === store.localPlayerId"
              class="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary shrink-0"
            >
              Вы
            </span>
            <Crown
              v-if="player.isHost"
              class="size-3.5 text-amber-400 shrink-0"
              title="Создатель комнаты"
            />
          </div>

          <div class="flex items-center gap-1.5 shrink-0 text-[11px]">
            <span
              class="inline-block size-2 rounded-full"
              :class="player.online ? 'bg-emerald-400' : 'bg-zinc-500'"
            />
            <span
              :class="
                player.online ? 'text-emerald-400' : 'text-muted-foreground'
              "
            >
              {{ player.online ? 'В сети' : 'Офлайн' }}
            </span>
            <button
              v-if="store.isLocalHost && player.playerId !== store.localPlayerId"
              type="button"
              class="ml-1 inline-flex size-6 items-center justify-center rounded border border-border/80 bg-background/70 text-muted-foreground hover:border-rose-500/50 hover:text-rose-400 transition-colors cursor-pointer"
              title="Выгнать игрока"
              @click="store.kickOnlinePlayer(player.playerId)"
            >
              <UserX class="size-3.5" />
            </button>
          </div>
        </div>

        <div
          v-for="slot in remainingSlots"
          :key="`empty-${slot}`"
          class="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground"
        >
          <div class="flex items-center gap-2">
            <Loader2 class="size-3.5 animate-spin opacity-70" />
            <span>Ожидание...</span>
          </div>
        </div>
      </div>

      <div
        v-if="confirmDisband && store.isLocalHost"
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
            @click="confirmDisband = false"
          >
            Отмена
          </Button>
          <Button
            variant="destructive"
            size="sm"
            class="w-full justify-center gap-1.5 text-xs"
            @click="
              confirmDisband = false;
              store.disbandOnlineRoom();
            "
          >
            <Trash2 class="size-3.5" />
            Удалить
          </Button>
        </div>
      </div>

      <div v-else class="flex items-center justify-between gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          class="gap-1.5 text-xs"
          @click="store.showChatDialog = true"
        >
          <MessageSquare class="size-3.5 text-primary" />
          <span>Чат</span>
          <span
            v-if="store.chatMessages.length > 0"
            class="font-mono text-[11px] text-primary"
          >
            ({{ store.chatMessages.length }})
          </span>
        </Button>

        <div class="flex items-center gap-1.5">
          <Button
            variant="destructive"
            size="sm"
            class="gap-1.5 text-xs"
            @click="store.leaveOnlineGame()"
          >
            <LogOut class="size-3.5" />
            <span>Выйти</span>
          </Button>
          <Button
            v-if="store.isLocalHost"
            variant="outline"
            size="icon"
            class="size-8 shrink-0 border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
            aria-label="Распустить и удалить комнату"
            title="Распустить и удалить комнату"
            @click="confirmDisband = true"
          >
            <Trash2 class="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
