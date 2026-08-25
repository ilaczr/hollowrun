const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { requestLocalJson } = require('./local-service-client.cjs');

const INSTANCE_TOKEN = 'a'.repeat(64);

function createRequestDouble(responseFactory) {
  return (_url, options, onResponse) => {
    const request = new EventEmitter();
    request.destroy = () => request.emit('error', new Error('destroyed'));
    request.setTimeout = (_timeoutMs, callback) => {
      request.onTimeout = callback;
    };
    queueMicrotask(() => onResponse(responseFactory(options)));
    return request;
  };
}

function createResponse({ body, instanceToken = INSTANCE_TOKEN, statusCode = 200 }) {
  const response = new EventEmitter();
  response.statusCode = statusCode;
  response.headers = { 'x-hollowrun-instance': instanceToken };
  response.resume = () => {};
  response.destroy = () => response.emit('aborted');
  queueMicrotask(() => {
    if (body !== undefined) response.emit('data', Buffer.from(body));
    response.emit('end');
  });
  return response;
}

test('returns authenticated bounded JSON from the local service', async () => {
  const result = await requestLocalJson('http://127.0.0.1:3824/api/health', INSTANCE_TOKEN, {
    get: createRequestDouble(options => {
      assert.equal(options.headers['X-HollowRun-Instance'], INSTANCE_TOKEN);
      return createResponse({ body: JSON.stringify({ success: true }) });
    })
  });

  assert.deepEqual(result, { success: true });
});

test('rejects another service, malformed JSON, and oversized responses', async () => {
  const wrongService = await requestLocalJson('http://127.0.0.1:3824/api/health', INSTANCE_TOKEN, {
    get: createRequestDouble(() => createResponse({ body: '{}', instanceToken: 'wrong' }))
  });
  const malformed = await requestLocalJson('http://127.0.0.1:3824/api/health', INSTANCE_TOKEN, {
    get: createRequestDouble(() => createResponse({ body: '{' }))
  });
  const oversized = await requestLocalJson('http://127.0.0.1:3824/api/health', INSTANCE_TOKEN, {
    maxResponseBytes: 1,
    get: createRequestDouble(() => createResponse({ body: '{}' }))
  });

  assert.equal(wrongService, null);
  assert.equal(malformed, null);
  assert.equal(oversized, null);
});

test('settles failed and timed-out requests as unavailable', async () => {
  const failed = await requestLocalJson('http://127.0.0.1:3824/api/health', INSTANCE_TOKEN, {
    get: () => {
      throw new Error('unavailable');
    }
  });
  const timedOut = await requestLocalJson('http://127.0.0.1:3824/api/health', INSTANCE_TOKEN, {
    get: () => {
      const request = new EventEmitter();
      request.destroy = () => request.emit('error', new Error('destroyed'));
      request.setTimeout = (_timeoutMs, callback) => queueMicrotask(callback);
      return request;
    }
  });

  assert.equal(failed, null);
  assert.equal(timedOut, null);
});
