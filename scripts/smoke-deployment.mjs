const baseUrl = process.env.SMOKE_BASE_URL;
if (!baseUrl) throw new Error('SMOKE_BASE_URL is required.');
const base = new URL(baseUrl);
if (base.protocol !== 'https:') throw new Error('SMOKE_BASE_URL must use HTTPS.');

const home = await fetch(new URL('/', base));
if (!home.ok || !home.headers.get('content-type')?.includes('text/html')) throw new Error(`Application shell smoke test failed with ${home.status}.`);
const profile = await fetch(new URL('/api/profile', base), { redirect: 'manual' });
if (profile.status !== 401) throw new Error(`Authenticated API boundary smoke test expected 401, received ${profile.status}.`);
for (const header of ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy']) {
  if (!profile.headers.has(header)) throw new Error(`Authenticated API response is missing ${header}.`);
}
console.log(`Deployment smoke tests passed for ${base.origin}.`);
