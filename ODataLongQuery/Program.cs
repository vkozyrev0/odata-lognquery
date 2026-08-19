using Microsoft.AspNetCore.OData;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.OData.ModelBuilder;
using ODataLongQuery.Data;
using ODataLongQuery.LongRunning;
using ODataLongQuery.Models;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(options =>
{
    options.ConfigureEndpointDefaults(endpoint => endpoint.Protocols = HttpProtocols.Http1);
});

var modelBuilder = new ODataConventionModelBuilder();
modelBuilder.EntitySet<Product>("Products");

builder.Services.AddSingleton<ProductCatalog>();
builder.Services.AddODataLongRunningQueries(builder.Configuration);
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins(
            "http://localhost:4200",
            "http://127.0.0.1:4200")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .WithExposedHeaders("Location", "Retry-After", "Preference-Applied", "AsyncResult", "OData-Version"));
});
builder.Services.AddControllers()
    .AddOData(options => options
        .Select()
        .Filter()
        .OrderBy()
        .Count()
        .SetMaxTop(100)
        .AddRouteComponents("odata", modelBuilder.GetEdmModel()));

var app = builder.Build();

app.UseRouting();
app.UseCors();
app.UseODataLongRunningQueries();
app.MapControllers();

app.MapGet("/", () => Results.Json(new
{
    service = "/odata",
    metadata = "/odata/$metadata",
    products = "/odata/Products",
    asyncHint = "Send Prefer: respond-async to run a query in the background. The service returns HTTP 202 and a Location monitor URL."
}));

app.Run();
