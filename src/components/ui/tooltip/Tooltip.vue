<script setup lang="ts">
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from 'reka-ui';

withDefaults(
  defineProps<{
    side?: 'top' | 'bottom' | 'left' | 'right';
    sideOffset?: number;
  }>(),
  {
    side: 'top',
    sideOffset: 8,
  },
);
</script>

<template>
  <TooltipProvider :delay-duration="180">
    <TooltipRoot data-slot="tooltip">
      <TooltipTrigger as-child>
        <slot name="trigger" />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          data-slot="tooltip-content"
          :side="side"
          :side-offset="sideOffset"
          :avoid-collisions="true"
          :collision-padding="14"
          class="pointer-events-none hidden sm:block z-50 max-w-64 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg"
        >
          <slot />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
