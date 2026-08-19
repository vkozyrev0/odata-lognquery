# Query scenarios: sync, async, and async with wait

The Angular demo and this sample service support three ways to run an OData query. They differ in how long the **original HTTP request** stays open, not in which rows `$filter` / `$orderby` / `$top` return.

This note describes each scenario, its trade-offs, and what changes when the service uses **OData paging** over a very large set.

The matching Power Query (M) scripts live in [`excel/`](../excel/).

## Shared background

| Piece | Role |
| --- | --- |
| Original request | `GET /odata/Products?...` |
| `Prefer: respond-async` | Client asks the service to return **202 Accepted** instead of blocking |
| `wait=N` | Client is willing to wait up to N seconds on that first request |
| Status monitor | `GET /async/{jobId}` until **200** + `AsyncResult` |
| Cancel | `DELETE /async/{jobId}` |
| Server-driven page | Response includes `@odata.nextLink` (or `$skiptoken`) for the next page |
| Client-driven page | Client sends `$top` and `$skip` / `$skiptoken` |

OData paging does **not** replace 202. Paging splits a **result** into pages. 202 splits **wait time** off the original connection. A large query can need both: a long-running first page, then many following pages.

### This sample (5000 rows, page size 500)

`ODataLongQuery/appsettings.json` → `DemoData`:

| Setting | Default | Role |
| --- | --- | --- |
| `DatasetSize` | 5000 | In-memory `Products` catalog |
| `PageSize` | 500 | Server-driven page; first response includes `@odata.nextLink` until the last page |
| `QueryDelayMilliseconds` | 300 | Delay **per page** for sync and for `respond-async` without wait |
| `WaitQueryDelayMilliseconds` | 4000 | Default delay **per page** when Prefer includes `wait=N`, if the client does not send `X-Demo-Wait-Delay-Milliseconds` |

The Angular client and the three Power Query scripts use the **same page-following algorithm**:

1. First GET is `/odata/Products?$count=true&$orderby=Id` (no `$top`, so the full set is in play).
2. Read `value` and `@odata.nextLink`.
3. If `nextLink` is present, GET that URL with the **same scenario headers** as page 1.
   - Sync: no `Prefer`.
   - Async: `Prefer: respond-async` (a **new job per page**), then poll `Location`.
   - Async with wait: `Prefer: respond-async, wait=N` on page 1; later pages use `wait=min(N, 5)`. Each of those pages sleeps the client’s wait-mode delay (`X-Demo-Wait-Delay-Milliseconds`, default 4000). If that delay is greater than N seconds the page returns **202**; otherwise **200**.
4. Concatenate `value` until there is no `nextLink` (10 pages × 500 = 5000 rows in the default catalog).

Treat `@odata.nextLink` as an opaque URL. Do not rebuild `$skip` yourself unless the service documents conventional paging (this demo happens to use `$skip`).

In Power Query, `OData.Feed` follows `@odata.nextLink` automatically, but only for ordinary synchronous 200 responses. The sample `Products_Sync.pq` still spells the loop out so it matches the web app. A 202 monitor payload is a custom HTTP conversation; you must follow `nextLink` yourself.

---

## 1. Synchronous

**Demo control:** “Synchronous — wait on this request.”

**Headers:** none of `respond-async` / `wait`.

**Sequence:**

1. Client `GET /odata/Products?...`
2. Service runs the query (this sample sleeps `QueryDelayMilliseconds` per page to simulate work).
3. Service returns **200 OK** and the page of entities on the same connection.

Power Query: native `OData.Feed` / “Get data → From OData feed”. Excel keeps the connection open until the response finishes.

### Pros

- Simplest client. Native Power Query `OData.Feed` can follow `nextLink`; this sample’s M spells the loop out to match Angular.
- One round trip per page; no job id, no poll loop, no `AsyncResult`.
- Easy to reason about errors: the HTTP status is the query status.
- Best when the page is cheap (indexed `$filter`, small `$top`, warm cache).

### Cons

