const fs = require('fs');
const path = require('path');

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
  const directory = path.dirname(filePath);
  const temporaryFile = `${filePath}.${process.pid}.tmp`;

  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporaryFile, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    fs.renameSync(temporaryFile, filePath);
    return settings;
  } catch (error) {
    try {
      fs.rmSync(temporaryFile, { force: true });
    } catch {
      // Best-effort cleanup only. The original settings file remains untouched.
    }
    throw error;
  }
}

module.exports = {
  SETTINGS_VERSION,
  createDefaultSettings,
  normalizeSettings,
  readSettings,
  writeSettings
};
