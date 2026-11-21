<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref} from 'vue';
import {EntityType} from '@/domain/game/types';
import {useGameStore} from '@/application/stores/useGameStore';
import {useCameraKeyboardControls} from '@/application/composables/useCameraKeyboardControls';
import GameViewport from '@/presentation/GameViewport.vue';
import TopHudBar from '@/presentation/TopHudBar.vue';
import TacticalDock from '@/presentation/TacticalDock.vue';
import NewGameDialog from '@/presentation/NewGameDialog.vue';
import PauseMenuDialog from '@/presentation/PauseMenuDialog.vue';
import DiplomacyDialog from '@/presentation/DiplomacyDialog.vue';
import CountriesDialog from '@/presentation/CountriesDialog.vue';
import IncomeBreakdownDialog from '@/presentation/IncomeBreakdownDialog.vue';
import VictoryDialog from '@/presentation/VictoryDialog.vue';
import SonnerBanner from '@/presentation/SonnerBanner.vue';
import LoadingOverlay from '@/presentation/LoadingOverlay.vue';
import WaitingLobbyOverlay from '@/presentation/WaitingLobbyOverlay.vue';
import MainMenuOverlay from '@/presentation/MainMenuOverlay.vue';
import NotificationsDialog from '@/presentation/NotificationsDialog.vue';
import ChatDialog from '@/presentation/ChatDialog.vue';
import MatchOverviewDialog from '@/presentation/MatchOverviewDialog.vue';
import SaveSlotsDialog from '@/presentation/SaveSlotsDialog.vue';
import MatchHistoryDialog from '@/presentation/MatchHistoryDialog.vue';
import ShortcutsHelpDialog from '@/presentation/ShortcutsHelpDialog.vue';
import OfflineIndicator from '@/presentation/OfflineIndicator.vue';

const store = useGameStore();
const viewportRef = ref<InstanceType<typeof GameViewport> | null>(null);

function handleFocusNextUnit(): void {
  const key = store.selectNextReadyUnit();
  if (key) {
    viewportRef.value?.focusOnHex(key);
  }
}

function isAnyModalOpen(): boolean {
  return (
    store.showNewGameDialog ||
    store.showPauseDialog ||
    store.showDiplomacyDialog ||
    store.showCountriesDialog ||
    store.showIncomeDialog ||
    store.showNotificationsDialog ||
    store.showChatDialog ||
    store.showMatchOverviewDialog ||
    store.showSaveLoadDialog ||
    store.showHistoryDialog ||
    store.showShortcutsDialog
  );
}

function isInActiveGameBoard(): boolean {
  return (
    !store.isLoading &&
    !store.showMainMenu &&
    !(store.isOnlineMode && store.roomStatus === 'WAITING') &&
    !isAnyModalOpen()
  );
}

function isEditableElement(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

useCameraKeyboardControls({
  isEnabled: () => isInActiveGameBoard(),
  pan: (dxPx, dyPx) => viewportRef.value?.panCamera(dxPx, dyPx),
  orbit: (deltaRadians) => viewportRef.value?.orbitCamera(deltaRadians),
  zoom: (factor, immediate) => viewportRef.value?.zoomCamera(factor, immediate),
});

function toggleFullscreen(): void {
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
  };
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  try {
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      const res = doc.exitFullscreen
        ? doc.exitFullscreen()
        : doc.webkitExitFullscreen?.();
      if (res instanceof Promise) void res.catch(() => {});
    } else {
      const res = root.requestFullscreen
        ? root.requestFullscreen()
        : root.webkitRequestFullscreen?.();
      if (res instanceof Promise) void res.catch(() => {});
    }
  } catch {
    // Fullscreen API may be blocked in restricted contexts
  }
}