- The TCP/HTTP request is held for the whole query. Gateways, load balancers, and Excel/Power BI can time out (often 100s–10 min).
- The UI (or refresh) is blocked; there is no job to cancel with `DELETE`.
- A timeout on **page 1** wastes work and yields nothing; a timeout on **page N** of a large pull can fail the entire refresh after N−1 pages already loaded.
- Connection slots on the service stay occupied by idle-waiting clients.

### Large data + paging

`OData.Feed` will request page 1, then `@odata.nextLink`, then the next, until the table is complete (or `$top` is satisfied). Each page is a **separate synchronous** GET.

- If **assembling** a page is slow (heavy `$filter` / `$expand` / scan), every page can sit on the timeout budget.
- If pages are fast but there are **tens of thousands**, total refresh time is `pageCount × (latency + transfer)`. Excel still materializes the full table in memory unless you filter early.
- Server-driven `Prefer: odata.maxpagesize` keeps payloads bounded, but does not shorten server compute for the first page.
- Client-driven `$top=5000&$skip=…` lets Power Query or the user stop early, but skip-deep on huge sets is often expensive on the server.

**Use sync when:** each page reliably finishes well inside the shortest timeout in the path, and you are happy to block the refresh.

---

## 2. Asynchronous (`Prefer: respond-async`)

**Demo control:** “Async — Prefer: respond-async, then poll.”

**Headers:** `Prefer: respond-async`.

**Sequence:**

1. Client `GET /odata/Products?...` with `Prefer: respond-async`.
2. Service immediately returns **202 Accepted**, `Location: /async/{jobId}`, `Retry-After`, `Preference-Applied: respond-async`.
3. Query keeps running in the background.
4. Client polls `Location`:
   - still running → **202**
   - done → **200** with `AsyncResult` and the first result page
5. Optional: `DELETE` on the monitor to cancel.

Power Query has **no** built-in 202 client. The workbook uses `Web.Contents` + `ManualStatusHandling` + `Function.InvokeAfter` to poll.

### Pros

- Original request returns in milliseconds. Proxies and Excel are much less likely to drop it.
- The client can keep polling (or stop). Cancel maps cleanly to `DELETE /async/{id}`.
- The service can shed waiting connections and bound work with job TTL.
- Fits “fire a heavy report, come back later” better than a held GET.

### Cons

- More moving parts: job store, monitor URL, `Retry-After`, `AsyncResult`, payload wrap (4.01 JSON vs 4.0 `application/http`).
- Power Query polling is awkward: `Function.InvokeAfter` blocks that query, recursion/attempt caps apply, and the PQ UI still waits for the function to finish.
- Jobs in this sample are in-memory; a process recycle loses the monitor (**410/404**).
- Chatty: many GETs to `/async/{id}` if the query is long and `Retry-After` is small.
- Error handling splits across 202-on-monitor vs `AsyncResult: 4xx/5xx` on the completed envelope.

### Large data + paging

202 only covers **one HTTP resource** — typically the **first page** of the query.

After the monitor returns 200, the body may still contain `@odata.nextLink`. Each following page is a **new** data-service request:

- If you GET `nextLink` **without** `respond-async`, you are back to scenario 1 for pages 2…N (timeout risk returns).
- If you GET each `nextLink` **with** `respond-async`, you start a **new job per page**. That is correct but operationally heavy: job fan-out, TTL vs poll interval, and Power Query must loop “202 → poll → page → nextLink”.
- `nextLink` must be treated as an opaque URL (auth, host, `$skiptoken`). Do not rebuild skip/top by hand unless the service documents conventional paging.
- Loading **all** pages into one Power Query table still means **full materialization**. 202 does not stream rows into Excel while later pages run.
- Prefer combining 202 on the **expensive** first page (scan/filter) with **sync** on cheap `nextLink` pages (seek by token), if the service’s later pages are cheap.

**Use async when:** the first page (or the whole unpaged query) can exceed timeouts, and you can poll (browser, job runner). Treat each later page as its own decision: sync vs async.

---

## 3. Asynchronous with wait (`Prefer: respond-async, wait=N`)

**Demo control:** “Async with wait — hold up to N seconds, then 202 if still running.”

