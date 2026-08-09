const fs = require('node:fs');
const path = require('node:path');

const templatePath = path.join(
  __dirname,
  '..',
  'node_modules',
  'app-builder-lib',
  'templates',
  'nsis',
  'portable.nsi'
);
const splashExecutablePath = path.join(
  __dirname,
  '..',
  'HollowRun.Splash',
  'publish',
  'HollowRun.Splash.exe'
);

for (const requiredPath of [templatePath, splashExecutablePath]) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(`Required portable build file not found: ${requiredPath}`);
  }
}

let template = fs.readFileSync(templatePath, 'utf8');
const newline = template.includes('\r\n') ? '\r\n' : '\n';
const joinLines = lines => lines.join(newline);
const PATCH_MARKER = '; HollowRun WinForms portable splash v3';
const PREVIOUS_SECTION_MARKER = '; HollowRun WinForms portable splash v2';
const PREVIOUS_GUI_MARKERS = [
  '; HollowRun WinForms portable splash v1',
  '; HollowRun WPF portable splash v1'
];
const escapedSplashExecutablePath = splashExecutablePath.replace(/\$/g, () => '$$');

const launchSplashBlock = joinLines([
  '  InitPluginsDir',
  `  ${PATCH_MARKER}`,
  `  File /oname=$PLUGINSDIR\\HollowRun.Splash.exe "${escapedSplashExecutablePath}"`,
  '  Delete "$PLUGINSDIR\\hollowrun-splash.done"',
  '  Push $R8',
  "  System::Call 'Kernel32::GetCurrentProcessId()i.R8'",
  "  Exec '\"$PLUGINSDIR\\HollowRun.Splash.exe\" --done-file \"$PLUGINSDIR\\hollowrun-splash.done\" --parent-process-id $R8'",
  '  Pop $R8',
  '  SetDetailsPrint none'
]);

const finishSplashBlock = joinLines([
  '  Push $R8',
  '  ClearErrors',
  '  FileOpen $R8 "$PLUGINSDIR\\hollowrun-splash.done" w',
  '  IfErrors HollowRunSignalSplash_done',
  '  FileWrite $R8 "done"',
  '  FileClose $R8',
  'HollowRunSignalSplash_done:',
  '  Pop $R8'
]);

const silentModeBlock = joinLines([
  '  !ifndef SPLASH_IMAGE',
  '    SetSilent silent',
  '  !endif'
]);

const previousWinFormsSectionBlock = joinLines([
  '  ; The separate WinForms process is the only extraction UI.',
  '  HideWindow',
  '  SetDetailsPrint none'
]);

const previousWpfSectionBlock = joinLines([
  '  ; The separate WPF process is the only extraction UI.',
  '  HideWindow',
  '  SetDetailsPrint none'
]);

const oldSplashTextBlock = joinLines([
  '    CreateFont $HollowRunSplashTextFont "Segoe UI" 9 400',
  '    BgImage::AddText "Extracting application files..." $HollowRunSplashTextFont 255 255 255 80 153 440 173'
]);

const oldStartTimerBlock = joinLines([
  '    Call HollowRunKeepSplashTopmost',
  '    Push $R9',
  '    GetFunctionAddress $R9 HollowRunKeepSplashTopmost',
  '    nsDialogs::CreateTimer $R9 100',
  '    Pop $R9'
]);

const oldAttachProgressBlock = joinLines([
  '    Call HollowRunAttachSplashProgress',
  '    HideWindow',
  '    Call HollowRunKeepSplashTopmost',
  '    SetDetailsPrint none'
]);

const oldStopTimerBlock = joinLines([
  '    Push $R9',
  '    GetFunctionAddress $R9 HollowRunKeepSplashTopmost',
  '    nsDialogs::KillTimer $R9',
  '    Pop $R9'
]);

