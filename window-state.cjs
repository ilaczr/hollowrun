const fs = require('fs');
const path = require('path');

const MIN_WIDTH = 1024;
const MIN_HEIGHT = 768;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateWindowState(value) {
  if (!value || typeof value !== 'object') return null;
  if (![value.x, value.y, value.width, value.height].every(isFiniteNumber)) return null;
  if (value.width < MIN_WIDTH || value.height < MIN_HEIGHT) return null;

  return {
    x: Math.round(value.x),
    y: Math.round(value.y),
    width: Math.round(value.width),
    height: Math.round(value.height),
    isMaximized: value.isMaximized === true
  };
}

function readWindowState(filePath) {
  try {
    return validateWindowState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

function fitWindowStateToDisplay(state, screen) {
  const validated = validateWindowState(state);
  if (!validated) return null;

  const display = screen.getDisplayMatching(validated) || screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const width = Math.min(validated.width, workArea.width);
  const height = Math.min(validated.height, workArea.height);

  return {
    x: Math.min(Math.max(validated.x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(validated.y, workArea.y), workArea.y + workArea.height - height),
    width,
    height,
    isMaximized: validated.isMaximized
  };
}

function writeWindowState(filePath, state) {
  const validated = validateWindowState(state);
  if (!validated) return false;

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
    return true;
  } catch (error) {
    console.error(`Could not save window state: ${error.message}`);
    return false;
  }
}

module.exports = {
  MIN_HEIGHT,
  MIN_WIDTH,
  fitWindowStateToDisplay,
  readWindowState,
  validateWindowState,
  writeWindowState
};
