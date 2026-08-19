using ODataLongQuery.Models;

namespace ODataLongQuery.Data;

public sealed class ProductCatalog
{
    public IQueryable<Product> Products { get; }

    public ProductCatalog()
    {
        Products = Create().AsQueryable();
    }

    private static List<Product> Create()
    {
        var categories = new[] { "Beverages", "Condiments", "Produce", "Seafood", "Dairy" };
        var names = new[]
        {
            "Chai", "Chang", "Aniseed Syrup", "Chef Anton's Cajun Seasoning",
            "Grandma's Boysenberry Spread", "Uncle Bob's Organic Dried Pears",
            "Northwoods Cranberry Sauce", "Mishi Kobe Niku", "Ikura",
            "Queso Cabrales", "Queso Manchego La Pastora", "Konbu",
            "Tofu", "Genen Shouyu", "Pavlova", "Alice Mutton", "Carnarvon Tigers",
            "Teatime Chocolate Biscuits", "Sir Rodney's Marmalade", "Gustaf's Knackebrod"
        };

        return names.Select((name, index) => new Product
        {
            Id = index + 1,
            Name = name,
            Category = categories[index % categories.Length],
            Price = 4.50m + (index * 3.25m),
            UnitsInStock = (index * 7) % 80,
            Discontinued = index % 7 == 0
        }).ToList();
    }
}
