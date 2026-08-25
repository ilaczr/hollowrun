import { createHash } from 'node:crypto';
import fs from 'node:fs';

function hashFile(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function copyFileIfChanged(sourceFile, destinationFile) {
  try {
    const sourceStats = fs.statSync(sourceFile);
    const destinationStats = fs.statSync(destinationFile);
    if (sourceStats.size === destinationStats.size
      && hashFile(sourceFile) === hashFile(destinationFile)) {
      return false;
    }
  } catch {
    // A missing or unreadable destination is handled by the copy below.
  }

  fs.copyFileSync(sourceFile, destinationFile);
  return true;
}
