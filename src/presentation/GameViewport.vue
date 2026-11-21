<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {Check, RotateCcw, Sparkles, Sun, X} from 'lucide-vue-next';
import {animate, type JSAnimation} from 'animejs';
import type {HexKey} from '@/domain/hex/hexCoordinates';
import type {FactionId} from '@/domain/game/types';
import {FACTION_PALETTES} from '@/domain/game/rules';
import {useGameStore} from '@/application/stores/useGameStore';
import {Button} from '@/components/ui/button';
import {
  AntiyoyThreeScene,
  type FloatingPopupEvent,
} from '@/infrastructure/three/antiyoyScene';

const store = useGameStore();
const canvasContainer = ref<HTMLDivElement | null>(null);
const turnEdgeGlowEl = ref<HTMLDivElement | null>(null);
const turnEdgeGlowColor = ref<string | null>(null);
const contextLost = ref(false);
const popups = ref<FloatingPopupEvent[]>([]);
let turnEdgeGlowAnim: JSAnimation | null = null;
let lastHandledTurnFocusKey = '';

interface MarkerTooltipEntry {
  kind: 'regenerator' | 'flare';
  label: string;
  faction: FactionId;
  ownerName: string;
  turnsRemaining: number;
}

function formatTurnsLabel(turns: number): string {
  const abs = Math.abs(turns) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 19) return `${turns} ходов`;
  if (last === 1) return `${turns} ход`;
  if (last >= 2 && last <= 4) return `${turns} хода`;
  return `${turns} ходов`;
}

const hoveredMarkerTooltip = computed<{
  x: number;
  y: number;
  entries: MarkerTooltipEntry[];
} | null>(() => {
  if (store.showMainMenu || !sceneInstance) return null;
  const key = store.hoveredHexKey;
  if (!key) return null;
  void store.boardVersion;
  void store.cameraZoom;

  if (store.visibleHexSet && !store.visibleHexSet.has(key)) {
    return null;
  }

  const entries: MarkerTooltipEntry[] = [];
  for (const reg of store.gameState.regenerators ?? []) {
    if (reg.centerKey !== key || reg.turnsRemaining <= 0) continue;
    const ownerName =
      store.gameState.factions[reg.faction]?.name ??
      FACTION_PALETTES[reg.faction]?.name ??
      'Держава';
    entries.push({
      kind: 'regenerator',
      label: 'Регенератор',
      faction: reg.faction,
      ownerName,
      turnsRemaining: reg.turnsRemaining,
    });
  }

  for (const flare of store.gameState.flares) {
    if (flare.centerKey !== key || flare.turnsRemaining <= 0) continue;
    const ownerName =
      store.gameState.factions[flare.faction]?.name ??
      FACTION_PALETTES[flare.faction]?.name ??
      'Держава';
    entries.push({
      kind: 'flare',
      label: 'Освещение',
      faction: flare.faction,
      ownerName,
      turnsRemaining: flare.turnsRemaining,
    });
  }

  if (entries.length === 0) return null;
  const pos = sceneInstance.projectHexToScreen(key, 2.0);
  if (!pos) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const x = Math.max(96, Math.min(vw - 96, pos.x));
  const y = Math.max(76, pos.y - 12);
  return {x, y, entries};
});

let sceneInstance: AntiyoyThreeScene | null = null;

function pushHighlights(): void {
  if (!sceneInstance) return;
  sceneInstance.updateInteractionHighlights(store.gameState, {
    selectedProvinceId: store.selectedProvinceId,
    selectedUnitKey: store.selectedUnitKey,
    reachableKeys: store.reachableHexMap.keys(),
    catapultTargetKeys: store.catapultTargetSet,
    buildableKeys: store.buildableHexSet,
    tradingPostPreviewKeys: store.hoveredTradingPostPreviewSet,
    demolishKeys: store.demolishHexSet,
    landPickEligibleKeys: store.landPickEligibleSet,
    landPickSelectedKeys: store.landPickSelectedSet,
    visibleHexes: store.visibleHexSet,
  });
}

function handleFloatingPopup(popup: FloatingPopupEvent): void {
  popups.value = [...popups.value.slice(-10), popup];
  window.setTimeout(() => {
    const el = document.getElementById(`coin-popup-${popup.id}`);
    if (el) {
      animate(el, {
        translateY: [0, -34],
        opacity: [1, 0],
        duration: 850,
        ease: 'outCubic',
      });
    }
  }, 16);
  window.setTimeout(() => {
    popups.value = popups.value.filter((p) => p.id !== popup.id);
  }, 920);
}

function focusOnHex(key: HexKey, minZoom?: number): void {
  sceneInstance?.focusOnHex(key, minZoom);
}

function applyZoomFromUi(zoom: number): void {
  sceneInstance?.setCameraZoom(zoom);
}

function panCamera(dxPx: number, dyPx: number): void {
  sceneInstance?.panCameraByPixels(dxPx, dyPx);
}

function orbitCamera(deltaRadians: number): void {
  sceneInstance?.orbitCameraByRadians(deltaRadians);
}

