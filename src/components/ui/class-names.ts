/** Joins the truthy class names in order; returns `undefined` when none remain. */
export function cx(...parts: readonly (string | false | null | undefined)[]): string | undefined {
  const joined = parts.filter((part) => typeof part === 'string' && part !== '').join(' ');
  return joined === '' ? undefined : joined;
}
