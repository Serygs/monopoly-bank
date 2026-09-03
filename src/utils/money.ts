export function formatThousands(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}
