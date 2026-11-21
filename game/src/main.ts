import {createApp} from 'vue';
import {createPinia} from 'pinia';
import {registerSW} from 'virtual:pwa-register';
import App from '@/App.vue';
import {
  markPwaUpdateAvailable,
  registerPwaController,
  setSwRegistration,
} from '@/application/composables/usePwaInstall';
import '@/index.css';

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    markPwaUpdateAvailable();
  },
  onRegisteredSW(_swUrl, registration) {
    setSwRegistration(registration);
  },
});
registerPwaController(updateSW);

const app = createApp(App);
app.use(createPinia());
app.mount('#app');
