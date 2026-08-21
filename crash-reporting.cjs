const os = require('os');

const REDACTED = '[Redacted]';
const STEAM_ID_PATTERN = /\b7656\d{13}\b/g;
const INSTANCE_TOKEN_PATTERN = /\b[a-f0-9]{64}\b/gi;
const URL_QUERY_PATTERN = /(https?:\/\/[^\s?#]+)[?#][^\s]*/gi;
const PRIVATE_INTEGRATIONS = new Set([
  'AdditionalContext',
  'ChildProcess',
  'Console',
  'ContextLines',
  'ElectronBreadcrumbs',
  'ElectronNet',
  'GpuContext',
  'LocalVariables',
  'MainProcessSession',
  'NativeNodeFetch',
  'NodeContext',
  'RendererEventLoopBlock',
  'Screenshots'
]);
const ALLOWED_CONTEXTS = new Set(['app', 'browser', 'os', 'runtime']);
const ALLOWED_TAGS = new Set([
  'component',
  'diagnostic_test',
  'electron.process',
  'event.process',
  'process_type'
]);

let sentry = null;
let active = false;
let initialized = false;

function getPrivatePathPrefixes() {
  return [...new Set([
    os.homedir(),
    process.env.USERPROFILE,
    process.env.HOMEDRIVE && process.env.HOMEPATH
      ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`
      : ''
  ].filter(Boolean).map(value => String(value).replace(/[\\/]+$/, '')))]
    .sort((left, right) => right.length - left.length);
}

function sanitizeText(value) {
  if (typeof value !== 'string') return value;

  let sanitized = value;
  for (const prefix of getPrivatePathPrefixes()) {
    sanitized = sanitized.replaceAll(prefix, '%USERPROFILE%');
    sanitized = sanitized.replaceAll(prefix.replaceAll('\\', '/'), '%USERPROFILE%');
  }

  return sanitized
    .replace(STEAM_ID_PATTERN, REDACTED)
    .replace(INSTANCE_TOKEN_PATTERN, REDACTED)
    .replace(URL_QUERY_PATTERN, '$1');
}

function sanitizeStacktrace(stacktrace) {
  if (!Array.isArray(stacktrace?.frames)) return stacktrace;
  for (const frame of stacktrace.frames) {
    if (!frame || typeof frame !== 'object') continue;
    frame.filename = sanitizeText(frame.filename);
    frame.abs_path = sanitizeText(frame.abs_path);
    delete frame.vars;
    delete frame.context_line;
    delete frame.pre_context;
    delete frame.post_context;
  }
  return stacktrace;
}

function sanitizeSentryEvent(event) {
  if (!event || typeof event !== 'object') return event;

  delete event.breadcrumbs;
  delete event.extra;
  delete event.request;
  delete event.server_name;
  delete event.transaction;
  delete event.user;

  event.message = sanitizeText(event.message);

  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      exception.value = sanitizeText(exception.value);
      sanitizeStacktrace(exception.stacktrace);
    }
  }

  if (event.contexts && typeof event.contexts === 'object') {
    event.contexts = Object.fromEntries(
      Object.entries(event.contexts).filter(([name]) => ALLOWED_CONTEXTS.has(name))
    );
  }

  if (event.tags && typeof event.tags === 'object') {
    event.tags = Object.fromEntries(
      Object.entries(event.tags)
        .filter(([name]) => ALLOWED_TAGS.has(name))
        .map(([name, value]) => [name, sanitizeText(value)])
    );
  }

  return event;
}

function initializeCrashReporting({ dsn, release, environment = 'production' }) {
  if (initialized || !dsn) return active;

  try {
    sentry = require('@sentry/electron/main');
    sentry.init({
      dsn,
      release,
      environment,
      attachScreenshot: false,
      enableLogs: false,
      enableMetrics: false,
      enableRendererProfiling: false,
      maxBreadcrumbs: 0,
      sendDefaultPii: false,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        urlQueryParams: false,
        graphQL: { document: false, variables: false },
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        stackFrameVariables: false,
        frameContextLines: 0
      },
      integrations(defaultIntegrations) {
        return [
          ...defaultIntegrations.filter(integration => (
            !PRIVATE_INTEGRATIONS.has(integration.name)
            && integration.name !== 'SentryMinidump'
          )),
          sentry.sentryMinidumpIntegration({ maxMinidumpsPerSession: 1 })
        ];
      },
      beforeSend: sanitizeSentryEvent,
      initialScope: {
        tags: {
          component: 'electron-main'
        }
      }
    });
    initialized = true;
    active = true;
  } catch (error) {
    sentry = null;
    initialized = false;
    active = false;
    console.error(`Crash reporting could not be initialized: ${error.message}`);
  }

  return active;
}

async function deactivateCrashReporting() {
  if (!initialized) return;

  active = false;
  try {
    const { crashReporter } = require('electron');
    crashReporter.setUploadToServer(false);
  } catch {
    // Closing the Sentry client below still prevents JavaScript event delivery.
  }

  try {
    await sentry?.close(2000);
  } catch {
    // The persisted preference is already off; startup will remain fail-closed.
  }
}

function captureException(error, tags = {}) {
  if (!active || !sentry) return null;

  return sentry.withScope(scope => {
    for (const [name, value] of Object.entries(tags)) {
      if (ALLOWED_TAGS.has(name)) scope.setTag(name, sanitizeText(String(value)));
    }
    return sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
}

async function sendTestReport() {
  if (!active || !sentry) throw new Error('Crash reporting is not active.');

  const eventId = captureException(new Error('HollowRun crash reporting test'), {
    component: 'settings',
    diagnostic_test: 'true'
  });
  const sent = await sentry.flush(5000);
  if (!sent) throw new Error('The test report could not be delivered in time.');
  return eventId;
}

function isCrashReportingActive() {
  return active;
}

function isCrashReportingInitialized() {
  return initialized;
}

module.exports = {
  captureException,
  deactivateCrashReporting,
  initializeCrashReporting,
  isCrashReportingActive,
  isCrashReportingInitialized,
  sanitizeSentryEvent,
  sanitizeText,
  sendTestReport
};
