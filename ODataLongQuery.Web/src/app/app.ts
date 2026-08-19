import { Component, inject, signal } from '@angular/core';
import {
  CallMode,
  DemoQueryResult,
  ODataService,
  PayloadStyle,
} from './odata.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly odata = inject(ODataService);

  protected readonly filter = signal("Price lt 50");
  protected readonly orderBy = signal('Price desc');
  protected readonly top = signal<number | null>(10);
  protected readonly mode = signal<CallMode>('async');
  protected readonly waitSeconds = signal(10);
  protected readonly payloadStyle = signal<PayloadStyle>('unwrapped');
  protected readonly result = signal<DemoQueryResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly polling = signal(false);

  private pollGeneration = 0;

  protected async run(): Promise<void> {
    this.pollGeneration += 1;
    this.busy.set(true);
    this.polling.set(false);

    try {
      const first = await this.odata.query({
        filter: this.filter(),
        orderBy: this.orderBy(),
        top: this.top(),
        mode: this.mode(),
        waitSeconds: this.waitSeconds(),
        payloadStyle: this.payloadStyle(),
      });
      this.result.set(first);

      if (first.jobId && (first.state === 'accepted' || first.state === 'running')) {
        await this.pollUntilDone(first.jobId, this.payloadStyle());
      }
    } finally {
      this.busy.set(false);
      this.polling.set(false);
    }
  }

  protected async cancel(): Promise<void> {
    const jobId = this.result()?.jobId;
    if (!jobId) {
      return;
    }

    this.pollGeneration += 1;
    this.polling.set(false);
    try {
      await this.odata.cancel(jobId);
    } catch {
      // already gone
    }
    this.result.update((current) =>
      current
        ? {
            ...current,
            state: 'missing',
            statusCode: 404,
            error: 'Canceled.',
          }
        : current,
    );
  }

  private async pollUntilDone(jobId: string, style: PayloadStyle): Promise<void> {
    const generation = this.pollGeneration;
    this.polling.set(true);

    while (generation === this.pollGeneration) {
      const next = await this.odata.poll(jobId, style);
      if (generation !== this.pollGeneration) {
        return;
      }
      this.result.set({ ...next, jobId: next.jobId ?? jobId });

      if (next.state === 'completed' || next.state === 'failed' || next.state === 'missing') {
        this.polling.set(false);
        return;
      }

      await this.sleep((next.retryAfterSeconds ?? 2) * 1000);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
