import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

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
  private readonly http = inject(HttpClient);

  async query(spec: QuerySpec): Promise<DemoQueryResult> {
    const path = this.buildPath(spec);
    const prefer = this.preferFor(spec.mode, spec.waitSeconds);
    const headers = new HttpHeaders({
      Accept: 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    });

    try {
      const response = await firstValueFrom(
        this.http.get(path, { headers, observe: 'response', responseType: 'text' }),
      );
      return this.read(response, path, prefer, spec.payloadStyle);
    } catch (err: unknown) {
      if (this.isHttpError(err)) {
        return this.read(err, path, prefer, spec.payloadStyle);
      }
      return this.failed(
        `Could not reach the OData service. Start ODataLongQuery first. ${this.messageOf(err)}`,
      );
    }
  }

  async poll(jobId: string, payloadStyle: PayloadStyle): Promise<DemoQueryResult> {
    const path = `/async/${jobId}`;
    const accept = payloadStyle === 'http' ? 'application/http' : 'application/json';
    const headers = new HttpHeaders({
      Accept: accept,
      ...(payloadStyle === 'http' ? { 'OData-MaxVersion': '4.0' } : {}),
    });

    try {
      const response = await firstValueFrom(
        this.http.get(path, { headers, observe: 'response', responseType: 'text' }),
      );
      const result = this.read(response, path, null, payloadStyle);
      result.acceptHeader = accept;
      return result;
    } catch (err: unknown) {
      if (this.isHttpError(err)) {
        return this.read(err, path, null, payloadStyle);
      }
      return this.failed(this.messageOf(err));
    }
  }

  async cancel(jobId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/async/${jobId}`, { observe: 'response' }));
  }

  private buildPath(spec: QuerySpec): string {
    const parts: string[] = [];
    if (spec.filter.trim()) {
      parts.push('$filter=' + encodeURIComponent(spec.filter.trim()));
    }
    if (spec.orderBy.trim()) {
      parts.push('$orderby=' + encodeURIComponent(spec.orderBy.trim()));
    }
    if (spec.top && spec.top > 0) {
      parts.push('$top=' + spec.top);
    }
    return parts.length === 0 ? '/odata/Products' : '/odata/Products?' + parts.join('&');
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

  private read(
    response: HttpResponse<string>,
    requestUrl: string,
    prefer: string | null,
    payloadStyle: PayloadStyle,
  ): DemoQueryResult {
    const body = response.body ?? '';
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

    if (response.status === 202) {
      result.state = prefer ? 'accepted' : 'running';
      return result;
    }

    if (response.status === 404) {
      result.state = 'missing';
      result.error = 'The async job was not found, was canceled, or has expired.';
      return result;
    }

    if (response.status < 200 || response.status >= 300) {
      result.state = 'failed';
      result.error = body || response.statusText;
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
      const parsed = JSON.parse(body) as { value?: Product[] } | Product[];
      const rows = Array.isArray(parsed) ? parsed : parsed.value;
      if (!Array.isArray(rows)) {
        return [];
      }
      return rows.map((row) => ({
        id: Number(row.id ?? (row as unknown as { Id: number }).Id),
        name: String(row.name ?? (row as unknown as { Name: string }).Name ?? ''),
        category: String(row.category ?? (row as unknown as { Category: string }).Category ?? ''),
        price: Number(row.price ?? (row as unknown as { Price: number }).Price),
        unitsInStock: Number(row.unitsInStock ?? (row as unknown as { UnitsInStock: number }).UnitsInStock),
        discontinued: Boolean(row.discontinued ?? (row as unknown as { Discontinued: boolean }).Discontinued),
      }));
    } catch {
      return [];
    }
  }

  private jobIdFrom(location: string | null, body: string): string | null {
    if (location) {
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

  private header(response: HttpResponse<string>, name: string): string | null {
    return response.headers.get(name);
  }

  private intHeader(response: HttpResponse<string>, name: string): number | null {
    const value = response.headers.get(name);
    if (!value) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private isHttpError(err: unknown): err is HttpResponse<string> {
    return err instanceof HttpResponse;
  }

  private messageOf(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) {
      return String((err as { message: string }).message);
    }
    return String(err);
  }

  private failed(message: string): DemoQueryResult {
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
      requestUrl: '',
      preferHeader: null,
      acceptHeader: null,
      products: [],
    };
  }
}
