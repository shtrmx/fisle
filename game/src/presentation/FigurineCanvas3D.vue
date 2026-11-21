<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {animate} from 'animejs';
import type {FactionId} from '@/domain/game/types';
import {
  figurinePreviewRenderer,
  type PreviewToolId,
} from '@/infrastructure/three/figurinePreviewRenderer';

const props = withDefaults(
  defineProps<{
    tool: PreviewToolId;
    faction: FactionId;
    size?: number;
  }>(),
  {
    size: 56,
  },
);

const canvasRef = ref<HTMLCanvasElement | null>(null);
const slotId = `preview-${Math.random().toString(36).slice(2, 10)}`;

onMounted(() => {
  if (!canvasRef.value) return;
  figurinePreviewRenderer.registerSlot(
    slotId,
    canvasRef.value,
    props.tool,
    props.faction,
  );
});

watch(
  () => [props.tool, props.faction] as const,
  ([nextTool, nextFaction], [prevTool]) => {
    figurinePreviewRenderer.updateSlot(slotId, nextTool, nextFaction);
    if (nextTool !== prevTool && canvasRef.value) {
      animate(canvasRef.value, {
        scale: [0.76, 1],
        duration: 240,
        ease: 'outBack',
      });
    }
  },
);

onBeforeUnmount(() => {
  figurinePreviewRenderer.unregisterSlot(slotId);
});
</script>

<template>
  <canvas
    ref="canvasRef"
    width="160"
    height="160"
    class="pointer-events-none block h-full w-full shrink-0"
  />
</template>
