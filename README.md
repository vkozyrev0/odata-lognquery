# OData long-running queries (HTTP 202)

A .NET 10 teaching sample for [OData asynchronous requests](https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html#sec_AsynchronousRequests).

The service accepts a normal OData query with `Prefer: respond-async`, returns **202 Accepted** plus a status-monitor URL, and lets the client poll (or cancel) until the result is ready. An Angular 22 site acts as the browser client so you can watch the handshake without writing curl.

This is a demo, not a production job runner. Jobs are in-memory. Product queries include a short artificial delay so 202 stays on screen long enough to see.

Why the sample exists: [docs/purpose.md](docs/purpose.md).

## What's in the repo

| Path | Role |
| --- | --- |
| `ODataLongQuery/` | OData v4 service (`Products`, 202 middleware, `/async/{jobId}` monitor) |
| `ODataLongQuery.Web/` | Angular 22 client (`ng serve` proxies `/odata` and `/async` to the service) |
| `docs/purpose.md` | Purpose of the demo |
| `docs/query-scenarios.md` | Sync, async, and async-with-wait — including OData paging |
| `excel/` | Power Query workbook and M scripts for the same three scenarios |
| `queries.http` | REST Client requests for the same flows |
| `global.json` | Pins the released .NET 10 SDK (`10.0.400`) |

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) (10.0.400 or later in the 10.0 line)
- [Node.js](https://nodejs.org/) 20 or later (for the Angular client)
- Windows, macOS, or Linux

```bash
dotnet --version
```

## Run

From the repo root, start the service, then the Angular client (two terminals):

```bash
dotnet run --project ODataLongQuery
cd ODataLongQuery.Web && npm start
```

| App | URL |
| --- | --- |
| OData service | http://localhost:5268 |
| Angular demo | http://localhost:4200 (or http://127.0.0.1:4200) |

The Angular app calls the service at `http://127.0.0.1:5268` (CORS). Keep both processes running.

Open the website to compare a blocking query with `Prefer: respond-async`, poll the monitor, cancel a job, follow `@odata.nextLink` across the 5000-row catalog (500 per page), and switch between OData 4.01 unwrapped JSON and the 4.0 `application/http` wrapper.

## How the 202 flow works

1. Client sends an OData query with `Prefer: respond-async` (optional `wait=N`).
2. Service returns **202 Accepted**, `Location` (monitor URL), `Preference-Applied: respond-async`, and `Retry-After`.
3. The query keeps running in the background.
4. Client polls `Location`:
   - still running → **202**
   - finished → **200** with `AsyncResult` set to the original status code
5. `DELETE` on the monitor cancels the job.

The service never returns 202 unless the client sent `respond-async`. That is required by the spec.

```
Client                         Service                         Monitor
  |  GET /odata/Products          |                               |
  |  Prefer: respond-async        |                               |
  |------------------------------>|                               |
  |  202 Accepted                 |                               |
  |  Location: /async/{id}        |  (query continues)            |
  |<------------------------------|                               |
  |  GET /async/{id}              |                               |
  |-------------------------------------------------------------->|
  |  202 running / 200 + payload  |                               |
  |<--------------------------------------------------------------|
```

## Service endpoints

| Method | URL | Description |
| --- | --- | --- |
| GET | `/odata` | Service document |
| GET | `/odata/$metadata` | EDM metadata |
| GET | `/odata/Products` | Product entity set (`$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$count`; page size 500 + `@odata.nextLink`) |
| GET | `/odata/Products({id})` | Single product |
| GET | `/demo/config` | Live `datasetSize`, `pageSize`, `queryDelayMilliseconds` |
| GET | `/async/{jobId}` | Status monitor for a 202 job |
| DELETE | `/async/{jobId}` | Cancel the job |

### curl

Synchronous (blocks for the demo delay):

```bash
curl "http://localhost:5268/odata/Products?$filter=Price%20lt%2050&$select=Name,Price"
```

Asynchronous:

```bash
curl -i -H "Prefer: respond-async" \
  "http://localhost:5268/odata/Products?$filter=contains(Name,'Queso')"
```

Typical first response:

```http
HTTP/1.1 202 Accepted
Location: http://localhost:5268/async/{jobId}
Retry-After: 2
Preference-Applied: respond-async
```

Poll until ready:

```bash
curl -i http://localhost:5268/async/{jobId}
```

The completed monitor is always outer **200** (the job is done). How the **original** query is represented is a second choice — the Angular **Completed-monitor payload** radios. Full write-up: [docs/query-scenarios.md](docs/query-scenarios.md#completed-monitor-payload).

**OData 4.01 unwrapped** (default): poll with `Accept: application/json`. Body is the Products JSON. The original status is only in the `AsyncResult` header (`200` on success, 4xx/5xx if that query failed). Browsers can `JSON.parse` the body.

```http
HTTP/1.1 200 OK
AsyncResult: 200
Content-Type: application/json

{ "@odata.context": "...", "value": [ ... ], "@odata.nextLink": "..." }
```

**OData 4.0 wrapped**: poll with `Accept: application/http` (this sample also sends `OData-MaxVersion: 4.0`). Body is a serialized HTTP response; parse the inner status line, headers, then JSON. Use this to match older 4.0 clients.

```bash
curl -i -H "Accept: application/http" http://localhost:5268/async/{jobId}
```

```http
HTTP/1.1 200 OK
AsyncResult: 200
Content-Type: application/http

HTTP/1.1 200 OK
Content-Type: application/json

{ "value": [ ... ] }
```

Neither shape applies to a synchronous 200 or to async-with-wait that finishes on the original request — those bodies are already Products JSON.

Wait-mode pages sleep 4s (`WaitQueryDelayMilliseconds`). A 2-second wait expires and returns 202; a 10-second wait covers the page and returns 200:

```bash
curl -i -H "Prefer: respond-async, wait=2" \
  "http://localhost:5268/odata/Products?$count=true&$orderby=Id"

curl -i -H "Prefer: respond-async, wait=10" \
  "http://localhost:5268/odata/Products?$count=true&$orderby=Id"
```

Cancel:

```bash
curl -X DELETE http://localhost:5268/async/{jobId}
```

`queries.http` has the same calls for the VS Code / Visual Studio REST client.

## Configuration

`ODataLongQuery/appsettings.json`:

```json
"DemoData": {
  "DatasetSize": 5000,
  "PageSize": 500
},
"AsyncRequests": {
  "RetryAfterSeconds": 2,
  "JobTimeToLiveMinutes": 15,
  "QueryDelayMilliseconds": 300,
  "WaitQueryDelayMilliseconds": 4000
}
```

`PageSize` is the server-driven page (`@odata.nextLink` until the last page). Raise `DatasetSize` to try a larger catalog.

`QueryDelayMilliseconds` is the per-page sleep for sync and for `respond-async` without wait. `WaitQueryDelayMilliseconds` is the per-page sleep when Prefer includes `wait=N`. The Angular default wait is **2 seconds**, so wait mode returns **202** (then you poll). Raise wait to 4 or more to get **200** on the original request instead. Set either delay to `0` to turn that sleep off.

`GET /demo/config` returns the live `datasetSize`, `pageSize`, and delay. The Angular client and the Power Query scripts in `excel/power-query/` follow `nextLink` with the same three modes as the UI.

## Build

```bash
dotnet build
cd ODataLongQuery.Web && npm ci && npm run build
```

## What this is not

- Not a database or reporting engine (catalog is in-memory)
- Not a durable queue (jobs die on process recycle)
- Not a full OData client (`$expand`, batch, auth, and delta are out of scope)
- Not a recommendation to make every query async
