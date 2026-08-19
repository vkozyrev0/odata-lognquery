# Excel / Power Query sample

This folder holds an Excel workbook and three Power Query (M) scripts that mirror the demo app:

| Scenario | File | Excel query name |
| --- | --- | --- |
| Synchronous | `power-query/Products_Sync.pq` | `Products_Sync` |
| Async (`Prefer: respond-async`) | `power-query/Products_Async.pq` | `Products_Async` |
| Async with wait | `power-query/Products_AsyncWait.pq` | `Products_AsyncWait` |

Workbook: **`OData-Query-Scenarios.xlsx`**.

## Before you refresh

1. Start the sample service: `dotnet run --project ../ODataLongQuery`
2. Confirm `http://127.0.0.1:5268/odata/Products` returns JSON.
3. Open the workbook in **Excel for Microsoft 365** (Windows). Power Query M in this form is not supported in Excel for the web.

## Load a query

1. Data → Get Data → From Other Sources → **Blank query**.
2. Home → **Advanced Editor**.
3. Paste the contents of the matching `.pq` file.
4. Set `BaseUrl` to `http://127.0.0.1:5268` if needed.
5. Anonymous / ignore privacy level for localhost if Excel prompts.

All three scripts use the same client algorithm as the Angular app:

1. First URL: `http://127.0.0.1:5268/odata/Products?$count=true&$orderby=Id`
2. Read `value` and `@odata.nextLink` (service page size **500**, catalog **5000**).
3. GET each `nextLink` with the **same scenario headers** until there is no next page.
4. Concatenate rows (10 pages × 500 = 5000).

| Query | Prefer on each page | After 202 |
| --- | --- | --- |
| `Products_Sync` | none | n/a (200 only) |
| `Products_Async` | `respond-async` | poll `Location` |
| `Products_AsyncWait` | `respond-async, wait=N` (page 1: 2; later pages: 2) | poll when the 4s wait-mode page delay exceeds N |

`OData.Feed` would follow `nextLink` for the sync case; `Products_Sync.pq` still writes the loop so the three scripts stay comparable.

Excel will still wait until the M function finishes. Async in Power Query avoids **HTTP** timeouts; it does not make the Excel refresh dialog non-blocking.
