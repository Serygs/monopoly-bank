const textEncoder = new TextEncoder();
// Cloudflare Workers rejects PBKDF2 requests above 100,000 iterations.
export const passwordHashIterations = 100_000;

export interface PasswordHash { hash: string; salt: string; }

export async function hashPassword(password: string, salt = randomToken(16)): Promise<PasswordHash> {
  const material = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: decode(salt), iterations: passwordHashIterations }, material, 256);
  return { hash: encode(new Uint8Array(bits)), salt };
}

export async function verifyPassword(password: string, expected: PasswordHash): Promise<boolean> {
  const actual = await hashPassword(password, expected.salt);
  const left = decode(actual.hash); const right = decode(expected.hash);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function tokenHash(token: string): Promise<string> {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(token))));
}

export function randomToken(bytes = 32): string { const value = new Uint8Array(bytes); crypto.getRandomValues(value); return encode(value); }
function encode(value: Uint8Array): string { return btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, ''); }
function decode(value: string): Uint8Array { const normalized = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '='); return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0)); }
