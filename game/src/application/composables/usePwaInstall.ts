import {computed, ref} from 'vue';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'; platform: string}>;
}

export type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'error';

const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null);
const isInstalled = ref<boolean>(false);
const isIos = ref<boolean>(false);
const isOnline = ref<boolean>(
  typeof navigator !== 'undefined' ? navigator.onLine : true,
);
const updateStatus = ref<UpdateCheckStatus>('idle');

let swRegistration: ServiceWorkerRegistration | null = null;
let updateSwCallback: ((reloadPage?: boolean) => Promise<void>) | null = null;
let statusResetTimer: ReturnType<typeof setTimeout> | null = null;
let listenersAttached = false;

export function registerPwaController(
  updateSW: (reloadPage?: boolean) => Promise<void>,
): void {
  updateSwCallback = updateSW;
}

export function setSwRegistration(reg: ServiceWorkerRegistration | undefined): void {
  if (reg) {
    swRegistration = reg;
  }
}

export function markPwaUpdateAvailable(): void {
  if (statusResetTimer) {
    clearTimeout(statusResetTimer);
    statusResetTimer = null;
  }
  updateStatus.value = 'available';
}

function scheduleStatusReset(): void {
  if (statusResetTimer) {
    clearTimeout(statusResetTimer);
  }
  statusResetTimer = setTimeout(() => {
    if (updateStatus.value === 'up-to-date' || updateStatus.value === 'error') {
      updateStatus.value = 'idle';
    }
  }, 3000);
}

function initPwaListeners(): void {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;

  const standaloneMedia = window.matchMedia('(display-mode: standalone)');
  const nav = window.navigator as Navigator & {standalone?: boolean};
  isInstalled.value = standaloneMedia.matches || nav.standalone === true;

  const ua = window.navigator.userAgent.toLowerCase();
  isIos.value =
    /iphone|ipad|ipod/.test(ua) ||
    (ua.includes('macintosh') && 'ontouchend' in document);

  window.addEventListener('beforeinstallprompt', (event: Event) => {
    event.preventDefault();
    deferredPrompt.value = event as BeforeInstallPromptEvent;
  });

  window.addEventListener('appinstalled', () => {
    isInstalled.value = true;
    deferredPrompt.value = null;
  });

  standaloneMedia.addEventListener('change', (event) => {
    if (event.matches) {
      isInstalled.value = true;
      deferredPrompt.value = null;
    }
  });

  window.addEventListener('online', () => {
    isOnline.value = true;
  });

  window.addEventListener('offline', () => {
    isOnline.value = false;
  });
}

export function usePwaInstall() {
  initPwaListeners();

  const isInstallable = computed(() => deferredPrompt.value !== null);

  async function install(): Promise<boolean> {
    const promptEvent = deferredPrompt.value;
    if (!promptEvent) return false;
    await promptEvent.prompt();
    const {outcome} = await promptEvent.userChoice;
    if (outcome === 'accepted') {
      isInstalled.value = true;
      deferredPrompt.value = null;
      return true;
    }
    return false;
  }

  async function applyUpdate(): Promise<void> {
    if (updateSwCallback) {
      await updateSwCallback(true);
      return;
    }
    if (swRegistration?.waiting) {
      swRegistration.waiting.postMessage({type: 'SKIP_WAITING'});
    }
    window.location.reload();
  }

  async function checkForUpdates(): Promise<void> {
    if (updateStatus.value === 'checking') return;
    if (updateStatus.value === 'available') {
      await applyUpdate();
      return;
    }

    if (!isOnline.value) {
      updateStatus.value = 'error';
      scheduleStatusReset();
      return;
    }

    updateStatus.value = 'checking';
    try {
      const reg =
        swRegistration ??
        (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
          ? await navigator.serviceWorker.getRegistration()
          : undefined);

      if (reg) {
        swRegistration = reg;
        await reg.update();
        if (reg.waiting || reg.installing) {
          markPwaUpdateAvailable();
          return;
        }
      }

      if (updateStatus.value === 'checking') {
        updateStatus.value = 'up-to-date';
        scheduleStatusReset();
      }
    } catch {
      updateStatus.value = 'error';
      scheduleStatusReset();
    }
  }

  return {
    isInstallable,
    isInstalled,
    isIos,
    isOnline,
    updateStatus,
    install,
    checkForUpdates,
  };
}
