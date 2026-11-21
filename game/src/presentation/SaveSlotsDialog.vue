<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {
  Clock,
  FolderOpen,
  Globe,
  Save,
  Trash2,
} from 'lucide-vue-next';
import {FACTION_PALETTES} from '@/domain/game/rules';
import {MAX_SAVE_SLOTS} from '@/infrastructure/storage/saveGameStorage';
import {useGameStore} from '@/application/stores/useGameStore';
import ModalDialog from '@/components/ui/dialog/ModalDialog.vue';
import {Button} from '@/components/ui/button';

const store = useGameStore();
const customLabel = ref('');

watch(
  () => store.showSaveLoadDialog,
  (open) => {
    if (open) {
      store.refreshSaveSlots();
      customLabel.value = '';
    }
  },
);

const canSaveCurrentGame = computed(() => !store.showMainMenu);

const canManageAutoSave = computed(
  () =>
    canSaveCurrentGame.value &&
    (!store.isOnlineMode || store.isLocalHost),
);

const usedCount = computed(
  () => store.saveSlots.filter((slot) => slot !== null).length,
);

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

function handleSave(slot: number): void {
  const saved = store.saveCurrentGameToSlot(slot, customLabel.value);
  if (saved) {
    customLabel.value = '';
  }
}

function handleLoad(slot: number): void {
  store.loadSavedGameFromSlot(slot);
}

function handleDelete(slot: number): void {
  store.removeSaveSlot(slot);
}
</script>

<template>
  <ModalDialog
    :open="store.showSaveLoadDialog"
    :title="`Сохранения (${usedCount}/${MAX_SAVE_SLOTS})`"
    content-class="w-[min(94vw,480px)] max-h-[86vh] overflow-y-auto"
    @update:open="(val) => (store.showSaveLoadDialog = val)"
  >
    <div class="space-y-3">
      <!-- Auto-save active notice (Host / Solo) -->
      <div
        v-if="canManageAutoSave && store.autoSaveSlot !== null"
        class="flex items-center justify-between gap-2 rounded-lg border border-primary/35 bg-primary/8 px-3 py-2 text-xs"
      >
        <span class="text-foreground">
          Автосохранение каждые 5 мин ·
          <strong class="font-mono text-primary tabular-nums">
            Слот {{ store.autoSaveSlot }}
          </strong>
        </span>
        <button
          type="button"
          class="text-[11px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
          @click="store.setAutoSaveSlot(null)"
        >
          Отключить
        </button>
      </div>

      <!-- Optional Save Label when in-game -->
      <div v-if="canSaveCurrentGame" class="space-y-1">
        <input
          v-model="customLabel"
          type="text"
          maxlength="32"
          placeholder="Название сохранения (необязательно)"
          class="flex h-9 w-full min-w-0 rounded-md border border-border bg-secondary/45 px-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <!-- 10 Numbered Save Slots -->
      <div class="space-y-1.5">
        <div
          v-for="(slotData, idx) in store.saveSlots"
          :key="idx + 1"
          class="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors"
          :class="
            canManageAutoSave && store.autoSaveSlot === idx + 1
              ? 'border-primary/50 bg-primary/8'
              : slotData
                ? 'border-border bg-secondary/40'
                : 'border-dashed border-border/70 bg-secondary/15'
          "
        >
          <div class="flex items-center gap-2 min-w-0 flex-1">
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background/75 font-mono text-[11px] font-bold tabular-nums text-muted-foreground"
            >
              {{ idx + 1 }}
            </span>

            <template v-if="slotData">
              <span
                class="inline-block size-3 shrink-0 rounded-xs border border-white/25"
                :style="{
                  backgroundColor:
                    FACTION_PALETTES[slotData.viewerFactionId]?.tileHex ??
                    '#94a3b8',
                }"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="font-semibold text-foreground truncate">
                    {{ slotData.label }}
                  </span>
                  <Globe
                    v-if="slotData.wasOnline"
                    class="size-3 shrink-0 text-primary"
                    title="Сохранено из онлайн-партии"
                  />
                  <span
                    v-if="canManageAutoSave && store.autoSaveSlot === idx + 1"
                    class="shrink-0 font-mono text-[10px] font-semibold text-primary"
                  >
                    Авто · 5м
                  </span>
                </div>
                <div
                  class="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground tabular-nums"
                >
                  <span>Ход {{ slotData.turn }}</span>
                  <span class="inline-flex items-center gap-0.5">
                    <Clock class="size-2.5" />
                    {{ formatClock(slotData.elapsedSeconds) }}
                  </span>
                  <span>{{ formatDate(slotData.savedAt) }}</span>
                </div>
              </div>
            </template>

            <div v-else class="flex items-center gap-2 min-w-0">
              <span class="text-muted-foreground/75">Пустой слот</span>
              <span
                v-if="canManageAutoSave && store.autoSaveSlot === idx + 1"
                class="shrink-0 font-mono text-[10px] font-semibold text-primary"
              >
                Авто · 5м
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-1 shrink-0">
            <Button
              v-if="canSaveCurrentGame"
              variant="secondary"
              size="sm"
              class="h-7 px-2 text-[11px] gap-1"
              :title="slotData ? 'Перезаписать' : 'Сохранить'"
              @click="handleSave(idx + 1)"
            >
              <Save class="size-3" />
              <span class="hidden sm:inline">Сохр.</span>
            </Button>

            <Button
              v-if="slotData"
              variant="default"
              size="sm"
              class="h-7 px-2 text-[11px] gap-1"
              title="Загрузить"
              @click="handleLoad(idx + 1)"
            >
              <FolderOpen class="size-3" />
              <span class="hidden sm:inline">Загр.</span>
            </Button>

            <Button
              v-if="slotData"
              variant="ghost"
              size="icon"
              class="size-7 text-muted-foreground hover:text-rose-400"
              aria-label="Удалить сохранение"
              @click="handleDelete(idx + 1)"
            >
              <Trash2 class="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  </ModalDialog>
</template>
