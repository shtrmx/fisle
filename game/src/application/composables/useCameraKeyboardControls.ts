import {onBeforeUnmount, onMounted} from 'vue';

export interface CameraKeyboardController {
  readonly isEnabled: () => boolean;
  readonly pan: (dxPx: number, dyPx: number) => void;
  readonly orbit: (deltaRadians: number) => void;
  readonly zoom: (factor: number, immediate?: boolean) => void;
}

const CAMERA_KEY_CODES = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyQ',
  'KeyE',
  'Equal',
  'NumpadAdd',
  'Minus',
  'NumpadSubtract',
]);

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Drives smooth 60fps continuous camera pan (Arrow keys + optional Shift boost),
 * rotation (Q / E), and zoom (+ / -) while keys are held down.
 */
export function useCameraKeyboardControls(
  controller: CameraKeyboardController,
): void {
  const heldCodes = new Set<string>();
  let shiftHeld = false;
  let rafId = 0;
  let lastTimestamp = 0;

  function stopLoop(): void {
    if (rafId !== 0) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    lastTimestamp = 0;
  }

  function clearHeld(): void {
    heldCodes.clear();
    shiftHeld = false;
    stopLoop();
  }

  function step(now: number): void {
    if (heldCodes.size === 0 || !controller.isEnabled()) {
      clearHeld();
      return;
    }

    const dt =
      lastTimestamp > 0 ? Math.min(0.05, (now - lastTimestamp) / 1000) : 0.016;
    lastTimestamp = now;

    // Pan: screen-delta convention (dragging map right moves viewport left)
    let panX = 0;
    let panY = 0;
    if (heldCodes.has('ArrowLeft')) panX += 1;
    if (heldCodes.has('ArrowRight')) panX -= 1;
    if (heldCodes.has('ArrowUp')) panY += 1;
    if (heldCodes.has('ArrowDown')) panY -= 1;

    if (panX !== 0 || panY !== 0) {
      const len = Math.hypot(panX, panY);
      const speedPx = shiftHeld ? 920 : 520;
      controller.pan((panX / len) * speedPx * dt, (panY / len) * speedPx * dt);
    }

    // Orbit (rotate camera around vertical axis)
    let orbitDir = 0;
    if (heldCodes.has('KeyQ')) orbitDir -= 1;
    if (heldCodes.has('KeyE')) orbitDir += 1;
    if (orbitDir !== 0) {
      const angularSpeed = shiftHeld ? 2.4 : 1.5;
      controller.orbit(orbitDir * angularSpeed * dt);
    }

    // Continuous smooth zoom
    let zoomDir = 0;
    if (heldCodes.has('Equal') || heldCodes.has('NumpadAdd')) zoomDir += 1;
    if (heldCodes.has('Minus') || heldCodes.has('NumpadSubtract')) zoomDir -= 1;
    if (zoomDir !== 0) {
      const zoomRate = shiftHeld ? 1.7 : 1.15;
      const factor = Math.exp(zoomDir * zoomRate * dt);
      controller.zoom(factor, true);
    }

    rafId = window.requestAnimationFrame(step);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      shiftHeld = true;
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!CAMERA_KEY_CODES.has(e.code)) return;
    if (isEditableTarget(e.target) || !controller.isEnabled()) return;

    e.preventDefault();
    shiftHeld = e.shiftKey;
    heldCodes.add(e.code);
    if (rafId === 0) {
      lastTimestamp = 0;
      rafId = window.requestAnimationFrame(step);
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      shiftHeld = false;
      return;
    }
    if (heldCodes.delete(e.code) && heldCodes.size === 0) {
      stopLoop();
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearHeld);
  });

  onBeforeUnmount(() => {
    clearHeld();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', clearHeld);
  });
}
