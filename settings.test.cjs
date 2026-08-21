const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createDefaultSettings,
  normalizeSettings,
  readSettings,
  writeSettings
} = require('./settings.cjs');

test('settings default to crash reporting disabled', () => {
  assert.deepEqual(createDefaultSettings(), {
    version: 1,
    diagnostics: { autoSendCrashReports: false }
  });
  assert.deepEqual(normalizeSettings(null), createDefaultSettings());
  assert.deepEqual(normalizeSettings({ diagnostics: { autoSendCrashReports: 'true' } }), createDefaultSettings());
});

test('settings accept only an explicit true boolean', () => {
  assert.deepEqual(normalizeSettings({
    version: 99,
    diagnostics: { autoSendCrashReports: true, unexpected: 'ignored' },
    unexpected: true
  }), {
    version: 1,
    diagnostics: { autoSendCrashReports: true }
  });
});

test('settings read and write a canonical file atomically', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hollowrun-settings-'));
  const file = path.join(directory, 'settings.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  assert.deepEqual(readSettings(file), createDefaultSettings());
  assert.deepEqual(writeSettings(file, {
    diagnostics: { autoSendCrashReports: true }
  }), {
    version: 1,
    diagnostics: { autoSendCrashReports: true }
  });
  assert.deepEqual(readSettings(file), {
    version: 1,
    diagnostics: { autoSendCrashReports: true }
  });

  writeSettings(file, createDefaultSettings());
  assert.deepEqual(readSettings(file), createDefaultSettings());
  assert.deepEqual(fs.readdirSync(directory), ['settings.json']);
});

test('a corrupt settings file fails closed', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hollowrun-settings-corrupt-'));
  const file = path.join(directory, 'settings.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(file, '{broken', 'utf8');
  assert.deepEqual(readSettings(file), createDefaultSettings());
});