**Headers:** `Prefer: respond-async, wait=N` plus `X-Demo-Wait-Delay-Milliseconds` (the Angular **wait seconds** and **wait-mode page delay (seconds)** boxes). Defaults are wait 2s and delay 4s, so the first request returns 202. Raise wait or lower the delay to get 200 instead.

**Sequence:**

1. Client `GET /odata/Products?...` with both preferences.
2. Service starts the job and **holds that request** up to N seconds.
3. If the query finishes in time → **200** on the original connection (as if sync).
4. If not → **202** + `Location`, and the client polls as in scenario 2.

Power Query: same custom `Web.Contents` path; if the first response is already 200, skip the poll loop.

### Pros

- One round trip when the page is fast enough (common case for warm, selective queries).
- Automatic fallback to 202 when the page is slow — without a second client mode.
- Fewer monitor polls than pure async when N is close to typical runtime.
- Cancel still exists if the service returns 202.
- Good default for mixed workloads: most pages sync-shaped, outliers go async.

### Cons

- The first request **can still be held for N seconds**. If N is 60 and the gateway times out at 30, you have not solved timeouts.
- You must pick N from the **shortest** timeout in the path (browser, Excel, reverse proxy, API gateway), minus a safety margin.
- Slightly more server logic (wait + race with job completion).
- Power Query still needs custom M; `OData.Feed` will not send `wait`.
- If N is too small, you always get 202 (pure async with extra delay). If N is too large, you recreate sync timeouts.

### Large data + paging

Wait is per request, so per **page**.

- **Page 1** often pays the query compile/scan cost. A larger wait (e.g. 20–60s) is reasonable if that is still under the gateway limit.
- **Pages 2…N** via `nextLink` are often cheaper. A **small wait** (or plain sync) on those pages avoids job spam.
- Do not use the same wait blindly on every page without measuring. A 60s wait × 500 pages is a multi-hour refresh even when each page would have returned in 200ms.
- In Power Query, a parameter `WaitSeconds` on a shared getter lets you use 30 for the first URL and 5 for `nextLink`.

**Use wait when:** you want one client implementation, most pages finish quickly, and you know a safe N below every timeout.

---

## How the three interact with paging (summary)

```
GET Products?$filter=…          ← may be sync, async, or async+wait
        │
        ▼
   200 page + nextLink?         ← first page (or 202 then 200 on the monitor)
        │
        ├─ no nextLink → done
        │
        └─ GET nextLink         ← independent choice: sync / async / wait
                │
                └─ … until no nextLink
```

| Concern | Sync | Async | Async + wait |
| --- | --- | --- | --- |
| First-page timeout | High if the scan is slow | Low on the original GET | Medium: up to N seconds |
| Later pages (`nextLink`) | Same as first (blocking) | New job per page if you keep Prefer | Tune N down for cheap pages |
| Power Query connector | `OData.Feed` follows pages | Custom M; you follow `nextLink` | Custom M; skip poll if 200 |
| Excel/Power BI refresh | One long (or many sequential) waits | Refresh waits on poll loop anyway | Fewer polls; still one refresh |
| Memory | Full assembled table | Same once pages are concatenated | Same |
| Cancel | Not in the protocol | `DELETE` monitor (that job/page only) | `DELETE` only if 202 was returned |
| Operational load | Held connections | Jobs + poll QPS | Mix; usually lowest chatter |

Practical pattern for a **very large** OData set in Excel:

1. Push predicates into `$filter` / `$select` so the service never ships unused columns or rows.
2. Prefer server-driven pages (`maxpagesize`) over giant unpaged payloads.
3. Use **async+wait** on the **first** URL if that URL can be slow.
4. Follow `nextLink` **synchronously** (or with a small wait) if continuation is a cheap seek.
5. If continuation is also a heavy query, use async per page and persist jobs (this sample’s in-memory store is not enough).
6. Do not expect 202 to stream millions of rows into the worksheet; cap with `$top` or a date window, then incrementally refresh.

---

## Completed-monitor payload

The three radios above choose how the **first** (and each `nextLink`) request is started. A second pair of radios — **Completed-monitor payload** — chooses how the **finished** status monitor is serialized.

That choice applies only to `GET /async/{jobId}` after the service returned **202**. It does **not** apply when:

