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
    /// Set to 0 to disable.
    /// </summary>
    public int QueryDelayMilliseconds { get; set; } = 4000;
}
