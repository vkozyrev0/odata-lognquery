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
  DemoConfig,
  DemoQueryResult,
  ODataService,
  PayloadStyle,
  Product,
  QuerySpec,
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

  protected readonly filter = signal('');
  protected readonly orderBy = signal('Id');
  protected readonly top = signal<number | null>(null);
  protected readonly followPages = signal(true);
  protected readonly mode = signal<CallMode>('async');
  protected readonly waitSeconds = signal(2);
  protected readonly waitDelaySeconds = signal(4);
  protected readonly payloadStyle = signal<PayloadStyle>('unwrapped');
  protected readonly result = signal<DemoQueryResult | null>(null);
  protected readonly actions = signal<ActionLogEntry[]>([]);
  protected readonly busy = signal(false);
  protected readonly polling = signal(false);
  protected readonly demoConfig = signal<DemoConfig | null>(null);
  protected readonly pagesLoaded = signal(0);
  protected readonly rowsLoaded = signal(0);

  private pollGeneration = 0;
  private nextActionId = 1;
  private readonly maxPages = 100;

  constructor() {
    void this.loadConfig();
  }

  protected getActionRowId = (params: GetRowIdParams<ActionLogEntry>): string =>
    String(params.data?.id ?? '');

  protected setTop(value: string): void {
    this.top.set(value === '' ? null : Number(value));
  }

  protected setWaitSeconds(value: string): void {
    this.waitSeconds.set(Number(value));
  }

  protected setWaitDelaySeconds(value: string): void {
    const parsed = Number(value);
    this.waitDelaySeconds.set(Number.isFinite(parsed) ? parsed : 0);
  }

  protected pagingSummary(): string {
    const rows = this.rowsLoaded();
    const pages = this.pagesLoaded();
    const total = this.result()?.odataCount ?? this.demoConfig()?.datasetSize;
    if (pages === 0) {
      return 'No pages loaded yet.';
    }
    const totalPart = total != null ? ` / ${total}` : '';
    const follow = this.followPages() ? '' : ' (first page only)';
    return `${rows}${totalPart} rows from ${pages} server page(s)${follow}`;
  }

  protected clearActions(): void {
    this.actions.set([]);
  }

  protected async run(): Promise<void> {
    const generation = ++this.pollGeneration;
    this.busy.set(true);
    this.polling.set(false);
    this.clearActions();
    this.result.set(null);
    this.pagesLoaded.set(0);
    this.rowsLoaded.set(0);

    const spec: QuerySpec = {
      filter: this.filter(),
      orderBy: this.orderBy(),
      top: this.top(),
      mode: this.mode(),
      waitSeconds: this.waitSeconds(),
      waitDelaySeconds: this.waitDelaySeconds(),
      payloadStyle: this.payloadStyle(),
    };

    try {
      const products: Product[] = [];
      let url: string | null = this.odata.buildQueryUrl(spec);
      let waitSeconds = spec.waitSeconds;
      let pageIndex = 0;
      let odataCount: number | null = null;
      let last: DemoQueryResult | null = null;

      while (url && pageIndex < this.maxPages) {
        if (generation !== this.pollGeneration) {
          return;
        }

        pageIndex += 1;
        this.logAction(url, this.describeOutgoingPage(spec, pageIndex, waitSeconds));

        let page = await this.odata.queryUrl(url, { ...spec, waitSeconds });
        if (generation !== this.pollGeneration) {
          return;
        }

        this.logAction(this.urlForResult(page, url), this.describeResult(page, 'query'));

        if (page.jobId && (page.state === 'accepted' || page.state === 'running')) {
          page = await this.pollUntilDone(page.jobId, spec.payloadStyle, generation);
          if (generation !== this.pollGeneration) {
            return;
          }
        }

        if (page.state !== 'completed') {
          this.result.set({ ...page, products: [...products], odataCount: page.odataCount ?? odataCount });
          return;
        }

        products.push(...page.products);
        if (page.odataCount != null) {
          odataCount = page.odataCount;
        }
        last = {
          ...page,
          products: [...products],
          odataCount,
        };
        this.pagesLoaded.set(pageIndex);
        this.rowsLoaded.set(products.length);
        this.result.set(last);
        this.logAction(
          url,
          `Page ${pageIndex}: +${page.products.length} row(s); ${products.length}${
            odataCount != null ? ` / ${odataCount}` : ''
          } loaded${page.nextLink ? '; @odata.nextLink present' : '; last page'}`,
        );

        url = this.followPages() ? this.odata.toAbsolute(page.nextLink) : null;
        if (spec.mode === 'wait') {
          waitSeconds = Math.min(spec.waitSeconds, 5);
        }
      }

      if (pageIndex >= this.maxPages && last?.nextLink) {
        this.logAction(last.nextLink, `Stopped after ${this.maxPages} pages (safety cap)`);
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
        nextLink: null,
        odataCount: null,
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

  private async loadConfig(): Promise<void> {
    try {
      const cfg = await this.odata.config();
      this.demoConfig.set(cfg);
      if (typeof cfg.waitQueryDelayMilliseconds === 'number') {
        this.waitDelaySeconds.set(cfg.waitQueryDelayMilliseconds / 1000);
      }
    } catch {
      this.demoConfig.set(null);
    }
  }

  private async pollUntilDone(
    jobId: string,
    style: PayloadStyle,
    generation: number,
  ): Promise<DemoQueryResult> {
    this.polling.set(true);
    const url = `${this.odata.apiBase}/async/${jobId}`;
    let latest: DemoQueryResult | null = null;

    while (generation === this.pollGeneration) {
      this.logAction(url, 'GET status monitor — is the query finished yet?');
      const next = await this.odata.poll(jobId, style);
      if (generation !== this.pollGeneration) {
        this.polling.set(false);
        return next;
      }
      latest = { ...next, jobId: next.jobId ?? jobId };
      this.result.update((current) =>
        current
          ? { ...latest!, products: current.products, odataCount: latest!.odataCount ?? current.odataCount }
          : latest,
      );
      this.logAction(url, this.describeResult(next, 'poll'));

      if (next.state === 'completed' || next.state === 'failed' || next.state === 'missing') {
        this.polling.set(false);
        return latest;
      }

      const wait = next.retryAfterSeconds ?? 2;
      this.logAction(url, `Wait ${wait}s (Retry-After), then poll again`);
      await this.sleep(wait * 1000);
    }

    this.polling.set(false);
    return (
      latest ?? {
        state: 'missing',
        statusCode: 0,
        asyncResult: null,
        jobId,
        monitorUrl: url,
        retryAfterSeconds: null,
        preferenceApplied: null,
        contentType: null,
        payloadStyle: style,
        innerStatusCode: null,
        innerContentType: null,
        rawBody: '',
        error: 'Polling canceled.',
        requestUrl: url,
        preferHeader: null,
        acceptHeader: null,
        products: [],
        nextLink: null,
        odataCount: null,
      }
    );
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

  private describeOutgoingPage(spec: QuerySpec, pageIndex: number, waitSeconds: number): string {
    const which = pageIndex === 1 ? 'page 1' : `nextLink page ${pageIndex}`;
    if (spec.mode === 'async') {
      return `GET ${which} with Prefer: respond-async (ask for HTTP 202)`;
    }
    if (spec.mode === 'wait') {
      return `GET ${which} with Prefer: respond-async, wait=${waitSeconds}; page delay ${spec.waitDelaySeconds}s`;
    }
    return `GET ${which} synchronously (no Prefer: respond-async)`;
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
      const next = result.nextLink ? '; @odata.nextLink follows' : '';
      return `${result.statusCode} OK — ${kind === 'poll' ? 'monitor returned' : 'query returned'} ${count} product(s)${async}${next}`;
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
