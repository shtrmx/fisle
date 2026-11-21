<script setup lang="ts">
import {watch} from 'vue';
import {
  ArrowLeftRight,
  Bell,
  Handshake,
  Info,
  Mail,
  MessageSquare,
  Skull,
  Swords,
  Trash2,
  XCircle,
} from 'lucide-vue-next';
import {FACTION_PALETTES} from '@/domain/game/rules';
import type {GameNotification} from '@/domain/multiplayer/types';
import {useGameStore} from '@/application/stores/useGameStore';
import ModalDialog from '@/components/ui/dialog/ModalDialog.vue';
import {Button} from '@/components/ui/button';

const store = useGameStore();

// Auto-read all notifications as soon as the history dialog is opened
watch(
  () => store.showNotificationsDialog,
  (open) => {
    if (open) {
      store.markAllNotificationsRead();
    }
  },
);

function iconFor(category: GameNotification['category']) {
  switch (category) {
    case 'WAR':
      return Swords;
    case 'FRIEND':
      return Handshake;
    case 'BLACK_MARK':
      return Skull;
    case 'EXCHANGE':
      return ArrowLeftRight;
    case 'REJECTED':
      return XCircle;
    case 'CHAT':
      return MessageSquare;
    case 'SYSTEM':
      return Info;
    default:
      return Mail;
  }
}

function toneFor(category: GameNotification['category']): string {
  switch (category) {
    case 'WAR':
    case 'BLACK_MARK':
    case 'REJECTED':
      return 'text-rose-400';
    case 'FRIEND':
      return 'text-emerald-400';
    case 'EXCHANGE':
      return 'text-primary';
    case 'CHAT':
      return 'text-sky-400';
    default:
      return 'text-muted-foreground';
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}
</script>

<template>
  <ModalDialog
    :open="store.showNotificationsDialog"
    title="История сообщений"
    content-class="w-[min(94vw,460px)] max-h-[84vh] overflow-y-auto"
    @update:open="(val) => (store.showNotificationsDialog = val)"
  >
    <div class="space-y-3">
      <div
        v-if="store.notifications.length === 0"
        class="flex flex-col items-center justify-center gap-2 py-8 text-center text-xs text-muted-foreground"
      >
        <Bell class="size-6 opacity-45" />
        <span>Пусто</span>
      </div>

      <div v-else class="space-y-1.5 max-h-[58vh] overflow-y-auto pr-1">
        <div
          v-for="notif in store.notifications"
          :key="notif.id"
          class="flex w-full items-start gap-2.5 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs"
        >
          <component
            :is="iconFor(notif.category)"
            class="mt-0.5 size-4 shrink-0"
            :class="toneFor(notif.category)"
          />
          <div class="min-w-0 flex-1 space-y-0.5">
            <div class="flex items-center justify-between gap-2 text-[11px]">
              <div class="flex items-center gap-1.5 min-w-0">
                <span
                  v-if="notif.fromFaction !== undefined"
                  class="inline-block size-2 shrink-0 rounded-xs"
                  :style="{
                    backgroundColor:
                      FACTION_PALETTES[notif.fromFaction]?.tileHex ?? '#94a3b8',
                  }"
                />
                <span class="font-semibold text-foreground truncate">
                  {{ notif.fromName ?? 'Событие' }}
                </span>
              </div>
              <span
                class="font-mono text-[10px] tabular-nums text-muted-foreground shrink-0"
              >
                <template v-if="notif.turn > 0">Ход {{ notif.turn }} · </template
                >{{ formatTime(notif.timestamp) }}
              </span>
            </div>
            <p class="leading-snug text-foreground/90 break-words">
              {{ notif.text }}
            </p>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between gap-2 pt-1">
        <Button
          v-if="store.notifications.length > 0"
          variant="ghost"
          size="sm"
          class="gap-1.5 text-xs text-muted-foreground hover:text-rose-400"
          @click="store.clearNotifications()"
        >
          <Trash2 class="size-3.5" />
          <span>Очистить</span>
        </Button>
        <div v-else />

        <Button
          variant="default"
          size="sm"
          @click="store.showNotificationsDialog = false"
        >
          Закрыть
        </Button>
      </div>
    </div>
  </ModalDialog>
</template>
