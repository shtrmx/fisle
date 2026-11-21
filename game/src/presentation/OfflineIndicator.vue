<script setup lang="ts">
import {WifiOff} from 'lucide-vue-next';
import {usePwaInstall} from '@/application/composables/usePwaInstall';

const {isOnline} = usePwaInstall();
</script>

<template>
  <div
    v-if="!isOnline"
    role="status"
    class="fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-amber-500/40 bg-card/95 px-3 py-1.5 text-xs font-medium text-amber-300 shadow-lg backdrop-blur-sm"
  >
    <WifiOff class="size-3.5 shrink-0" />
    <span>Офлайн</span>
  </div>
</template>