function zoomCamera(factor: number, immediate = false): void {
  sceneInstance?.zoomCameraByFactor(factor, immediate);
}

function resetCameraView(): void {
  sceneInstance?.resetCameraView();
}

defineExpose({
  focusOnHex,
  applyZoomFromUi,
  panCamera,
  orbitCamera,
  zoomCamera,
  resetCameraView,
});

onMounted(() => {
  if (!canvasContainer.value) return;

  sceneInstance = new AntiyoyThreeScene(canvasContainer.value, {
    onHexClick: (key) => store.handleHexClick(key),
    onBackgroundClick: () => {
      if (!store.landPicker) {
        store.clearSelection();
      }
    },
    onHexHover: (key) => store.setHoveredHex(key),
    onCameraTelemetry: (zoom, tiltFactor) =>
      store.syncCameraTelemetry(zoom, tiltFactor),
    onFloatingPopup: handleFloatingPopup,
    onContextLost: () => {
      contextLost.value = true;
    },
    onBoardReady: () => {
      store.setSceneReady();
    },
  });

  sceneInstance.rebuildBoard(
    store.gameState,
    store.visibleHexSet,
    store.viewerFactionId,
  );
  pushHighlights();
});

watch(
  () => store.mapResetVersion,
  () => {
    if (!sceneInstance) return;
    sceneInstance.rebuildBoard(
      store.gameState,
      store.visibleHexSet,
      store.viewerFactionId,
    );
    pushHighlights();
  },
);

watch(
  () => [store.boardVersion, store.viewerFactionId, store.isViewerEliminated],
  () => {
    if (!sceneInstance) return;
    sceneInstance.syncState(
      store.gameState,
      store.latestEvents,
      store.visibleHexSet,
      store.viewerFactionId,
    );
    pushHighlights();
  },
);

watch(
  () => [
    store.selectedProvinceId,
    store.selectedUnitKey,
    store.activeTool,
    store.hoveredHexKey,
    store.landPicker,
  ],
  () => {
    pushHighlights();
  },
);

watch(
  () => store.cameraMode,
  (mode) => {
    sceneInstance?.setCameraMode(mode);
  },
);

watch(
  () => store.areaPulseSignal,
  (sig) => {
    if (!sig || !sceneInstance) return;
    sceneInstance.showAreaPulse(sig.centerKey, sig.radius, sig.kind);
  },
);

function triggerTurnEdgeGlow(factionId: FactionId): void {
  const palette = FACTION_PALETTES[factionId];
  if (!palette) return;

  if (turnEdgeGlowAnim) {
    turnEdgeGlowAnim.pause();
    turnEdgeGlowAnim = null;
  }

  turnEdgeGlowColor.value = palette.bannerHex;
  void nextTick(() => {
    const el = turnEdgeGlowEl.value;
    if (!el) return;
    el.style.opacity = '0';
    turnEdgeGlowAnim = animate(el, {
      opacity: [0, 0.34, 0],
      duration: 950,
      ease: 'inOutSine',
      onComplete: () => {
        turnEdgeGlowAnim = null;
        turnEdgeGlowColor.value = null;
      },
    });
  });
}

watch(
  () => [
    store.isHumanTurn,
    store.activeFactionId,
    store.gameState.turn,
    store.mapResetVersion,
    store.showMainMenu,
    store.isLoading,
  ],
  () => {
    if (store.showMainMenu || store.isLoading) {
      lastHandledTurnFocusKey = '';
      return;
    }
    if (!store.isHumanTurn || store.gameState.winner !== null) {
      return;
    }

    const factionId = store.activeFactionId;
    const turnKey = `${store.mapResetVersion}:${store.gameState.turn}:${factionId}`;
    if (turnKey === lastHandledTurnFocusKey) return;
    lastHandledTurnFocusKey = turnKey;

    void nextTick(() => {
      if (
        !sceneInstance ||
        store.showMainMenu ||
        store.isLoading ||
        !store.isHumanTurn
      ) {
        return;
      }
      sceneInstance.focusFactionIfOffscreen(store.gameState, factionId);
      sceneInstance.pulseFactionBorders(store.gameState, factionId);
      triggerTurnEdgeGlow(factionId);
    });
  },
  {immediate: true},
);

onBeforeUnmount(() => {
  if (turnEdgeGlowAnim) {
    turnEdgeGlowAnim.pause();
    turnEdgeGlowAnim = null;
  }
  sceneInstance?.dispose();
  sceneInstance = null;
});
</script>

