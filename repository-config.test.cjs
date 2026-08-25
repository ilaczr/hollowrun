const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = __dirname;
const readText = relativePath => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const readJson = relativePath => JSON.parse(readText(relativePath));

test('keeps release versions synchronized across JavaScript and native projects', () => {
  const rootPackage = readJson('package.json');
  const version = rootPackage.version;
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (const relativePath of [
    'package-lock.json',
    'backend/package.json',
    'backend/package-lock.json',
    'frontend/package.json',
    'frontend/package-lock.json'
  ]) {
    const manifest = readJson(relativePath);
    assert.equal(manifest.version, version, `${relativePath} has a different version`);
    if (manifest.packages?.['']) {
      assert.equal(manifest.packages[''].version, version, `${relativePath} root package has a different version`);
    }
  }

  for (const relativePath of [
    'HollowRun.Worker/HollowRun.Worker.csproj',
    'HollowRun.Splash/HollowRun.Splash.csproj'
  ]) {
    assert.match(readText(relativePath), new RegExp(`<Version>${escapedVersion}<\\/Version>`));
  }
});

test('packages every local module required directly by the Electron entry point', () => {
  const rootPackage = readJson('package.json');
  const packagedFiles = new Set(rootPackage.build?.files || []);
  const entryPoint = readText(rootPackage.main);
  const localRequires = [...entryPoint.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)]
    .map(match => match[1]);

  assert.ok(packagedFiles.has(rootPackage.main), `${rootPackage.main} is missing from build.files`);
  for (const relativePath of localRequires) {
    assert.ok(packagedFiles.has(relativePath), `${relativePath} is required but missing from build.files`);
  }
  assert.ok(packagedFiles.has('backend/**/*'));
  assert.ok(packagedFiles.has('frontend/dist/**/*'));
  assert.ok(packagedFiles.has('HollowRun.Worker/publish/**/*'));
  assert.doesNotMatch(entryPoint, /frontend\/public\//);
  assert.doesNotMatch(readText('loading.html'), /frontend\/public\//);
  assert.match(entryPoint, /frontend\/dist\/hollowrun\.png/);
  assert.match(readText('loading.html'), /frontend\/dist\/hollowrun\.svg/);
});

test('keeps release ownership and documentation on the configured repositories', () => {
  const rootPackage = readJson('package.json');
  const readme = readText('README.md');
  const commands = readText('COMMANDS.MD');

  assert.equal(rootPackage.author, 'ju6697');
  assert.equal(rootPackage.repository?.url, 'https://github.com/ju6697/hollowrun.git');
  assert.match(readme, /https:\/\/github\.com\/ju6697\/hollowrun\/releases/);
  assert.match(readme, /https:\/\/codeberg\.org\/ju6697\/hollowrun\/releases/);
  assert.equal((commands.match(/```/g) || []).length % 2, 0, 'COMMANDS.MD has an unclosed code fence');
});
