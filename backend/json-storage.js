import fs from 'fs';
import path from 'path';

export function writeJsonAtomically(filePath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const directory = path.dirname(filePath);
  const temporaryFile = `${filePath}.${process.pid}.tmp`;

  try {
    fs.mkdirSync(directory, { recursive: true });
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
