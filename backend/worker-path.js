import fs from 'fs';
import path from 'path';

export function resolveAsarUnpackedPath(filePath) {
  const asarSegment = `${path.sep}app.asar${path.sep}`;
  if (!filePath.includes(asarSegment)) return filePath;
  return filePath.replace(asarSegment, `${path.sep}app.asar.unpacked${path.sep}`);
}

export function getWorkerExecutableCandidates(baseDirectory) {
  const publishedWorker = path.join(
    baseDirectory,
    '..',
    'HollowRun.Worker',
    'publish',
    'HollowRun.Worker.exe'
  );

  return [...new Set([
    resolveAsarUnpackedPath(publishedWorker),
    publishedWorker,
    path.join(
      baseDirectory,
      '..',
      'HollowRun.Worker',
      'bin',
      'Release',
      'net10.0',
      'win-x64',
      'HollowRun.Worker.exe'
    ),
    path.join(
      baseDirectory,
      '..',
      'HollowRun.Worker',
      'bin',
      'Debug',
      'net10.0',
      'HollowRun.Worker.exe'
    )
  ])];
}

export function findWorkerExecutablePath(baseDirectory, existsSync = fs.existsSync) {
  return getWorkerExecutableCandidates(baseDirectory).find(candidate => existsSync(candidate)) || null;
}

export function getIdleWorkerDirectory(userDataDirectory, appId) {
  return path.join(userDataDirectory, 'workers', `app_${appId}`);
}
