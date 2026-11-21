<script setup lang="ts">
import {computed} from 'vue';

const props = withDefaults(
  defineProps<{
    values: readonly number[];
    color?: string;
    height?: number;
  }>(),
  {
    color: '#eab308',
    height: 64,
  },
);

const W = 240;

const chartData = computed(() => {
  const h = props.height;
  const padX = 6;
  const padY = 8;
  const pts = props.values.length > 0 ? props.values : [0];
  const minVal = Math.min(0, ...pts);
  const maxVal = Math.max(4, ...pts);
  const range = Math.max(1, maxVal - minVal);

  const toY = (v: number): number =>
    padY + (1 - (v - minVal) / range) * (h - padY * 2);

  const coords =
    pts.length === 1
      ? [
          {x: padX, y: toY(pts[0])},
          {x: W - padX, y: toY(pts[0])},
        ]
      : pts.map((v, idx) => ({
          x: padX + (idx / (pts.length - 1)) * (W - padX * 2),
          y: toY(v),
        }));

  const linePath = coords
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const zeroY = toY(0);
  const last = coords[coords.length - 1];
  const first = coords[0];
  const areaPath = `${linePath} L ${last.x.toFixed(1)} ${zeroY.toFixed(1)} L ${first.x.toFixed(1)} ${zeroY.toFixed(1)} Z`;

  return {
    linePath,
    areaPath,
    zeroY,
    lastPoint: last,
    minVal,
    maxVal,
  };
});
</script>

<template>
  <svg
    :viewBox="`0 0 ${W} ${height}`"
    class="w-full overflow-visible"
    :style="{height: `${height}px`}"
    role="img"
    aria-label="График дохода за ход"
  >
    <!-- Zero baseline -->
    <line
      x1="4"
      :x2="W - 4"
      :y1="chartData.zeroY"
      :y2="chartData.zeroY"
      stroke="currentColor"
      class="text-border"
      stroke-dasharray="3 3"
      stroke-width="1"
    />

    <!-- Soft area fill -->
    <path :d="chartData.areaPath" :fill="color" fill-opacity="0.16" />

    <!-- Main trend line -->
    <path
      :d="chartData.linePath"
      fill="none"
      :stroke="color"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <!-- Latest turn dot -->
    <circle
      :cx="chartData.lastPoint.x"
      :cy="chartData.lastPoint.y"
      r="3"
      :fill="color"
    />
  </svg>
</template>
