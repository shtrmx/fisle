import {computed, ref} from 'vue';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'; platform: string}>;
}

const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null);
const isInstalled = ref<boolean>(false);
const isIos = ref<boolean>(false);
const isOnline = ref<boolean>(
  typeof navigator !== 'undefined' ? navigator.onLine : true,
);

let listenersAttached = false;

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

  return {
    isInstallable,
    isInstalled,
    isIos,
    isOnline,
    install,
  };
}
