namespace ODataLongQuery.LongRunning;

public sealed class AsyncRequestOptions
{
    public const string SectionName = "AsyncRequests";

    /// <summary>
    /// Seconds the client should wait before polling the status monitor.
    /// </summary>
    public int RetryAfterSeconds { get; set; } = 2;

    /// <summary>
    /// How long completed or abandoned jobs are kept for polling.
    /// </summary>
    public int JobTimeToLiveMinutes { get; set; } = 15;

    /// <summary>
    /// Artificial delay applied to product queries so the 202 flow is easy to observe.
    /// Used for synchronous GETs and for Prefer: respond-async without wait.
    /// Set to 0 to disable.
    /// </summary>
    public int QueryDelayMilliseconds { get; set; } = 300;

    /// <summary>
    /// Per-page delay when Prefer includes wait=N. Must exceed the client's wait
    /// (the Angular default is 2s) so the original request returns 202 instead of 200.
    /// Set to 0 to use <see cref="QueryDelayMilliseconds"/>.
    /// </summary>
    public int WaitQueryDelayMilliseconds { get; set; } = 4000;
}
