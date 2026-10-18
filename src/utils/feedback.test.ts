import { afterEach, describe, expect, it, vi } from 'vitest';
import { playPaymentFeedback, vibrate } from './feedback';

type ParamCall = { method: 'set' | 'ramp'; value: number; time: number };

function createAudioHarness(currentTime: number) {
  const destination = { name: 'destination' };
  const oscillatorParam: ParamCall[] = [];
  const gainParam: ParamCall[] = [];
  const events: string[] = [];
  const gainNode = {
    gain: {
      setValueAtTime: (value: number, time: number) => {
        gainParam.push({ method: 'set', value, time });
      },
      exponentialRampToValueAtTime: (value: number, time: number) => {
        gainParam.push({ method: 'ramp', value, time });
      },
    },
  };
  const oscillator = {
    type: 'sine' as string,
    frequency: {
      setValueAtTime: (value: number, time: number) => {
        oscillatorParam.push({ method: 'set', value, time });
      },
      exponentialRampToValueAtTime: (value: number, time: number) => {
        oscillatorParam.push({ method: 'ramp', value, time });
      },
    },
    connect: (target: unknown) => {
      events.push(target === gainNode ? 'oscillator->gain' : 'oscillator->other');
      return gainNode;
    },
    start: (when?: number) => {
      events.push(`start:${String(when)}`);
    },
    stop: (when?: number) => {
      events.push(`stop:${String(when)}`);
    },
  };
  const gainConnect = (target: unknown) => {
    events.push(target === destination ? 'gain->destination' : 'gain->other');
    return destination;
  };
  Object.assign(gainNode, { connect: gainConnect });
  class FakeAudioContext {
    currentTime = currentTime;
    destination = destination;
    createOscillator() {
      return oscillator;
    }
    createGain() {
      return gainNode;
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  return { oscillator, oscillatorParam, gainParam, events };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('playPaymentFeedback', () => {
  it('does not create an audio context when disabled', () => {
    const constructed = vi.fn();
    class Spy {
      constructor() {
        constructed();
      }
    }
    vi.stubGlobal('AudioContext', Spy);
    playPaymentFeedback(false);
    expect(constructed).not.toHaveBeenCalled();
  });

  it('plays a triangle tone with a falling pitch', () => {
    const { oscillator, oscillatorParam } = createAudioHarness(2);
    playPaymentFeedback(true);
    expect(oscillator.type).toBe('triangle');
    expect(oscillatorParam).toEqual([
      { method: 'set', value: 820, time: 2 },
      { method: 'ramp', value: 260, time: 2.12 },
    ]);
  });

  it('shapes the volume envelope with a quick attack and release', () => {
    const { gainParam } = createAudioHarness(1);
    playPaymentFeedback(true);
    expect(gainParam).toHaveLength(3);
    expect(gainParam[0]).toEqual({ method: 'set', value: 0.0001, time: 1 });
    expect(gainParam[1]?.method).toBe('ramp');
    expect(gainParam[1]?.value).toBe(0.05);
    expect(gainParam[1]?.time).toBeCloseTo(1.015, 10);
    expect(gainParam[2]?.method).toBe('ramp');
    expect(gainParam[2]?.value).toBe(0.0001);
    expect(gainParam[2]?.time).toBeCloseTo(1.18, 10);
  });

  it('routes the oscillator through the gain to the destination, then starts and stops it', () => {
    const { events } = createAudioHarness(3);
    playPaymentFeedback(true);
    expect(events).toEqual([
      'oscillator->gain',
      'gain->destination',
      'start:undefined',
      expect.stringMatching(/^stop:3\.19/),
    ]);
  });

  it('stops the oscillator 0.19 seconds after the current time', () => {
    const { events } = createAudioHarness(10);
    playPaymentFeedback(true);
    const stop = events.find((event) => event.startsWith('stop:'));
    expect(Number(stop?.slice(5))).toBeCloseTo(10.19, 10);
  });

  it('swallows audio failures', () => {
    class Broken {
      constructor() {
        throw new Error('audio unavailable');
      }
    }
    vi.stubGlobal('AudioContext', Broken);
    expect(() => playPaymentFeedback(true)).not.toThrow();
  });
});

describe('vibrate', () => {
  it.each([
    [200, true],
    [[100, 50, 100], true],
  ])('vibrates with %j when enabled', (pattern, enabled) => {
    const spy = vi.fn();
    vi.stubGlobal('navigator', { vibrate: spy });
    vibrate(pattern, enabled);
    expect(spy).toHaveBeenCalledWith(pattern);
  });

  it('does not vibrate when disabled', () => {
    const spy = vi.fn();
    vi.stubGlobal('navigator', { vibrate: spy });
    vibrate(200, false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does nothing when the browser has no vibration support', () => {
    vi.stubGlobal('navigator', {});
    expect(() => vibrate(200, true)).not.toThrow();
  });

  it('does not call a non-function vibrate property', () => {
    vi.stubGlobal('navigator', { vibrate: 'yes' });
    expect(() => vibrate(200, true)).not.toThrow();
  });
});
