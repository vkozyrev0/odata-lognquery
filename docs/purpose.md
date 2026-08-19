# Purpose of this demo

This repository is a teaching sample, not a production service. It shows how an OData API can accept a query that takes too long to answer on the original HTTP request, and how a website can wait for that answer without holding the first connection open.

## The problem

OData is usually synchronous. The client sends `$filter`, `$select`, `$orderby`, and similar options. The server computes the result and returns `200 OK` with the payload.

That model breaks down when the query is expensive:

- The browser or gateway times out.
- A load balancer drops the idle connection.
- The client cannot do anything else while it waits.
- Cancelling the work is awkward because there is no job identity.

Long-running queries need a handshake that says “I accepted the work; come back here for the result.”

## What OData already specifies

OData 4.01 defines that handshake. It is not a custom invent-your-own job API.

1. The client sends a normal data request plus `Prefer: respond-async`.
2. If the service agrees to run it in the background, it **must** return **202 Accepted** with a `Location` status-monitor URL. It should also send `Preference-Applied: respond-async` and may send `Retry-After`.
3. The service **must not** return 202 unless the client asked for `respond-async`.
4. The client polls `Location`:
   - still running → another **202**
   - finished → **200** with an `AsyncResult` header that carries the original status code, and the original OData payload
5. `DELETE` on the monitor cancels the job.
6. Optional `wait=N` means “hold this request up to N seconds; if you are still working, then give me 202.”

That is the entire point of the sample: make that protocol visible, end to end.

## What this repo contains

| Piece | Role |
| --- | --- |
| `ODataLongQuery` | OData v4 service on **.NET 10**. Exposes `Products` and implements the 202 / monitor / cancel path. |
| `ODataLongQuery.Web` | Angular 22 client. Used to demonstrate the protocol from a browser. |
| `docs/purpose.md` | This document: why the sample exists. |
| `queries.http` | The same calls for a REST client. |

The product catalog is in-memory and the service inserts a short, configurable delay (`QueryDelayMilliseconds`). The delay is intentional. Without it, a laptop finishes the query so fast that 202 never stays on screen long enough to teach anything.

## What the website is for

The website is a client, not a second OData implementation.

It exists so someone can:

- Compare a blocking query with an async query without writing curl.
- See the 202, `Location`, `Retry-After`, and `AsyncResult` values on screen.
- Watch the poll loop until the monitor returns the OData payload.
- Cancel a running job.
- Try `$filter`, `$orderby`, and `$top` and still go through the same 202 path.
- Compare the two completed-monitor payload styles: OData 4.01 unwrapped JSON versus the OData 4.0 `application/http` wrapper.

During local demo, the Angular app calls `http://127.0.0.1:5268` directly (CORS) and sends the real OData headers (`Prefer`, `Accept`). Polling uses `/async/{jobId}` on that same origin.

## What this demo is not

- Not a real database, warehouse, or reporting engine.
- Not a queue, workflow, or durable job processor. Jobs live in memory and expire.
- Not a complete OData client (no `$expand`, batch, auth, or delta).
- Not a recommendation to make every query async. Fast queries should stay synchronous.

Use it to understand the protocol, then replace the in-memory catalog and the artificial delay with a real store and a real timeout policy.

## Suggested next steps

These are optional follow-ups, not part of the current demo:

1. Swap the in-memory catalog for EF Core and make only *estimated-slow* queries async.
2. Persist jobs so a recycle or second instance can still serve the monitor URL.
3. Add authentication and make the monitor URL private to the caller.
4. Host the Angular production build from the OData service (or another static host) instead of only `ng serve`.
