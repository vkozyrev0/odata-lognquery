import { Injectable } from '@angular/core';

export type CallMode = 'sync' | 'async' | 'wait';
export type PayloadStyle = 'unwrapped' | 'http';

export interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  unitsInStock: number;
  discontinued: boolean;
}

export interface QuerySpec {
  filter: string;
  orderBy: string;
  top: number | null;
  mode: CallMode;
  waitSeconds: number;
  payloadStyle: PayloadStyle;
}

export interface DemoQueryResult {
  state: 'idle' | 'accepted' | 'running' | 'completed' | 'failed' | 'missing';
  statusCode: number;
  asyncResult: number | null;
  jobId: string | null;
  monitorUrl: string | null;
  retryAfterSeconds: number | null;
  preferenceApplied: string | null;
  contentType: string | null;
  payloadStyle: PayloadStyle;
  innerStatusCode: number | null;
  innerContentType: string | null;
  rawBody: string;
  error: string | null;
  requestUrl: string;
  preferHeader: string | null;
  acceptHeader: string | null;
  products: Product[];
}

@Injectable({ providedIn: 'root' })
export class ODataService {
  /** Direct to Kestrel. Avoids Vite proxy keep-alive ECONNRESET on Node 18+. */
  readonly apiBase = 'http://127.0.0.1:5268';

  async query(spec: QuerySpec): Promise<DemoQueryResult> {
    const path = this.buildPath(spec);
    const url = this.apiBase + path;
    const prefer = this.preferFor(spec.mode, spec.waitSeconds);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (prefer) {
      headers['Prefer'] = prefer;
    }

    try {
      const response = await fetch(url, { method: 'GET', headers });
      return await this.read(response, path, prefer, spec.payloadStyle);
    } catch (err: unknown) {
      return this.failed(
        `Could not reach the OData service at ${this.apiBase}. Start it first:\n` +
          `dotnet run --project ODataLongQuery\n\n${this.messageOf(err)}`,
        path,
        prefer,
      );
    }
  }

  async poll(jobId: string, payloadStyle: PayloadStyle): Promise<DemoQueryResult> {
    const path = `/async/${jobId}`;
    const url = this.apiBase + path;
    const accept = payloadStyle === 'http' ? 'application/http' : 'application/json';
    const headers: Record<string, string> = { Accept: accept };
    if (payloadStyle === 'http') {
      headers['OData-MaxVersion'] = '4.0';
    }

    try {
      const response = await fetch(url, { method: 'GET', headers });
      const result = await this.read(response, path, null, payloadStyle);
      result.acceptHeader = accept;
      return result;
    } catch (err: unknown) {
      return this.failed(this.messageOf(err), path);
    }
  }

