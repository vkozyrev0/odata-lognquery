// Products_Sync
// Same algorithm as the Angular "Synchronous" radio:
//   GET page (no Prefer) → read value + @odata.nextLink → GET nextLink → … until none.
// Service defaults: catalog 5000, page size 500 (DemoData in appsettings.json).
// First URL matches the web app: $count=true&$orderby=Id, no $top (load every page).
// OData.Feed would follow nextLink automatically; this script spells the loop out so
// it stays aligned with Products_Async / Products_AsyncWait and the Angular client.
// Start the sample service first: dotnet run --project ODataLongQuery

let
    BaseUrl = "http://127.0.0.1:5268",
    FirstUrl = BaseUrl & "/odata/Products?$count=true&$orderby=Id",
    MaxPages = 100,

    AbsoluteUrl = (maybeUrl as nullable text) as text =>
        if maybeUrl = null then
            error "Missing URL"
        else if Text.StartsWith(maybeUrl, "http://") or Text.StartsWith(maybeUrl, "https://") then
            maybeUrl
        else
            BaseUrl & maybeUrl,

    GetResponse = (url as text) as record =>
        let
            binary = Web.Contents(
                url,
                [
                    Headers = [Accept = "application/json"],
                    ManualStatusHandling = {200, 202, 404, 410, 500}
                ]
            ),
            responseMeta = Value.Metadata(binary)
        in
            [
                Status = responseMeta[Response.Status],
                Headers = responseMeta[Headers],
                Binary = binary
            ],

    FetchResource = (url as text) as record =>
        let
            response = GetResponse(url),
            completed =
                if response[Status] = 200 then
                    response
                else
                    error Error.Record(
                        "ODataHttpError",
                        "Synchronous page did not return 200",
                        [Url = url, Status = response[Status]]
                    ),
            json = Json.Document(completed[Binary]),
            rows = json[value],
            nextLink = Record.FieldOrDefault(json, "@odata.nextLink", null)
        in
            [Rows = rows, NextLink = nextLink],

    AllPages = (url as text, pagesLeft as number) as list =>
        let
            page = FetchResource(url),
            rest =
                if page[NextLink] = null or pagesLeft <= 1 then
                    {}
                else
                    @AllPages(AbsoluteUrl(page[NextLink]), pagesLeft - 1)
        in
            page[Rows] & rest,

    Records = AllPages(FirstUrl, MaxPages),
    Result = Table.FromRecords(Records)
in
    Result
