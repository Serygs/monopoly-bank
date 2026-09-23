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

import type { OperationalMetrics } from './operational-metrics.js';

/** A Worker-native Resend adapter. API credentials never leave Worker secrets. */
export class ResendTransactionalEmailProvider implements TransactionalEmailProvider {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly sendRequest: typeof fetch;
  private readonly metrics?: OperationalMetrics;
  constructor(
    apiKey: string,
    from: string,
    sendRequest: typeof fetch = fetch,
    metrics?: OperationalMetrics,
  ) {
    this.apiKey = apiKey;
    this.from = from;
    this.sendRequest = sendRequest;
    this.metrics = metrics;
  }

  async send(message: TransactionalEmail): Promise<void> {
    const startedAt = Date.now();
    let providerRejected = false;
    try {
      const response = await this.sendRequest('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': message.idempotencyKey,
          'user-agent': 'monopoly-bank-worker',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!response.ok) {
        providerRejected = true;
        this.metrics?.record(
          'email',
          'provider_send',
          'failure',
          Date.now() - startedAt,
          response.status,
        );
        throw new Error(`Transactional email provider rejected request (${response.status}).`);
      }
      this.metrics?.record(
        'email',
        'provider_send',
        'success',
        Date.now() - startedAt,
        response.status,
      );
    } catch (error) {
      if (!providerRejected)
        this.metrics?.record('email', 'provider_send', 'unavailable', Date.now() - startedAt);
      throw error;
    }
  }
}