  async cancel(jobId: string): Promise<void> {
    const response = await fetch(this.apiBase + `/async/${jobId}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) {
      throw new Error(`Cancel failed (${response.status})`);
    }
  }

  private buildPath(spec: QuerySpec): string {
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
    return query ? `/odata/Products?${query}` : '/odata/Products';
  }

  private preferFor(mode: CallMode, waitSeconds: number): string | null {
    if (mode === 'async') {
      return 'respond-async';
    }
    if (mode === 'wait') {
      return `respond-async, wait=${Math.min(60, Math.max(0, waitSeconds))}`;
    }
    return null;
  }

  private async read(
    response: Response,
    requestUrl: string,
    prefer: string | null,
    payloadStyle: PayloadStyle,
  ): Promise<DemoQueryResult> {
    const body = await response.text();
    const result: DemoQueryResult = {
      state: 'idle',
      statusCode: response.status,
      asyncResult: this.intHeader(response, 'AsyncResult'),
      jobId: this.jobIdFrom(this.header(response, 'Location'), body),
      monitorUrl: this.header(response, 'Location'),
      retryAfterSeconds: this.intHeader(response, 'Retry-After'),
      preferenceApplied: this.header(response, 'Preference-Applied'),
      contentType: response.headers.get('Content-Type'),
      payloadStyle,
      innerStatusCode: null,
      innerContentType: null,
      rawBody: body,
      error: null,
      requestUrl,
      preferHeader: prefer,
      acceptHeader: null,
      products: [],
    };

    if (this.looksLikeHtml(body)) {
      result.state = 'failed';
      result.error =
        'The Angular dev server returned HTML instead of OData. The proxy is not reaching the service. ' +
        'Start ODataLongQuery on http://127.0.0.1:5268 and restart npm start.';
      return result;
    }

    if (response.status === 202) {
      result.state = prefer ? 'accepted' : 'running';
      if (!result.jobId) {
        result.error = '202 Accepted did not include a monitor job id in Location or the body.';
      }
      return result;
    }

    if (response.status === 404) {
      result.state = 'missing';
      result.error = 'The async job was not found, was canceled, or has expired.';
      return result;
    }

    if (response.status < 200 || response.status >= 300) {
      result.state = 'failed';
      result.error = this.errorFromBody(body) || `${response.status} ${response.statusText}`;
      return result;
    }

    result.state = 'completed';
    let payload = body;
    if (payloadStyle === 'http' || body.startsWith('HTTP/1.')) {
      const inner = this.parseHttpMessage(body);
      result.innerStatusCode = inner.statusCode;
      result.innerContentType = inner.contentType;
      payload = inner.body;
    }
    result.products = this.parseProducts(payload);
    return result;
  }

  private parseHttpMessage(message: string): {
    statusCode: number | null;
    contentType: string | null;
    body: string;
  } {
    let separator = message.indexOf('\r\n\r\n');
    let headerEnd = 4;
    if (separator < 0) {
      separator = message.indexOf('\n\n');
      headerEnd = 2;
    }
    if (separator < 0) {
      return { statusCode: null, contentType: null, body: message };
    }

    const headerBlock = message.slice(0, separator);
    const body = message.slice(separator + headerEnd);
    const lines = headerBlock.split(/\r?\n/).filter((line) => line.length > 0);
    const statusParts = lines[0]?.split(' ') ?? [];
    const statusCode = statusParts.length >= 2 ? Number(statusParts[1]) : null;
    const typeLine = lines.find((line) => line.toLowerCase().startsWith('content-type:'));
    const contentType = typeLine ? typeLine.slice('Content-Type:'.length).trim() : null;
    return { statusCode: Number.isFinite(statusCode) ? statusCode : null, contentType, body };
  }

  private parseProducts(body: string): Product[] {
    if (!body.trim()) {
      return [];
    }
    try {
      const parsed = JSON.parse(body) as Record<string, unknown> | unknown[];
      const rows = Array.isArray(parsed)
        ? parsed
        : ((parsed as { value?: unknown }).value as unknown);
      if (!Array.isArray(rows)) {
        return [];
      }
      return rows.map((item) => {
        const row = item as Record<string, unknown>;
        return {
          id: Number(row['id'] ?? row['Id']),
          name: String(row['name'] ?? row['Name'] ?? ''),
          category: String(row['category'] ?? row['Category'] ?? ''),
          price: Number(row['price'] ?? row['Price']),
          unitsInStock: Number(row['unitsInStock'] ?? row['UnitsInStock']),
          discontinued: Boolean(row['discontinued'] ?? row['Discontinued']),
        };
      });
    } catch {
      return [];
    }
  }

  private jobIdFrom(location: string | null, body: string): string | null {
    if (location) {
      const match = /async\/([0-9a-fA-F-]{36})/.exec(location);
      if (match) {
        return match[1];
      }
      const slash = location.lastIndexOf('/');
      if (slash >= 0 && slash < location.length - 1) {
        return location.slice(slash + 1);
      }
    }
    try {
      const parsed = JSON.parse(body) as { jobId?: string };
      return parsed.jobId ?? null;
    } catch {
      return null;
    }
  }

  private header(response: Response, name: string): string | null {
    return response.headers.get(name);
  }

  private intHeader(response: Response, name: string): number | null {
    const value = response.headers.get(name);
    if (!value) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private looksLikeHtml(body: string): boolean {
    const start = body.trimStart().slice(0, 32).toLowerCase();
    return start.startsWith('<!doctype') || start.startsWith('<html');
  }

  private errorFromBody(body: string): string | null {
    if (!body.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
      return parsed.error?.message ?? parsed.message ?? body;
    } catch {
      return body;
    }
  }

  private messageOf(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) {
      return String((err as { message: string }).message);
    }
    return String(err);
  }

  private failed(message: string, requestUrl = '', prefer: string | null = null): DemoQueryResult {
    return {
      state: 'failed',
      statusCode: 0,
      asyncResult: null,
      jobId: null,
      monitorUrl: null,
      retryAfterSeconds: null,
      preferenceApplied: null,
      contentType: null,
      payloadStyle: 'unwrapped',
      innerStatusCode: null,
      innerContentType: null,
      rawBody: '',
      error: message,
      requestUrl,
      preferHeader: prefer,
      acceptHeader: null,
      products: [],
    };
  }
}
