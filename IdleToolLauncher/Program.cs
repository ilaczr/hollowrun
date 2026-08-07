using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace IdleToolLauncher
{
    public class Program
    {
        public static void Main(string[] args)
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
                if (!Directory.Exists(backendDir))
                {
                    backendDir = Path.Combine(Directory.GetCurrentDirectory(), "backend");
                }
            }

            if (!Directory.Exists(backendDir))
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"[Error] Could not find backend directory: {backendDir}");
                Console.ReadLine();
                return;
            }

            Console.WriteLine($"[Info] Starting Node.js backend from: {backendDir}");

            var nodeProcessInfo = new ProcessStartInfo
            {
                FileName = "node",
                Arguments = "server.js",
                WorkingDirectory = backendDir,
                UseShellExecute = false
            };

            Process nodeProcess;
            try
            {
                nodeProcess = Process.Start(nodeProcessInfo);
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"[Error] Failed to start node.js. Is node installed and in PATH? {ex.Message}");
                Console.ReadLine();
                return;
            }

            Thread.Sleep(2000);

            string url = "http://localhost:3824";
            Console.WriteLine($"[Info] Opening dashboard in your browser: {url}");
            OpenBrowser(url);

            if (nodeProcess != null && !nodeProcess.HasExited)
            {
                nodeProcess.WaitForExit();
            }
        }

        public static void OpenBrowser(string url)
        {
            try
            {
                if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                {
                    Process.Start(new ProcessStartInfo("cmd", $"/c start {url}") { CreateNoWindow = true });
                }
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
