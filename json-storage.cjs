const fs = require('fs');
const path = require('path');

function writeJsonAtomically(filePath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const temporaryFile = `${filePath}.${process.pid}.tmp`;

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporaryFile, serialized, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryFile, filePath);
  } catch (error) {
    try {
      fs.rmSync(temporaryFile, { force: true });
    } catch {
      // Best-effort cleanup only. The previous file remains the source of truth.
    }
    throw error;
  }
}

module.exports = { writeJsonAtomically };
