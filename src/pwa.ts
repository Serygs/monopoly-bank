export function registerPwa(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register('/sw.js').then((registration) => {
    const announceUpdate = () => { if (navigator.serviceWorker.controller !== null) window.dispatchEvent(new Event('pwa-update-ready')); };
    if (registration.waiting !== null) announceUpdate();
    registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', () => { if (registration.installing?.state === 'installed') announceUpdate(); }));
  }).catch(() => undefined);
}

export function applyPwaUpdate(): void {
  void navigator.serviceWorker.getRegistration().then((registration) => registration?.waiting?.postMessage({ type: 'SKIP_WAITING' }));
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
}