<template>
  <div class="relative h-full w-full overflow-hidden select-none">
    <!-- Isolated WebGL mount node -->
    <div
      ref="canvasContainer"
      class="h-full w-full cursor-grab active:cursor-grabbing"
    />

    <!-- Subtle Active Player Turn Viewport Edge Glow -->
    <div
      v-if="turnEdgeGlowColor"
      ref="turnEdgeGlowEl"
      class="pointer-events-none fixed inset-0 z-20 opacity-0"
      :style="{
        boxShadow: `inset 0 0 32px 4px ${turnEdgeGlowColor}45, inset 0 0 0 1.5px ${turnEdgeGlowColor}55`,
      }"
      aria-hidden="true"
    />

    <!-- Interactive Manual Land Exchange Picker Bar -->
    <div
      v-if="store.landPicker"
      class="pointer-events-auto fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2 sm:gap-3 rounded-xl border border-primary/60 bg-card/95 px-3.5 py-2.5 shadow-2xl w-[min(94vw,520px)]"
    >
      <div class="flex items-center gap-2 text-xs min-w-0">
        <span
          class="inline-block size-3 shrink-0 rounded-xs border border-white/25"
          :style="{
            backgroundColor:
              FACTION_PALETTES[store.landPicker.ownerFaction].tileHex,
          }"
        />
        <span class="font-semibold text-foreground truncate">
          {{ FACTION_PALETTES[store.landPicker.ownerFaction].name }}
        </span>
        <span class="text-muted-foreground">·</span>
        <span class="font-mono font-bold tabular-nums text-emerald-400">
          Выбрано: {{ store.landPicker.selectedKeys.length }}
        </span>
      </div>

      <div class="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          class="h-8 px-2 text-xs"
          :disabled="store.landPicker.selectedKeys.length === 0"
          @click="store.clearLandPickerSelection()"
        >
          <RotateCcw class="size-3.5" />
          <span class="hidden sm:inline">Сбросить</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          class="h-8 px-2.5 text-xs"
          @click="store.cancelLandPicker()"
        >
          <X class="size-3.5" />
          <span>Отмена</span>
        </Button>

        <Button
          variant="default"
          size="sm"
          class="h-8 px-3 text-xs"
          @click="store.finishLandPicker()"
        >
          <Check class="size-3.5" />
          <span>Готово ({{ store.landPicker.selectedKeys.length }})</span>
        </Button>
      </div>
    </div>

    <!-- Floating hover tooltip for active Regenerators & Illumination Flares -->
    <div
      v-if="hoveredMarkerTooltip"
      class="pointer-events-none fixed z-30 -translate-x-1/2 -translate-y-full"
      :style="{
        left: `${hoveredMarkerTooltip.x}px`,
        top: `${hoveredMarkerTooltip.y}px`,
      }"
    >
      <div
        class="flex flex-col gap-1.5 rounded-xl border border-border bg-card/95 px-3 py-2 text-xs shadow-xl backdrop-blur-md"
      >
        <div
          v-for="(entry, idx) in hoveredMarkerTooltip.entries"
          :key="`${entry.kind}-${idx}`"
          class="flex items-center gap-2.5 whitespace-nowrap"
        >
          <Sparkles
            v-if="entry.kind === 'regenerator'"
            class="size-3.5 shrink-0 text-emerald-400"
          />
          <Sun v-else class="size-3.5 shrink-0 text-violet-400" />

          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-1.5">
              <span class="font-semibold text-foreground">{{ entry.label }}</span>
              <span class="text-muted-foreground">·</span>
              <span
                class="font-mono text-[11px] font-semibold tabular-nums"
                :class="
                  entry.kind === 'regenerator'
                    ? 'text-emerald-400'
                    : 'text-violet-300'
                "
              >
                {{ formatTurnsLabel(entry.turnsRemaining) }}
              </span>
            </div>
            <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                class="inline-block size-2 shrink-0 rounded-xs border border-white/25"
                :style="{
                  backgroundColor:
                    FACTION_PALETTES[entry.faction]?.tileHex ?? '#94a3b8',
                }"
              />
              <span>{{ entry.ownerName }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Floating economy / combat popups projected from 3D hexes -->
    <div class="pointer-events-none fixed inset-0 z-10 overflow-hidden">
      <div
        v-for="popup in popups"
        :id="`coin-popup-${popup.id}`"
        :key="popup.id"
        class="absolute -translate-x-1/2 font-mono text-sm font-bold tabular-nums drop-shadow-md whitespace-nowrap"
        :class="
          popup.tone === 'positive'
            ? 'text-emerald-300'
            : popup.tone === 'negative'
              ? 'text-rose-300'
              : 'text-amber-200'
        "
        :style="{left: `${popup.screenX}px`, top: `${popup.screenY}px`}"
      >
        {{ popup.text }}
      </div>
    </div>

    <!-- Graceful fallback if WebGL context is lost -->
    <div
      v-if="contextLost"
      class="fixed inset-0 z-40 flex items-center justify-center bg-background/95 p-6 text-center"
    >
      <div class="max-w-sm space-y-3 rounded-xl border border-border bg-card p-6">
        <h2 class="font-display text-lg font-bold text-foreground">
          Контекст WebGL приостановлен
        </h2>
        <p class="text-sm text-muted-foreground">
          Графический контекст браузера был сброшен. Обновите страницу, чтобы
          продолжить партию.
        </p>
      </div>
    </div>
  </div>
</template>
