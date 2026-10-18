/**
 * PREPARED ONLY: run with --go during the owner's exclusive shell verification window.
 * Actual native handlers + mounted props + simulator frames. No service/build/project edits.
 * Intentionally never terminates, relaunches, pauses or reloads the app.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { connectNativeRuntime } from './cdp.mjs';

const cli = process.argv.slice(2);
const ownDirectory = path.dirname(fileURLToPath(import.meta.url));
const argument = (name, fallback) => {
  const index = cli.indexOf(name);
  return index < 0 ? fallback : cli[index + 1];
};
if (!cli.includes('--go')) {
  console.log('Prepared audit; no runtime actions performed.');
  console.log('After owner GO, run: node verification/system-appearance-audit.mjs --go');
  console.log('Optional: --device <UDID> --port <Metro port> --output <new output directory>');
  process.exit(0);
}

const device = argument('--device', '93BCE7CC-D004-43AF-8F44-1EB2ADF526E9');
const port = Number(argument('--port', '8081'));
const appId = 'com.smilestudio.app';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.resolve(argument('--output', path.join(ownDirectory, `system-appearance-${runId}`)));
const runFile = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const equal = (left, right) => JSON.stringify(sortObject(left)) === JSON.stringify(sortObject(right));
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}
const log = (message) => console.log(`[System audit] ${message}`);
async function command(binary, args) {
  return (await runFile(binary, args, { timeout: 25000, maxBuffer: 2_000_000 })).stdout.trim();
}
const simctl = (...args) => command('/usr/bin/xcrun', ['simctl', ...args]);
async function optionalBytes(filename) {
  try { return await readFile(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function projectHashes(documents) {
  const folder = path.join(documents, 'projects');
  let filenames;
  try { filenames = await readdir(folder); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  const hashes = {};
  for (const filename of filenames.filter((item) => item.endsWith('.json')).sort()) {
    hashes[filename] = sha256(await readFile(path.join(folder, filename)));
  }
  return hashes;
}

let runtime;
let preferencesPath;
let documents;
let originalPreferencesBytes;
let originalPreferences;
let originalOS;
let originalProjects;
let mutationStarted = false;
let failure;
const report = {
  date: new Date().toISOString(), appId, device, port, output,
  method: 'Actual native handlers, Appearance, mounted root/theme/status-bar props, and unmodified simulator frames',
  appRelaunchPerformed: false,
  earlierRelaunchPersistenceProof: 'relaunch-preferences.json from the earlier shell audit',
  captures: [], observations: [], cleanup: {},
};

await mkdir(output, { recursive: false });

async function connect() {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const connection = await connectNativeRuntime({ port, appId });
      runtime = connection;
      await evaluate(await readFile(path.join(ownDirectory, 'native-ui.js'), 'utf8'));
      await evaluate(installProofExpression);
      return;
    } catch (error) {
      lastError = error;
      runtime?.close();
      runtime = undefined;
      await delay(300);
    }
  }
  throw lastError ?? new Error('Existing Hermes runtime is unavailable');
}

// CDP does not await React Native's Promise implementation: every expression below is synchronous.
async function evaluate(expression) {
  const response = await runtime.call('Runtime.evaluate', { expression, returnByValue: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result?.value ?? response.result;
}

const installProofExpression = `(() => {
  globalThis.__systemAuditSnapshot = () => {
    const rn = __shellModule('node_modules/react-native/index.js');
    const state = __shellModule('src/state/preferences.ts').usePreferences.getState();
    const route = __shellModule('expo-router/build/global-state/router-store.js').store.getRouteInfo();
    const name = f => typeof f?.type === 'string' ? f.type :
      f?.type?.displayName || f?.type?.name || f?.type?.render?.name || f?.elementType?.name || '';
    const all = __shellFibers();
    const root = all.find(f => name(f) === 'RootLayout' || name(f).startsWith('RootLayout('));
    const inside = [];
    const visit = f => { if (!f) return; inside.push(f); for (let child = f.child; child; child = child.sibling) visit(child); };
    visit(root);
    const flatten = style => rn.StyleSheet.flatten(style) || {};
    const rootViews = inside.filter(f => /GestureHandlerRootView/.test(name(f))).map(f => ({
      name: name(f), backgroundColor: flatten(f.memoizedProps?.style).backgroundColor,
    }));
    const directRootChild = root?.child ? { name: name(root.child),
      backgroundColor: flatten(root.child.memoizedProps?.style).backgroundColor } : null;
    const themes = inside.filter(f => typeof f.memoizedProps?.value?.dark === 'boolean' && f.memoizedProps.value.colors?.background)
      .map(f => ({ name: name(f), dark: f.memoizedProps.value.dark,
        background: f.memoizedProps.value.colors.background, card: f.memoizedProps.value.colors.card,
        text: f.memoizedProps.value.colors.text, primary: f.memoizedProps.value.colors.primary }));
    const statusBars = inside.filter(f => /StatusBar/.test(name(f))).map(f => ({
      name: name(f), style: f.memoizedProps?.style, barStyle: f.memoizedProps?.barStyle,
      hidden: f.memoizedProps?.hidden,
    }));
    return {
      ready: state.ready, error: state.error, preferences: state.preferences,
      restorationPending: globalThis.__systemAuditRestorePending === true,
      restorationError: globalThis.__systemAuditRestoreError || null,
      pathname: route.pathname, segments: route.segments,
      nativeAppearance: rn.Appearance.getColorScheme(), rootFound: !!root,
      directRootChild, rootViews, themes, statusBars,
      palettes: { light: __shellModule('src/ui/theme.ts').lightColors, dark: __shellModule('src/ui/theme.ts').darkColors },
      diagnosticComponentNames: root ? undefined : all.map(name).filter(n => /RootLayout|GestureHandlerRootView|ThemeProvider|StatusBar/.test(n)),
    };
  };
  return { proofInstalled: true };
})()`;

const snapshot = () => evaluate('__systemAuditSnapshot()');
async function poll(label, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await snapshot();
    if (predicate(last)) return last;
    await delay(250);
  }
  report.lastFailedObservation = { label, observation: last };
  throw new Error(`Timed out: ${label}`);
}
function appearanceMatches(state, scheme) {
  const palette = state.palettes?.[scheme];
  if (!palette || !state.rootFound || state.nativeAppearance !== scheme) return false;
  const rootColorMatches = state.directRootChild?.backgroundColor === palette.bg ||
    state.rootViews.some((view) => view.backgroundColor === palette.bg);
  const theme = state.themes.find((item) => item.name === 'ThemeProvider') ?? state.themes[0];
  const themeMatches = theme && theme.dark === (scheme === 'dark') && theme.background === palette.bg &&
    theme.card === palette.surface && theme.text === palette.text && theme.primary === palette.accentText;
  const expoStyle = scheme === 'dark' ? 'light' : 'dark';
  const nativeStyle = `${expoStyle}-content`;
  return rootColorMatches && themeMatches &&
    state.statusBars.some((bar) => bar.style === expoStyle && bar.hidden !== true) &&
    state.statusBars.some((bar) => bar.barStyle === nativeStyle && bar.hidden !== true);
}
async function waitForAppearance(scheme, requireSystem = true) {
  let consecutive = 0;
  return poll(`Appearance + root palette + Expo/native status bars match ${scheme}`, (state) => {
    const match = state.ready && !state.error && (!requireSystem || state.preferences.appearance === 'system') && appearanceMatches(state, scheme);
    consecutive = match ? consecutive + 1 : 0;
    return consecutive >= 3;
  });
}
async function capture(label) {
  // Allow the native status-bar animation and any development loading banner to settle.
  await delay(1200);
  const temporary = path.join('/private/tmp', `smile-system-${runId}-${label}.png`);
  await simctl('io', device, 'screenshot', temporary);
  const destination = path.join(output, `${label}.png`);
  await copyFile(temporary, destination);
  const entry = { file: `${label}.png`, sha256: sha256(await readFile(destination)) };
  report.captures.push(entry);
  return entry;
}

try {
  log('Snapshotting preference file, OS appearance and saved-project hashes.');
  const appBundle = await simctl('get_app_container', device, appId, 'app');
  const dataContainer = await simctl('get_app_container', device, appId, 'data');
  documents = path.join(dataContainer, 'Documents');
  preferencesPath = path.join(documents, 'preferences.json');
  originalPreferencesBytes = await optionalBytes(preferencesPath);
  originalOS = await simctl('ui', device, 'appearance');
  if (!['light', 'dark'].includes(originalOS)) throw new Error(`Unexpected OS appearance: ${originalOS}`);
  originalProjects = await projectHashes(documents);
  if (originalPreferencesBytes !== null) await writeFile(path.join(output, 'original-preferences.bin'), originalPreferencesBytes);
  await writeFile(path.join(output, 'original-project-hashes.json'), JSON.stringify(originalProjects, null, 2) + '\n');
  report.installedUserInterfaceStyle = await command('/usr/libexec/PlistBuddy', ['-c', 'Print :UIUserInterfaceStyle', path.join(appBundle, 'Info.plist')]);
  if (report.installedUserInterfaceStyle !== 'Automatic') throw new Error(`Installed UIUserInterfaceStyle must be Automatic; got ${report.installedUserInterfaceStyle}`);

  await connect();
  const baseline = await poll('Preferences are hydrated without an error', (state) => state.ready && !state.error);
  if (baseline.pathname !== '/') throw new Error(`Start this audit on Studio (/); current route is ${baseline.pathname}`);
  originalPreferences = baseline.preferences;
  report.baseline = { osAppearance: originalOS, preferences: originalPreferences,
    preferenceFileExists: originalPreferencesBytes !== null,
    preferenceFileSHA256: originalPreferencesBytes === null ? null : sha256(originalPreferencesBytes),
    projectCount: Object.keys(originalProjects).length, mounted: baseline };
  await writeFile(path.join(output, 'baseline.json'), JSON.stringify(report.baseline, null, 2) + '\n');

  log('Selecting System using the mounted Settings handler.');
  mutationStarted = true;
  await evaluate("__shellPress('Open settings')");
  await poll('Settings route is mounted', (state) => state.pathname === '/settings');
  await evaluate("__shellPress('System appearance')");
  await poll('System preference write completes', (state) => state.ready && !state.error && state.preferences.appearance === 'system');
  const persisted = JSON.parse(await readFile(preferencesPath, 'utf8'));
  if (persisted.preferences?.appearance !== 'system') throw new Error('System preference did not persist to disk');
  report.systemSelectionPersistedToDisk = true;

  for (const scheme of ['light', 'dark']) {
    log(`Changing simulator OS to ${scheme}; waiting for actual native Appearance, root palette and both status-bar props.`);
    await simctl('ui', device, 'appearance', scheme);
    const observed = await waitForAppearance(scheme);
    const actualOS = await simctl('ui', device, 'appearance');
    if (actualOS !== scheme) throw new Error(`OS appearance read-back mismatch: ${actualOS} != ${scheme}`);
    report.observations.push({ requestedOS: scheme, actualOS, mounted: observed });
    await capture(`system-${scheme}`);
  }
  report.systemFollowsOS = true;
  log('System follows both OS appearances; restoring the original state.');
} catch (error) {
  failure = error;
  report.error = error.stack ?? String(error);
} finally {
  const cleanupErrors = [];
  if (mutationStarted) {
    try {
      await simctl('ui', device, 'appearance', originalOS);
      report.cleanup.osAppearanceRestored = (await simctl('ui', device, 'appearance')) === originalOS;
    } catch (error) { cleanupErrors.push(`OS restore: ${error.message}`); }
    try {
      if (!runtime) await connect();
      await evaluate(`(() => {
        globalThis.__systemAuditRestoreError = null;
        globalThis.__systemAuditRestorePending = true;
        __shellModule('src/state/preferences.ts').usePreferences.getState().updatePreferences(${JSON.stringify(originalPreferences)})
          .then(() => { globalThis.__systemAuditRestorePending = false; }, error => {
            globalThis.__systemAuditRestoreError = String(error);
            globalThis.__systemAuditRestorePending = false;
          });
        return { restoreRequested: true };
      })()`);
      const restored = await poll('Original preference values restored after write completion', (state) =>
        state.ready && !state.error && !state.restorationPending && !state.restorationError && equal(state.preferences, originalPreferences));
      report.cleanup.preferenceValuesRestored = equal(restored.preferences, originalPreferences);
    } catch (error) { cleanupErrors.push(`Preference values restore: ${error.stack ?? error.message}`); }
    try {
      // Restore the exact bytes as well as values, including the originally absent-file case.
      // This disk restore remains independent of CDP availability after a test failure.
      if (originalPreferencesBytes === null) {
        await rm(preferencesPath, { force: true });
      } else {
        const currentBytes = await optionalBytes(preferencesPath);
        if (currentBytes === null || !currentBytes.equals(originalPreferencesBytes)) {
          const temporary = `${preferencesPath}.system-audit-${runId}.tmp`;
          await writeFile(temporary, originalPreferencesBytes);
          await rename(temporary, preferencesPath);
        }
      }
      const finalBytes = await optionalBytes(preferencesPath);
      report.cleanup.preferenceBytesRestored = originalPreferencesBytes === null ? finalBytes === null :
        finalBytes !== null && finalBytes.equals(originalPreferencesBytes);
    } catch (error) { cleanupErrors.push(`Preference bytes restore: ${error.message}`); }
    try {
      if (!runtime) await connect();
      await evaluate(`(() => {
        const router = __shellModule('expo-router/build/imperative-api.js').router;
        if (router.canGoBack()) router.back(); else router.replace('/');
        return { studioRequested: true };
      })()`);
      await poll('Studio root route restored', (state) => state.pathname === '/');
      await evaluate("__shellPress('Studio tab')");
      await evaluate("(() => { __shellFibers().filter(f => typeof f.stateNode?.scrollTo === 'function').forEach(f => f.stateNode.scrollTo({ y: 0, animated: false })); return { scrolledToTop: true }; })()");
      const finalScheme = originalPreferences.appearance === 'system' ? originalOS : originalPreferences.appearance;
      const finalMounted = await waitForAppearance(finalScheme, false);
      report.cleanup.studioRestored = finalMounted.pathname === '/';
      report.cleanup.finalMounted = finalMounted;
      await capture('restored-studio');
    } catch (error) { cleanupErrors.push(`Studio UI restore: ${error.stack ?? error.message}`); }
  }
  if (documents && originalProjects) {
    try {
      const finalProjects = await projectHashes(documents);
      report.cleanup.projectFilesUnchanged = equal(originalProjects, finalProjects);
      report.cleanup.finalProjectHashes = finalProjects;
      await writeFile(path.join(output, 'final-project-hashes.json'), JSON.stringify(finalProjects, null, 2) + '\n');
      if (!report.cleanup.projectFilesUnchanged) cleanupErrors.push('Saved project files changed; no project restoration was attempted.');
    } catch (error) { cleanupErrors.push(`Project verification: ${error.message}`); }
  }
  runtime?.close();
  report.cleanup.errors = cleanupErrors;
  report.passed = !failure && report.systemFollowsOS === true && cleanupErrors.length === 0 &&
    report.cleanup.osAppearanceRestored === true && report.cleanup.preferenceValuesRestored === true &&
    report.cleanup.preferenceBytesRestored === true && report.cleanup.studioRestored === true &&
    report.cleanup.projectFilesUnchanged === true;
  await writeFile(path.join(output, 'system-appearance-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, output, report: path.join(output, 'system-appearance-report.json'), cleanupErrors }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
