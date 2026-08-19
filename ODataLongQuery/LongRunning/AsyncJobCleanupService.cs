using Microsoft.Extensions.Options;

namespace ODataLongQuery.LongRunning;

public sealed class AsyncJobCleanupService : BackgroundService
{
    private readonly AsyncJobStore _jobs;
    private readonly IOptions<AsyncRequestOptions> _options;
    private readonly ILogger<AsyncJobCleanupService> _logger;

    public AsyncJobCleanupService(
        AsyncJobStore jobs,
        IOptions<AsyncRequestOptions> options,
        ILogger<AsyncJobCleanupService> logger)
    {
        _jobs = jobs;
        _options = options;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            var ttl = TimeSpan.FromMinutes(Math.Max(1, _options.Value.JobTimeToLiveMinutes));
            var removed = _jobs.PurgeExpired(ttl);
            if (removed > 0)
            {
                _logger.LogInformation("Purged {Count} expired async jobs", removed);
            }
        }
    }
}
