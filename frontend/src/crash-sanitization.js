const REDACTED = '[Redacted]';
const STEAM_ID_PATTERN = /\b7656\d{13}\b/g;
const INSTANCE_TOKEN_PATTERN = /\b[a-f0-9]{64}\b/gi;
const URL_QUERY_PATTERN = /(https?:\/\/[^\s?#]+)[?#][^\s]*/gi;
const WINDOWS_USER_DIRECTORY_PATTERN = /\b[A-Za-z]:[\\/]Users[\\/][^\\/\r\n]+(?=[\\/]|$)/gi;
const UNIX_USER_DIRECTORY_PATTERN = /(^|[\s"'(])\/(?:Users|home)\/[^/\\\r\n]+(?=[/\\]|$)/g;
const ALLOWED_CONTEXTS = new Set(['app', 'browser', 'os', 'runtime']);
const ALLOWED_TAGS = new Set(['component', 'electron.process', 'event.process', 'process_type']);

export function sanitizeRendererText(value) {
  if (typeof value !== 'string') return value;

  return value
    .replace(WINDOWS_USER_DIRECTORY_PATTERN, '%USERPROFILE%')
    .replace(UNIX_USER_DIRECTORY_PATTERN, (_match, prefix) => `${prefix}%USERPROFILE%`)
    .replace(STEAM_ID_PATTERN, REDACTED)
    .replace(INSTANCE_TOKEN_PATTERN, REDACTED)
    .replace(URL_QUERY_PATTERN, '$1');
}

export function sanitizeRendererEvent(event) {
  if (!event || typeof event !== 'object') return event;

  delete event.breadcrumbs;
  delete event.extra;
  delete event.request;
  delete event.server_name;
  delete event.transaction;
  delete event.user;
  event.message = sanitizeRendererText(event.message);

  for (const exception of event.exception?.values || []) {
    exception.value = sanitizeRendererText(exception.value);
    for (const frame of exception.stacktrace?.frames || []) {
      frame.filename = sanitizeRendererText(frame.filename);
      frame.abs_path = sanitizeRendererText(frame.abs_path);
      delete frame.vars;
      delete frame.context_line;
      delete frame.pre_context;
      delete frame.post_context;
    }
  }

  if (event.contexts && typeof event.contexts === 'object') {
    event.contexts = Object.fromEntries(
      Object.entries(event.contexts).filter(([name]) => ALLOWED_CONTEXTS.has(name))
    );
  }

  if (event.tags && typeof event.tags === 'object') {
    event.tags = Object.fromEntries(
      Object.entries(event.tags).filter(([name]) => ALLOWED_TAGS.has(name))
    );
  }

  return event;
}
