/**
 * One-time local bootstrap for a newcomer: `npm run setup`.
 *
 * - Checks the Node.js version against .nvmrc / package.json#engines.
 * - Applies the D1 migrations to the *local* database that `wrangler dev` uses
 *   (`wrangler d1 migrations apply MONOPOLY_BANK_DB --local`). State lives in
 *   `.wrangler/state/`; re-running is safe because wrangler skips applied migrations.
 * - Prints the remaining manual steps (Playwright browser download).
 *
 * It never contacts Cloudflare: no `--remote`, no login, no production binding.
 */
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const wranglerEntry = fileURLToPath(
  new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
);
const D1_BINDING = 'MONOPOLY_BANK_DB';

function step(title) {
  console.log(`\n▸ ${title}`);
}

function fail(message, hint) {
  console.error(`\n✖ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    // stdin is not a TTY so wrangler does not stop for an interactive confirmation.
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

step('Checking Node.js version');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor !== 22) {
  fail(
    `Node.js ${process.versions.node} is not supported; Monopoly Bank pins Node 22 (see .nvmrc).`,
    'Run `nvm use` (or install Node 22) and re-run `npm run setup`.',
  );
}
console.log(`  Node.js ${process.versions.node} ✓`);

step('Checking installed dependencies');
try {
  await access(wranglerEntry);
} catch {
  fail(
    'wrangler is not installed in node_modules.',
    'Run `npm install`, then `npm run setup` again.',
  );
}
console.log('  node_modules ✓');

step(
  `Applying D1 migrations to the local database (wrangler d1 migrations apply ${D1_BINDING} --local)`,
);
const exitCode = await run(process.execPath, [
  wranglerEntry,
  'd1',
  'migrations',
  'apply',
  D1_BINDING,
  '--local',
]);
if (exitCode !== 0) {
  fail(
    `wrangler exited with code ${exitCode} while applying local D1 migrations.`,
    'Only .wrangler/state/ is involved; delete that directory to start from an empty local database.',
  );
}
console.log('  Local D1 is up to date (state in .wrangler/state/; safe to re-run) ✓');

console.log(`
✔ Setup complete.

Next steps:
  • npm run dev                        start the client and the Worker with the local D1
  • npx playwright install chromium    one-time browser download, required before
                                       npm run test:e2e
  • npm run check                      lint + unit tests; npm run typecheck for tsc -b only
`);
