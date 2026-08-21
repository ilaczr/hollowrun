// A Sentry DSN is a public, write-only client key and may be packaged with the app.
// Paste the DSN for the HollowRun Electron project here before making a release.
const PACKAGED_SENTRY_DSN = 'https://88bfb85eee5e609be979eb7203f66477@o4511950684749824.ingest.de.sentry.io/4511950688354384';

function normalizeSentryDsn(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate) return '';

  try {
    const url = new URL(candidate);
    const hasProjectId = /^\/[1-9]\d*\/?$/.test(url.pathname);
    return url.protocol === 'https:' && Boolean(url.username) && !url.password && hasProjectId
      ? url.toString().replace(/\/$/, '')
      : '';
  } catch {
    return '';
  }
}

function getCrashReportingConfig(environment = process.env) {
  const environmentDsn = environment?.HOLLOWRUN_SENTRY_DSN;
  const dsn = normalizeSentryDsn(environmentDsn || PACKAGED_SENTRY_DSN);

  return {
    configured: Boolean(dsn),
    dsn
  };
}

module.exports = {
  getCrashReportingConfig,
  normalizeSentryDsn
};
