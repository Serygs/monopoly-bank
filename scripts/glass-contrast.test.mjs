import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Declarations of the first rule block that starts with `selector`. */
const css = readFileSync(
  new URL('../src/styles/visual-styles/liquid-glass.css', import.meta.url),
  'utf8',
);

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing ${selector}`);
  return css.slice(start, css.indexOf('\n}', start));
}

const light = block(":root[data-visual-style='liquid-glass']");
const dark = block(":root[data-visual-style='liquid-glass'][data-color-mode='dark']");

function parseColor(value) {
  const hex = /^#([0-9a-f]{6})$/iu.exec(value);
  if (hex?.[1] !== undefined) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)/u.exec(value);
  if (rgb === null) throw new Error(`unparsable colour ${value}`);
  return [
    Number(rgb[1]),
    Number(rgb[2]),
    Number(rgb[3]),
    rgb[4] === undefined ? 1 : Number(rgb[4]),
  ];
}

function token(scope, name, fallbackScope = light) {
  const match = new RegExp(`${name}: (#[0-9a-f]{6}|rgb\\([^)]*\\));`, 'iu').exec(scope);
  const found =
    match?.[1] ??
    new RegExp(`${name}: (#[0-9a-f]{6}|rgb\\([^)]*\\));`, 'iu').exec(fallbackScope)?.[1];
  if (found === undefined) throw new Error(`missing token ${name}`);
  return parseColor(found);
}

function over(top, bottom) {
  const a = top[3];
  return [
    top[0] * a + bottom[0] * (1 - a),
    top[1] * a + bottom[1] * (1 - a),
    top[2] * a + bottom[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Worst-case page backdrops: the most saturated mesh blob and the plain canvas, per mode. */
const backdrops = {
  light: [
    [138, 182, 244, 1],
    [204, 178, 246, 1],
    [148, 222, 196, 1],
    [255, 214, 176, 1],
    [241, 245, 251, 1],
  ],
  dark: [
    [37, 52, 70, 1],
    [41, 38, 56, 1],
    [22, 37, 42, 1],
    [16, 21, 28, 1],
  ],
};

describe.each([
  ['light', light],
  ['dark', dark],
])('Liquid Glass contrast (%s)', (mode, scope) => {
  const text = token(scope, '--mb-color-text-primary');
  const secondary = token(scope, '--mb-color-text-secondary');

  it.each([['--mb-glass-tint'], ['--mb-glass-card-tint'], ['--mb-popover-tint']])(
    'primary and secondary text over %s stay AA on every backdrop',
    (surface) => {
      const tint = token(scope, surface);
      for (const backdrop of backdrops[mode] ?? []) {
        const bg = over(tint, backdrop);
        expect(
          ratio(text, bg),
          `${surface} primary on ${backdrop.join(',')}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          ratio(secondary, bg),
          `${surface} secondary on ${backdrop.join(',')}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('white label on the tinted primary button stays AA on every backdrop', () => {
    const match = /--mb-glass-button-primary-bg:[\s\S]*?(rgb\([^)]*\));/u.exec(scope);
    if (match?.[1] === undefined) throw new Error('missing primary button tint');
    const tint = parseColor(match[1]);
    const label = [255, 255, 255, 1];
    for (const backdrop of backdrops[mode] ?? []) {
      expect(ratio(label, over(tint, backdrop))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
