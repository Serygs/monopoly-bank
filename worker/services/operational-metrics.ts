export type OperationalComponent = 'api' | 'auth' | 'email' | 'websocket' | 'pwa' | 'cleanup';
export type OperationalOutcome = 'success' | 'failure' | 'unavailable' | 'rejected';

/**
 * Analytics Engine fields are intentionally low-cardinality operational values only.
 * Never add user/game IDs, email, nickname, avatar, tokens, amounts, or comments here.
 */
export interface OperationalMetrics {
  record(component: OperationalComponent, operation: string, outcome: OperationalOutcome, durationMs?: number, status?: number): void;
}

export class AnalyticsOperationalMetrics implements OperationalMetrics {
  private readonly dataset?: AnalyticsEngineDataset;
  constructor(dataset?: AnalyticsEngineDataset) { this.dataset = dataset; }
  record(component: OperationalComponent, operation: string, outcome: OperationalOutcome, durationMs = 0, status = 0): void {
    if (!this.dataset) return;
    try {
      this.dataset.writeDataPoint({ blobs: [component, operation, outcome], doubles: [1, durationMs, status], indexes: ['all'] });
    } catch {
      // Observability must never alter a banking, auth, or WebSocket outcome.
    }
  }
}

export class NoopOperationalMetrics implements OperationalMetrics {
  record(): void {}
}
