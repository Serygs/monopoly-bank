import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const template = readFileSync(new URL('./sw.template.js', import.meta.url), 'utf8');

/** The built scripts and styles the service worker precaches, as root-relative URLs. */
export function precacheList(fileNames: readonly string[]): string[] {
  return fileNames
    .filter((name) => /\.(?:js|css)$/u.test(name))
    .map((name) => `/${name}`)
    .sort();
}

/**
 * `sw.js` for one build. The version hashes the template and the file list, so every deploy
 * that changes a byte of the client ships a different worker: the browser sees the update,
 * the app offers to reload, and `activate` drops the previous build's cache.
 */
export function renderServiceWorker(source: string, files: readonly string[]): string {
  const version = createHash('sha256')
    .update(source)
    .update(files.join('\n'))
    .digest('hex')
    .slice(0, 12);
  return source
    .replace('__SHELL_VERSION__', `monopoly-bank-shell-${version}`)
    .replace('__PRECACHE__', JSON.stringify(files));
}

/** Emits `sw.js` next to the client build; the Worker build has no service worker. */
export function serviceWorkerPlugin(): Plugin {
  return {
    name: 'monopoly-bank:service-worker',
    apply: 'build',
    applyToEnvironment: (environment) => environment.name === 'client',
    generateBundle(_options, bundle) {
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: renderServiceWorker(template, precacheList(Object.keys(bundle))),
      });
    },
  };
}
