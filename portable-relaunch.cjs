const fs = require('fs');
const path = require('path');

function getPortableRelaunchOptions({
  isPackaged,
  platform = process.platform,
  environment = process.env,
  existsSync = fs.existsSync
} = {}) {
  if (!isPackaged || platform !== 'win32') return undefined;

  const executable = typeof environment?.PORTABLE_EXECUTABLE_FILE === 'string'
    ? environment.PORTABLE_EXECUTABLE_FILE.trim()
    : '';
  if (
    !executable
    || !path.win32.isAbsolute(executable)
    || path.win32.extname(executable).toLowerCase() !== '.exe'
    || !existsSync(executable)
  ) {
    return undefined;
  }

  return {
    execPath: executable,
    args: []
  };
}

module.exports = { getPortableRelaunchOptions };
