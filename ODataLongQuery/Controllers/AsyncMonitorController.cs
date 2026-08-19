using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using ODataLongQuery.LongRunning;

namespace ODataLongQuery.Controllers;

[ApiController]
[Route("async")]
public sealed class AsyncMonitorController : ControllerBase
{
    private readonly AsyncJobStore _jobs;
    private readonly AsyncRequestOptions _options;

    public AsyncMonitorController(AsyncJobStore jobs, IOptions<AsyncRequestOptions> options)
    {
        _jobs = jobs;
        _options = options.Value;
    }

    [HttpGet("{id:guid}")]
    public async Task Get(Guid id)
    {
        var job = _jobs.Get(id);
        if (job is null || job.Status is AsyncJobStatus.Canceled)
        {
            Response.StatusCode = StatusCodes.Status404NotFound;
            Response.Headers["OData-Version"] = "4.0";
            await Response.WriteAsJsonAsync(new
            {
                error = new { code = "JobNotFound", message = "The async job does not exist, was canceled, or has expired." }
            });
            return;
        }

        if (job.Status is AsyncJobStatus.Running)
        {
            var location = $"/async/{job.Id}";
            Response.StatusCode = StatusCodes.Status202Accepted;
            Response.Headers.Location = location;
            Response.Headers.RetryAfter = _options.RetryAfterSeconds.ToString();
            Response.Headers["OData-Version"] = "4.0";
            await Response.WriteAsJsonAsync(new
            {
                status = "running",
                jobId = job.Id,
                monitor = location,
                retryAfterSeconds = _options.RetryAfterSeconds
            });
            return;
        }

        var result = job.Result ?? CapturedResponse.ServerError("The async job finished without a result.");
        if (WantsHttpMessageWrapper())
        {
            await result.WriteAsHttpMessageAsync(Response);
            return;
        }

        await result.WriteUnwrappedAsync(Response);
    }

    [HttpDelete("{id:guid}")]
    public IActionResult Delete(Guid id)
    {
        var job = _jobs.Get(id);
        if (job is null)
        {
            return NotFound();
        }

        job.TryCancel();
        _jobs.Remove(id);
        return NoContent();
    }

    private bool WantsHttpMessageWrapper()
    {
        var accept = Request.Headers.Accept.ToString();
        if (accept.Contains("application/http", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var maxVersion = Request.Headers["OData-MaxVersion"].ToString();
        return maxVersion.StartsWith("4.0", StringComparison.Ordinal)
               && string.IsNullOrWhiteSpace(accept);
    }
}
