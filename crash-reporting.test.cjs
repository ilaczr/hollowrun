const assert = require('node:assert/strict');
const os = require('node:os');
const test = require('node:test');
const { getCrashReportingConfig, normalizeSentryDsn } = require('./crash-reporting-config.cjs');
const { sanitizeSentryEvent, sanitizeText } = require('./crash-reporting.cjs');

test('Sentry configuration accepts only a public HTTPS project DSN', () => {
  const validDsn = 'https://publickey@o123.ingest.sentry.io/456';
  assert.equal(normalizeSentryDsn(validDsn), validDsn);
  assert.equal(normalizeSentryDsn('http://publickey@o123.ingest.sentry.io/456'), '');
  assert.equal(normalizeSentryDsn('https://publickey:secret@o123.ingest.sentry.io/456'), '');
  assert.equal(normalizeSentryDsn('https://o123.ingest.sentry.io/456'), '');
  assert.equal(normalizeSentryDsn('https://publickey@o123.ingest.sentry.io/project'), '');
  assert.deepEqual(getCrashReportingConfig({ HOLLOWRUN_SENTRY_DSN: validDsn }), {
    configured: true,
    dsn: validDsn
  });
  assert.deepEqual(getCrashReportingConfig({ HOLLOWRUN_SENTRY_DSN: 'invalid' }), {
    configured: false,
    dsn: ''
  });
});

test('report text removes local paths, Steam IDs, instance tokens, and URL queries', () => {
  const token = 'a'.repeat(64);
  const input = `${os.homedir()}\\file.js 76561198000000000 ${token} https://example.test/path?token=value`;
  const sanitized = sanitizeText(input);
  assert.match(sanitized, /%USERPROFILE%/);
  assert.doesNotMatch(sanitized, /76561198000000000/);
  assert.doesNotMatch(sanitized, new RegExp(token));
  assert.match(sanitized, /https:\/\/example\.test\/path$/);
});

test('report text removes user directories that differ from the current account', () => {
  const sanitized = sanitizeText([
    'C:\\Users\\Another User\\app.js',
    'C:/Users/Another User/app.js',
    '/home/another-user/app.js',
    '/Users/another-user/app.js'
  ].join(' '));

  assert.equal(sanitized.match(/%USERPROFILE%/g)?.length, 4);
  assert.doesNotMatch(sanitized, /Another User|another-user/);
});

test('report events discard private context and stack-frame data', () => {
  const event = sanitizeSentryEvent({
    message: 'Failure for 76561198000000000',
    user: { id: '76561198000000000' },
    request: { headers: { authorization: 'secret' } },
    breadcrumbs: [{ message: 'clicked game' }],
    extra: { game: 'Private game' },
    server_name: 'private-machine',
    transaction: '/api/private',
    contexts: {
      os: { name: 'Windows' },
      runtime: { name: 'Electron' },
      device: { name: 'Private PC' }
    },
    tags: {
      component: 'renderer-process',
      steam_id: '76561198000000000'
    },
    exception: {
      values: [{
        value: 'Steam account 76561198000000000 failed',
        stacktrace: {
          frames: [{
            filename: `${os.homedir()}\\app.js`,
            abs_path: `${os.homedir()}\\app.js`,
            vars: { token: 'secret' },
            context_line: 'private source',
            pre_context: ['private'],
            post_context: ['private']
          }]
        }
      }]
    }
  });

  assert.equal(event.user, undefined);
  assert.equal(event.request, undefined);
  assert.equal(event.breadcrumbs, undefined);
  assert.equal(event.extra, undefined);
  assert.equal(event.server_name, undefined);
  assert.equal(event.transaction, undefined);
  assert.deepEqual(Object.keys(event.contexts).sort(), ['os', 'runtime']);
  assert.deepEqual(event.tags, { component: 'renderer-process' });
  assert.doesNotMatch(event.message, /76561198000000000/);
  assert.doesNotMatch(event.exception.values[0].value, /76561198000000000/);
  const frame = event.exception.values[0].stacktrace.frames[0];
  assert.match(frame.filename, /%USERPROFILE%/);
  assert.equal(frame.vars, undefined);
  assert.equal(frame.context_line, undefined);
  assert.equal(frame.pre_context, undefined);
  assert.equal(frame.post_context, undefined);
});
