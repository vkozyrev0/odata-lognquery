using System.Collections.Concurrent;

namespace ODataLongQuery.LongRunning;

public sealed class AsyncJobStore
{
    private readonly ConcurrentDictionary<Guid, AsyncJob> _jobs = new();

    public AsyncJob Create()
    {
        var job = new AsyncJob();
        _jobs[job.Id] = job;
        return job;
    }

    public AsyncJob? Get(Guid id) => _jobs.TryGetValue(id, out var job) ? job : null;

    public bool Remove(Guid id) => _jobs.TryRemove(id, out _);

    public int PurgeExpired(TimeSpan timeToLive)
    {
        var cutoff = DateTimeOffset.UtcNow - timeToLive;
        var removed = 0;

        foreach (var pair in _jobs)
        {
            var job = pair.Value;
            var stamp = job.CompletedAt ?? job.CreatedAt;
            if (stamp < cutoff && _jobs.TryRemove(pair.Key, out var expired))
            {
                expired.TryCancel();
                expired.Cancellation.Dispose();
                removed++;
            }
        }

        return removed;
    }
}
