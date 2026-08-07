using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;

namespace IdleTool.Launcher
{
    public class Program
    {
        private const string DashboardUrl = "http://127.0.0.1:3824";

        public static async Task Main(string[] args)
        {
            Console.Title = "IdleTool - Backend Server";
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("========================================");
            Console.WriteLine("           IdleTool Launcher");
            Console.WriteLine("========================================");
            Console.ResetColor();

            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string backendDir = Path.Combine(exeDir, "backend");

            if (!Directory.Exists(backendDir))
            {
                backendDir = Path.GetFullPath(Path.Combine(exeDir, "..", "..", "..", "..", "backend"));
            }

            string serverPath = Path.Combine(backendDir, "server.js");
            if (!File.Exists(serverPath))
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"[Error] Could not find the IdleTool backend: {serverPath}");
                Console.ReadLine();
                return;
            }

            Console.WriteLine($"[Info] Starting Node.js backend from: {backendDir}");

            Process? nodeProcess;
            try
            {
                var nodeProcessInfo = new ProcessStartInfo
                {
                    FileName = FindNodeExecutable(),
                    WorkingDirectory = backendDir,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                nodeProcessInfo.ArgumentList.Add("server.js");
                nodeProcess = Process.Start(nodeProcessInfo);
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"[Error] Failed to start node.js. Is node installed and in PATH? {ex.Message}");
                Console.ReadLine();
                return;
            }

            if (nodeProcess == null || !await WaitForBackend(nodeProcess))
            {
                if (nodeProcess is { HasExited: false }) nodeProcess.Kill(entireProcessTree: true);
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("[Error] The IdleTool backend did not become ready.");
                Console.ReadLine();
                return;
            }

            Console.WriteLine($"[Info] Opening dashboard in your browser: {DashboardUrl}");
            OpenBrowser(DashboardUrl);

            if (!nodeProcess.HasExited)
            {
                await nodeProcess.WaitForExitAsync();
            }
        }

        private static async Task<bool> WaitForBackend(Process nodeProcess)
        {
            using HttpClient client = new() { Timeout = TimeSpan.FromSeconds(1) };
            for (int attempt = 0; attempt < 30 && !nodeProcess.HasExited; attempt++)
            {
                try
                {
                    using HttpResponseMessage response = await client.GetAsync($"{DashboardUrl}/api/status");
                    if (response.IsSuccessStatusCode) return true;
                }
                catch (HttpRequestException) { }
                catch (TaskCanceledException) { }

                await Task.Delay(250);
            }

            return false;
        }

        private static string FindNodeExecutable()
        {
            string? pathValue = Environment.GetEnvironmentVariable("PATH");
            if (string.IsNullOrWhiteSpace(pathValue))
            {
                throw new FileNotFoundException("The PATH environment variable is empty.");
            }

            foreach (string entry in pathValue.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            {
                string directory = entry.Trim().Trim('"');
                if (string.IsNullOrWhiteSpace(directory)) continue;

                string candidate = Path.Combine(directory, "node.exe");
                if (File.Exists(candidate)) return candidate;
            }

            throw new FileNotFoundException("node.exe was not found in PATH.");
        }

        private static void OpenBrowser(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine($"[Warning] Failed to automatically open browser: {ex.Message}");
                Console.WriteLine($"Please open {url} manually.");
            }
        }
    }
}
