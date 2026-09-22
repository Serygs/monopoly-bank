import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountLiquidGlassEffects } from './liquid-glass-effects';

class FakeElement {
  readonly style = { setProperty: vi.fn(), removeProperty: vi.fn() };

  closest<T>(): T { return this as unknown as T; }
  contains(): boolean { return false; }
  getBoundingClientRect(): DOMRect { return { left: 10, top: 20, width: 200, height: 100 } as DOMRect; }
}

describe('Liquid Glass effects', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('uses a bounded, frame-scheduled pointer reflection and releases it on cleanup', () => {
    const listeners = new Map<string, EventListener>();
    const mediaListeners = new Set<EventListener>();
    const motion = { matches: false, addEventListener: vi.fn((_event: string, listener: EventListener) => mediaListeners.add(listener)), removeEventListener: vi.fn((_event: string, listener: EventListener) => mediaListeners.delete(listener)) };
    const finePointer = { matches: true, addEventListener: vi.fn((_event: string, listener: EventListener) => mediaListeners.add(listener)), removeEventListener: vi.fn((_event: string, listener: EventListener) => mediaListeners.delete(listener)) };
    const root = new FakeElement();
    const surface = new FakeElement();
    const ownerDocument = {
      visibilityState: 'visible',
      addEventListener: vi.fn((event: string, listener: EventListener) => listeners.set(event, listener)),
      removeEventListener: vi.fn((event: string) => listeners.delete(event)),
    } as unknown as Document;
    vi.stubGlobal('Element', FakeElement);
    vi.stubGlobal('Node', FakeElement);
    vi.stubGlobal('window', {
      matchMedia: vi.fn((query: string) => query.includes('pointer') ? finePointer : motion),
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => { callback(0); return 1; }),
      cancelAnimationFrame: vi.fn(),
    });

    const cleanup = mountLiquidGlassEffects({ root: root as unknown as HTMLElement, ownerDocument, getReducedMotionPreference: () => motion as unknown as MediaQueryList });
    listeners.get('pointerover')?.({ target: surface, pointerType: 'mouse' } as unknown as Event);
    listeners.get('pointermove')?.({ clientX: 110, clientY: 70, pointerType: 'mouse' } as unknown as Event);

    expect(surface.style.setProperty).toHaveBeenCalledWith('--glass-pointer-x', '50.0%');
    expect(surface.style.setProperty).toHaveBeenCalledWith('--glass-pointer-y', '50.0%');
    expect(surface.style.setProperty).toHaveBeenCalledWith('--glass-rotate-x', '0.00deg');
    expect(surface.style.setProperty).toHaveBeenCalledWith('--glass-rotate-y', '0.00deg');

    cleanup();

    expect(surface.style.removeProperty).toHaveBeenCalledWith('--glass-pointer-x');
    expect(listeners).toHaveLength(0);
    expect(mediaListeners).toHaveLength(0);
  });
});
