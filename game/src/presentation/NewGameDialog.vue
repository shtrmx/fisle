<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {useGameStore} from '@/application/stores/useGameStore';
import ModalDialog from '@/components/ui/dialog/ModalDialog.vue';
import GameSetupForm, {
  type SetupHeaderState,
} from '@/presentation/GameSetupForm.vue';

const store = useGameStore();
const resetKey = ref(0);
const setupHeader = ref<SetupHeaderState>({
  title: 'Новая партия',
  stepText: null,
  canGoBackInside: false,
});

const dialogTitle = computed(() =>
  setupHeader.value.stepText
    ? `${setupHeader.value.title} · ${setupHeader.value.stepText}`
    : setupHeader.value.title,
);

watch(
  () => store.showNewGameDialog,
  (isOpen) => {
    if (isOpen) {
      resetKey.value += 1;
    }
  },
);
</script>

<template>
  <ModalDialog
    :open="store.showNewGameDialog"
    :title="dialogTitle"
    content-class="w-[min(94vw,480px)] max-h-[88dvh] overflow-y-auto overflow-x-hidden"
    @update:open="(val) => (store.showNewGameDialog = val)"
  >
    <GameSetupForm
      :initial-tab="store.newGameDialogInitialTab"
      :show-tabs="true"
      :reset-key="resetKey"
      @header-change="(h) => (setupHeader = h)"
      @cancel="store.showNewGameDialog = false"
    />
  </ModalDialog>
</template>
