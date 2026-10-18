import { useLayoutEffect, useRef, useState } from 'react';

const MIN_OFFSET = 8;
const BUTTON_GAP = 12;

export function useSettingsPopover(open: boolean) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const bounds = buttonRef.current?.getBoundingClientRect();
      if (bounds === undefined) return;
      setPosition({
        top: Math.max(MIN_OFFSET, bounds.bottom + BUTTON_GAP),
        right: Math.max(MIN_OFFSET, window.innerWidth - bounds.right),
      });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);
  return { buttonRef, position };
}
