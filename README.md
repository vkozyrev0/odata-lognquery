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

Open the website to compare a blocking query with `Prefer: respond-async`, poll the monitor, cancel a job, and switch between OData 4.01 unwrapped JSON and the 4.0 `application/http` wrapper.

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
| GET | `/odata/Products` | Product entity set (`$filter`, `$select`, `$orderby`, `$top`, `$skip`, `$count`) |
| GET | `/odata/Products({id})` | Single product |
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

Completed monitor, OData 4.01 (default): `200` + `AsyncResult: 200` + Products JSON.

Completed monitor, OData 4.0 wrapper:

```bash
curl -i -H "Accept: application/http" http://localhost:5268/async/{jobId}
```

Wait up to 10 seconds, then 202 only if still running:

```bash
curl -i -H "Prefer: respond-async, wait=10" \
  "http://localhost:5268/odata/Products?$top=5"
```

Cancel:

```bash
curl -X DELETE http://localhost:5268/async/{jobId}
```

`queries.http` has the same calls for the VS Code / Visual Studio REST client.

## Configuration

`ODataLongQuery/appsettings.json`:

```json
"AsyncRequests": {
  "RetryAfterSeconds": 2,
  "JobTimeToLiveMinutes": 15,
  "QueryDelayMilliseconds": 4000
}
```

Set `QueryDelayMilliseconds` to `0` to turn off the artificial delay.

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