- the query is **synchronous** (no monitor), or
- **async with wait** already returned **200** on the original connection.

In those cases the body is always the Products JSON (`value`, `@odata.count`, `@odata.nextLink`).

Both completed-monitor styles use outer **HTTP 200** on the monitor URL (the monitor resource was found and the job is done). The **original query status** is carried separately, in the `AsyncResult` header. If the query failed, you still see monitor `200` with `AsyncResult: 400` (or 500), not an outer 4xx/5xx.

### OData 4.01 unwrapped (default in the demo)

**UI radio:** “OData 4.01 unwrapped — JSON body + AsyncResult header.”

**Poll headers:** `Accept: application/json`.

**Completed response:**

```http
HTTP/1.1 200 OK
AsyncResult: 200
Content-Type: application/json
OData-Version: 4.0

{
  "@odata.context": "http://127.0.0.1:5268/odata/$metadata#Products",
  "@odata.count": 5000,
  "value": [ { "id": 1, "name": "Chai", ... } ],
  "@odata.nextLink": "http://127.0.0.1:5268/odata/Products?$count=true&$orderby=Id&$skip=500"
}
```

The body **is** the original OData payload. `fetch` / a browser can `JSON.parse` it. The protocol trace shows `AsyncResult`; **Inner status** stays empty because there is no inner HTTP envelope.

**Use this when:** you control the client (this Angular app, a modern library, curl + `jq`). It is the 4.01 simplification and the default here.

### OData 4.0 wrapped (`application/http`)

**UI radio:** “OData 4.0 wrapped — Accept: application/http HTTP message.”

**Poll headers:** `Accept: application/http` and, in this demo, `OData-MaxVersion: 4.0`.

**Completed response:**

```http
HTTP/1.1 200 OK
AsyncResult: 200
Content-Type: application/http

HTTP/1.1 200 OK
Content-Type: application/json
OData-Version: 4.0
Content-Length: 1234

{ "@odata.context": "...", "value": [ ... ], "@odata.nextLink": "..." }
```

The monitor body is a **serialized HTTP message**: status line, inner headers, blank line, then the JSON. The client must split headers from body (this app does that when the radio is set to wrapped). The protocol trace fills **Inner status** and **Inner content-type** from that envelope.

**Use this when:** you are matching an OData **4.0** client that expected the original response to be recoverable as a full HTTP message (status, headers, and payload together). Older generators and some gateways still speak this shape.

### Comparing the two

| | 4.01 unwrapped | 4.0 wrapped |
| --- | --- | --- |
| Poll `Accept` | `application/json` | `application/http` |
| Outer monitor status | 200 | 200 |
| Original query status | `AsyncResult` header only | `AsyncResult` **and** inner status line |
| Body | Products JSON | `HTTP/1.1 …` message whose body is Products JSON |
| Parse cost | `JSON.parse` | Split HTTP message, then `JSON.parse` |
| `nextLink` | Same JSON field | Same field, inside the inner body |
| Power Query in this sample | Yes (`Accept: application/json`) | Not used; M would have to unwrap `application/http` |

The Actions grid still records the same poll URLs either way. Switch the radio and run **Async** (not Sync) so a monitor GET actually happens; then compare `Content-Type`, `AsyncResult`, and Inner status on the protocol trace.

---

## Mapping to the demo UI

| UI radio | Protocol | Typical first response |
| --- | --- | --- |
| Synchronous | No `Prefer` | 200 after the demo delay |
| Async | `Prefer: respond-async` | 202 immediately |
| Async with wait | `Prefer: respond-async, wait=N` | 200 if done within N s, else 202 |

| Completed-monitor payload | Poll `Accept` | Body when the job is done |
| --- | --- | --- |
| OData 4.01 unwrapped | `application/json` | Products JSON; original status in `AsyncResult` |
| OData 4.0 wrapped | `application/http` | HTTP message wrapping that JSON; parse inner status / headers / body |

The Actions grid in the Angular app is the right place to watch these headers, the poll loop, and each `nextLink` GET. Leave `$top` empty and “follow pages” on to pull all 5000 rows. The Excel file in `excel/` uses the same three modes and the same nextLink loop (always the unwrapped JSON monitor).
