export function jsonRequest(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  origin = 'https://example.test',
): Request {
  return new Request(`${origin}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function mutationRequest(body: unknown): Request {
  return new Request('https://game-session/mutation', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
