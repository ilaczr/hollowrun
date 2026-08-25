import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { copyFileIfChanged } from './worker-files.js';

test('copies new worker files and reuses identical runtime copies', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hollowrun-worker-files-'));
  const sourceFile = path.join(directory, 'source.dll');
  const destinationFile = path.join(directory, 'runtime.dll');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(sourceFile, 'first worker build', 'utf8');

  assert.equal(copyFileIfChanged(sourceFile, destinationFile), true);
  const firstModifiedTime = fs.statSync(destinationFile).mtimeMs;
  assert.equal(copyFileIfChanged(sourceFile, destinationFile), false);
  assert.equal(fs.statSync(destinationFile).mtimeMs, firstModifiedTime);

  fs.writeFileSync(sourceFile, 'updated worker build', 'utf8');
  assert.equal(copyFileIfChanged(sourceFile, destinationFile), true);
  assert.equal(fs.readFileSync(destinationFile, 'utf8'), 'updated worker build');
});
