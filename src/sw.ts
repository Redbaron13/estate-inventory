/// <reference lib="webworker" />
// Service worker: stores the whole app on the phone at install time (code,
// fonts, the barcode decoder) so it opens and works with no signal. Data is
// not cached here: it lives in IndexedDB and syncs through the app.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Every page of the app is the same single-page shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${import.meta.env.BASE_URL}index.html`), { denylist: [/^\/functions\//, /^\/rest\//, /^\/auth\//, /^\/storage\//] }));

// New versions wait until the person taps "Restart app", so nothing in
// progress is interrupted.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
