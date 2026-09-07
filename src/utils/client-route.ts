export function currentRoute(pathname: string, search: string, hash: string): string {
  return `${pathname}${search}${hash}`;
}

export function routePath(route: string): string {
  return new URL(route, 'https://monopoly-bank.local').pathname;
}
