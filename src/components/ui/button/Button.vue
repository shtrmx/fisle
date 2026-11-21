<script setup lang="ts">
import type {Component, HTMLAttributes} from 'vue';
import {Primitive} from 'reka-ui';
import {cn} from '@/lib/utils';
import {buttonVariants, type ButtonVariants} from '.';

interface Props {
  as?: string | Component;
  asChild?: boolean;
  variant?: ButtonVariants['variant'];
  size?: ButtonVariants['size'];
  class?: HTMLAttributes['class'];
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button',
  asChild: false,
});
</script>

<template>
  <Primitive
    data-slot="button"
    :as="as"
    :as-child="asChild"
    :class="cn(buttonVariants({variant, size}), props.class)"
  >
    <slot />
  </Primitive>
</template>
