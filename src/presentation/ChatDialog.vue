<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue';
import {MessageSquare, Send} from 'lucide-vue-next';
import {FACTION_PALETTES} from '@/domain/game/rules';
import {useGameStore} from '@/application/stores/useGameStore';
import ModalDialog from '@/components/ui/dialog/ModalDialog.vue';
import {Button} from '@/components/ui/button';

const store = useGameStore();
const draft = ref('');
const feedRef = ref<HTMLDivElement | null>(null);

const activePlayers = computed(() =>
  store.onlinePlayers.filter((p) => !p.left),
);

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

function scrollToBottom(): void {
  void nextTick(() => {
    if (feedRef.value) {
      feedRef.value.scrollTop = feedRef.value.scrollHeight;
    }
  });
}

watch(
  () => [store.showChatDialog, store.chatMessages.length],
  ([open]) => {
    if (open) {
      // Mark CHAT notifications read when opening chat
      for (const n of store.notifications) {
        if (n.category === 'CHAT' && !n.read) {
          store.markNotificationRead(n.id);
        }
      }
      scrollToBottom();
    }
  },
);

function submit(): void {
  const trimmed = draft.value.trim();
  if (!trimmed) return;
  store.sendChatMessage(trimmed);
  draft.value = '';
  scrollToBottom();
}
</script>

<template>
  <ModalDialog
    :open="store.showChatDialog"
    title="Чат"
    content-class="w-[min(94vw,460px)]"
    @update:open="(val) => (store.showChatDialog = val)"
  >
    <div class="space-y-3">
      <!-- Live Online Players Presence Strip -->
      <div
        v-if="activePlayers.length > 0"
        class="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-secondary/35 p-2"
      >
        <div
          v-for="p in activePlayers"
          :key="p.playerId"
          class="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/85 px-2 py-1 text-[11px]"
        >
          <span
            class="inline-block size-2 rounded-full shrink-0"
            :class="p.online ? 'bg-emerald-400' : 'bg-zinc-500'"
            :title="p.online ? 'В сети' : 'Офлайн'"
          />
          <span
            class="inline-block size-2.5 rounded-xs shrink-0"
            :style="{
              backgroundColor:
                FACTION_PALETTES[p.factionId]?.tileHex ?? '#94a3b8',
            }"
          />
          <span class="font-medium text-foreground max-w-[110px] truncate">
            {{ p.nickname }}
          </span>
        </div>
      </div>

      <!-- Messages Feed -->
      <div
        ref="feedRef"
        class="h-64 overflow-y-auto rounded-lg border border-border bg-secondary/20 p-2.5 space-y-2"
      >
        <div
          v-if="store.chatMessages.length === 0"
          class="flex h-full flex-col items-center justify-center gap-1.5 text-xs text-muted-foreground"
        >
          <MessageSquare class="size-5 opacity-45" />
          <span>Нет сообщений</span>
        </div>

        <div
          v-for="msg in store.chatMessages"
          :key="msg.id"
          class="rounded-md border px-2.5 py-2 text-xs space-y-1"
          :class="
            msg.playerId === store.localPlayerId
              ? 'border-primary/40 bg-primary/10'
              : 'border-border bg-secondary/45'
          "
        >
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <div class="flex items-center gap-1.5 min-w-0">
              <span
                class="inline-block size-2.5 rounded-xs shrink-0"
                :style="{
                  backgroundColor:
                    FACTION_PALETTES[msg.factionId]?.tileHex ?? '#94a3b8',
                }"
              />
              <span class="font-semibold text-foreground truncate">
                {{ msg.nickname }}
              </span>
            </div>
            <span class="font-mono text-[10px] tabular-nums text-muted-foreground shrink-0">
              <template v-if="msg.turn > 0">Ход {{ msg.turn }} · </template
              >{{ formatTime(msg.timestamp) }}
            </span>
          </div>
          <p class="text-foreground/95 leading-snug break-words">
            {{ msg.text }}
          </p>
        </div>
      </div>

      <!-- Composer -->
      <div class="flex items-center gap-2">
        <input
          v-model="draft"
          type="text"
          maxlength="240"
          placeholder="Сообщение..."
          class="h-9 flex-1 rounded-md border border-input bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-ring"
          @keydown.enter="submit"
        />
        <Button
          size="sm"
          class="h-9 px-3"
          :disabled="!draft.trim()"
          @click="submit"
        >
          <Send class="size-3.5" />
        </Button>
      </div>
    </div>
  </ModalDialog>
</template>
