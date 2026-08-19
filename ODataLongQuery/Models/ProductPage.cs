using System.Text.Json.Serialization;

namespace ODataLongQuery.Models;

public sealed class ProductPage
{
    [JsonPropertyName("@odata.context")]
    public string? Context { get; set; }

    [JsonPropertyName("@odata.count")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? Count { get; set; }

    [JsonPropertyName("value")]
    public List<Product> Value { get; set; } = [];

    [JsonPropertyName("@odata.nextLink")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? NextLink { get; set; }
}
