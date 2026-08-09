// HollowRun worker - zero-credential local Steam API idler

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using Steamworks;

namespace HollowRun.Worker
{
    class Program
    {
        static void Main(string[] args)
        {
            if (args.Length > 0 && args[0] == "--verify-library")
            {
                VerifyLibraryOwnership();
                return;
            }

            if (args.Length == 0 || !uint.TryParse(args[0], out uint appId))
            {
                Console.WriteLine(JsonSerializer.Serialize(new { success = false, error = "Invalid or missing AppID argument." }));
                return;
            }

            try
            {
                string appIdFile = Path.Combine(AppContext.BaseDirectory, "steam_appid.txt");
                File.WriteAllText(appIdFile, appId.ToString());
                Environment.SetEnvironmentVariable("SteamAppId", appId.ToString());
                Environment.SetEnvironmentVariable("SteamGameId", appId.ToString());

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

        private static void VerifyLibraryOwnership()
        {
            try
            {
                uint[] candidates = JsonSerializer.Deserialize<uint[]>(Console.In.ReadToEnd()) ?? [];
                candidates = candidates
                    .Where(appId => appId > 10)
                    .Distinct()
                    .Take(20000)
                    .ToArray();

                Environment.SetEnvironmentVariable("SteamAppId", "480");
                Environment.SetEnvironmentVariable("SteamGameId", "480");
                SteamClient.Init(480);

                if (!SteamClient.IsValid)
                {
                    Console.WriteLine(JsonSerializer.Serialize(new {
                        success = false,
                        error = "Steam ownership verifier could not connect to the running Steam client."
                    }));
                    return;
                }

                List<uint> ownedAppIds = [];
                foreach (uint candidate in candidates)
                {
                    try
                    {
                        if (SteamApps.IsSubscribedToApp(candidate)) ownedAppIds.Add(candidate);
                    }
                    catch
                    {
                        // A failed individual lookup is not ownership evidence.
                    }
                }

                Console.WriteLine(JsonSerializer.Serialize(new {
                    success = true,
                    steamId = SteamClient.SteamId.Value.ToString(),
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
            finally
            {
                TryShutdownSteam();
            }
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
    }
}
