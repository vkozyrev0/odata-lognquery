namespace ODataLongQuery.DemoData;

public sealed class DemoDataOptions
{
    public const string SectionName = "DemoData";

    public int DatasetSize { get; set; } = 5000;
    public int PageSize { get; set; } = 500;
}
