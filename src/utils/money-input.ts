const maxMoneyInput = 9_999_999_999;

export function appendMoneyDigit(value: string, digit: string): string {
  if (!/^\d$/.test(digit)) return value;
  const normalized = value.replace(/^0+/, '');
  const next = `${normalized}${digit}`.replace(/^0+(?=\d)/, '');
  return Number(next) > maxMoneyInput ? normalized : next;
}

export function removeMoneyDigit(value: string): string { return value.slice(0, -1); }
export function sanitizeMoneyInput(value: string): string {
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return Number(digits) > maxMoneyInput ? String(maxMoneyInput) : digits;
}
