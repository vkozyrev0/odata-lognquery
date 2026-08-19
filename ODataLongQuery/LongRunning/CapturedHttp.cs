using System.Net.Http.Headers;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace ODataLongQuery.LongRunning;

public sealed class CapturedRequest
{
    public required string Method { get; init; }
    public required string Scheme { get; init; }
    public required HostString Host { get; init; }
    public required PathString PathBase { get; init; }
    public required PathString Path { get; init; }
    public required QueryString QueryString { get; init; }
    public string? ContentType { get; init; }
    public byte[] Body { get; init; } = [];
    public required IReadOnlyList<KeyValuePair<string, string[]>> Headers { get; init; }
    public string TraceIdentifier { get; init; } = "";

    public static async Task<CapturedRequest> FromAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        request.EnableBuffering();
        using var body = new MemoryStream();
        await request.Body.CopyToAsync(body, cancellationToken);
        request.Body.Position = 0;

        var headers = new List<KeyValuePair<string, string[]>>();
        foreach (var header in request.Headers)
        {
            headers.Add(new(header.Key, header.Value.ToArray()!));
        }

        return new CapturedRequest
        {
            Method = request.Method,
            Scheme = request.Scheme,
            Host = request.Host,
            PathBase = request.PathBase,
            Path = request.Path,
            QueryString = request.QueryString,
            ContentType = request.ContentType,
            Body = body.ToArray(),
            Headers = headers,
            TraceIdentifier = request.HttpContext.TraceIdentifier
        };
    }

    public HttpRequestMessage ToHttpRequestMessage()
    {
        var url = $"{Scheme}://{Host}{PathBase}{Path}{QueryString}";
        var message = new HttpRequestMessage(new HttpMethod(Method), url);

        if (Body.Length > 0)
        {
            message.Content = new ByteArrayContent(Body);
            if (!string.IsNullOrEmpty(ContentType))
            {
                message.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(ContentType);
            }
        }

        foreach (var header in Headers)
        {
            if (header.Key.Equals("Prefer", StringComparison.OrdinalIgnoreCase)
                || header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)
                || header.Key.Equals("Host", StringComparison.OrdinalIgnoreCase)
                || header.Key.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase)
                || header.Key.Equals("Connection", StringComparison.OrdinalIgnoreCase)
                || header.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!message.Headers.TryAddWithoutValidation(header.Key, header.Value)
                && message.Content is not null)
            {
                message.Content.Headers.TryAddWithoutValidation(header.Key, header.Value);
            }
        }

        message.Headers.TryAddWithoutValidation(AsyncRequestMiddleware.ReplayHeaderName, "1");
        return message;
    }
}

public sealed class CapturedResponse
{
    public required int StatusCode { get; init; }
    public string? ReasonPhrase { get; init; }
    public string? ContentType { get; init; }
    public byte[] Body { get; init; } = [];
    public required IReadOnlyList<KeyValuePair<string, string[]>> Headers { get; init; }

    private static readonly HashSet<string> HopByHopHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Connection",
        "Keep-Alive",
        "Proxy-Authenticate",
        "Proxy-Authorization",
        "TE",
        "Trailers",
        "Transfer-Encoding",
        "Upgrade",
        "Host"
    };

    public static async Task<CapturedResponse> FromAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var body = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        var headers = new List<KeyValuePair<string, string[]>>();

        void AddHeaders(HttpHeaders source)
        {
            foreach (var header in source)
            {
                if (HopByHopHeaders.Contains(header.Key))
                {
                    continue;
                }

                headers.Add(new(header.Key, header.Value.ToArray()));
            }
        }

        AddHeaders(response.Headers);
        AddHeaders(response.Content.Headers);

        return new CapturedResponse
        {
            StatusCode = (int)response.StatusCode,
            ReasonPhrase = response.ReasonPhrase ?? ReasonPhrases.GetReasonPhrase((int)response.StatusCode),
            ContentType = response.Content.Headers.ContentType?.ToString(),
            Body = body,
            Headers = headers
        };
    }

    public static CapturedResponse ServerError(string message)
    {
        var json = Encoding.UTF8.GetBytes(
            System.Text.Json.JsonSerializer.Serialize(new
            {
                error = new { code = "AsyncExecutionFailed", message }
            }));

        return new CapturedResponse
        {
            StatusCode = StatusCodes.Status500InternalServerError,
            ReasonPhrase = "Internal Server Error",
            ContentType = "application/json; charset=utf-8",
            Body = json,
            Headers =
            [
                new("Content-Type", ["application/json; charset=utf-8"]),
                new("OData-Version", ["4.0"])
            ]
        };
    }

    public async Task WriteUnwrappedAsync(HttpResponse destination)
    {
        destination.StatusCode = StatusCodes.Status200OK;
        destination.Headers["AsyncResult"] = StatusCode.ToString();
        CopyHeaders(destination);

        if (Body.Length > 0)
        {
            await destination.Body.WriteAsync(Body);
        }
    }

    public async Task WriteAsHttpMessageAsync(HttpResponse destination)
    {
        destination.StatusCode = StatusCodes.Status200OK;
        destination.ContentType = "application/http";
        destination.Headers["AsyncResult"] = StatusCode.ToString();

        var builder = new StringBuilder();
        builder.Append("HTTP/1.1 ").Append(StatusCode).Append(' ')
            .Append(ReasonPhrase ?? "OK").Append("\r\n");

        foreach (var header in Headers)
        {
            foreach (var value in header.Value)
            {
                builder.Append(header.Key).Append(": ").Append(value).Append("\r\n");
            }
        }

        if (!HasHeader("Content-Length"))
        {
            builder.Append("Content-Length: ").Append(Body.Length).Append("\r\n");
        }

        builder.Append("\r\n");

        var preamble = Encoding.UTF8.GetBytes(builder.ToString());
        await destination.Body.WriteAsync(preamble);
        if (Body.Length > 0)
        {
            await destination.Body.WriteAsync(Body);
        }
    }

    public async Task WriteOriginalAsync(HttpResponse destination)
    {
        destination.StatusCode = StatusCode;
        CopyHeaders(destination);
        if (Body.Length > 0)
        {
            await destination.Body.WriteAsync(Body);
        }
    }

    private void CopyHeaders(HttpResponse destination)
    {
        foreach (var header in Headers)
        {
            if (header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            destination.Headers[header.Key] = header.Value;
        }

        if (!string.IsNullOrEmpty(ContentType) && string.IsNullOrEmpty(destination.ContentType))
        {
            destination.ContentType = ContentType;
        }
    }

    private bool HasHeader(string name) =>
        Headers.Any(header => header.Key.Equals(name, StringComparison.OrdinalIgnoreCase));
}
