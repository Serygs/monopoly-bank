import { useEffect, useState } from 'react';

export function useUpdateReady(): [boolean, () => void] {
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    const ready = () => setUpdateReady(true);
    window.addEventListener('pwa-update-ready', ready);
    return () => window.removeEventListener('pwa-update-ready', ready);
  }, []);
  return [updateReady, () => setUpdateReady(false)];
}
