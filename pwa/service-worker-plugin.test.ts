import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { precacheList, renderServiceWorker } from './service-worker-plugin.ts';

const template = readFileSync(new URL('./sw.template.js', import.meta.url), 'utf8');
const version = (source: string) => /const SHELL_VERSION = '([^']+)'/u.exec(source)?.[1];

describe('service worker build', () => {
  it('precaches only built scripts and styles, sorted', () => {
    expect(
      precacheList([
        'assets/build/index-b.js',
        'assets/build/inter-latin.woff2',
        'index.html',
        'assets/build/index-a.css',
      ]),
    ).toEqual(['/assets/build/index-a.css', '/assets/build/index-b.js']);
  });

  it('fills every placeholder with a version that follows the build', () => {
    const first = renderServiceWorker(template, ['/assets/build/a.js']);
    const second = renderServiceWorker(template, ['/assets/build/b.js']);
    expect(first).not.toContain('__SHELL_VERSION__');
    expect(first).not.toContain('__PRECACHE__');
    expect(first).toContain('...["/assets/build/a.js"]');
    expect(version(first)).toMatch(/^monopoly-bank-shell-[0-9a-f]{12}$/u);
    expect(version(first)).not.toBe(version(second));
    expect(renderServiceWorker(template, ['/assets/build/a.js'])).toBe(first);
  });

  it('still leaves the API and WebSocket traffic to the network', () => {
    const source = renderServiceWorker(template, []);
    expect(source).toContain("url.pathname.startsWith('/api/')) return;");
    expect(source).toContain("if (request.method !== 'GET') return;");
    expect(() => new Function(source)).not.toThrow();
  });
});
