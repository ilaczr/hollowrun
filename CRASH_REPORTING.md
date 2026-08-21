# Crash reporting configuration

HollowRun's crash reporter is fail-closed. The Settings toggle is off by default,
and it cannot be enabled until a valid Sentry DSN is packaged with the application.

## 1. Create the Sentry project

1. Create or sign in to a Sentry organization. For an EU-focused distribution,
   select Sentry's Germany data region when creating the organization if that option
   is available to the chosen plan.
2. Create one project named **HollowRun** with the **Electron** platform.
3. Open **Project Settings > Client Keys (DSN)** and copy the **Public DSN**. It
   has this form:

   ```text
   https://PUBLIC_KEY@oNUMBER.ingest.sentry.io/PROJECT_ID
   ```

4. The public DSN is stored as `PACKAGED_SENTRY_DSN` in
   `crash-reporting-config.cjs`. The DSN is an ingestion key and is expected to ship
   in a client application. Do not put a Sentry auth token there.

For local testing without editing the packaged value, set an environment variable
before starting Electron:

```powershell
$env:HOLLOWRUN_SENTRY_DSN = 'https://PUBLIC_KEY@oNUMBER.ingest.sentry.io/PROJECT_ID'
npm.cmd start
```

## 2. Connect the private GitHub repository

The GitHub integration can associate Sentry issues and releases with the private
HollowRun repository. Grant the Sentry GitHub app access only to this repository
unless Sentry needs access to others.

1. In Sentry, open **Settings > Integrations > GitHub** and choose **Add
   Installation**.
2. In GitHub, choose the account or organization that owns HollowRun, select **Only
   select repositories**, and grant access to the private HollowRun repository.
3. Return to Sentry and finish the installation. Select HollowRun as the repository
   used by this Sentry project if prompted.
4. Use Sentry's **Create GitHub Issue** or **Link GitHub Issue** action on an
   actionable grouped Sentry issue. Do not automatically create one GitHub issue per
   crash event.

The GitHub app installation is configured in Sentry/GitHub and does not add a GitHub
token to the HollowRun executable. Release builds automatically ask Sentry to
associate the current Git commit when the source-map credentials in section 4 are
configured. Missing or empty commit ranges do not fail the application build.

## 3. Configure email notifications

1. Use the dedicated crash-report email address for the Sentry account, or add that
   address as an organization member with access to the HollowRun project.
2. Open **Alerts** for the HollowRun project and create an **Issue Alert**.
3. Trigger the alert when a new issue is created and when a resolved issue regresses.
4. Add an email notification action for the dedicated account/member.
5. Do not create a GitHub issue for every event. Sentry groups repeated events;
   create or link a private GitHub issue only after a grouped failure is actionable.

No GitHub token or email-provider credential belongs in the HollowRun executable.

## 4. Configure source-map uploads

Source maps turn minified React stack traces back into source filenames and line
numbers. They are uploaded during a release build and deleted from `frontend/dist`
after a successful upload.

1. In Sentry organization settings, create an organization auth token/internal
   integration for CI. Sentry's current **Organization Token** type is created with
   the fixed `org:ci` scope; that is sufficient for this build's release, commit,
   and source-map operations. Restrict its project access to HollowRun where the
   Sentry plan supports that restriction.
2. Copy `frontend/.env.example` to `frontend/.env.local`.
3. Fill in:

   ```dotenv
   SENTRY_AUTH_TOKEN=the_private_ci_token
   SENTRY_ORG=the_organization_slug
   SENTRY_PROJECT=hollowrun
   ```

4. Set `SENTRY_URL=https://de.sentry.io` for this project's Germany data region.
   A project in Sentry's US region would instead use `https://us.sentry.io`.
5. Keep `frontend/.env.local` private. The repository ignores `.env.local` files.

The release name is generated as `hollowrun@<package version>` in both the runtime
and source-map build. Keep the root and frontend package versions synchronized with
the existing version scripts.

## 5. Privacy and retention

In the Sentry project:

1. Keep default server-side data scrubbing enabled.
2. Do not enable Session Replay, tracing, profiling, log collection, screenshots,
   or automatic user/IP enrichment for this project.
3. Choose the shortest retention period that meets the project's debugging needs.
4. Limit project membership to people who need crash-report access.

The HollowRun SDK configuration independently removes user, request, breadcrumb,
extra, local-variable, screenshot, log, and session data. It redacts Steam IDs,
instance tokens, URL queries, and the local user-profile path. Native minidumps are
limited to one per app run but can inherently contain fragments of process memory or
local paths; this is disclosed in the Settings page.

## 6. Build and verify

1. Build the frontend and start HollowRun in development mode:

   ```powershell
   npm.cmd run build:frontend
   npm.cmd start
   ```

2. Open **Settings**, confirm the status says **Off**, then enable automatic crash
   reports.
3. Choose **Restart now**.
4. Return to **Settings**, confirm the status says **Active**, and choose **Send test
   report**. This test action is deliberately available only in development builds.
5. Confirm the event `HollowRun crash reporting test` appears in Sentry under the
   release matching the app version.
6. Build the portable executable normally:

   ```powershell
   npm.cmd run build
   ```

7. Confirm the frontend build output does not contain `.map` files after Sentry's
   upload step.
8. In the release's artifacts, confirm Sentry lists the uploaded frontend JavaScript
   and source maps; those maps will be applied to future renderer crash stacks.
9. Run the packaged executable and confirm **Send test report** is absent from
   **Settings**.
10. Confirm the dedicated email address received the new-issue notification.
11. Disable the setting, restart again, and confirm the status returns to **Off**.

If the Settings page says **Build setup required**, the packaged DSN is empty or
invalid. If the app can report but stack traces remain minified, recheck the three
source-map environment variables and the build output from the Sentry Vite plugin.
