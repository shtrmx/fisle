<script setup lang="ts">
import {ref} from 'vue';
import {Download, Share} from 'lucide-vue-next';
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

const {isInstallable, isInstalled, isIos, install} = usePwaInstall();
const showIosGuide = ref(false);
</script>

<template>
  <template v-if="!isInstalled">
    <Button
      v-if="isInstallable"
      variant="secondary"
      :size="props.size"
      :class="['w-full justify-center gap-2', props.buttonClass]"
      @click="install"
    >
      <Download class="size-4 shrink-0 text-primary" />
      <span>Установить</span>
    </Button>

    <template v-else-if="isIos">
      <Button
        variant="secondary"
        :size="props.size"
        :class="['w-full justify-center gap-2', props.buttonClass]"
        @click="showIosGuide = true"
      >
        <Download class="size-4 shrink-0 text-primary" />
        <span>Установить</span>
      </Button>

      <ModalDialog
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
  </template>
</template>
