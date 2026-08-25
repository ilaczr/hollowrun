const http = require('http');

const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

function requestLocalJson(url, instanceToken, {
  timeoutMs = 3000,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  get = http.get
} = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let request;
    try {
      request = get(url, {
        headers: { 'X-HollowRun-Instance': instanceToken }
      }, response => {
        response.once('aborted', () => finish(null));
        response.once('error', () => finish(null));
        if (
          response.statusCode !== 200
          || response.headers['x-hollowrun-instance'] !== instanceToken
        ) {
          response.resume();
          finish(null);
          return;
        }

        const chunks = [];
        let totalBytes = 0;
        response.on('data', chunk => {
          const buffer = Buffer.from(chunk);
          totalBytes += buffer.length;
          if (totalBytes > maxResponseBytes) {
            response.destroy();
            finish(null);
            return;
          }
          chunks.push(buffer);
        });
        response.once('end', () => {
          if (settled) return;
          try {
            finish(JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8')));
          } catch {
            finish(null);
          }
        });
      });
    } catch {
      finish(null);
      return;
    }

    request.once('error', () => finish(null));
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      finish(null);
    });
  });
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  requestLocalJson
};
