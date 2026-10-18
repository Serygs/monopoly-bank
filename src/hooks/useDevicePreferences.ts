import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { mountAppearance } from '../appearance/appearance-controller';
import { readPreferences, writePreferences, type DevicePreferences } from '../utils/preferences';

export function useDevicePreferences(): [
  DevicePreferences,
  (change: Partial<DevicePreferences>) => void,
] {
  const [preferences, setPreferences] = useState<DevicePreferences>(() => readPreferences());
  const { visualStyle, colorMode } = preferences;
  useLayoutEffect(() => mountAppearance({ visualStyle, colorMode }), [visualStyle, colorMode]);
  useEffect(() => {
    writePreferences(preferences);
  }, [preferences]);
  const update = useCallback(
    (change: Partial<DevicePreferences>) =>
      setPreferences((current) => ({ ...current, ...change })),
    [],
  );
  return [preferences, update];
}
