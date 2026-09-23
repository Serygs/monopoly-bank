import type { VisualStyleEffectContext } from './visual-styles';

const surfaceSelector = '.page-header--hero, .game-card';

interface ActiveSurface {
  element: HTMLElement;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Decorative shell effect. It never changes layout, interaction, or app state. */
export function mountLiquidGlassEffects({
  root,
  ownerDocument,
  getReducedMotionPreference,
}: VisualStyleEffectContext): () => void {
  const motion = getReducedMotionPreference();
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let active = !motion.matches && finePointer.matches && ownerDocument.visibilityState !== 'hidden';
  let surface: ActiveSurface | null = null;
  let frame: number | null = null;
  let pointerX = 50;
  let pointerY = 50;

  const clearSurface = () => {
    if (surface === null) return;
    for (const property of [
      '--glass-pointer-x',
      '--glass-pointer-y',
      '--glass-rotate-x',
      '--glass-rotate-y',
    ]) {
      surface.element.style.removeProperty(property);
    }
    surface = null;
  };

  const paint = () => {
    frame = null;
    if (!active || surface === null) return;
    const x = Math.max(0, Math.min(100, ((pointerX - surface.left) / surface.width) * 100));
    const y = Math.max(0, Math.min(100, ((pointerY - surface.top) / surface.height) * 100));
    surface.element.style.setProperty('--glass-pointer-x', `${x.toFixed(1)}%`);
    surface.element.style.setProperty('--glass-pointer-y', `${y.toFixed(1)}%`);
    surface.element.style.setProperty(
      '--glass-rotate-x',
      `${(((50 - y) / 50) * 1.2).toFixed(2)}deg`,
    );
    surface.element.style.setProperty(
      '--glass-rotate-y',
      `${(((x - 50) / 50) * 1.5).toFixed(2)}deg`,
    );
  };

  const onPointerOver = (event: PointerEvent) => {
    if (!active || event.pointerType === 'touch' || !(event.target instanceof Element)) return;
    const candidate = event.target.closest<HTMLElement>(surfaceSelector);
    if (candidate === null || candidate === surface?.element) return;
    clearSurface();
    const bounds = candidate.getBoundingClientRect();
    surface = {
      element: candidate,
      left: bounds.left,
      top: bounds.top,
      width: Math.max(bounds.width, 1),
      height: Math.max(bounds.height, 1),
    };
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!active || surface === null || event.pointerType === 'touch') return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (frame === null) frame = window.requestAnimationFrame(paint);
  };

  const onPointerOut = (event: PointerEvent) => {
    if (
      surface === null ||
      (event.relatedTarget instanceof Node && surface.element.contains(event.relatedTarget))
    )
      return;
    clearSurface();
  };

  const updateActivity = () => {
    active = !motion.matches && finePointer.matches && ownerDocument.visibilityState !== 'hidden';
    if (!active) clearSurface();
  };

  ownerDocument.addEventListener('pointerover', onPointerOver, { passive: true });
  ownerDocument.addEventListener('pointermove', onPointerMove, { passive: true });
  ownerDocument.addEventListener('pointerout', onPointerOut, { passive: true });
  ownerDocument.addEventListener('visibilitychange', updateActivity);
  motion.addEventListener('change', updateActivity);
  finePointer.addEventListener('change', updateActivity);

  return () => {
    ownerDocument.removeEventListener('pointerover', onPointerOver);
    ownerDocument.removeEventListener('pointermove', onPointerMove);
    ownerDocument.removeEventListener('pointerout', onPointerOut);
    ownerDocument.removeEventListener('visibilitychange', updateActivity);
    motion.removeEventListener('change', updateActivity);
    finePointer.removeEventListener('change', updateActivity);
    if (frame !== null) window.cancelAnimationFrame(frame);
    clearSurface();
    root.style.removeProperty('--liquid-pointer-x');
    root.style.removeProperty('--liquid-pointer-y');
  };
}
