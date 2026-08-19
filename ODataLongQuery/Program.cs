using Microsoft.AspNetCore.OData;
using Microsoft.OData.ModelBuilder;
using ODataLongQuery.Data;
using ODataLongQuery.LongRunning;
using ODataLongQuery.Models;

var builder = WebApplication.CreateBuilder(args);

var modelBuilder = new ODataConventionModelBuilder();
modelBuilder.EntitySet<Product>("Products");

builder.Services.AddSingleton<ProductCatalog>();
builder.Services.AddODataLongRunningQueries(builder.Configuration);
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins("http://localhost:5248", "http://127.0.0.1:5248")
            .AllowAnyHeader()
            .AllowAnyMethod());
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
