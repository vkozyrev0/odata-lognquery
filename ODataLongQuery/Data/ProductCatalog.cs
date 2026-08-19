using Microsoft.Extensions.Options;
using ODataLongQuery.DemoData;
using ODataLongQuery.Models;

namespace ODataLongQuery.Data;

public sealed class ProductCatalog
{
    private static readonly string[] Categories = ["Beverages", "Condiments", "Produce", "Seafood", "Dairy"];
    private static readonly string[] SeedNames =
    [
        "Chai", "Chang", "Aniseed Syrup", "Chef Anton's Cajun Seasoning",
        "Grandma's Boysenberry Spread", "Uncle Bob's Organic Dried Pears",
        "Northwoods Cranberry Sauce", "Mishi Kobe Niku", "Ikura",
        "Queso Cabrales", "Queso Manchego La Pastora", "Konbu",
        "Tofu", "Genen Shouyu", "Pavlova", "Alice Mutton", "Carnarvon Tigers",
        "Teatime Chocolate Biscuits", "Sir Rodney's Marmalade", "Gustaf's Knackebrod"
    ];

    public IQueryable<Product> Products { get; }
    public int DatasetSize { get; }
    public int PageSize { get; }

    public ProductCatalog(IOptions<DemoDataOptions> options)
    {
        DatasetSize = Math.Max(1, options.Value.DatasetSize);
        PageSize = Math.Max(1, options.Value.PageSize);
        Products = Create(DatasetSize).AsQueryable();
    }

    private static List<Product> Create(int count)
    {
        return Enumerable.Range(1, count).Select(id =>
        {
            var index = id - 1;
            var name = index < SeedNames.Length
                ? SeedNames[index]
                : $"{SeedNames[index % SeedNames.Length]} #{id}";
            return new Product
            {
                Id = id,
                Name = name,
                Category = Categories[index % Categories.Length],
                Price = 4.50m + (index % 200) * 0.75m,
                UnitsInStock = (index * 7) % 80,
                Discontinued = id % 7 == 0
            };
        }).ToList();
    }
}
