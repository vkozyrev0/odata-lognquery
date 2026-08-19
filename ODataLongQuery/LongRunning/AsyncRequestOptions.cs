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
    /// Default per-page delay when Prefer includes wait=N, used if the client
    /// does not send <see cref="WaitDelayHeaderName"/>.
    /// </summary>
    public int WaitQueryDelayMilliseconds { get; set; } = 4000;

    public const string WaitDelayHeaderName = "X-Demo-Wait-Delay-Milliseconds";

    public const int MaxQueryDelayMilliseconds = 60_000;
}
