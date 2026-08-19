// Products_AsyncWait
// Same algorithm as the Angular "Async with wait" radio:
//   Prefer: respond-async, wait=N on page 1 (N = FirstPageWaitSeconds).
//   If the page finishes in N seconds the first response is 200 (no poll);
//   otherwise 202 + poll Location.
//   Continuation pages use wait=min(N, 5) — NextPageWaitSeconds — matching the web app.
//   WaitQueryDelaySeconds matches the Angular "wait-mode page delay (seconds)" box.
//   It is sent as X-Demo-Wait-Delay-Milliseconds (seconds × 1000). If delay > wait, 202.
// Service defaults: catalog 5000, page size 500.
// First URL matches the web app: $count=true&$orderby=Id, no $top.
// Start the sample service first: dotnet run --project ODataLongQuery

let
    BaseUrl = "http://127.0.0.1:5268",
    FirstUrl = BaseUrl & "/odata/Products?$count=true&$orderby=Id",
    FirstPageWaitSeconds = 2,
    NextPageWaitSeconds = 2,
    WaitQueryDelaySeconds = 4,
    MaxPages = 100,
    MaxPolls = 60,
    PollDelay = #duration(0, 0, 0, 2),

    AbsoluteUrl = (maybeUrl as nullable text) as text =>
        if maybeUrl = null then
            error "Missing URL"
        else if Text.StartsWith(maybeUrl, "http://") or Text.StartsWith(maybeUrl, "https://") then
            maybeUrl
        else
            BaseUrl & maybeUrl,

    HeaderValue = (headers as record, name as text) as nullable text =>
        let
            names = Record.FieldNames(headers),
            match = List.First(List.Select(names, each Text.Upper(_) = Text.Upper(name)), null)
        in
            if match = null then null else Record.Field(headers, match),

    GetResponse = (url as text, prefer as nullable text) as record =>
        let
            headers =
                if prefer = null then
                    [Accept = "application/json"]
                else
                    [
                        Accept = "application/json",
                        Prefer = prefer,
                        #"X-Demo-Wait-Delay-Milliseconds" = Number.ToText(WaitQueryDelaySeconds * 1000)
                    ],
            binary = Web.Contents(
                url,
                [
                    Headers = headers,
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

    PollUntilComplete = (monitorUrl as text, attemptsLeft as number) as record =>
        let
            response = GetResponse(monitorUrl, null),
            done =
                if response[Status] = 200 then
                    response
                else if response[Status] = 202 and attemptsLeft > 0 then
                    Function.InvokeAfter(
                        () => @PollUntilComplete(monitorUrl, attemptsLeft - 1),
                        PollDelay
                    )
                else
                    error Error.Record(
                        "ODataAsyncTimeout",
                        "Monitor did not return 200 in time",
                        [Url = monitorUrl, Status = response[Status]]
                    )
        in
            done,

    FetchResource = (url as text, waitSeconds as number) as record =>
        let
            prefer = "respond-async, wait=" & Number.ToText(waitSeconds),
            first = GetResponse(url, prefer),
            completed =
                if first[Status] = 200 then
                    first
                else if first[Status] = 202 then
                    PollUntilComplete(AbsoluteUrl(HeaderValue(first[Headers], "Location")), MaxPolls)
                else
                    error Error.Record(
                        "ODataHttpError",
                        "Unexpected status on async-wait request",
                        [Url = url, Status = first[Status]]
                    ),
            json = Json.Document(completed[Binary]),
            rows = json[value],
            nextLink = Record.FieldOrDefault(json, "@odata.nextLink", null)
        in
            [Rows = rows, NextLink = nextLink],

    AllPages = (url as text, waitSeconds as number, pagesLeft as number) as list =>
        let
            page = FetchResource(url, waitSeconds),
            rest =
                if page[NextLink] = null or pagesLeft <= 1 then
                    {}
                else
                    @AllPages(AbsoluteUrl(page[NextLink]), NextPageWaitSeconds, pagesLeft - 1)
        in
            page[Rows] & rest,

    Records = AllPages(FirstUrl, FirstPageWaitSeconds, MaxPages),
    Result = Table.FromRecords(Records)
in
    Result
