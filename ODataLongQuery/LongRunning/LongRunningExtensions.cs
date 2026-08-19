namespace ODataLongQuery.LongRunning;

public static class LongRunningExtensions
{
    public static IServiceCollection AddODataLongRunningQueries(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<AsyncRequestOptions>(configuration.GetSection(AsyncRequestOptions.SectionName));
        services.AddSingleton<AsyncJobStore>();
        services.AddHostedService<AsyncJobCleanupService>();
        return services;
    }

    public static IApplicationBuilder UseODataLongRunningQueries(this IApplicationBuilder app)
        => app.UseMiddleware<AsyncRequestMiddleware>();
}
