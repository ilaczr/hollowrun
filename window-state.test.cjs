const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  fitWindowStateToDisplay,
  readWindowState,
  validateWindowState,
  writeWindowState
} = require('./window-state.cjs');

const validState = { x: 100, y: 80, width: 1280, height: 800, isMaximized: false };

test('validates complete window state and rejects malformed values', () => {
  assert.deepEqual(validateWindowState(validState), validState);
  assert.equal(validateWindowState({ ...validState, width: 500 }), null);
  assert.equal(validateWindowState({ ...validState, x: '100' }), null);
  assert.equal(validateWindowState(null), null);
});

test('keeps restored bounds inside the closest display work area', () => {
  const screen = {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } })
  };

  assert.deepEqual(
    fitWindowStateToDisplay({ x: 1800, y: 1000, width: 1280, height: 800, isMaximized: true }, screen),
    { x: 640, y: 240, width: 1280, height: 800, isMaximized: true }
  );
});

test('writes and reads state without throwing on a missing or corrupt file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hollowrun-window-state-'));
  const filePath = path.join(directory, 'window-state.json');

  try {
    assert.equal(readWindowState(filePath), null);
    assert.equal(writeWindowState(filePath, validState), true);
    assert.deepEqual(readWindowState(filePath), validState);
    fs.writeFileSync(filePath, '{bad json', 'utf8');
    assert.equal(readWindowState(filePath), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
