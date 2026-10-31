let sharedContext: AudioContext | undefined;

/** Forgets the shared context; for tests that stub `AudioContext` anew each time. */
export function resetAudioContext(): void {
  sharedContext = undefined;
}

/** One context for every tone: a new one per sound leaks, and iOS caps how many may exist. */
function audioContext(): AudioContext {
  sharedContext ??= new AudioContext();
  if (sharedContext.state === 'suspended') void sharedContext.resume();
  return sharedContext;
}

export function playPaymentFeedback(enabled: boolean): void {
  if (!enabled) return;
  try {
    const context = audioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(820, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(260, context.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.19);
  } catch {
    /* Browser audio is optional. */
  }
}

/** A short dry click for a dice roll. */
export function playRollFeedback(enabled: boolean): void {
  if (!enabled) return;
  try {
    const context = audioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(180, context.currentTime);
    gain.gain.setValueAtTime(0.03, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.08);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.09);
  } catch {
    /* Browser audio is optional. */
  }
}

export function vibrate(pattern: number | number[], enabled: boolean): void {
  if (enabled && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
}