const oldOriginalTopmostBlock = joinLines([
  '    ; Keep the extraction splash above other non-topmost windows.',
  '    FindWindow $0 "NSISBGImage" ""',
  "    System::Call 'User32::SetWindowPos(p $0, p -1, i 0, i 0, i 0, i 0, i 0x0013)'"
]);

const currentMarkers = [
  PATCH_MARKER,
  'File /oname=$PLUGINSDIR\\HollowRun.Splash.exe',
  'Exec \'"$PLUGINSDIR\\HollowRun.Splash.exe"',
  'Kernel32::GetCurrentProcessId()i.R8',
  'FileOpen $R8 "$PLUGINSDIR\\hollowrun-splash.done" w'
];

function assertCurrentPatch(value) {
  const missing = currentMarkers.filter(marker => !value.includes(marker));
  const sectionIndex = value.indexOf(`${newline}Section${newline}`);
  const markerIndex = value.indexOf(PATCH_MARKER);
  if (
    missing.length > 0
    || sectionIndex < 0
    || markerIndex < sectionIndex
    || value.includes('WindowsPowerShell\\v1.0\\powershell.exe')
  ) {
    throw new Error(`Portable template contains an incomplete HollowRun WinForms splash patch: ${missing.join(', ')}`);
  }
}

if (template.includes(PATCH_MARKER)) {
  assertCurrentPatch(template);
  console.log('Portable template already launches the WinForms splash from its extraction section.');
  process.exit(0);
}

if (template.includes(PREVIOUS_SECTION_MARKER)) {
  const incorrectProcessIdCall = "System::Call 'Kernel32::GetCurrentProcessId()i.rR8'";
  const correctedProcessIdCall = "System::Call 'Kernel32::GetCurrentProcessId()i.R8'";
  if (!template.includes(incorrectProcessIdCall)) {
    throw new Error('Previous Section-based splash patch is missing its process-ID call.');
  }
  template = template.replace(PREVIOUS_SECTION_MARKER, PATCH_MARKER);
  template = template.replace(incorrectProcessIdCall, correctedProcessIdCall);

  assertCurrentPatch(template);
  fs.writeFileSync(templatePath, template, 'utf8');
  console.log('Corrected the NSIS $R8 destination used to launch the splash helper.');
  process.exit(0);
}

function removeFunction(value, name) {
  const startToken = `Function ${name}`;
  const start = value.indexOf(startToken);
  if (start < 0) {
    return value;
  }

  const endToken = 'FunctionEnd';
  const end = value.indexOf(endToken, start);
  if (end < 0) {
    throw new Error(`Portable template has an incomplete ${name} function.`);
  }

  let removeEnd = end + endToken.length;
  while (value.slice(removeEnd, removeEnd + newline.length) === newline) {
    removeEnd += newline.length;
  }
  return value.slice(0, start) + value.slice(removeEnd);
}

function removeOptionalBlock(value, block) {
  return value.includes(block) ? value.replace(block, '') : value;
}

function removePreviousGuiLaunch(value, marker) {
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0) {
    return value;
  }

  const launchStart = value.lastIndexOf(newline, markerIndex) + newline.length;
  const hideLine = '  HideWindow';
  const hideIndex = value.indexOf(hideLine, markerIndex);
  if (hideIndex < 0) {
    throw new Error(`Previous GUI splash patch is incomplete: ${marker}`);
  }
  const launchEndCandidate = value.indexOf(newline, hideIndex + hideLine.length);
  const launchEnd = launchEndCandidate < 0 ? value.length : launchEndCandidate + newline.length;
  return value.slice(0, launchStart) + value.slice(launchEnd);
}

