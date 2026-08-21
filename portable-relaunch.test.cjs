const assert = require('node:assert/strict');
const test = require('node:test');
const { getPortableRelaunchOptions } = require('./portable-relaunch.cjs');

test('relaunches a packaged Windows portable app through its original executable', () => {
  const executable = 'C:\\Apps\\HollowRun 1.2.13.exe';
  assert.deepEqual(getPortableRelaunchOptions({
    isPackaged: true,
    platform: 'win32',
    environment: { PORTABLE_EXECUTABLE_FILE: executable },
    existsSync: candidate => candidate === executable
  }), {
    execPath: executable,
    args: []
  });
});

test('uses Electron default relaunch outside a valid portable Windows build', () => {
  const validEnvironment = { PORTABLE_EXECUTABLE_FILE: 'C:\\Apps\\HollowRun.exe' };
  const existsSync = () => true;

  assert.equal(getPortableRelaunchOptions({
    isPackaged: false,
    platform: 'win32',
    environment: validEnvironment,
    existsSync
  }), undefined);
  assert.equal(getPortableRelaunchOptions({
    isPackaged: true,
    platform: 'linux',
    environment: validEnvironment,
    existsSync
  }), undefined);
  assert.equal(getPortableRelaunchOptions({
    isPackaged: true,
    platform: 'win32',
    environment: { PORTABLE_EXECUTABLE_FILE: 'relative.exe' },
    existsSync
  }), undefined);
  assert.equal(getPortableRelaunchOptions({
    isPackaged: true,
    platform: 'win32',
    environment: validEnvironment,
    existsSync: () => false
  }), undefined);
});
