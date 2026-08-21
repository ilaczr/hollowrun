import * as Sentry from '@sentry/electron/renderer';

const PRIVATE_INTEGRATIONS = new Set(['Breadcrumbs', 'BrowserSession', 'HttpContext']);
const STEAM_ID_PATTERN = /\b7656\d{13}\b/g;
const INSTANCE_TOKEN_PATTERN = /\b[a-f0-9]{64}\b/gi;
const URL_QUERY_PATTERN = /(https?:\/\/[^\s?#]+)[?#][^\s]*/gi;
let active = false;

function sanitizeText(value) {
  return typeof value === 'string'
    ? value
      .replace(STEAM_ID_PATTERN, '[Redacted]')
      .replace(INSTANCE_TOKEN_PATTERN, '[Redacted]')
      .replace(URL_QUERY_PATTERN, '$1')
    : value;
}

function sanitizeEvent(event) {
  if (!event || typeof event !== 'object') return event;

  delete event.breadcrumbs;
  delete event.extra;
  delete event.request;
  delete event.server_name;
  delete event.transaction;
  delete event.user;
  event.message = sanitizeText(event.message);

  for (const exception of event.exception?.values || []) {
    exception.value = sanitizeText(exception.value);
    for (const frame of exception.stacktrace?.frames || []) {
      frame.filename = sanitizeText(frame.filename);
      frame.abs_path = sanitizeText(frame.abs_path);
      delete frame.vars;
      delete frame.context_line;
      delete frame.pre_context;
      delete frame.post_context;
    }
  }

  if (event.contexts && typeof event.contexts === 'object') {
    const allowedContexts = new Set(['app', 'browser', 'os', 'runtime']);
    event.contexts = Object.fromEntries(
      Object.entries(event.contexts).filter(([name]) => allowedContexts.has(name))
    );
  }

  if (event.tags && typeof event.tags === 'object') {
    const allowedTags = new Set(['component', 'electron.process', 'event.process', 'process_type']);
    event.tags = Object.fromEntries(
      Object.entries(event.tags).filter(([name]) => allowedTags.has(name))
    );
  }

  return event;
}

export function initializeRendererCrashReporting() {
  if (active || window.hollowrun?.crashReportingActive !== true) return active;

  Sentry.init({
    attachStacktrace: true,
    enableLogs: false,
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
      return defaultIntegrations.filter(integration => !PRIVATE_INTEGRATIONS.has(integration.name));
    },
    beforeSend: sanitizeEvent
  });
  active = true;
  return active;
}

export function captureRendererException(error, component = 'react-renderer') {
  if (!active) return null;
  return Sentry.withScope(scope => {
    scope.setTag('component', component);
    return Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
}
