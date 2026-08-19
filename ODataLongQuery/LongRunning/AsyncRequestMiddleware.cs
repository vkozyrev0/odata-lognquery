using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace ODataLongQuery.LongRunning;

/// <summary>
/// Implements OData asynchronous requests (HTTP 202) as specified in
/// OData 4.01 Part 1, section 11.6.
/// </summary>
public sealed class AsyncRequestMiddleware
{
    public const string ReplayHeaderName = "X-OData-Async-Replay";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly RequestDelegate _next;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<AsyncRequestMiddleware> _logger;

    public AsyncRequestMiddleware(
        RequestDelegate next,
        IHttpClientFactory httpClientFactory,
        ILogger<AsyncRequestMiddleware> logger)
    {
        _next = next;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public async Task InvokeAsync(
        HttpContext context,
        AsyncJobStore jobs,
        IOptions<AsyncRequestOptions> optionsAccessor)
    {
        if (!ShouldHandle(context))
        {
            await _next(context);
            return;
        }

        var prefer = PreferHeaderParser.Parse(context.Request.Headers);
        if (!prefer.RespondAsync)
        {
            await _next(context);
            return;
        }

        var options = optionsAccessor.Value;
        var captured = await CapturedRequest.FromAsync(context.Request, context.RequestAborted);
        var job = jobs.Create();

        StartJob(job, captured);

        if (prefer.WaitSeconds is > 0)
        {
            var wait = Task.Delay(TimeSpan.FromSeconds(prefer.WaitSeconds.Value), context.RequestAborted);
            await Task.WhenAny(job.Completed.Task, wait);

            if (job.Result is { } result)
            {
                _logger.LogInformation("Async job {JobId} finished within wait={Wait}s; returning synchronously", job.Id, prefer.WaitSeconds);
                jobs.Remove(job.Id);
                await result.WriteOriginalAsync(context.Response);
                return;
            }
        }

        await WriteAcceptedAsync(context, job, options);
    }

    private void StartJob(AsyncJob job, CapturedRequest captured)
    {
        using (ExecutionContext.SuppressFlow())
        {
            _ = Task.Run(() => ExecuteJobAsync(job, captured));
        }
    }

    private async Task ExecuteJobAsync(AsyncJob job, CapturedRequest captured)
    {
        _logger.LogInformation("Starting async OData job {JobId} for {Method} {Path}{Query}",
            job.Id, captured.Method, captured.Path, captured.QueryString);

        try
        {
            var client = _httpClientFactory.CreateClient("odata-replay");
            using var request = captured.ToHttpRequestMessage();
            using var response = await client.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                job.Cancellation.Token);

            job.Complete(await CapturedResponse.FromAsync(response, job.Cancellation.Token));
            _logger.LogInformation("Async OData job {JobId} completed with {StatusCode}", job.Id, job.Result?.StatusCode);
        }
        catch (OperationCanceledException) when (job.Cancellation.IsCancellationRequested)
        {
            job.TryCancel();
            _logger.LogInformation("Async OData job {JobId} was canceled", job.Id);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Async OData job {JobId} failed", job.Id);
            job.Complete(CapturedResponse.ServerError(ex.Message));
        }
    }

    private static bool ShouldHandle(HttpContext context)
    {
        if (context.Request.Headers.ContainsKey(ReplayHeaderName))
        {
            return false;
        }

        var path = context.Request.Path;
        if (!path.StartsWithSegments("/odata"))
        {
            return false;
        }

        if (path.StartsWithSegments("/odata/$metadata")
            || path.Equals("/odata", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/odata/", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return true;
    }

    private static async Task WriteAcceptedAsync(HttpContext context, AsyncJob job, AsyncRequestOptions options)
    {
        var location = $"{context.Request.Scheme}://{context.Request.Host}/async/{job.Id}";

        context.Response.StatusCode = StatusCodes.Status202Accepted;
        context.Response.Headers.Location = location;
        context.Response.Headers.RetryAfter = options.RetryAfterSeconds.ToString();
        context.Response.Headers["Preference-Applied"] = "respond-async";
        context.Response.Headers["OData-Version"] = "4.0";
        context.Response.ContentType = "application/json; charset=utf-8";

        var payload = new
        {
            status = "accepted",
            jobId = job.Id,
            monitor = location,
            retryAfterSeconds = options.RetryAfterSeconds
        };

        await context.Response.WriteAsync(JsonSerializer.Serialize(payload, JsonOptions));
    }
}
