/** The length a join code may have (the Worker issues 6 characters; the form accepts 4-12). */
export const JOIN_CODE_MIN_LENGTH = 4;
export const JOIN_CODE_MAX_LENGTH = 12;

/** How a code is compared and sent: no spaces, upper case. */
export function normalizeJoinCode(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** The code split into groups of three for reading aloud ("ABC DEF"); the value is unchanged. */
export function formatJoinCode(code: string): string {
  return normalizeJoinCode(code).replace(/(.{3})(?=.)/g, '$1 ');
}

/** The one invitation link for a code: what the QR code, Share and Copy carry. */
export function joinInviteLink(origin: string, code: string): string {
  return `${origin}/games/join?code=${encodeURIComponent(normalizeJoinCode(code))}`;
}

/** The code in a join link's query string, or an empty string. */
export function joinCodeFromSearch(search: string): string {
  return normalizeJoinCode(new URLSearchParams(search).get('code') ?? '');
}

/** Whether a typed code has a plausible length (the Worker still decides if it exists). */
export function isJoinCodeShaped(value: string): boolean {
  const length = normalizeJoinCode(value).length;
  return length >= JOIN_CODE_MIN_LENGTH && length <= JOIN_CODE_MAX_LENGTH;
}
