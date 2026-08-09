const fs = require('fs');
const path = require('path');

const repositoryRoot = path.resolve(__dirname, '..');
const rootPackagePath = path.join(repositoryRoot, 'package.json');
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
const version = String(rootPackage.version || '').trim();
const semanticVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!semanticVersionPattern.test(version)) {
  throw new Error(`The root package version is not valid SemVer: ${version || '(empty)'}`);
}

function writeJsonIfChanged(filePath, update) {
  const current = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!update(current)) return;
  const nextText = `${JSON.stringify(current, null, 2)}\n`;
  fs.writeFileSync(filePath, nextText, 'utf8');
}

for (const relativePath of ['backend/package.json', 'frontend/package.json']) {
  writeJsonIfChanged(path.join(repositoryRoot, relativePath), manifest => {
    if (manifest.version === version) return false;
    manifest.version = version;
    return true;
  });
}

for (const relativePath of ['package-lock.json', 'backend/package-lock.json', 'frontend/package-lock.json']) {
  writeJsonIfChanged(path.join(repositoryRoot, relativePath), lockfile => {
    const lockRootPackage = lockfile.packages?.[''];
    if (lockfile.version === version && (!lockRootPackage || lockRootPackage.version === version)) return false;
    lockfile.version = version;
    if (lockRootPackage) lockRootPackage.version = version;
    return true;
  });
}

for (const relativePath of [
  'HollowRun.Worker/HollowRun.Worker.csproj',
  'HollowRun.Splash/HollowRun.Splash.csproj'
]) {
  const projectPath = path.join(repositoryRoot, relativePath);
  const current = fs.readFileSync(projectPath, 'utf8');
  const next = /<Version>[^<]*<\/Version>/.test(current)
    ? current.replace(/<Version>[^<]*<\/Version>/, `<Version>${version}</Version>`)
    : current.replace(/(<RootNamespace>[^<]*<\/RootNamespace>)/, `$1\n    <Version>${version}</Version>`);
  if (current !== next) fs.writeFileSync(projectPath, next, 'utf8');
}

console.log(`Synchronized HollowRun version ${version}.`);
