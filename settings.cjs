const fs = require('fs');
const { writeJsonAtomically } = require('./json-storage.cjs');

const SETTINGS_VERSION = 1;

function createDefaultSettings() {
  return {
    version: SETTINGS_VERSION,
    diagnostics: {
      autoSendCrashReports: false
    }
  };
}

function normalizeSettings(value) {
  const defaults = createDefaultSettings();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;

  return {
    version: SETTINGS_VERSION,
    diagnostics: {
      autoSendCrashReports: value.diagnostics?.autoSendCrashReports === true
    }
  };
}

function readSettings(filePath) {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return createDefaultSettings();
  }
}

function writeSettings(filePath, value) {
  const settings = normalizeSettings(value);
  writeJsonAtomically(filePath, settings);
  return settings;
}

module.exports = {
  SETTINGS_VERSION,
  createDefaultSettings,
  normalizeSettings,
  readSettings,
  writeSettings
};
