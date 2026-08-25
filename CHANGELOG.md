# Changelog

All notable user-facing changes to HollowRun are documented here.

## 2.0.0 - 2026-08-25

### Changed

- Isolated frontend utilities, artwork, and Settings UI from the main application component for simpler maintenance and direct testing.
- Removed backend tests and duplicate frontend source artwork from packaged application files.
- Made production source-map uploads explicitly opt-in, even when Sentry credentials are present locally.
- Prevented Steam helper processes from inheriting HollowRun authentication, data-path, Electron, and crash-reporting environment variables.
- Made cached library metadata and hidden-ghost configuration writes atomic.
- Consolidated settings, window-state, cache, and hidden-ghost persistence around one atomic JSON writer.
- Consolidated Electron startup probes around one authenticated, size-bounded local-service client.
- Completed the build and verification command guide.

### Fixed

- Restored the complete root test suite and added frontend regression coverage.
- Enabled undefined-variable linting for the mixed browser and Node frontend toolchain.
- Fixed packaged game workers being prepared inside the read-only ASAR instead of writable application data.
- Fixed persisted card-drop queues silently failing to restore.
- Fixed Recent Games crashing when its extracted timestamp helper was not imported.
- Prevented a late worker exit or startup timeout from removing a newer session for the same AppID.
- Bounded idle-worker startup output and improved errors when worker preparation fails.
- Reused unchanged per-game worker files so a quick restart does not rewrite a worker that is still exiting.
- Extended crash-report privacy filtering to redact Windows, macOS, and Linux user-directory paths in renderer reports.
- Restored the packaged startup logo and window icon by pointing them at the compiled frontend assets.
- Added a fail-closed startup handler for unexpected Electron initialization errors.

## 1.2.14 - 2026-08-22

### Added

- Added the Windows setup installer for the first time, alongside the portable executable.

### Changed

- Enabled ASAR packaging and unpacked the native Steam worker where Windows can execute it.
- Improved startup speed, splash progress, local-service readiness checks, and single-instance handling.
- Improved packaged custom-status worker discovery and portable application relaunching.

### Fixed

- Fixed normal game sessions failing to start from a packaged ASAR build by moving temporary workers into writable application data.
- Fixed the application closing during a slow second-stage startup.
- Fixed restart from Settings for portable builds.
- Fixed custom status failing to launch in packaged builds.
- Improved local port-conflict reporting and stale-process handling.

## 1.2.13 - 2026-08-22

### Added

- Added the Settings page.
- Added optional automatic crash reporting through Sentry, disabled by default.
- Added privacy filtering and an explanation of what crash reports contain.
- Added production source-map support for readable crash reports.

### Changed

- Limited the test-report action to development builds.
- Required a restart when changing native crash-monitoring state.

## 1.2.12 - 2026-08-21

### Added

- Added the opt-in custom Steam **In-Game** status feature using a managed hidden ghost shortcut.
- Added setup and cleanup for Steam's local UI debugging marker.
- Added automatic reassertion of the custom status after another game launches.

### Changed

- Kept the managed shortcut hidden from the normal Steam Library after creation.
- Blocked AppID 480 from discovery, queues, API requests, and worker startup.

## 1.2.11 - 2026-08-15

### Changed

- Card-drop scanning now starts automatically when the connected Steam account becomes available.

## 1.2.10 - 2026-08-15

### Added

- Added streamed discovery of owned games with Steam trading-card drops remaining.
- Added sequential and bulk card-drop queues, supporting up to Steam's 32 simultaneous AppID limit.
- Added live card-drop count checks and automatic queue advancement.
- Added the active Steam profile's public avatar, full or animated background, mini-profile background, and avatar frame.
- Added account-specific ownership verification through the local Steam client.

### Changed

- Improved library metadata, local caching, search, recent-game history, and startup loading behavior.

## 1.2.9 - 2026-08-09

### Added

- Reintroduced the project as **HollowRun**, replacing the earlier IdleTool name and branding.
- Added the Electron desktop shell, native startup splash, portable packaging, window-state persistence, and synchronized versioning tools.
- Added local Steam library discovery, active-account verification, game metadata, search, and multi-session idling.

### Changed

- Removed committed build artifacts and moved generated dependencies, caches, and packages out of version control.
- Reworked the interface and backend around a zero-credential connection to the running Steam desktop client.

## 1.0.0 - 2026-08-07

### Added

- Initial IdleTool prototype with a local backend, web interface, Windows launcher, and isolated Steamworks worker.

Versions between 1.0.0 and 1.2.9 do not have distinct release snapshots in this
repository; their early development work is summarized under 1.2.9.
