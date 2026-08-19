namespace ODataLongQuery.LongRunning;

public enum AsyncJobStatus
{
    Running,
    Completed,
    Failed,
    Canceled
}

public sealed class AsyncJob
{
    private readonly object _gate = new();

    public Guid Id { get; } = Guid.NewGuid();
    public DateTimeOffset CreatedAt { get; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAt { get; private set; }
    public AsyncJobStatus Status { get; private set; } = AsyncJobStatus.Running;
    public CapturedResponse? Result { get; private set; }
    public CancellationTokenSource Cancellation { get; } = new();
    public TaskCompletionSource Completed { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public bool IsTerminal
    {
        get
        {
            lock (_gate)
            {
                return Status is not AsyncJobStatus.Running;
            }
        }
    }

    public void Complete(CapturedResponse result)
    {
        lock (_gate)
        {
            if (Status is not AsyncJobStatus.Running)
            {
                return;
            }

            Status = result.StatusCode >= 500 ? AsyncJobStatus.Failed : AsyncJobStatus.Completed;
            Result = result;
            CompletedAt = DateTimeOffset.UtcNow;
        }

        Completed.TrySetResult();
    }

    public bool TryCancel()
    {
        lock (_gate)
        {
            if (Status is not AsyncJobStatus.Running)
            {
                Status = AsyncJobStatus.Canceled;
                CompletedAt ??= DateTimeOffset.UtcNow;
            }
            else
            {
                Status = AsyncJobStatus.Canceled;
                CompletedAt = DateTimeOffset.UtcNow;
            }
        }

        try
        {
            Cancellation.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // already completed
        }

        Completed.TrySetResult();
        return true;
    }
}
