// SteamWorker - zero-credential local Steam API idler

using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using Steamworks;

namespace SteamWorker
{
    class Program
    {
        static void Main(string[] args)
        {
            if (args.Length == 0 || !uint.TryParse(args[0], out uint appId))
            {
                Console.WriteLine(JsonSerializer.Serialize(new { success = false, error = "Invalid or missing AppID argument." }));
                return;
            }

            try
            {
                // Ensure steam_appid.txt exists in current execution directory
                File.WriteAllText("steam_appid.txt", appId.ToString());
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

            bool running = true;
            Console.CancelKeyPress += (sender, eventArgs) => {
                eventArgs.Cancel = true;
                running = false;
            };

            while (running)
            {
                try
                {
                    SteamClient.RunCallbacks();
                }
                catch { }

                Thread.Sleep(1000);
            }

            try
            {
                SteamClient.Shutdown();
            }
            catch { }

            Console.WriteLine(JsonSerializer.Serialize(new {
                success = true,
                status = "STOPPED",
                appid = appId
            }));
        }
    }
}
