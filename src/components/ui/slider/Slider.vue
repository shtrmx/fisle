<script setup lang="ts">
import type {HTMLAttributes} from 'vue';
import {
  SliderRange,
  SliderRoot,
  SliderThumb,
  SliderTrack,
} from 'reka-ui';
import {cn} from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    modelValue: number[];
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    class?: HTMLAttributes['class'];
  }>(),
  {
    min: 0,
    max: 100,
    step: 1,
    disabled: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: number[]];
}>();
</script>

<template>
  <SliderRoot
    data-slot="slider"
    :model-value="modelValue"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    :class="
      cn(
        'relative flex w-full touch-none items-center select-none cursor-pointer',
        props.class,
      )
    "
    @update:model-value="(val) => val && emit('update:modelValue', val)"
  >
    <SliderTrack
      data-slot="slider-track"
      class="bg-muted relative h-1.5 w-full grow overflow-hidden rounded-full"
    >
      <SliderRange
        data-slot="slider-range"
        class="bg-primary absolute h-full"
      />
    </SliderTrack>
    <SliderThumb
      data-slot="slider-thumb"
      class="border-primary bg-background block size-4 rounded-full border-2 shadow-sm transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    />
  </SliderRoot>
</template>
