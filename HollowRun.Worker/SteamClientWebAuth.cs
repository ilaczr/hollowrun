using System.Diagnostics;
using System.Runtime.InteropServices;

namespace HollowRun.Worker;

internal static class SteamClientWebAuth
{
    private const int CreateSteamPipeMethodIndex = 0;
    private const int ReleaseSteamPipeMethodIndex = 1;
    private const int ConnectToGlobalUserMethodIndex = 2;
    private const int ReleaseUserMethodIndex = 4;
    private const int GetSteamAppsMethodIndex = 15;
    private const int GetClientUserMethodIndex = 8;
    private const int IsSubscribedAppMethodIndex = 6;
    private const int GetCurrentWebAuthTokenMethodIndex = 52;
    private const int RequestWebAuthTokenMethodIndex = 53;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private delegate nint CreateInterfaceDelegate(
        [MarshalAs(UnmanagedType.LPStr)] string interfaceName,
        nint returnCode
    );

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    private delegate int CreateSteamPipeDelegate(nint self);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    [return: MarshalAs(UnmanagedType.I1)]
    private delegate bool ReleaseSteamPipeDelegate(nint self, int steamPipe);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    private delegate int ConnectToGlobalUserDelegate(nint self, int steamPipe);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    private delegate void ReleaseUserDelegate(nint self, int steamPipe, int steamUser);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall, CharSet = CharSet.Ansi)]
    private delegate nint GetSteamAppsDelegate(
        nint self,
        int steamUser,
        int steamPipe,
        [MarshalAs(UnmanagedType.LPStr)] string interfaceName
    );

    [UnmanagedFunctionPointer(CallingConvention.ThisCall, CharSet = CharSet.Ansi)]
    private delegate nint GetIClientUserDelegate(
        nint self,
        int steamUser,
        int steamPipe,
        [MarshalAs(UnmanagedType.LPStr)] string interfaceName
    );

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    [return: MarshalAs(UnmanagedType.I1)]
    private delegate bool IsSubscribedAppDelegate(nint self, uint appId);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    [return: MarshalAs(UnmanagedType.I1)]
    private delegate bool GetCurrentWebAuthTokenDelegate(
        nint self,
        nint tokenBuffer,
        int tokenBufferSize,
        nint secondaryBuffer,
        int secondaryBufferSize
    );

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    private delegate ulong RequestWebAuthTokenDelegate(nint self);

    internal sealed class Session : IDisposable
    {
        private nint library;
        private readonly nint steamClient;
        private readonly int steamPipe;
        private readonly int steamUser;
        private readonly nint clientUser;
        private readonly nint steamApps;

        internal Session(
            nint library,
            nint steamClient,
            int steamPipe,
            int steamUser,
            nint clientUser,
            nint steamApps)
        {
            this.library = library;
            this.steamClient = steamClient;
            this.steamPipe = steamPipe;
            this.steamUser = steamUser;
            this.clientUser = clientUser;
            this.steamApps = steamApps;
        }

        internal bool TryRequestToken(out ulong apiCall, out string stage)
        {
            apiCall = 0;
            stage = "request-token";
            try
            {
                RequestWebAuthTokenDelegate requestToken = Marshal.GetDelegateForFunctionPointer<RequestWebAuthTokenDelegate>(
                    ReadVirtualMethod(clientUser, RequestWebAuthTokenMethodIndex)
                );
                apiCall = requestToken(clientUser);
                stage = "complete";
                return apiCall != 0;
            }
            catch
            {
                stage = "exception";
                return false;
            }
        }

        internal bool TryGetCurrentSecureToken(out string? token, out string stage)
        {
            token = null;
            stage = "get-token";
            nint tokenBuffer = 0;
            nint secondaryBuffer = 0;
            try
            {
                GetCurrentWebAuthTokenDelegate getCurrentToken = Marshal.GetDelegateForFunctionPointer<GetCurrentWebAuthTokenDelegate>(
                    ReadVirtualMethod(clientUser, GetCurrentWebAuthTokenMethodIndex)
                );
                const int bufferSize = 4 * 1024;
                tokenBuffer = Marshal.AllocHGlobal(bufferSize);
                secondaryBuffer = Marshal.AllocHGlobal(bufferSize);
                byte[] empty = new byte[bufferSize];
                Marshal.Copy(empty, 0, tokenBuffer, bufferSize);
                Marshal.Copy(empty, 0, secondaryBuffer, bufferSize);
                if (!getCurrentToken(
                        clientUser,
                        tokenBuffer,
                        bufferSize,
                        secondaryBuffer,
                        bufferSize))
                {
                    stage = "token-empty";
                    return false;
                }

                token = Marshal.PtrToStringUTF8(tokenBuffer);
                stage = "complete";
                return !string.IsNullOrWhiteSpace(token);
            }
            catch
            {
                token = null;
                stage = "exception";
                return false;
            }
            finally
            {
                if (tokenBuffer != 0) Marshal.FreeHGlobal(tokenBuffer);
                if (secondaryBuffer != 0) Marshal.FreeHGlobal(secondaryBuffer);
            }
        }

        internal bool IsSubscribedToApp(uint appId)
        {
            IsSubscribedAppDelegate isSubscribed = Marshal.GetDelegateForFunctionPointer<IsSubscribedAppDelegate>(
                ReadVirtualMethod(steamApps, IsSubscribedAppMethodIndex)
            );
            return isSubscribed(steamApps, appId);
        }

        public void Dispose()
        {
            if (library == 0) return;
            try
            {
                ReleaseUserDelegate releaseUser = Marshal.GetDelegateForFunctionPointer<ReleaseUserDelegate>(
                    ReadVirtualMethod(steamClient, ReleaseUserMethodIndex)
                );
                releaseUser(steamClient, steamPipe, steamUser);
            }
            catch
            {
                // The process is exiting; failure to release this short-lived handle is harmless.
            }

            try
            {
                ReleaseSteamPipeDelegate releasePipe = Marshal.GetDelegateForFunctionPointer<ReleaseSteamPipeDelegate>(
                    ReadVirtualMethod(steamClient, ReleaseSteamPipeMethodIndex)
                );
                releasePipe(steamClient, steamPipe);
            }
            catch
            {
                // The Steam client owns the global user and remains untouched.
            }

            NativeLibrary.Free(library);
            library = 0;
        }
    }

    internal static bool TryOpen(out Session? session, out string stage)
    {
        session = null;
        stage = "unsupported";
        if (!OperatingSystem.IsWindows()) return false;

        string? steamClientPath = FindSteamClientPath();
        if (steamClientPath is null)
        {
            stage = "client-path";
            return false;
        }

        nint library = 0;
        nint steamClient = 0;
        int steamPipe = 0;
        int steamUser = 0;
        try
        {
            library = NativeLibrary.Load(steamClientPath);
            CreateInterfaceDelegate createInterface = Marshal.GetDelegateForFunctionPointer<CreateInterfaceDelegate>(
                NativeLibrary.GetExport(library, "CreateInterface")
            );

            steamClient = createInterface("SteamClient020", 0);
            if (steamClient == 0)
            {
                stage = "steam-client";
                return false;
            }

            CreateSteamPipeDelegate createPipe = Marshal.GetDelegateForFunctionPointer<CreateSteamPipeDelegate>(
                ReadVirtualMethod(steamClient, CreateSteamPipeMethodIndex)
            );
            steamPipe = createPipe(steamClient);
            if (steamPipe == 0)
            {
                stage = "steam-pipe";
                return false;
            }

            ConnectToGlobalUserDelegate connectUser = Marshal.GetDelegateForFunctionPointer<ConnectToGlobalUserDelegate>(
                ReadVirtualMethod(steamClient, ConnectToGlobalUserMethodIndex)
            );
            steamUser = connectUser(steamClient, steamPipe);
            if (steamUser == 0)
            {
                stage = "global-user";
                return false;
            }

            nint clientEngine = createInterface("CLIENTENGINE_INTERFACE_VERSION005", 0);
            if (clientEngine == 0)
            {
                stage = "client-engine";
                return false;
            }

            GetIClientUserDelegate getIClientUser = Marshal.GetDelegateForFunctionPointer<GetIClientUserDelegate>(
                ReadVirtualMethod(clientEngine, GetClientUserMethodIndex)
            );
            nint clientUser = getIClientUser(
                clientEngine,
                steamUser,
                steamPipe,
                "CLIENTUSER_INTERFACE_VERSION001"
            );
            if (clientUser == 0)
            {
                stage = "client-user";
                return false;
            }

            GetSteamAppsDelegate getSteamApps = Marshal.GetDelegateForFunctionPointer<GetSteamAppsDelegate>(
                ReadVirtualMethod(steamClient, GetSteamAppsMethodIndex)
            );
            nint steamApps = getSteamApps(
                steamClient,
                steamUser,
                steamPipe,
                "STEAMAPPS_INTERFACE_VERSION008"
            );
            if (steamApps == 0)
            {
                stage = "steam-apps";
                return false;
            }

            session = new Session(library, steamClient, steamPipe, steamUser, clientUser, steamApps);
            library = 0;
            stage = "complete";
            return true;
        }
        catch
        {
            stage = "exception";
            return false;
        }
        finally
        {
            if (library != 0)
            {
                ReleasePartialConnection(steamClient, steamPipe, steamUser);
                NativeLibrary.Free(library);
            }
        }
    }

    private static void ReleasePartialConnection(nint steamClient, int steamPipe, int steamUser)
    {
        if (steamClient == 0) return;
        if (steamUser != 0)
        {
            try
            {
                ReleaseUserDelegate releaseUser = Marshal.GetDelegateForFunctionPointer<ReleaseUserDelegate>(
                    ReadVirtualMethod(steamClient, ReleaseUserMethodIndex)
                );
                releaseUser(steamClient, steamPipe, steamUser);
            }
            catch { }
        }
        if (steamPipe != 0)
        {
            try
            {
                ReleaseSteamPipeDelegate releasePipe = Marshal.GetDelegateForFunctionPointer<ReleaseSteamPipeDelegate>(
                    ReadVirtualMethod(steamClient, ReleaseSteamPipeMethodIndex)
                );
                releasePipe(steamClient, steamPipe);
            }
            catch { }
        }
    }

    private static nint ReadVirtualMethod(nint instance, int index)
    {
        nint virtualTable = Marshal.ReadIntPtr(instance);
        if (virtualTable == 0) throw new InvalidOperationException("Steam interface has no virtual table.");
        nint method = Marshal.ReadIntPtr(virtualTable, index * nint.Size);
        if (method == 0) throw new InvalidOperationException("Steam interface method is unavailable.");
        return method;
    }

    private static string? FindSteamClientPath()
    {
        try
        {
            using Process? steam = Process.GetProcessesByName("steam").FirstOrDefault();
            string? executablePath = steam?.MainModule?.FileName;
            if (string.IsNullOrWhiteSpace(executablePath)) return null;
            string clientPath = Path.Combine(Path.GetDirectoryName(executablePath)!, "steamclient64.dll");
            return File.Exists(clientPath) ? clientPath : null;
        }
        catch
        {
            return null;
        }
    }
}
