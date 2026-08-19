using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OData.Query;
using Microsoft.AspNetCore.OData.Routing.Controllers;
using Microsoft.Extensions.Options;
using ODataLongQuery.Data;
using ODataLongQuery.LongRunning;
using ODataLongQuery.Models;

namespace ODataLongQuery.Controllers;

public sealed class ProductsController : ODataController
{
    private readonly ProductCatalog _catalog;
    private readonly AsyncRequestOptions _async;
    private readonly int _pageSize;

    public ProductsController(
        ProductCatalog catalog,
        IOptions<AsyncRequestOptions> asyncOptions)
    {
        _catalog = catalog;
        _async = asyncOptions.Value;
        _pageSize = catalog.PageSize;
    }

    public async Task<ActionResult<ProductPage>> Get(
        ODataQueryOptions<Product> query,
        CancellationToken cancellationToken)
    {
        await SimulateLongRunningQuery(cancellationToken);

        var settings = new ODataQuerySettings { PageSize = _pageSize };
        var applied = query.ApplyTo(_catalog.Products, settings);
        var page = applied.Cast<Product>().ToList();

        var filtered = query.Filter is null
            ? _catalog.Products
            : query.Filter.ApplyTo(_catalog.Products, new ODataQuerySettings()) as IQueryable<Product>
              ?? _catalog.Products;
        var filteredCount = filtered.LongCount();
        long? count = query.Count?.Value == true ? filteredCount : null;

        var skip = query.Skip?.Value ?? 0;
        var nextSkip = skip + page.Count;
        var clientTop = query.Top?.Value;
        // $top on this request is "max rows in this response". Remaining for nextLink
        // is that value minus rows already returned here (not minus $skip).
        var remainingTop = clientTop.HasValue ? clientTop.Value - page.Count : (int?)null;
        string? nextLink = null;
        var moreFiltered = nextSkip < filteredCount;
        var withinClientTop = !remainingTop.HasValue || remainingTop.Value > 0;
        if (page.Count > 0 && page.Count == _pageSize && moreFiltered && withinClientTop)
        {
            nextLink = BuildNextLink(Request, nextSkip, remainingTop);
        }

        return Ok(new ProductPage
        {
            Context = $"{Request.Scheme}://{Request.Host}/odata/$metadata#Products",
            Count = count,
            Value = page,
            NextLink = nextLink
        });
    }

    [EnableQuery]
    public async Task<ActionResult<Product>> Get(int key, CancellationToken cancellationToken)
    {
        await SimulateLongRunningQuery(cancellationToken);
        var product = _catalog.Products.FirstOrDefault(item => item.Id == key);
        if (product is null)
        {
            return NotFound();
        }

        return Ok(product);
    }

    private Task SimulateLongRunningQuery(CancellationToken cancellationToken)
    {
        var prefer = PreferHeaderParser.Parse(Request.Headers);
        var delay = prefer.WaitSeconds is > 0 && _async.WaitQueryDelayMilliseconds > 0
            ? _async.WaitQueryDelayMilliseconds
            : _async.QueryDelayMilliseconds;
        return delay > 0 ? Task.Delay(delay, cancellationToken) : Task.CompletedTask;
    }

    private static string BuildNextLink(HttpRequest request, int skip, int? remainingTop)
    {
        var parts = new List<string>();
        foreach (var pair in request.Query)
        {
            if (pair.Key.Equals("$skip", StringComparison.OrdinalIgnoreCase)
                || pair.Key.Equals("$top", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            foreach (var value in pair.Value as IEnumerable<string?> ?? Array.Empty<string?>())
            {
                parts.Add($"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(value ?? "")}");
            }
        }

        if (remainingTop is > 0)
        {
            parts.Add($"$top={remainingTop.Value}");
        }

        parts.Add($"$skip={skip}");
        return $"{request.Scheme}://{request.Host}{request.Path}?{string.Join("&", parts)}";
    }
}