function onKeyDown(e: KeyboardEvent): void {
  const code = e.code;

  // Ctrl + / (or Cmd + /) toggles Keyboard Shortcuts Cheatsheet on Main Menu & Game Screen
  if (
    (e.ctrlKey || e.metaKey) &&
    !e.altKey &&
    (code === 'Slash' || e.key === '/' || e.key === '?')
  ) {
    if (!isEditableElement(e.target)) {
      e.preventDefault();
      store.showShortcutsDialog = !store.showShortcutsDialog;
    }
    return;
  }

  // Ctrl + F (or Cmd + F) toggles Fullscreen mode (physical KeyF works in EN & RU layouts)
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && code === 'KeyF') {
    if (!isEditableElement(e.target)) {
      e.preventDefault();
      toggleFullscreen();
    }
    return;
  }

  if (store.showShortcutsDialog) {
    if (code === 'Escape') {
      store.showShortcutsDialog = false;
    }
    return;
  }

  if (store.landPicker) {
    if (code === 'Escape') {
      store.cancelLandPicker();
    }
    return;
  }

  if (store.showPauseDialog) {
    if (code === 'Escape' || code === 'KeyP') {
      store.showPauseDialog = false;
    }
    return;
  }

  if (!isInActiveGameBoard() || isEditableElement(e.target)) {
    return;
  }

  // Ctrl + Z / Cmd + Z undo
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (code === 'KeyZ') {
      e.preventDefault();
      store.undoLastAction();
    }
    return;
  }

  if (e.altKey) return;

  switch (code) {
    case 'Escape':
      if (store.activeTool || store.selectedUnitKey) {
        store.clearSelection();
      } else {
        store.showPauseDialog = true;
      }
      break;
    case 'KeyP':
      store.showPauseDialog = true;
      break;
    case 'KeyH':
      store.hudCollapsed = !store.hudCollapsed;
      break;
    case 'KeyZ':
      store.undoLastAction();
      break;
    case 'KeyD':
      if (store.gameState.config.diplomacyEnabled) {
        store.showDiplomacyDialog = true;
      }
      break;
    case 'KeyN':
      store.showNotificationsDialog = true;
      break;
    case 'KeyC':
      if (store.isOnlineMode) {
        store.showChatDialog = true;
      }
      break;
    case 'KeyI':
      store.showMatchOverviewDialog = true;
      break;
    case 'KeyV':
      store.cycleCameraMode();
      break;
    case 'Digit0':
    case 'Numpad0':
    case 'Home':
      viewportRef.value?.resetCameraView();
      break;
    case 'Tab':
      e.preventDefault();
      handleFocusNextUnit();
      break;
    case 'KeyB':
      store.selectTool(EntityType.BEACON);
      break;
    case 'KeyF':
      store.selectTool('FLARE');
      break;
    case 'KeyR':
      store.selectTool('REGENERATOR');
      break;
    case 'KeyX':
      store.selectTool('DEMOLISH');
      break;
    case 'Space':
    case 'Enter':
      e.preventDefault();
      store.endTurn();
      break;
    case 'Digit1':
    case 'Numpad1':
      store.selectTool(EntityType.PEASANT);
      break;
    case 'Digit2':
    case 'Numpad2':
      store.selectTool(EntityType.SPEARMAN);
      break;
    case 'Digit3':
    case 'Numpad3':
      store.selectTool(EntityType.BARON);
      break;
    case 'Digit4':
    case 'Numpad4':
      store.selectTool(EntityType.KNIGHT);
      break;
    case 'Digit5':
    case 'Numpad5':
      store.selectTool(EntityType.CATAPULT);
      break;
    case 'Digit6':
    case 'Numpad6':
      store.selectTool(EntityType.FARM);
      break;
    case 'Digit7':
    case 'Numpad7':
      store.selectTool(EntityType.TRADING_POST);
      break;
    case 'Digit8':
    case 'Numpad8':
      store.selectTool(EntityType.TOWER);
      break;
    case 'Digit9':
    case 'Numpad9':
      store.selectTool(EntityType.STRONG_TOWER);
      break;
    default:
      break;
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <main class="relative h-screen w-screen overflow-hidden bg-background">
    <GameViewport ref="viewportRef" />
    <template
      v-if="
        !store.showMainMenu &&
        !(store.isOnlineMode && store.roomStatus === 'WAITING')
      "
    >
      <TopHudBar />
      <TacticalDock @focus-next-unit="handleFocusNextUnit" />
    </template>
    <MainMenuOverlay />
    <NewGameDialog />
    <PauseMenuDialog />
    <DiplomacyDialog />
    <CountriesDialog />
    <IncomeBreakdownDialog />
    <NotificationsDialog />
    <ChatDialog />
    <MatchOverviewDialog />
    <SaveSlotsDialog />
    <MatchHistoryDialog />
    <ShortcutsHelpDialog />
    <VictoryDialog />
    <SonnerBanner />
    <WaitingLobbyOverlay />
    <LoadingOverlay />
    <OfflineIndicator />
  </main>
</template>
