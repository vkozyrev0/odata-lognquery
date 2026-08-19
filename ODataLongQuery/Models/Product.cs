namespace ODataLongQuery.Models;

public sealed class Product
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Category { get; set; } = "";
    public decimal Price { get; set; }
    public int UnitsInStock { get; set; }
    public bool Discontinued { get; set; }
}
