import * as Sentry from '@sentry/electron/renderer';
import { sanitizeRendererEvent } from './crash-sanitization.js';

const PRIVATE_INTEGRATIONS = new Set(['Breadcrumbs', 'BrowserSession', 'HttpContext']);
let active = false;

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
    beforeSend: sanitizeRendererEvent
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
