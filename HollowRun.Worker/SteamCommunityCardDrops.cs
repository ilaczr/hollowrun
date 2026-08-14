using System.Net;
using System.Text.RegularExpressions;

namespace HollowRun.Worker;

internal sealed record SteamCardDropGame(uint AppId, int? DropsRemaining);

internal sealed record SteamCardDropPage(
    int MaximumPage,
    IReadOnlyList<SteamCardDropGame> Games
);

internal static partial class SteamCommunityCardDrops
{
    [GeneratedRegex(@"</?div\b[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex DivTagPattern();

    [GeneratedRegex(@"<[a-z][^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex OpeningTagPattern();

    [GeneratedRegex(@"<script\b[^>]*>[\s\S]*?</script>|<style\b[^>]*>[\s\S]*?</style>", RegexOptions.IgnoreCase)]
    private static partial Regex ScriptAndStylePattern();

    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex HtmlTagPattern();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespacePattern();

    [GeneratedRegex(@"\d+\s*card drops?\s*remaining", RegexOptions.IgnoreCase)]
    private static partial Regex RemainingDropsPattern();

    [GeneratedRegex(@"(?<count>\d+)\s*card drops?\s*remaining", RegexOptions.IgnoreCase)]
    private static partial Regex RemainingDropCountPattern();

    [GeneratedRegex(@"\bno\s+card drops?\s+remaining\b", RegexOptions.IgnoreCase)]
    private static partial Regex NoRemainingDropsPattern();

    [GeneratedRegex(@"/gamecards/(?<appid>[1-9]\d*)(?:/|$|[?#])", RegexOptions.IgnoreCase)]
    private static partial Regex GameCardsPathPattern();

    [GeneratedRegex(@"(?:[?&]|&amp;)p=(?<page>\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex PageQueryPattern();

    internal static SteamCardDropPage ParsePage(string html, int currentPage)
    {
        if (string.IsNullOrWhiteSpace(html))
        {
            return new(Math.Max(1, currentPage), []);
        }

        List<SteamCardDropGame> games = [];

        foreach (string row in ExtractDivBlocksByClass(html, "badge_row"))
        {
            if (!HasDropsRemaining(row)) continue;
            uint? appId = GetRowAppId(row);
            if (appId is null || appId <= 10) continue;
            games.Add(new(appId.Value, GetRowDropCount(row)));
        }

        int maximumPage = Math.Max(1, currentPage);
        foreach (Match match in PageQueryPattern().Matches(html))
        {
            if (int.TryParse(match.Groups["page"].Value, out int page))
            {
                maximumPage = Math.Max(maximumPage, page);
            }
        }

        return new(maximumPage, games);
    }

    internal static int? ParseGameCardPage(string html)
    {
        if (string.IsNullOrWhiteSpace(html)) return null;
        string text = GetText(html);
        Match countMatch = RemainingDropCountPattern().Match(text);
        if (countMatch.Success
            && int.TryParse(countMatch.Groups["count"].Value, out int count))
        {
            return count;
        }
        return NoRemainingDropsPattern().IsMatch(text) ? 0 : null;
    }

    private static IReadOnlyList<string> ExtractDivBlocksByClass(string html, string className)
    {
        List<string> blocks = [];
        int currentStart = -1;
        int depth = 0;

        foreach (Match match in DivTagPattern().Matches(html))
        {
            bool isClosingTag = match.Value.StartsWith("</div", StringComparison.OrdinalIgnoreCase);

            if (currentStart >= 0)
            {
                depth += isClosingTag ? -1 : 1;
                if (depth == 0)
                {
                    blocks.Add(html.Substring(currentStart, match.Index + match.Length - currentStart));
                    currentStart = -1;
                }
                continue;
            }

            if (!isClosingTag && HasClass(match.Value, className))
            {
                currentStart = match.Index;
                depth = 1;
            }
        }

        return blocks;
    }

    private static bool HasDropsRemaining(string rowHtml)
    {
        if (RowHasClass(rowHtml, "badge_title_playgame")
            || RowHasClass(rowHtml, "badge_title_stats_playgame"))
        {
            return true;
        }
        if (RowHasClass(rowHtml, "badge_title_stats_completed")) return false;
        return RemainingDropsPattern().IsMatch(GetText(rowHtml));
    }

    private static uint? GetRowAppId(string rowHtml)
    {
        foreach (Match match in OpeningTagPattern().Matches(rowHtml))
        {
            if (!match.Value.StartsWith("<a", StringComparison.OrdinalIgnoreCase)) continue;
            string href = ReadHtmlAttribute(match.Value, "href");
            Match appMatch = GameCardsPathPattern().Match(href);
            if (appMatch.Success && uint.TryParse(appMatch.Groups["appid"].Value, out uint appId))
            {
                return appId;
            }
        }
        return null;
    }

    private static int? GetRowDropCount(string rowHtml)
    {
        Match match = RemainingDropCountPattern().Match(GetText(rowHtml));
        return match.Success && int.TryParse(match.Groups["count"].Value, out int count) ? count : null;
    }

    private static bool RowHasClass(string html, string className)
    {
        foreach (Match match in OpeningTagPattern().Matches(html))
        {
            if (HasClass(match.Value, className)) return true;
        }
        return false;
    }

    private static bool HasClass(string openingTag, string className)
    {
        return ReadHtmlAttribute(openingTag, "class")
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
            .Contains(className, StringComparer.Ordinal);
    }

    private static string ReadHtmlAttribute(string openingTag, string attributeName)
    {
        string escapedName = Regex.Escape(attributeName);
        Match match = Regex.Match(
            openingTag,
            $$"""(?:^|\s){{escapedName}}\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<plain>[^\s>]+))""",
            RegexOptions.IgnoreCase
        );
        if (!match.Success) return string.Empty;
        string value = match.Groups["double"].Success
            ? match.Groups["double"].Value
            : match.Groups["single"].Success
                ? match.Groups["single"].Value
                : match.Groups["plain"].Value;
        return WebUtility.HtmlDecode(value);
    }

    private static string GetText(string html)
    {
        string withoutScripts = ScriptAndStylePattern().Replace(html, " ");
        string withoutTags = HtmlTagPattern().Replace(withoutScripts, " ");
        return WhitespacePattern().Replace(WebUtility.HtmlDecode(withoutTags), " ").Trim();
    }
}
