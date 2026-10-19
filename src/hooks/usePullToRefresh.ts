import { useRef, useState, type TouchEvent } from 'react';

export const PULL_THRESHOLD = 56;
export const PULL_MAX = 80;
const PULL_RESISTANCE = 0.5;

interface PullHandlers {
  onTouchStart: (event: TouchEvent<HTMLElement>) => void;
  onTouchMove: (event: TouchEvent<HTMLElement>) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
}

export function usePullToRefresh(onRefresh: (() => void) | undefined): {
  pull: number;
  handlers: PullHandlers;
} {
  const [pull, setPull] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const distance = useRef(0);

  const reset = () => {
    start.current = null;
    distance.current = 0;
    setPull(0);
  };

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (onRefresh === undefined || touch === undefined || event.currentTarget.scrollTop > 0) {
      start.current = null;
      return;
    }
    start.current = { x: touch.clientX, y: touch.clientY };
    distance.current = 0;
  };

  const onTouchMove = (event: TouchEvent<HTMLElement>) => {
    const origin = start.current;
    const touch = event.touches[0];
    if (origin === null || touch === undefined) return;
    const dy = touch.clientY - origin.y;
    const dx = Math.abs(touch.clientX - origin.x);
    if (dx > Math.abs(dy) || dy <= 0 || event.currentTarget.scrollTop > 0) {
      reset();
      return;
    }
    distance.current = Math.min(dy * PULL_RESISTANCE, PULL_MAX);
    setPull(distance.current);
  };

  const onTouchEnd = () => {
    const reached = start.current !== null && distance.current >= PULL_THRESHOLD;
    reset();
    if (reached) onRefresh?.();
  };

  return { pull, handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: reset } };
}
