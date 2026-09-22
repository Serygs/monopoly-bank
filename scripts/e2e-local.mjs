// Local browser run of the board scenarios against a throwaway local D1.
//
// Builds the Worker and client with Vite, applies every migration to a fresh
// D1 in a temporary persistence directory, starts `wrangler dev --local` from
// the built configuration on a free loopback port, runs the Playwright `local`
// project (`e2e/property.spec.ts`) against it, then stops Wrangler and deletes
// the temporary directory. No environment variable, secret, staging origin or
// mail provider is needed; `wrangler.jsonc` is only read. Extra arguments are
// passed to Playwright, for example `npm run test:e2e:local -- --update-snapshots`.
import { spawn, execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = fileURLToPath(new URL('..', import.meta.url));
const wranglerEntry = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const viteEntry = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const playwrightEntry = join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const builtConfig = join(root, 'dist', 'monopoly_bank', 'wrangler.json');
const readyTimeoutMs = 90_000;
const playwrightArguments = process.argv.slice(2);
const skipBuild = playwrightArguments.includes('--skip-build');
const forwardedArguments = playwrightArguments.filter((argument) => argument !== '--skip-build');

const persistence = await mkdtemp(join(tmpdir(), 'monopoly-bank-e2e-local-'));
/** @type {import('node:child_process').ChildProcess | null} */
let wrangler = null;
let wranglerOutput = '';
let exitCode = 1;

function log(message) { console.log(`[e2e-local] ${message}`); }

async function run(entry, args, options = {}) {
  await execFile(process.execPath, [entry, ...args], { cwd: root, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, ...options });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitUntilReady(baseURL) {
  const deadline = Date.now() + readyTimeoutMs;
  let lastError = 'no response yet';
  while (Date.now() < deadline) {
    if (wrangler !== null && wrangler.exitCode !== null) throw new Error(`wrangler dev exited early with code ${wrangler.exitCode}.\n${wranglerOutput}`);
    try {
      // The client shell must be served and the Worker must answer JSON on /api before a browser is pointed at it.
      const [shell, api] = await Promise.all([fetch(`${baseURL}/`), fetch(`${baseURL}/api/profile`)]);
      if (shell.status === 200 && api.status === 401 && (api.headers.get('content-type') ?? '').includes('application/json')) return;
      lastError = `shell ${shell.status}, api ${api.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`wrangler dev did not become ready within ${readyTimeoutMs / 1000}s (${lastError}).\n${wranglerOutput}`);
}

function stopWrangler() {
  return new Promise((resolve) => {
    if (wrangler === null || wrangler.exitCode !== null) { resolve(); return; }
    const child = wrangler;
    const forceKill = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }, 5_000);
    child.once('exit', () => { clearTimeout(forceKill); resolve(); });
    // Wrangler runs workerd as its own child; the whole process group is signalled so no local server lingers.
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  });
}

try {
  if (!skipBuild) {
    log('building the client and Worker with Vite');
    await run(viteEntry, ['build'], { env: { ...process.env, NODE_ENV: 'production' } });
  }

  log('applying every migration to a fresh local D1');
  await run(wranglerEntry, ['d1', 'migrations', 'apply', 'MONOPOLY_BANK_DB', '--local', '--persist-to', persistence]);

  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  log(`starting wrangler dev on ${baseURL}`);
  wrangler = spawn(process.execPath, [
    wranglerEntry, 'dev',
    '--config', builtConfig,
    '--local',
    '--persist-to', persistence,
    '--ip', '127.0.0.1',
    '--port', String(port),
    '--show-interactive-dev-session=false',
    // Registration and sign-in do not send mail; these only satisfy the Worker's constructor wiring.
    '--var', `APP_ORIGIN:${baseURL}`,
    '--var', 'RESEND_API_KEY:e2e-local-unused',
    '--var', 'RESEND_FROM_EMAIL:Monopoly Bank <e2e-local@localhost>',
  ], { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: process.env.CI ?? 'true' } });
  for (const stream of [wrangler.stdout, wrangler.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => { wranglerOutput = `${wranglerOutput}${chunk}`.slice(-64_000); if (process.env.E2E_LOCAL_VERBOSE === 'true') process.stderr.write(chunk); });
  }
  await waitUntilReady(baseURL);
  log('wrangler dev is ready; running the Playwright local project');

  const startedAt = Date.now();
  exitCode = await new Promise((resolve) => {
    const playwright = spawn(process.execPath, [playwrightEntry, 'test', '--project', 'local', '--workers', '1', ...forwardedArguments], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, E2E_BASE_URL: baseURL, E2E_RUN: 'true', E2E_LOCAL: 'true' },
    });
    playwright.on('exit', (code) => resolve(code ?? 1));
    playwright.on('error', () => resolve(1));
  });
  log(`Playwright finished with code ${exitCode} after ${Math.round((Date.now() - startedAt) / 1000)}s`);
  if (exitCode !== 0 && process.env.E2E_LOCAL_VERBOSE !== 'true') process.stderr.write(`\n[e2e-local] last wrangler output:\n${wranglerOutput.slice(-8_000)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  await stopWrangler();
  await rm(persistence, { recursive: true, force: true });
}
process.exit(exitCode);
