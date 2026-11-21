<script setup lang="ts">
import {
  Castle,
  Coins,
  Compass,
  Keyboard,
  LayoutGrid,
  Play,
  Sparkles,
  Swords,
} from 'lucide-vue-next';
import {
  SHORTCUT_GROUPS,
  type ShortcutGroup,
} from '@/domain/input/shortcuts';
import {useGameStore} from '@/application/stores/useGameStore';
import ModalDialog from '@/components/ui/dialog/ModalDialog.vue';

const store = useGameStore();

function iconForGroup(id: ShortcutGroup['id']) {
  switch (id) {
    case 'units':
      return Swords;
    case 'economy':
      return Coins;
    case 'defense':
      return Castle;
    case 'extra':
      return Sparkles;
    case 'turn':
      return Play;
    case 'camera':
      return Compass;
    case 'interface':
      return LayoutGrid;
  }
}
</script>

<template>
  <ModalDialog
    :open="store.showShortcutsDialog"
    title="Горячие клавиши"
    content-class="w-[min(95vw,760px)] max-h-[86vh] overflow-y-auto"
    @update:open="(val) => (store.showShortcutsDialog = val)"
  >
    <div class="space-y-3">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <section
          v-for="group in SHORTCUT_GROUPS"
          :key="group.id"
          class="rounded-lg border border-border bg-secondary/30 p-3 space-y-2"
        >
          <header
            class="flex items-center gap-1.5 border-b border-border/70 pb-1.5 text-xs font-semibold text-foreground"
          >
            <component
              :is="iconForGroup(group.id)"
              class="size-3.5 text-primary shrink-0"
            />
            <span>{{ group.title }}</span>
          </header>

          <ul class="space-y-1.5">
            <li
              v-for="item in group.items"
              :key="item.id"
              class="flex items-center justify-between gap-2 text-xs"
            >
              <span class="text-muted-foreground truncate">
                {{ item.label }}
              </span>

              <div class="flex items-center gap-1 shrink-0">
                <span class="inline-flex items-center gap-0.5">
                  <kbd
                    v-for="(k, idx) in item.keys"
                    :key="`${item.id}-k-${idx}`"
                    class="inline-flex min-w-5 h-5 items-center justify-center rounded border border-border bg-background px-1.5 font-mono text-[10px] font-semibold text-foreground shadow-xs"
                  >
                    {{ k }}
                  </kbd>
                </span>

                <template v-if="item.altKeys && item.altKeys.length > 0">
                  <span class="text-[10px] text-muted-foreground">/</span>
                  <span class="inline-flex items-center gap-0.5">
                    <kbd
                      v-for="(ak, idx) in item.altKeys"
                      :key="`${item.id}-ak-${idx}`"
                      class="inline-flex min-w-5 h-5 items-center justify-center rounded border border-border bg-background px-1.5 font-mono text-[10px] font-semibold text-foreground shadow-xs"
                    >
                      {{ ak }}
                    </kbd>
                  </span>
                </template>
              </div>
            </li>
          </ul>
        </section>
      </div>

      <div
        class="flex items-center justify-between border-t border-border/70 pt-2 text-[11px] text-muted-foreground"
      >
        <span class="inline-flex items-center gap-1.5">
          <Keyboard class="size-3.5 text-primary" />
          <span>Работают в раскладках EN и RU</span>
        </span>
        <span class="inline-flex items-center gap-1">
          <kbd
            class="inline-flex h-5 items-center rounded border border-border bg-background px-1.5 font-mono text-[10px] font-semibold text-foreground"
          >
            Ctrl
          </kbd>
          <span>+</span>
          <kbd
            class="inline-flex h-5 items-center rounded border border-border bg-background px-1.5 font-mono text-[10px] font-semibold text-foreground"
          >
            /
          </kbd>
        </span>
      </div>
    </div>
  </ModalDialog>
</template>
