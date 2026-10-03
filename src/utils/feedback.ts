export function playPaymentFeedback(enabled: boolean): void {
  if (!enabled) return;
  try {
    const context = new AudioContext();
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

export function vibrate(pattern: number | number[], enabled: boolean): void {
  if (enabled && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
}
