const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const releaseType = process.argv[2];
if (!['patch', 'minor', 'major'].includes(releaseType)) {
  throw new Error('Choose one release type: patch, minor, or major.');
}

const repositoryRoot = path.resolve(__dirname, '..');
const packagePath = path.join(repositoryRoot, 'package.json');
const lockfilePath = path.join(repositoryRoot, 'package-lock.json');
const rootPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const versionMatch = String(rootPackage.version || '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);

if (!versionMatch) throw new Error(`Cannot increment invalid version: ${rootPackage.version || '(empty)'}`);

const currentVersion = versionMatch[0];
let major = Number(versionMatch[1]);
let minor = Number(versionMatch[2]);
let patch = Number(versionMatch[3]);
if (![major, minor, patch].every(Number.isSafeInteger)) throw new Error('Version components are too large.');

if (releaseType === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (releaseType === 'minor') {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

const nextVersion = `${major}.${minor}.${patch}`;
rootPackage.version = nextVersion;
fs.writeFileSync(packagePath, `${JSON.stringify(rootPackage, null, 2)}\n`, 'utf8');

const rootLockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
rootLockfile.version = nextVersion;
if (rootLockfile.packages?.['']) rootLockfile.packages[''].version = nextVersion;
fs.writeFileSync(lockfilePath, `${JSON.stringify(rootLockfile, null, 2)}\n`, 'utf8');

const synchronization = spawnSync(process.execPath, [path.join(__dirname, 'sync-version.cjs')], {
  cwd: repositoryRoot,
  stdio: 'inherit'
});
if (synchronization.error) throw synchronization.error;
if (synchronization.status !== 0) process.exit(synchronization.status ?? 1);

console.log(`Bumped HollowRun from ${currentVersion} to ${nextVersion}.`);
