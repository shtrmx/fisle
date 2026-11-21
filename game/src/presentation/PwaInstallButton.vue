<script setup lang="ts">
import {computed, ref} from 'vue';
import {Download, RefreshCw, Share} from 'lucide-vue-next';
import {usePwaInstall} from '@/application/composables/usePwaInstall';
import {Button} from '@/components/ui/button';
import ModalDialog from '@/components/ui/dialog/ModalDialog.vue';

const props = withDefaults(
  defineProps<{
    size?: 'sm' | 'default' | 'lg';
    buttonClass?: string;
  }>(),
  {
    size: 'default',
    buttonClass: '',
  },
);

const {
  isInstallable,
  isInstalled,
  isIos,
  updateStatus,
  install,
  checkForUpdates,
} = usePwaInstall();
const showIosGuide = ref(false);

const canShowInstall = computed(
  () => !isInstalled.value && (isInstallable.value || isIos.value),
);

const updateLabel = computed(() => {
  switch (updateStatus.value) {
    case 'checking':
      return 'Проверка...';
    case 'up-to-date':
      return 'Обновлений нет';
    case 'available':
      return 'Обновить';
    case 'error':
      return 'Нет сети';
    default:
      return 'Проверить обновления';
  }
});

function handleInstallClick(): void {
  if (isInstallable.value) {
    void install();
  } else if (isIos.value) {
    showIosGuide.value = true;
  }
}
</script>

<template>
  <div class="flex w-full items-center gap-2">
    <Button
      variant="secondary"
      :size="props.size"
      :disabled="updateStatus === 'checking'"
      :class="['flex-1 justify-center gap-2', props.buttonClass]"
      @click="checkForUpdates"
    >
      <RefreshCw
        :class="[
          'size-4 shrink-0 text-primary',
          updateStatus === 'checking' ? 'animate-spin' : '',
        ]"
      />
      <span>{{ updateLabel }}</span>
    </Button>

    <Button
      v-if="canShowInstall"
      variant="secondary"
      size="icon"
      :class="['shrink-0', props.size === 'lg' ? 'size-10' : '']"
      aria-label="Установить"
      title="Установить"
      @click="handleInstallClick"
    >
      <Download class="size-4 text-primary" />
    </Button>
  </div>

  <ModalDialog
    v-if="isIos"
    :open="showIosGuide"
    title="Установка на iOS"
    content-class="w-[min(92vw,360px)]"
    @update:open="(val) => (showIosGuide = val)"
  >
    <ol class="space-y-2.5 text-sm text-foreground">
      <li class="flex items-start gap-2.5">
        <span
          class="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 font-mono text-xs font-bold text-primary"
        >
          1
        </span>
        <span class="leading-snug">
          Нажмите
          <Share class="mx-0.5 inline size-4 align-text-bottom text-primary" />
          <strong>Поделиться</strong> в Safari.
        </span>
      </li>
      <li class="flex items-start gap-2.5">
        <span
          class="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 font-mono text-xs font-bold text-primary"
        >
          2
        </span>
        <span class="leading-snug">
          Выберите <strong>На экран «Домой»</strong>.
        </span>
      </li>
    </ol>

    <div class="mt-4 flex justify-end">
      <Button variant="default" size="sm" @click="showIosGuide = false">
        Готово
      </Button>
    </div>
  </ModalDialog>
</template>
