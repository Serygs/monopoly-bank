export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}

export interface TransactionalEmailProvider {
  send(message: TransactionalEmail): Promise<void>;
}

/** A Worker-native Resend adapter. API credentials never leave Worker secrets. */
export class ResendTransactionalEmailProvider implements TransactionalEmailProvider {
  private readonly apiKey: string; private readonly from: string; private readonly sendRequest: typeof fetch;
  constructor(apiKey: string, from: string, sendRequest: typeof fetch = fetch) { this.apiKey = apiKey; this.from = from; this.sendRequest = sendRequest; }

  async send(message: TransactionalEmail): Promise<void> {
    const response = await this.sendRequest('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': message.idempotencyKey,
        'user-agent': 'monopoly-bank-worker',
      },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    });
    if (!response.ok) throw new Error(`Transactional email provider rejected request (${response.status}).`);
  }
}
