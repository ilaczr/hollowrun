import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  findWorkerExecutablePath,
  getWorkerExecutableCandidates,
  resolveAsarUnpackedPath
} from './worker-path.js';

test('resolves a worker inside app.asar to its physical unpacked path', () => {
  const baseDirectory = path.join('C:', 'Temp', 'HollowRun', 'resources', 'app.asar', 'backend');
  const virtualWorker = path.join(
    baseDirectory,
    '..',
    'HollowRun.Worker',
    'publish',
    'HollowRun.Worker.exe'
  );
  const physicalWorker = virtualWorker.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`
  );

  assert.equal(resolveAsarUnpackedPath(virtualWorker), physicalWorker);
  assert.equal(getWorkerExecutableCandidates(baseDirectory)[0], physicalWorker);
  assert.equal(findWorkerExecutablePath(baseDirectory, candidate => candidate === physicalWorker), physicalWorker);
});

test('keeps the normal development worker path unchanged', () => {
  const baseDirectory = path.join('C:', 'Repos', 'hollowrun', 'backend');
  const expectedWorker = path.join(
    baseDirectory,
    '..',
    'HollowRun.Worker',
    'publish',
    'HollowRun.Worker.exe'
  );

  assert.equal(resolveAsarUnpackedPath(expectedWorker), expectedWorker);
  assert.equal(findWorkerExecutablePath(baseDirectory, candidate => candidate === expectedWorker), expectedWorker);
});
