<script setup lang="ts">
import {Hexagon} from 'lucide-vue-next';
import {useGameStore} from '@/application/stores/useGameStore';

const store = useGameStore();
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-150 ease-out"
    leave-active-class="transition-opacity duration-300 ease-out"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="store.isLoading"
      class="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-background text-foreground select-none"
      role="status"
      aria-live="polite"
    >
      <div class="relative flex size-16 items-center justify-center">
        <div
          class="absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary animate-spin"
        />
        <Hexagon class="size-7 text-primary stroke-[1.75]" />
      </div>

      <div class="flex flex-col items-center gap-1 text-center">
        <span class="font-display text-sm font-semibold tracking-wide text-foreground">
          {{ store.loadingLabel }}
        </span>
      </div>
    </div>
  </Transition>
</template>
