import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sanitizeRendererEvent,
  sanitizeRendererText
} from './crash-sanitization.js';

test('renderer report text removes local user paths and identifiers', () => {
  const token = 'b'.repeat(64);
  const input = [
    'C:\\Users\\Private User\\Repos\\hollowrun\\App.jsx',
    '/home/private-user/hollowrun/App.jsx',
    '/Users/private-user/hollowrun/App.jsx',
    '76561198000000000',
    token,
    'https://example.test/path?secret=value'
  ].join(' ');
  const sanitized = sanitizeRendererText(input);

  assert.equal(sanitized.match(/%USERPROFILE%/g)?.length, 3);
  assert.doesNotMatch(sanitized, /Private User|private-user/);
  assert.doesNotMatch(sanitized, /76561198000000000/);
  assert.doesNotMatch(sanitized, new RegExp(token));
  assert.match(sanitized, /https:\/\/example\.test\/path$/);
});

test('renderer events keep only documented contexts and tags', () => {
  const event = sanitizeRendererEvent({
    message: 'Failure at C:\\Users\\Player\\app.js',
    user: { id: 'private' },
    request: { headers: { authorization: 'private' } },
    breadcrumbs: [{ message: 'private' }],
    extra: { private: true },
    contexts: { os: { name: 'Windows' }, device: { name: 'Private PC' } },
    tags: { component: 'renderer', steam_id: 'private' },
    exception: {
      values: [{
        value: 'Failure for 76561198000000000',
        stacktrace: {
          frames: [{
            filename: 'C:\\Users\\Player\\app.js',
            abs_path: 'C:/Users/Player/app.js',
            vars: { private: true },
            context_line: 'private',
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
  assert.deepEqual(event.contexts, { os: { name: 'Windows' } });
  assert.deepEqual(event.tags, { component: 'renderer' });
  assert.match(event.message, /%USERPROFILE%/);
  assert.doesNotMatch(event.exception.values[0].value, /76561198000000000/);
  const frame = event.exception.values[0].stacktrace.frames[0];
  assert.match(frame.filename, /%USERPROFILE%/);
  assert.match(frame.abs_path, /%USERPROFILE%/);
  assert.equal(frame.vars, undefined);
  assert.equal(frame.context_line, undefined);
  assert.equal(frame.pre_context, undefined);
  assert.equal(frame.post_context, undefined);
});
