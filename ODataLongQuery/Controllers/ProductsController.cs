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
    private readonly AsyncRequestOptions _options;

    public ProductsController(ProductCatalog catalog, IOptions<AsyncRequestOptions> options)
    {
        _catalog = catalog;
        _options = options.Value;
    }

    [EnableQuery]
    public async Task<ActionResult<IEnumerable<Product>>> Get(CancellationToken cancellationToken)
    {
        await SimulateLongRunningQuery(cancellationToken);
        return Ok(_catalog.Products);
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
        var delay = _options.QueryDelayMilliseconds;
        return delay > 0 ? Task.Delay(delay, cancellationToken) : Task.CompletedTask;
    }
}
