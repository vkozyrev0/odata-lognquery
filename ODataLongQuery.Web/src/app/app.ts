import { Component, inject, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import {
  ClientSideRowModelModule,
  ColDef,
  ColumnAutoSizeModule,
  GetRowIdParams,
  ModuleRegistry,
  NumberFilterModule,
  PaginationModule,
  TextFilterModule,
  themeQuartz,
} from 'ag-grid-community';
import {
  CallMode,
  DemoQueryResult,
  ODataService,
  PayloadStyle,
  Product,
} from './odata.service';

export interface ActionLogEntry {
  id: number;
  timestamp: string;
  url: string;
  description: string;
}

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  ColumnAutoSizeModule,
  NumberFilterModule,
  PaginationModule,
  TextFilterModule,
]);

@Component({
  selector: 'app-root',
  imports: [AgGridAngular],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly odata = inject(ODataService);

  protected readonly gridTheme = themeQuartz.withParams({
    fontSize: '8pt',
    headerFontSize: '8pt',
    rowHeight: 20,
    headerHeight: 22,
    cellHorizontalPadding: 4,
    spacing: 2,
  });
  protected readonly defaultColDef: ColDef<Product> = {
    sortable: true,
    filter: true,
    resizable: true,
    flex: 1,
    minWidth: 56,
  };
  protected readonly actionDefaultColDef: ColDef<ActionLogEntry> = {
    sortable: true,
    filter: true,
    resizable: true,
    flex: 1,
    minWidth: 48,
  };
  protected readonly actionColumnDefs: ColDef<ActionLogEntry>[] = [
    { field: 'timestamp', headerName: 'Timestamp', maxWidth: 140, flex: 0 },
    { field: 'url', headerName: 'URL', flex: 1.4 },
    { field: 'description', headerName: 'Description', flex: 1.6 },
  ];

  protected readonly columnDefs: ColDef<Product>[] = [
    { field: 'id', headerName: 'Id', maxWidth: 56, flex: 0 },
    { field: 'name', headerName: 'Name' },
    { field: 'category', headerName: 'Category' },
    {
      field: 'price',
      headerName: 'Price',
      valueFormatter: (params) =>
        typeof params.value === 'number' ? params.value.toFixed(2) : '',
    },
    { field: 'unitsInStock', headerName: 'Stock' },
    {
      field: 'discontinued',
      headerName: 'Discontinued',
      valueFormatter: (params) => (params.value ? 'yes' : 'no'),
    },
  ];

  protected readonly filter = signal("Price lt 50");
  protected readonly orderBy = signal('Price desc');
  protected readonly top = signal<number | null>(10);
  protected readonly mode = signal<CallMode>('async');
  protected readonly waitSeconds = signal(10);
  protected readonly payloadStyle = signal<PayloadStyle>('unwrapped');
  protected readonly result = signal<DemoQueryResult | null>(null);
  protected readonly actions = signal<ActionLogEntry[]>([]);
  protected readonly busy = signal(false);
  protected readonly polling = signal(false);

  private pollGeneration = 0;
  private nextActionId = 1;

  protected getActionRowId = (params: GetRowIdParams<ActionLogEntry>): string =>
    String(params.data?.id ?? '');

  protected setTop(value: string): void {
    this.top.set(value === '' ? null : Number(value));
  }

  protected setWaitSeconds(value: string): void {
    this.waitSeconds.set(Number(value));
  }

  protected clearActions(): void {
    this.actions.set([]);
  }

  protected async run(): Promise<void> {
    this.pollGeneration += 1;
    this.busy.set(true);
    this.polling.set(false);
    this.clearActions();
    this.result.set(null);

    const spec = {
      filter: this.filter(),
      orderBy: this.orderBy(),
      top: this.top(),
      mode: this.mode(),
      waitSeconds: this.waitSeconds(),
      payloadStyle: this.payloadStyle(),
    };

    try {
      const requestUrl = this.urlForQuery(spec);
      this.logAction(requestUrl, this.describeOutgoingQuery(spec));

      const first = await this.odata.query(spec);
      this.result.set(first);
      this.logAction(this.urlForResult(first, requestUrl), this.describeResult(first, 'query'));

      if (first.jobId && (first.state === 'accepted' || first.state === 'running')) {
        await this.pollUntilDone(first.jobId, this.payloadStyle());
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logAction('', `Client error: ${message}`);
      this.result.set({
        state: 'failed',
        statusCode: 0,
        asyncResult: null,
        jobId: null,
        monitorUrl: null,
        retryAfterSeconds: null,
        preferenceApplied: null,
        contentType: null,
        payloadStyle: this.payloadStyle(),
        innerStatusCode: null,
        innerContentType: null,
        rawBody: '',
        error: message,
        requestUrl: '',
        preferHeader: null,
        acceptHeader: null,
        products: [],
      });
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

    const url = `${this.odata.apiBase}/async/${jobId}`;
    this.pollGeneration += 1;
    this.polling.set(false);
    this.logAction(url, 'DELETE — cancel the running job');
    try {
      await this.odata.cancel(jobId);
      this.logAction(url, '204 — job canceled');
    } catch (err: unknown) {
      this.logAction(url, `Cancel failed: ${err instanceof Error ? err.message : String(err)}`);
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
    const url = `${this.odata.apiBase}/async/${jobId}`;

    while (generation === this.pollGeneration) {
      this.logAction(url, 'GET status monitor — is the query finished yet?');
      const next = await this.odata.poll(jobId, style);
      if (generation !== this.pollGeneration) {
        return;
      }
      this.result.set({ ...next, jobId: next.jobId ?? jobId });
      this.logAction(url, this.describeResult(next, 'poll'));

      if (next.state === 'completed' || next.state === 'failed' || next.state === 'missing') {
        this.polling.set(false);
        return;
      }

      const wait = next.retryAfterSeconds ?? 2;
      this.logAction(url, `Wait ${wait}s (Retry-After), then poll again`);
      await this.sleep(wait * 1000);
    }
  }

  private urlForQuery(spec: Parameters<ODataService['query']>[0]): string {
    const params = new URLSearchParams();
    if (spec.filter.trim()) {
      params.set('$filter', spec.filter.trim());
    }
    if (spec.orderBy.trim()) {
      params.set('$orderby', spec.orderBy.trim());
    }
    if (spec.top && spec.top > 0) {
      params.set('$top', String(spec.top));
    }
    const query = params.toString().replace(/%24/g, '$');
    return query ? `${this.odata.apiBase}/odata/Products?${query}` : `${this.odata.apiBase}/odata/Products`;
  }

  private urlForResult(result: DemoQueryResult, fallback: string): string {
    if (result.monitorUrl) {
      return result.monitorUrl.startsWith('http')
        ? result.monitorUrl
        : this.odata.apiBase + result.monitorUrl;
    }
    if (result.requestUrl) {
      return result.requestUrl.startsWith('http')
        ? result.requestUrl
        : this.odata.apiBase + result.requestUrl;
    }
    return fallback;
  }

  private describeOutgoingQuery(spec: Parameters<ODataService['query']>[0]): string {
    if (spec.mode === 'async') {
      return 'GET Products with Prefer: respond-async (ask for HTTP 202)';
    }
    if (spec.mode === 'wait') {
      return `GET Products with Prefer: respond-async, wait=${spec.waitSeconds}`;
    }
    return 'GET Products synchronously (no Prefer: respond-async)';
  }

  private describeResult(result: DemoQueryResult, kind: 'query' | 'poll'): string {
    if (result.state === 'accepted') {
      return `202 Accepted — job ${result.jobId ?? '?'} started; poll Location`;
    }
    if (result.state === 'running') {
      return `202 Accepted — still running${result.retryAfterSeconds ? `; Retry-After ${result.retryAfterSeconds}s` : ''}`;
    }
    if (result.state === 'completed') {
      const count = result.products.length;
      const async = result.asyncResult != null ? `; AsyncResult ${result.asyncResult}` : '';
      return `${result.statusCode} OK — ${kind === 'poll' ? 'monitor returned' : 'query returned'} ${count} product(s)${async}`;
    }
    if (result.state === 'missing') {
      return `${result.statusCode} — job not found, canceled, or expired`;
    }
    return `${result.statusCode || 'error'} — ${result.error ?? result.state}`;
  }

  private logAction(url: string, description: string): void {
    const entry: ActionLogEntry = {
      id: this.nextActionId++,
      timestamp: new Date().toISOString().replace('T', ' ').replace('Z', ' UTC'),
      url,
      description,
    };
    this.actions.update((rows) => [...rows, entry]);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
