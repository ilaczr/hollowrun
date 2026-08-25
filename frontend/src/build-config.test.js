import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldUploadSourceMaps } from './build-config.js';

const configuredEnvironment = {
  SENTRY_UPLOAD_SOURCEMAPS: 'true',
  SENTRY_AUTH_TOKEN: 'private-token',
  SENTRY_ORG: 'hollowrun',
  SENTRY_PROJECT: 'hollowrun'
};

test('source-map uploads require an explicit opt-in and complete credentials', () => {
  assert.equal(shouldUploadSourceMaps(configuredEnvironment), true);
  assert.equal(shouldUploadSourceMaps({ ...configuredEnvironment, SENTRY_UPLOAD_SOURCEMAPS: 'false' }), false);
  assert.equal(shouldUploadSourceMaps({ ...configuredEnvironment, SENTRY_UPLOAD_SOURCEMAPS: 'TRUE' }), false);
  assert.equal(shouldUploadSourceMaps({ ...configuredEnvironment, SENTRY_AUTH_TOKEN: '' }), false);
  assert.equal(shouldUploadSourceMaps({ ...configuredEnvironment, SENTRY_ORG: '' }), false);
  assert.equal(shouldUploadSourceMaps({ ...configuredEnvironment, SENTRY_PROJECT: '' }), false);
  assert.equal(shouldUploadSourceMaps(undefined), false);
});
