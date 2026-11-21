<script setup lang="ts">
import type {HTMLAttributes} from 'vue';
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import {X} from 'lucide-vue-next';
import {cn} from '@/lib/utils';

const props = defineProps<{
  open: boolean;
  title: string;
  description?: string;
  contentClass?: HTMLAttributes['class'];
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();
</script>

<template>
  <DialogRoot
    data-slot="dialog"
    :open="open"
    @update:open="(val) => emit('update:open', val)"
  >
    <DialogPortal>
      <DialogOverlay
        data-slot="dialog-overlay"
        class="fixed inset-0 z-50 bg-black/70"
      />
      <DialogContent
        data-slot="dialog-content"
        :class="
          cn(
            'fixed top-1/2 left-1/2 z-50 w-[min(94vw,540px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-4 sm:p-6 text-card-foreground shadow-2xl overflow-x-hidden focus:outline-none',
            props.contentClass,
          )
        "
      >
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-1">
            <DialogTitle
              data-slot="dialog-title"
              class="font-display text-lg font-bold tracking-tight text-foreground"
            >
              {{ title }}
            </DialogTitle>
            <DialogDescription
              v-if="description"
              data-slot="dialog-description"
              class="text-sm text-muted-foreground"
            >
              {{ description }}
            </DialogDescription>
          </div>
          <DialogClose
            data-slot="dialog-close"
            class="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            aria-label="Закрыть"
          >
            <X class="size-4" />
          </DialogClose>
        </div>
        <div class="mt-5">
          <slot />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
