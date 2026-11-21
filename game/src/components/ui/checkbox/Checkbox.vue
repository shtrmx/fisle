<script setup lang="ts">
import type {HTMLAttributes} from 'vue';
import {Check} from 'lucide-vue-next';
import {cn} from '@/lib/utils';

const props = defineProps<{
  modelValue: boolean;
  id?: string;
  disabled?: boolean;
  class?: HTMLAttributes['class'];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

function toggle(): void {
  if (props.disabled) return;
  emit('update:modelValue', !props.modelValue);
}
</script>

<template>
  <button
    :id="id"
    type="button"
    role="checkbox"
    data-slot="checkbox"
    :aria-checked="modelValue"
    :data-state="modelValue ? 'checked' : 'unchecked'"
    :disabled="disabled"
    :class="
      cn(
        'peer border-border bg-background data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 size-5 shrink-0 rounded-[5px] border shadow-xs transition-colors outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer flex items-center justify-center',
        props.class,
      )
    "
    @click="toggle"
  >
    <Check v-if="modelValue" class="size-3.5 stroke-[2.75]" />
  </button>
</template>
