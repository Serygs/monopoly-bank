export function registerPwa(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register('/sw.js').then((registration) => {
    const announceUpdate = () => { if (navigator.serviceWorker.controller !== null) { reportPwaEvent('UPDATE_AVAILABLE'); window.dispatchEvent(new Event('pwa-update-ready')); } };
    if (registration.waiting !== null) announceUpdate();
    registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', () => { if (registration.installing?.state === 'installed') announceUpdate(); }));
  }).catch(() => undefined);
}

export function applyPwaUpdate(): void {
  reportPwaEvent('UPDATE_APPLIED');
  void navigator.serviceWorker.getRegistration().then((registration) => registration?.waiting?.postMessage({ type: 'SKIP_WAITING' }));
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
}

function reportPwaEvent(event: 'UPDATE_AVAILABLE' | 'UPDATE_APPLIED' | 'OFFLINE_SHELL'): void {
  if (!navigator.onLine) return;
  void fetch('/api/telemetry/pwa', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event }) }).catch(() => undefined);
}
