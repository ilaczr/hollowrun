// HollowRun worker - zero-credential local Steam API idler

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using Steamworks;

namespace HollowRun.Worker
{
    class Program
    {
        private const uint SpacewarAppId = 480;
        private const int GhostHeartbeatTimeoutSeconds = 20;

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetConsoleWindow();

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr windowHandle, int command);

        static void Main(string[] args)
        {
            if (args.Length > 0 && args[0] == "--presence-ghost")
            {
                RunPresenceGhost(args.Length > 1 ? args[1] : null);
                return;
            }

            if (args.Length > 0 && args[0] == "--check-card-drops")
            {
                CheckCardDrops(
                    args.Length > 1 ? args[1] : null,
                    args.Length > 2 && uint.TryParse(args[2], out uint cardAppId) ? cardAppId : 0
                );
                return;
            }

            if (args.Length > 0 && args[0] == "--scan-card-drops")
            {
                ScanCardDrops(args.Length > 1 ? args[1] : null);
                return;
            }

            if (args.Length > 0 && args[0] == "--verify-library")
            {
                VerifyLibraryOwnership(args.Length > 1 ? args[1] : null);
                return;
            }

            uint appId = 0;
            if (args.Length == 0 || !uint.TryParse(args[0], out appId) || appId == SpacewarAppId)
            {
                Console.WriteLine(JsonSerializer.Serialize(new {
                    success = false,
                    error = appId == SpacewarAppId
                        ? "AppID 480 (Spacewar) is blocked and cannot be started by HollowRun."
                        : "Invalid or missing AppID argument."
                }));
                return;
            }

            try
            {
                ConfigureSteamApp(appId);

                SteamClient.Init(appId);
            }
            catch (Exception ex)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { 
                    success = false, 
                    error = $"Failed to initialize Steam API for AppID {appId}: {ex.Message}. Make sure Steam Client is running and logged in." 
                }));
                return;
            }

            if (!SteamClient.IsValid)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { 
                    success = false, 
                    error = $"SteamClient.IsValid returned false for AppID {appId}. Please verify the Steam Desktop Client is currently running and logged into an account." 
                }));
                TryShutdownSteam();
                return;
            }

            try
            {
                if (!SteamApps.IsSubscribed)
                {
                    Console.WriteLine(JsonSerializer.Serialize(new {
                        success = false,
                        error = $"The active Steam account does not own or have access to AppID {appId}."
                    }));
                    TryShutdownSteam();
                    return;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine(JsonSerializer.Serialize(new {
                    success = false,
                    error = $"Could not verify ownership for AppID {appId}: {ex.Message}"
                }));
                TryShutdownSteam();
                return;
            }

            string personaName = SteamClient.Name ?? "Unknown";
            string steamId = SteamClient.SteamId.Value.ToString();

            Console.WriteLine(JsonSerializer.Serialize(new {
                success = true,
                status = "IDLING",
                appid = appId,
                personaName = personaName,
                steamId = steamId,
                startTime = DateTime.UtcNow.ToString("o")
            }));
            Console.Out.Flush();

            using ManualResetEventSlim stopSignal = new(false);
            Console.CancelKeyPress += (sender, eventArgs) => {
                eventArgs.Cancel = true;
                stopSignal.Set();
            };

            while (!stopSignal.Wait(1000))
            {
                try
                {
                    SteamClient.RunCallbacks();
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"Steam callback error: {ex.Message}");
                }
            }

            TryShutdownSteam();

            Console.WriteLine(JsonSerializer.Serialize(new {
                success = true,
                status = "STOPPED",
                appid = appId
            }));
        }

        private static void RunPresenceGhost(string? heartbeatPath)
        {
            try
            {
                IntPtr consoleWindow = GetConsoleWindow();
                if (consoleWindow != IntPtr.Zero) ShowWindow(consoleWindow, 0);
            }
            catch
            {
                // The helper can still remain alive if Windows refuses to hide its console.
            }

            if (string.IsNullOrWhiteSpace(heartbeatPath) || !Path.IsPathFullyQualified(heartbeatPath)) return;

            while (true)
            {
                try
                {
                    if (!File.Exists(heartbeatPath)) return;
                    DateTime lastHeartbeat = File.GetLastWriteTimeUtc(heartbeatPath);
                    if (DateTime.UtcNow - lastHeartbeat > TimeSpan.FromSeconds(GhostHeartbeatTimeoutSeconds)) return;
                }
                catch
                {
                    return;
                }

                Thread.Sleep(2000);
            }
        }

        private static void VerifyLibraryOwnership(string? expectedSteamId)
        {
            try
            {
                if (!IsValidSteamId(expectedSteamId))
                {
                    Console.WriteLine(JsonSerializer.Serialize(new {
                        success = false,
                        error = "Active Steam account is unavailable."
                    }));
                    return;
                }

                uint[] candidates = JsonSerializer.Deserialize<uint[]>(Console.In.ReadToEnd()) ?? [];
                candidates = candidates
                    .Where(appId => appId > 10)
                    .Distinct()
                    .Take(20000)
                    .ToArray();

                if (!SteamClientWebAuth.TryOpen(out SteamClientWebAuth.Session? openedSession, out _))
                {
                    Console.WriteLine(JsonSerializer.Serialize(new {
                        success = false,
                        error = "Steam ownership verifier could not connect to the running Steam client."
                    }));
                    return;
                }
                using SteamClientWebAuth.Session clientSession = openedSession!;

                List<uint> ownedAppIds = [];
                foreach (uint candidate in candidates)
                {
                    try
                    {
                        if (clientSession.IsSubscribedToApp(candidate)) ownedAppIds.Add(candidate);
                    }
                    catch
                    {
                        // A failed individual lookup is not ownership evidence.
                    }
                }

                Console.WriteLine(JsonSerializer.Serialize(new {
                    success = true,
                    steamId = expectedSteamId,
                    ownedAppIds
                }));
            }
            catch (Exception ex)
            {
                Console.WriteLine(JsonSerializer.Serialize(new {
                    success = false,
                    error = $"Steam ownership verification failed: {ex.Message}"
                }));
            }
        }

        private static void CheckCardDrops(string? expectedSteamId, uint appId)
        {
            try
            {
                if (!IsValidSteamId(expectedSteamId) || appId <= 10)
                {
                    Console.WriteLine(JsonSerializer.Serialize(new {
                        success = false,
                        reason = "unavailable"
                    }));
                    return;
                }
                string steamId = expectedSteamId!;

                HttpClient? authenticatedClient = CreateAuthenticatedCommunityClient(steamId, out string failureReason);
                if (authenticatedClient is null)
                {
                    Console.WriteLine(JsonSerializer.Serialize(new {
                        success = false,
                        reason = failureReason
                    }));
                    return;
                }
                using HttpClient client = authenticatedClient;

                string gameCardUrl = $"https://steamcommunity.com/my/gamecards/{appId}/?l=english";
                string html = GetBadgePage(client, gameCardUrl, out Uri? pageUri);
                if (!IsExpectedGameCardPage(pageUri, steamId, appId))
                {
                    Console.WriteLine(JsonSerializer.Serialize(new {
                        success = false,
                        reason = "client-auth-failed"
                    }));
                    return;
                }

                int? dropsRemaining = SteamCommunityCardDrops.ParseGameCardPage(html);
                if (dropsRemaining is null)
                {
                    Console.WriteLine(JsonSerializer.Serialize(new {
                        success = false,
                        reason = "unavailable"
                    }));
                    return;
                }

                Console.WriteLine(JsonSerializer.Serialize(new {
                    success = true,
                    steamId,
                    appId,
                    dropsRemaining
                }));
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Card-drop check failed ({ex.GetType().Name}): {ex.Message}");
                Console.WriteLine(JsonSerializer.Serialize(new {
                    success = false,
                    reason = "unavailable"
                }));
            }
        }

        private static void ScanCardDrops(string? expectedSteamId)
        {
            try
            {
                if (!IsValidSteamId(expectedSteamId))
                {
                    Console.WriteLine(JsonSerializer.Serialize(new {
                        success = false,
                        reason = "steam-client-unavailable"
                    }));
                    return;
                }
                string steamId = expectedSteamId!;

                HttpClient? authenticatedClient = CreateAuthenticatedCommunityClient(steamId, out string failureReason);
                if (authenticatedClient is null)
                {
                    Console.WriteLine(JsonSerializer.Serialize(new {
                        success = false,
                        reason = failureReason
                    }));
                    return;
                }
                using HttpClient client = authenticatedClient;
                // The /my route fails closed by redirecting logged-out requests to Steam's login page.
                string badgeUrl = "https://steamcommunity.com/my/badges/?l=english&p=1";
                string firstPageHtml = GetBadgePage(client, badgeUrl, out Uri? firstPageUri);
                if (!IsExpectedBadgePage(firstPageUri, steamId))
                {
                    Console.WriteLine(JsonSerializer.Serialize(new {
                        success = false,
                        reason = "client-auth-failed"
                    }));
                    return;
                }

                SteamCardDropPage firstPage = SteamCommunityCardDrops.ParsePage(firstPageHtml, 1);
                const int maximumPages = 200;
                int totalPages = Math.Min(firstPage.MaximumPage, maximumPages);
                int failedPages = 0;
                Dictionary<uint, SteamCardDropGame> games = [];
                AddCardDropGames(games, firstPage.Games);
                WriteCardDropProgress(steamId, games, 1, totalPages, failedPages);

                for (int page = 2; page <= totalPages; page++)
                {
                    bool loaded = false;
                    for (int attempt = 0; attempt < 2 && !loaded; attempt++)
                    {
                        try
                        {
                            string pageUrl = $"https://steamcommunity.com/profiles/{steamId}/badges/?l=english&p={page}";
                            string html = GetBadgePage(client, pageUrl, out Uri? pageUri);
                            if (!IsExpectedBadgePage(pageUri, steamId)) throw new InvalidDataException();
                            SteamCardDropPage parsedPage = SteamCommunityCardDrops.ParsePage(html, page);
                            AddCardDropGames(games, parsedPage.Games);
                            loaded = true;
                        }
                        catch when (attempt == 0)
                        {
                            Thread.Sleep(500);
                        }
                    }

                    if (!loaded) failedPages++;
                    WriteCardDropProgress(steamId, games, page, totalPages, failedPages);
                    if (page < totalPages) Thread.Sleep(100);
                }

                Console.WriteLine(JsonSerializer.Serialize(new {
                    success = true,
                    steamId,
                    games = games.Values
                        .OrderBy(game => game.AppId)
                        .Select(game => new { appId = game.AppId, dropsRemaining = game.DropsRemaining }),
                    incomplete = failedPages > 0 || firstPage.MaximumPage > maximumPages,
                    failedPages,
                    scannedPages = totalPages,
                    totalPages = firstPage.MaximumPage
                }));
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Card-drop scan failed ({ex.GetType().Name}): {ex.Message}");
                Console.WriteLine(JsonSerializer.Serialize(new {
                    success = false,
                    reason = "unavailable"
                }));
            }
        }

        private static HttpClient? CreateAuthenticatedCommunityClient(string steamId, out string failureReason)
        {
            failureReason = "steam-client-unavailable";
            if (!SteamClientWebAuth.TryOpen(out SteamClientWebAuth.Session? openedSession, out _)) return null;

            using SteamClientWebAuth.Session clientSession = openedSession!;
            if (!clientSession.TryRequestToken(out ulong apiCall, out _) || apiCall == 0)
            {
                failureReason = "client-auth-failed";
                return null;
            }

            string? communityToken = null;
            DateTime deadline = DateTime.UtcNow.AddSeconds(15);
            while (string.IsNullOrWhiteSpace(communityToken) && DateTime.UtcNow < deadline)
            {
                clientSession.TryGetCurrentSecureToken(out communityToken, out _);
                if (string.IsNullOrWhiteSpace(communityToken)) Thread.Sleep(50);
            }

            if (string.IsNullOrWhiteSpace(communityToken)
                || !communityToken.StartsWith($"{steamId}||", StringComparison.Ordinal))
            {
                failureReason = "client-auth-failed";
                return null;
            }

            HttpClientHandler handler = new() {
                AllowAutoRedirect = true,
                AutomaticDecompression = System.Net.DecompressionMethods.All,
                CookieContainer = new System.Net.CookieContainer()
            };
            handler.CookieContainer.Add(
                new Uri("https://steamcommunity.com"),
                new System.Net.Cookie("steamLoginSecure", communityToken, "/", ".steamcommunity.com") {
                    HttpOnly = true,
                    Secure = true
                }
            );
            HttpClient client = new(handler) {
                MaxResponseContentBufferSize = 4 * 1024 * 1024,
                Timeout = TimeSpan.FromSeconds(20)
            };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("HollowRun Desktop");
            failureReason = string.Empty;
            return client;
        }

        private static string GetBadgePage(HttpClient client, string url, out Uri? finalUri)
        {
            using HttpResponseMessage response = client.GetAsync(url).GetAwaiter().GetResult();
            response.EnsureSuccessStatusCode();
            finalUri = response.RequestMessage?.RequestUri;
            string? contentType = response.Content.Headers.ContentType?.MediaType;
            if (!string.Equals(contentType, "text/html", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("Steam Community returned an unexpected response.");
            }
            return response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
        }

        private static bool IsExpectedBadgePage(Uri? uri, string steamId)
        {
            if (uri is null
                || uri.Scheme != Uri.UriSchemeHttps
                || !string.Equals(uri.Host, "steamcommunity.com", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            string normalizedPath = uri.AbsolutePath.TrimEnd('/');
            return string.Equals(normalizedPath, "/my/badges", StringComparison.OrdinalIgnoreCase)
                || string.Equals(normalizedPath, $"/profiles/{steamId}/badges", StringComparison.OrdinalIgnoreCase)
                || (uri.AbsolutePath.StartsWith("/id/", StringComparison.OrdinalIgnoreCase)
                    && normalizedPath.EndsWith("/badges", StringComparison.OrdinalIgnoreCase));
        }

        private static bool IsExpectedGameCardPage(Uri? uri, string steamId, uint appId)
        {
            if (uri is null
                || uri.Scheme != Uri.UriSchemeHttps
                || !string.Equals(uri.Host, "steamcommunity.com", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            string expectedSuffix = $"/gamecards/{appId}";
            string normalizedPath = uri.AbsolutePath.TrimEnd('/');
            return string.Equals(normalizedPath, $"/my{expectedSuffix}", StringComparison.OrdinalIgnoreCase)
                || string.Equals(normalizedPath, $"/profiles/{steamId}{expectedSuffix}", StringComparison.OrdinalIgnoreCase)
                || (uri.AbsolutePath.StartsWith("/id/", StringComparison.OrdinalIgnoreCase)
                    && normalizedPath.EndsWith(expectedSuffix, StringComparison.OrdinalIgnoreCase));
        }

        private static void AddCardDropGames(
            Dictionary<uint, SteamCardDropGame> games,
            IReadOnlyList<SteamCardDropGame> pageGames)
        {
            foreach (SteamCardDropGame game in pageGames)
            {
                if (!games.TryGetValue(game.AppId, out SteamCardDropGame? existing))
                {
                    games[game.AppId] = game;
                    continue;
                }

                int? dropsRemaining = existing.DropsRemaining is null
                    ? game.DropsRemaining
                    : game.DropsRemaining is null
                        ? existing.DropsRemaining
                        : Math.Max(existing.DropsRemaining.Value, game.DropsRemaining.Value);
                games[game.AppId] = new(game.AppId, dropsRemaining);
            }
        }

        private static void WriteCardDropProgress(
            string steamId,
            Dictionary<uint, SteamCardDropGame> games,
            int scannedPages,
            int totalPages,
            int failedPages)
        {
            Console.WriteLine(JsonSerializer.Serialize(new {
                success = true,
                status = "SCANNING_CARD_DROPS",
                steamId,
                games = games.Values
                    .OrderBy(game => game.AppId)
                    .Select(game => new { appId = game.AppId, dropsRemaining = game.DropsRemaining }),
                incomplete = true,
                failedPages,
                scannedPages,
                totalPages
            }));
            Console.Out.Flush();
        }

        private static void TryShutdownSteam()
        {
            try
            {
                SteamClient.Shutdown();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Steam shutdown error: {ex.Message}");
            }
        }

        private static void ConfigureSteamApp(uint appId)
        {
            string value = appId.ToString();
            File.WriteAllText(Path.Combine(AppContext.BaseDirectory, "steam_appid.txt"), value);
            Environment.SetEnvironmentVariable("SteamAppId", value);
            Environment.SetEnvironmentVariable("SteamGameId", value);
        }

        private static bool IsValidSteamId(string? steamId)
        {
            return steamId is { Length: 17 }
                && steamId.StartsWith("7656", StringComparison.Ordinal)
                && steamId.All(char.IsDigit);
        }
    }
}