const previousGuiMarker = PREVIOUS_GUI_MARKERS.find(marker => template.includes(marker));
if (previousGuiMarker) {
  template = removePreviousGuiLaunch(template, previousGuiMarker);
  template = removeOptionalBlock(template, `${previousWinFormsSectionBlock}${newline}`);
  template = removeOptionalBlock(template, `${previousWpfSectionBlock}${newline}`);
  template = template.replace(
    '  ; HollowRun displays extraction in a separate WinForms process.',
    silentModeBlock
  );
  template = template.replace(
    '  ; HollowRun displays extraction in a separate WPF process.',
    silentModeBlock
  );
} else {
  // Normalize the earlier native/BMP revisions. electron-builder retains this
  // generated template between builds, so upgrades must be deterministic.
  for (const functionName of [
    'HollowRunUpdateSplashProgress',
    'HollowRunAttachSplashProgress',
    'HollowRunKeepSplashTopmost'
  ]) {
    template = removeFunction(template, functionName);
  }

  template = template.replace(/^; HollowRun portable splash v[2-7]\r?\n/gm, '');
  template = template.replace(/^Var HollowRunSplash[^\r\n]*\r?\n/gm, '');
  template = removeOptionalBlock(template, `${oldSplashTextBlock}${newline}`);
  template = removeOptionalBlock(template, `${newline}${oldStartTimerBlock}`);
  template = removeOptionalBlock(template, `${oldStartTimerBlock}${newline}`);
  template = removeOptionalBlock(template, `${newline}${oldStopTimerBlock}`);
  template = removeOptionalBlock(template, `${oldStopTimerBlock}${newline}`);
  template = template.replace(/^\s*Call HollowRunUpdateSplashProgress\r?\n/gm, '');
  template = template.replace(/^\s*SendMessage \$HollowRunSplashProgress 0x0402 100 0\r?\n/gm, '');
  template = template.replace(/^\s*SendMessage \$HollowRunSplashStatus 0x000C 0 "STR:Starting HollowRun\.\.\."\r?\n/gm, '');

  if (template.includes(oldAttachProgressBlock)) {
    template = template.replace(oldAttachProgressBlock, '    HideWindow');
  } else {
    template = template.replace(
      `    HideWindow${newline}    Call HollowRunKeepSplashTopmost`,
      '    HideWindow'
    );
  }
  template = removeOptionalBlock(template, `${newline}${oldOriginalTopmostBlock}`);
}

if (
  template.includes('HollowRunSplash')
  || template.includes('HollowRunKeepSplashTopmost')
  || PREVIOUS_GUI_MARKERS.some(marker => template.includes(marker))
) {
  throw new Error('Could not fully normalize the previous HollowRun splash patch.');
}

if (!template.includes(silentModeBlock)) {
  throw new Error('Portable template is missing its silent-mode block.');
}

const sectionAnchor = `${newline}Section${newline}`;
const sectionAnchorCount = template.split(sectionAnchor).length - 1;
if (sectionAnchorCount !== 1) {
  throw new Error(`Expected one Section anchor, found ${sectionAnchorCount}.`);
}
template = template.replace(
  sectionAnchor,
  `${newline}Section${newline}${launchSplashBlock}${newline}`
);

if (!previousGuiMarker) {
  const execSuffix = 'ExecWait "$INSTDIR\\${APP_EXECUTABLE_FILENAME} $R0" $0';
  const execIndex = template.indexOf(execSuffix);
  if (execIndex < 0 || template.indexOf(execSuffix, execIndex + execSuffix.length) >= 0) {
    throw new Error('Expected one portable application launch anchor.');
  }
  const execLineStart = template.lastIndexOf(newline, execIndex) + newline.length;
  const execLineEndCandidate = template.indexOf(newline, execIndex);
  const execLineEnd = execLineEndCandidate < 0 ? template.length : execLineEndCandidate;
  const execLine = template.slice(execLineStart, execLineEnd);
  template = `${template.slice(0, execLineStart)}${finishSplashBlock}${newline}${newline}${execLine}${template.slice(execLineEnd)}`;
}

assertCurrentPatch(template);
fs.writeFileSync(templatePath, template, 'utf8');
console.log('Configured the independent WinForms splash at the start of portable extraction.');
