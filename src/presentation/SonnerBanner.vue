<script setup lang="ts">
import {
  ArrowLeftRight,
  Check,
  Handshake,
  Info,
  Mail,
  MessageSquare,
  Skull,
  Swords,
  X,
  XCircle,
} from 'lucide-vue-next';
import {DiplomaticMessageStatus} from '@/domain/game/types';
import {FACTION_PALETTES} from '@/domain/game/rules';
import type {NotificationCategory} from '@/domain/multiplayer/types';
import {useGameStore, type SonnerItem} from '@/application/stores/useGameStore';
import {Button} from '@/components/ui/button';

const store = useGameStore();

function iconFor(category: NotificationCategory) {
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
    case 'MESSAGE':
      return Mail;
    default:
      return Info;
  }
}

function toneClasses(category: NotificationCategory): {
  icon: string;
  border: string;
} {
  switch (category) {
    case 'WAR':
    case 'BLACK_MARK':
    case 'REJECTED':
      return {
        icon: 'text-rose-400',
        border: 'border-rose-500/45',
      };
    case 'FRIEND':
      return {
        icon: 'text-emerald-400',
        border: 'border-emerald-500/45',
      };
    case 'EXCHANGE':
      return {
        icon: 'text-primary',
        border: 'border-primary/50',
      };
    case 'CHAT':
      return {
        icon: 'text-sky-400',
        border: 'border-sky-500/45',
      };
    default:
      return {
        icon: 'text-primary',
        border: 'border-border',
      };
  }
}

function canRespondToItem(item: SonnerItem): boolean {
  if (
    item.actionKind !== 'DIPLOMACY_RESPONSE' ||
    item.messageId === undefined ||
    !store.canRespondDiplomacy
  ) {
    return false;
  }
  const msg = store.gameState.diplomacy.messages.find(
    (m) => m.id === item.messageId,
  );
  if (!msg || msg.status !== DiplomaticMessageStatus.PENDING) return false;
  return store.localControlledFactions.includes(msg.toFaction);
}
</script>

<template>
  <div
    v-if="store.sonnerItems.length > 0 && !store.isLoading"
    aria-live="polite"
    class="pointer-events-none fixed inset-x-0 top-[max(4rem,calc(env(safe-area-inset-top)+3.4rem))] sm:top-[3.6rem] z-[60] flex flex-col gap-1.5 px-2.5 sm:px-6"
  >
    <div
      v-for="item in store.sonnerItems"
      :key="item.id"
      class="pointer-events-auto flex w-full flex-nowrap items-center justify-between gap-2 sm:gap-3 rounded-xl border bg-card/95 px-2.5 py-2 sm:px-4 sm:py-2.5 text-xs shadow-xl backdrop-blur-md transition-all"
      :class="toneClasses(item.category).border"
    >
      <!-- Left: Icon, Faction Swatch, Title & Text / Summary Lines -->
      <div class="flex min-w-0 flex-1 items-start gap-2 sm:gap-2.5">
        <component
          :is="iconFor(item.category)"
          class="mt-0.5 size-4 shrink-0"
          :class="toneClasses(item.category).icon"
        />

        <div class="min-w-0 flex-1 space-y-0.5">
          <div
            v-if="item.title"
            class="flex items-center gap-1.5 text-[11px] font-semibold text-foreground"
          >
            <span
              v-if="item.fromFaction !== undefined"
              class="inline-block size-2 shrink-0 rounded-xs border border-white/25"
              :style="{
                backgroundColor:
                  FACTION_PALETTES[item.fromFaction]?.tileHex ?? '#94a3b8',
              }"
            />
            <span class="truncate">{{ item.title }}</span>
          </div>

          <!-- Multi-line turn summary -->
          <ul
            v-if="item.details && item.details.length > 1"
            class="space-y-0.5 text-xs leading-snug text-foreground/95"
          >
            <li
              v-for="(line, idx) in item.details"
              :key="idx"
              class="break-words"
            >
              · {{ line }}
            </li>
          </ul>

          <!-- Single-line event/message -->
          <p v-else class="text-xs leading-snug text-foreground/95 break-words">
            {{ item.text }}
          </p>
        </div>
      </div>

      <!-- Right: Quick Action (icon-only on mobile, icon+label on sm+) & Dismiss -->
      <div class="flex items-center gap-1 sm:gap-1.5 shrink-0">
        <Button
          v-if="canRespondToItem(item)"
          variant="default"
          size="sm"
          class="size-8 p-0 sm:h-7 sm:w-auto sm:gap-1 sm:px-2.5 text-[11px]"
          aria-label="Принять"
          title="Принять"
          @click="store.handleSonnerQuickAction(item.id, 'accept')"
        >
          <Check class="size-4 sm:size-3.5" />
          <span class="hidden sm:inline">Принять</span>
        </Button>

        <Button
          v-else-if="item.actionKind === 'OPEN_CHAT' && store.isOnlineMode"
          variant="secondary"
          size="sm"
          class="size-8 p-0 sm:h-7 sm:w-auto sm:gap-1 sm:px-2.5 text-[11px]"
          aria-label="Чат"
          title="Чат"
          @click="store.handleSonnerQuickAction(item.id, 'chat')"
        >
          <MessageSquare class="size-4 sm:size-3 text-sky-400" />
          <span class="hidden sm:inline">Чат</span>
        </Button>

        <Button
          v-else-if="
            item.actionKind === 'OPEN_DIPLOMACY' &&
            store.gameState.config.diplomacyEnabled
          "
          variant="secondary"
          size="sm"
          class="size-8 p-0 sm:h-7 sm:w-auto sm:gap-1 sm:px-2.5 text-[11px]"
          aria-label="Дипломатия"
          title="Дипломатия"
          @click="store.handleSonnerQuickAction(item.id, 'diplomacy')"
        >
          <Handshake class="size-4 sm:size-3 text-primary" />
          <span class="hidden sm:inline">Дипломатия</span>
        </Button>

        <button
          type="button"
          class="inline-flex size-8 sm:size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          aria-label="Скрыть"
          title="Скрыть"
          @click="store.dismissSonner(item.id)"
        >
          <X class="size-4 sm:size-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
