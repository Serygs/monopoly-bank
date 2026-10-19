const formatters = new Map<string, Intl.DateTimeFormat>();

export function dateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const cached = formatters.get(key);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat(locale, options);
  formatters.set(key, created);
  return created;
}
