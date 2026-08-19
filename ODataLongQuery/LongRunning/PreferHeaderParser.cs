namespace ODataLongQuery.LongRunning;

public sealed record PreferOptions(bool RespondAsync, int? WaitSeconds)
{
    public static PreferOptions Empty { get; } = new(false, null);
}

public static class PreferHeaderParser
{
    public static PreferOptions Parse(IHeaderDictionary headers)
    {
        if (!headers.TryGetValue("Prefer", out var values))
        {
            return PreferOptions.Empty;
        }

        var respondAsync = false;
        int? waitSeconds = null;

        foreach (var value in values)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                continue;
            }

            foreach (var token in SplitPreferences(value))
            {
                var item = token.Trim();
                if (item.Length == 0)
                {
                    continue;
                }

                var separator = item.IndexOfAny(['=', ';']);
                var name = separator < 0 ? item : item[..separator].Trim();
                var raw = separator < 0 ? null : item[(separator + 1)..].Trim().Trim('"');

                if (name.Equals("respond-async", StringComparison.OrdinalIgnoreCase))
                {
                    respondAsync = true;
                }
                else if (name.Equals("wait", StringComparison.OrdinalIgnoreCase)
                         && int.TryParse(raw, out var seconds)
                         && seconds >= 0)
                {
                    waitSeconds = seconds;
                }
            }
        }

        return new PreferOptions(respondAsync, waitSeconds);
    }

    private static IEnumerable<string> SplitPreferences(string header)
    {
        var start = 0;
        var inQuotes = false;

        for (var i = 0; i < header.Length; i++)
        {
            var c = header[i];
            if (c == '"')
            {
                inQuotes = !inQuotes;
            }
            else if (c == ',' && !inQuotes)
            {
                yield return header[start..i];
                start = i + 1;
            }
        }

        if (start < header.Length)
        {
            yield return header[start..];
        }
    }
}
