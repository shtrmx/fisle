<script setup lang="ts">
import type {HTMLAttributes} from 'vue';
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui';
import {Check, ChevronDown} from 'lucide-vue-next';
import {cn} from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

const props = defineProps<{
  modelValue: string;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  class?: HTMLAttributes['class'];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();
</script>

<template>
  <SelectRoot
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="(val) => emit('update:modelValue', String(val))"
  >
    <SelectTrigger
      data-slot="select-trigger"
      :class="
        cn(
          'border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm shadow-xs transition-colors outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer',
          props.class,
        )
      "
    >
      <SelectValue :placeholder="placeholder ?? 'Выберите...'" />
      <ChevronDown class="size-4 shrink-0 text-muted-foreground" />
    </SelectTrigger>

    <SelectPortal>
      <SelectContent
        data-slot="select-content"
        position="popper"
        :side-offset="4"
        class="z-[70] max-h-64 min-w-[var(--reka-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
      >
        <SelectViewport class="p-1">
          <SelectItem
            v-for="opt in options"
            :key="opt.value"
            :value="opt.value"
            :disabled="opt.disabled"
            class="relative flex w-full cursor-pointer select-none items-center justify-between gap-2 rounded-md py-1.5 pr-8 pl-2.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
          >
            <div class="flex flex-col">
              <SelectItemText>{{ opt.label }}</SelectItemText>
              <span v-if="opt.hint" class="text-[11px] text-muted-foreground">
                {{ opt.hint }}
              </span>
            </div>
            <SelectItemIndicator
              class="absolute right-2 flex size-4 items-center justify-center text-primary"
            >
              <Check class="size-3.5" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
