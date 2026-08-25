import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import jsonStorage from '../json-storage.cjs';

const { writeJsonAtomically } = jsonStorage;

test('writes canonical JSON atomically and leaves no temporary file', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hollowrun-json-storage-'));
  const filePath = path.join(directory, 'nested', 'state.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  writeJsonAtomically(filePath, { version: 1, enabled: true });

  assert.equal(
    fs.readFileSync(filePath, 'utf8'),
    '{\n  "version": 1,\n  "enabled": true\n}\n'
  );

  writeJsonAtomically(filePath, { version: 2, enabled: false });
  assert.equal(
    fs.readFileSync(filePath, 'utf8'),
    '{\n  "version": 2,\n  "enabled": false\n}\n'
  );
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['state.json']);
});

test('serialization failures preserve the previous file', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hollowrun-json-storage-failure-'));
  const filePath = path.join(directory, 'state.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(filePath, '{"version":1}\n', 'utf8');

  assert.throws(() => writeJsonAtomically(filePath, { unsupported: 1n }), TypeError);
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{"version":1}\n');
  assert.deepEqual(fs.readdirSync(directory), ['state.json']);
});
