namespace ODataLongQuery.LongRunning;

public static class LongRunningExtensions
{
    public static IServiceCollection AddODataLongRunningQueries(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<AsyncRequestOptions>(configuration.GetSection(AsyncRequestOptions.SectionName));
        services.AddSingleton<AsyncJobStore>();
        services.AddHostedService<AsyncJobCleanupService>();
        services.AddHttpClient("odata-replay")
            .ConfigureHttpClient(client => client.Timeout = Timeout.InfiniteTimeSpan);
        return services;
    }

    public static IApplicationBuilder UseODataLongRunningQueries(this IApplicationBuilder app)
        => app.UseMiddleware<AsyncRequestMiddleware>();
}
