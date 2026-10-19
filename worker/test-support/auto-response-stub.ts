class FakeRequestResponsePair {
  readonly request: string;
  readonly response: string;
  constructor(request: string, response: string) {
    this.request = request;
    this.response = response;
  }
}

Object.assign(globalThis, { WebSocketRequestResponsePair: FakeRequestResponsePair });
