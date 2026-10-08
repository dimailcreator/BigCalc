import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import CDP from "chrome-remote-interface";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = process.env.ANDROID_HOME ?? path.join(workspace, ".android-sdk");
const adb = path.join(sdkRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const deviceArgs = process.env.ANDROID_SERIAL ? ["-s", process.env.ANDROID_SERIAL] : [];
const port = 9228;
const live = "#app > .calculator-shell";
const bmi = `${live} > .calculator-module-screen[data-module-id="bmi"]`;
const height = `${bmi} input[id$="-height"]`;
const weight = `${bmi} input[id$="-weight"]`;
const units = `${live} .units-calculator`;
const math = `${units} input[id$="-value"]`;
const from = `${units} input[id$="-from"]`;
const to = `${units} input[id$="-to"]`;
const keyboard = `${live} > .calculator-keyboard`;
const output = path.join(workspace, ".release-test", "stage15", "android");
const apk = path.join(workspace, "android/app/build/outputs/apk/debug/app-debug.apk");
const withRegressions = process.argv.slice(2).includes("--with-regressions");
if (process.argv.slice(2).some((arg) => arg !== "--with-regressions"))
  throw new Error("Usage: npm run test:android:units -- [--with-regressions]");
if (!existsSync(adb) || !existsSync(apk))
  throw new Error("Build/install debug APK and provide Android SDK first");
mkdirSync(output, { recursive: true });
const adbOutput = (args) =>
  execFileSync(adb, [...deviceArgs, ...args], { encoding: "utf8" }).trim();
const results = { conversions: [], errors: [], appearance: [], screenshots: [], regressions: [] };
let client;
let snapshot;
let failure;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function evaluate(expression) {
  const response = await client.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (response.exceptionDetails)
    throw new Error(
      response.exceptionDetails.exception?.description ?? "WebView evaluation failed"
    );
  return response.result.value;
}

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await delay(150);
  }
  throw new Error(`${label}: timed out`);
}

async function connect(restart = false) {
  await client?.close();
  client = undefined;
  if (restart) {
    adbOutput(["shell", "am", "force-stop", "com.bigcalc.app"]);
    adbOutput(["shell", "am", "start", "-n", "com.bigcalc.app/.MainActivity"]);
  }
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt += 1) {
    try {
      const pid = adbOutput(["shell", "pidof", "com.bigcalc.app"]);
      if (
        pid &&
        adbOutput(["shell", "cat", "/proc/net/unix"]).includes(`@webview_devtools_remote_${pid}`)
      ) {
        adbOutput(["forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`]);
        target = (await CDP.List({ host: "127.0.0.1", port })).find(
          (item) => item.type === "page" && item.url.startsWith("https://localhost/")
        );
      }
    } catch {
      // Wait for process/socket creation after force-stop.
    }
    if (!target) await delay(200);
  }
  assert(target, "BigCalc WebView was not found");
  client = await CDP({ target, host: "127.0.0.1", port, local: true });
  await client.Page.enable();
  await waitFor(() => evaluate(`document.querySelector('${live}') !== null`), "App mount");
}

async function storage() {
  return evaluate(
    "Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('bigcalc.')).map(key=>[key,localStorage.getItem(key)]))"
  );
}

async function restoreStorage(value) {
  // Restore before bootstrap: the outgoing page's lifecycle flush must not
  // overwrite the incoming snapshot or leave stale in-memory repositories.
  const { identifier } = await client.Page.addScriptToEvaluateOnNewDocument({
    source: `(() => {for(const key of Object.keys(localStorage).filter(key=>key.startsWith('bigcalc.')))localStorage.removeItem(key);for(const [key,value] of Object.entries(${JSON.stringify(value)}))localStorage.setItem(key,value);globalThis.__unitsStorageRestored=true;})()`
  });
  try {
    await client.Page.reload();
    await waitFor(
      () =>
        evaluate(`globalThis.__unitsStorageRestored && document.querySelector('${live}') !== null`),
      "storage restoration"
    );
  } finally {
    await client.Page.removeScriptToEvaluateOnNewDocument({ identifier });
  }
  const restored = await storage();
  assert(
    Object.keys(restored).length === Object.keys(value).length &&
      Object.entries(value).every(([key, text]) => restored[key] === text),
    "Storage snapshot mismatch"
  );
}

async function tap(selector) {
  await evaluate(
    `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`
  );
  await delay(200);
  const point = await evaluate(
    `(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:(r.left+r.width/2)*devicePixelRatio,y:(r.top+r.height/2)*devicePixelRatio};})()`
  );
  const target = (await CDP.List({ host: "127.0.0.1", port })).find(
    (item) => item.type === "page" && item.url.startsWith("https://localhost/")
  );
  assert(target, "WebView disappeared before native tap");
  const offset = JSON.parse(target.description);
  results.lastTap = { selector, point, offset };
  adbOutput([
    "shell",
    "input",
    "tap",
    String(Math.round(point.x + (offset.screenX ?? 0))),
    String(Math.round(point.y + offset.screenY))
  ]);
  await delay(200);
}

function imeShown() {
  return /mInputShown=true/u.test(adbOutput(["shell", "dumpsys", "input_method"]));
}

async function nativeText(selector, text) {
  assert(/^[a-zA-Z0-9,.*/^()-]*$/u.test(text), "Only ASCII acceptance text is allowed");
  await tap(selector);
  await waitFor(() => imeShown(), `IME for ${selector}`);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);
  adbOutput(["shell", "input", "keyevent", "KEYCODE_DEL"]);
  if (text) adbOutput(["shell", "input", "text", text]);
  await waitFor(
    () =>
      evaluate(
        `document.querySelector(${JSON.stringify(selector)}).value === ${JSON.stringify(text)}`
      ),
    `native input ${text}`
  );
}

async function chromeGeometry() {
  const geometry = await evaluate(`(() => {
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height};
    };
    const wall = getComputedStyle(document.body,'::before');
    return {header:rect('${live} > .top-bar'),drawer:rect('${live} .drawer-toggle'),overflow:rect('${live} .overflow-toggle'),wallpaper:{height:wall.height,top:wall.top,width:wall.width},fonts:['.expression-editor','.number-viewport'].map(selector=>getComputedStyle(document.querySelector('${units} '+selector)).fontSize),surface:rect('${units}'),viewport:[innerWidth,innerHeight],scrollY,horizontalOverflow:document.documentElement.scrollWidth>innerWidth};
  })()`);
  const target = (await CDP.List({ host: "127.0.0.1", port })).find(
    (item) => item.type === "page" && item.url.startsWith("https://localhost/")
  );
  assert(target, "WebView geometry unavailable");
  const offset = JSON.parse(target.description);
  return { ...geometry, hostOffset: { x: offset.screenX, y: offset.screenY } };
}

async function expectStableChrome(before, label) {
  const after = await chromeGeometry();
  for (const part of ["header", "drawer", "overflow"]) {
    for (const key of ["x", "y", "width", "height"])
      assert(
        Math.abs(after[part][key] - before[part][key]) < 0.1,
        `${label}: ${part}.${key} changed with IME`
      );
  }
  assert(
    JSON.stringify(after.wallpaper) === JSON.stringify(before.wallpaper),
    `${label}: wallpaper changed with IME`
  );
  assert(
    JSON.stringify(after.fonts) === JSON.stringify(before.fonts),
    `${label}: numeric fonts changed`
  );
  assert(after.scrollY === 0 && !after.horizontalOverflow, `${label}: page overflow/scroll`);
  assert(
    JSON.stringify(after.hostOffset) === JSON.stringify(before.hostOffset),
    `${label}: native WebView panned`
  );
  results.imeChromeChecks ??= [];
  results.imeChromeChecks.push({ label, before, after });
}

async function swipeModule(up, distance) {
  const point = await evaluate(`(() => {
    const r=document.querySelector('${units}').getBoundingClientRect();
    const bottom=Math.min(r.bottom,innerHeight)-30;
    return {x:(r.x+r.width*.85)*devicePixelRatio,top:(bottom-${distance})*devicePixelRatio,bottom:bottom*devicePixelRatio};
  })()`);
  const offset = JSON.parse(
    (await CDP.List({ host: "127.0.0.1", port })).find(
      (item) => item.type === "page" && item.url.startsWith("https://localhost/")
    ).description
  );
  adbOutput([
    "shell",
    "input",
    "swipe",
    String(Math.round(point.x + offset.screenX)),
    String(Math.round((up ? point.bottom : point.top) + offset.screenY)),
    String(Math.round(point.x + offset.screenX)),
    String(Math.round((up ? point.top : point.bottom) + offset.screenY)),
    "700"
  ]);
  await delay(500);
  assert(imeShown(), "Module swipe dismissed IME");
}

async function revealResult() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const box = await evaluate(
      `(() => {const r=document.querySelector('${units} .units-result').getBoundingClientRect();return {top:r.top,bottom:r.bottom,header:document.querySelector('${live} .top-bar').getBoundingClientRect().bottom,height:innerHeight};})()`
    );
    if (box.top >= box.header && box.bottom <= box.height + 1) return;
    const up = box.bottom > box.height;
    const gap = up ? box.bottom - box.height : box.header - box.top;
    await swipeModule(up, Math.min(120, Math.max(25, gap + 10)));
  }
  throw new Error("Result is not fully reachable above IME");
}

async function dismissIme() {
  if (imeShown()) {
    adbOutput(["shell", "input", "keyevent", "KEYCODE_BACK"]);
    await waitFor(() => !imeShown(), "IME dismissal");
  }
}

async function active(id) {
  await waitFor(
    () => evaluate(`document.querySelector('${live}').dataset.activeModule === '${id}'`),
    `active ${id}`
  );
}

async function switchTo(id) {
  await dismissIme();
  await tap(`${live} .drawer-toggle`);
  await tap(`.calculator-drawer-item[data-module-id="${id}"]`);
  await active(id);
}

async function expectBmi(number, category, heightText, weightText) {
  await active("bmi");
  await waitFor(
    () =>
      evaluate(
        `(() => {const root=document.querySelector('${bmi}');return root.querySelector('.bmi-result-number').textContent===${JSON.stringify(number)} && root.querySelector('.bmi-result-category').textContent===${JSON.stringify(category)} && root.querySelector('.bmi-result-category').getAttribute('aria-label')===${JSON.stringify(`Категория: ${category}`)} && root.querySelector('input[id$="-height"]').value===${JSON.stringify(heightText)} && root.querySelector('input[id$="-weight"]').value===${JSON.stringify(weightText)};})()`
      ),
    `BMI ${number} / ${category}`
  );
}

function screenshot(name) {
  const remote = "/sdcard/bigcalc-units-acceptance.png";
  adbOutput(["shell", "screencap", "-p", remote]);
  execFileSync(adb, [...deviceArgs, "pull", remote, path.join(output, `${name}.png`)], {
    stdio: "ignore"
  });
  results.screenshots.push(`${name}.png`);
}

async function systemBack(check, label) {
  adbOutput(["shell", "input", "keyevent", "KEYCODE_BACK"]);
  await waitFor(check, label);
}

async function openSettings() {
  await tap(`${live} .overflow-toggle`);
  await tap('.overflow-menu button[role="menuitem"]');
  await waitFor(
    () => evaluate("document.querySelector('.settings-screen').dataset.open === 'true'"),
    "Settings open"
  );
}

async function observeWorker() {
  await client.Page.addScriptToEvaluateOnNewDocument({
    source: `(() => {
    const NativeWorker=globalThis.Worker;
    globalThis.__unitsWorkers=0;globalThis.__unitsCommands=[];globalThis.__unitsNativeEvents=[];
    globalThis.Worker=class extends NativeWorker {
      constructor(...args){super(...args);globalThis.__unitsWorkers++;}
      postMessage(command){globalThis.__unitsCommands.push(command);super.postMessage(command);}
    };
    document.addEventListener('input',event=>{
      if(event.target.matches?.('${from},${to},${height},${weight}'))
        globalThis.__unitsNativeEvents.push({id:event.target.id,value:event.target.value,trusted:event.isTrusted});
    },true);
  })()`
  });
}

async function key(name) {
  await tap(`${keyboard} [data-key="${name}"]`);
}

async function mathFocus() {
  await tap(math);
  await waitFor(() => !imeShown(), "math suppresses native IME");
  await waitFor(
    () =>
      evaluate(
        `document.activeElement===document.querySelector('${math}') && getComputedStyle(document.querySelector('${keyboard}')).display!=='none'`
      ),
    "focused math/shared keyboard"
  );
}

async function setMath(keys) {
  await mathFocus();
  await key("clear");
  if (
    keys.some((name) => ["pi", "e", "squareRoot", "sin"].includes(name)) &&
    (await evaluate(`document.querySelector('${keyboard}').dataset.expanded!=='true'`))
  )
    await key("expand");
  for (const name of keys) await key(name);
}

async function expectResult(expected, prefix = false) {
  const comparison = prefix
    ? `.startsWith(${JSON.stringify(expected)})`
    : `===${JSON.stringify(expected)}`;
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('${units}').dataset.phase==='completed' && document.querySelector('${units} .number-viewport-content').textContent.trim()${comparison}`
      ),
    `Units result ${expected}`
  );
}

async function conversion(label, keys, source, target, expected, prefix = false) {
  if (source !== null) {
    await nativeText(from, source);
    await nativeText(to, target);
  }
  await setMath(keys);
  await expectResult(expected, prefix);
  const sources = await readSources();
  results.conversions.push({
    label,
    sources,
    expected,
    match: prefix ? "prefix" : "exact",
    rendered: await evaluate(
      `document.querySelector('${units} .number-viewport-content').textContent`
    )
  });
  assert(await evaluate("globalThis.__unitsWorkers===1"), "Units created a second Worker");
}

async function readSources() {
  return evaluate(
    `({valueSource:document.querySelector('${math}').value,fromUnitText:document.querySelector('${from}').value,toUnitText:document.querySelector('${to}').value})`
  );
}

async function expectError(label, text) {
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('${units}').dataset.phase==='failed' && document.querySelector('${units}').textContent.includes(${JSON.stringify(text)}) && document.querySelector('${units} .number-viewport-content').textContent.trim()===''`
      ),
    label
  );
  results.errors.push({ label, text, sources: await readSources() });
}

try {
  assert(
    adbOutput(["shell", "getprop", "ro.kernel.qemu"]) !== "1",
    "Physical Android device required"
  );
  await connect(true);
  snapshot = await storage();
  writeFileSync(path.join(output, "entry-storage.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  results.device = adbOutput(["shell", "getprop", "ro.product.model"]);
  results.android = adbOutput(["shell", "getprop", "ro.build.version.release"]);
  results.webview = adbOutput(["shell", "dumpsys", "webviewupdate"]).match(
    /Current WebView package \(name, version\): (.+)/u
  )?.[1];
  results.ime = adbOutput(["shell", "settings", "get", "secure", "default_input_method"]);
  const apkBytes = readFileSync(apk);
  results.apkBytes = apkBytes.length;
  results.apkSha256 = createHash("sha256").update(apkBytes).digest("hex");
  results.installedAssets = [];
  for (const name of [
    "index.html",
    ...readdirSync(path.join(workspace, "dist-app/assets")).map((name) => `assets/${name}`)
  ]) {
    const expected = createHash("sha256")
      .update(readFileSync(path.join(workspace, "dist-app", name)))
      .digest("hex");
    const installed = await evaluate(
      `(async()=>{const response=await fetch(${JSON.stringify(`/${name}`)});if(!response.ok)throw new Error('Missing installed asset');return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');})()`
    );
    assert(installed === expected, `Installed APK asset differs from current build: ${name}`);
    results.installedAssets.push({ name, sha256: installed });
  }
  results.viewport = await evaluate("({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})");
  await restoreStorage({});
  if (withRegressions) {
    assert(process.env.npm_execpath, "Use npm run test:android:units -- --with-regressions");
    await client.close();
    client = undefined;
    for (const name of ["smoke", "lifecycle", "stage34", "bmi"]) {
      process.stdout.write(`Android regression: ${name}\n`);
      execFileSync(process.execPath, [process.env.npm_execpath, "run", `test:android:${name}`], {
        cwd: workspace,
        stdio: "inherit"
      });
      results.regressions.push(name);
    }
    await connect(true);
    await restoreStorage({});
  }
  assert(
    await evaluate(`getComputedStyle(document.querySelector('${keyboard}')).display!=='none'`),
    "Primary root keyboard was not visible before Back"
  );
  adbOutput(["shell", "input", "keyevent", "KEYCODE_BACK"]);
  let resumedActivities;
  await waitFor(() => {
    resumedActivities = adbOutput(["shell", "dumpsys", "activity", "activities"])
      .split("\n")
      .filter((line) => /topResumedActivity|mResumedActivity/u.test(line));
    return (
      resumedActivities.length > 0 &&
      resumedActivities.every((line) => !line.includes("com.bigcalc.app"))
    );
  }, "Primary root Back exits instead of hiding the keyboard");
  results.primaryRootBack = { exited: true, resumedActivities };
  await client?.close().catch(() => undefined);
  client = undefined;
  await connect(true);
  await observeWorker();
  await restoreStorage({});
  for (const name of ["1", "divide", "3", "equals"]) await key(name);
  await waitFor(
    () =>
      evaluate(`document.querySelector('${live} .main-display .expression-input').value==='Ans'`),
    "primary exact Ans"
  );
  const primaryHistory = await evaluate("localStorage.getItem('bigcalc.history.v1')");
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('${live} .main-display').dataset.phase==='completed' && document.querySelector('${live} .main-display > .result-output').textContent.trim().startsWith('0,333')`
      ),
    "primary Ans completed"
  );
  const primaryCreate = await evaluate(
    "globalThis.__unitsCommands.filter(command=>['create','createStructured'].includes(command.type)).at(-1)"
  );
  results.primarySession = primaryCreate.sessionId;
  const beforeUnits = await evaluate("globalThis.__unitsCommands.length");
  await switchTo("units");
  await conversion("1 км/ч → м/с", ["1"], null, null, "0,277777", true);
  results.initialUnitsCommands = await evaluate(`globalThis.__unitsCommands.slice(${beforeUnits})`);
  const initialUnitsCreate = results.initialUnitsCommands.find(
    (command) => command.type === "create"
  );
  assert(
    initialUnitsCreate && initialUnitsCreate.sessionId !== primaryCreate.sessionId,
    "Units reused the primary session"
  );
  assert(
    !results.initialUnitsCommands.some(
      (command) =>
        ["cancel", "dispose"].includes(command.type) &&
        command.sessionId === primaryCreate.sessionId
    ),
    "Units cancelled/disposed the primary session"
  );
  await conversion("π км → м", ["pi"], "km", "m", "3141,592", true);
  await conversion("√2 м → см", ["squareRoot", "2"], "m", "cm", "141,4213", true);
  await conversion("1 Дж/Вт → с", ["1"], "J/W", "s", "1");
  await conversion("1 кДж*ч/Дж → с", ["1"], "kJ*h/J", "s", "3600000");
  await conversion("25 °C → K", ["2", "5"], "celsius", "K", "298,15");
  await conversion("32 °F → °C", ["3", "2"], "fahrenheit", "celsius", "0");
  await conversion("1 bar → Pa", ["1"], "bar", "Pa", "100000");
  await conversion("e м → м", ["e"], "m", "m", "2,71828", true);
  await conversion("sin(30) м → м", ["sin", "3", "0", "round"], "m", "m", "0,5");
  await setMath(["2", "plus", "3", "backspace", "4"]);
  await expectResult("6");
  assert(
    (await readSources()).valueSource === "2+4",
    "Shared digit/operator/backspace insertion failed"
  );
  results.sharedKeyInsertion = true;
  await nativeText(from, "unknown");
  await expectError("unknown unit", "Неизвестная единица");
  await nativeText(from, "m");
  await nativeText(to, "s");
  await expectError("dimension mismatch", "Размерности единиц не совпадают");
  await nativeText(from, "celsius*m");
  await nativeText(to, "K");
  await expectError("affine misuse", "используется отдельно");
  await nativeText(from, "m");
  await nativeText(to, "m");
  await setMath(["1", "plus"]);
  await key("equals");
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('${units}').dataset.phase==='failed' && document.querySelector('${math}').getAttribute('aria-invalid')==='true'`
      ),
    "invalid math error"
  );
  results.errors.push({ label: "invalid math", sources: await readSources() });
  await setMath(["1"]);
  await expectResult("1");
  const sourceBeforeBack = await readSources();
  await tap(`${live} .drawer-toggle`);
  await systemBack(
    () => evaluate("document.querySelector('.calculator-drawer-layer').hidden"),
    "overlay Back"
  );
  await active("units");
  assert(
    await evaluate(`getComputedStyle(document.querySelector('${keyboard}')).display!=='none'`),
    "Overlay Back dismissed math keyboard"
  );
  await systemBack(
    () =>
      evaluate(
        `document.querySelector('${live}').dataset.keyboardDismissed==='true' && getComputedStyle(document.querySelector('${keyboard}')).display==='none'`
      ),
    "shared keyboard Back"
  );
  await active("units");
  assert(
    JSON.stringify(await readSources()) === JSON.stringify(sourceBeforeBack),
    "Keyboard Back lost source"
  );
  adbOutput(["shell", "input", "keyevent", "KEYCODE_HOME"]);
  await waitFor(() => evaluate("document.visibilityState==='hidden'"), "Units background");
  adbOutput(["shell", "am", "start", "-n", "com.bigcalc.app/.MainActivity"]);
  await waitFor(() => evaluate("document.visibilityState==='visible'"), "Units foreground");
  assert(
    await evaluate(
      `document.querySelector('${live}').dataset.keyboardDismissed==='true' && getComputedStyle(document.querySelector('${keyboard}')).display==='none'`
    ),
    "Resume reopened dismissed keyboard"
  );
  await systemBack(
    () => evaluate(`document.querySelector('${live}').dataset.activeModule==='bigcalc'`),
    "second Back uses module stack"
  );
  await switchTo("units");
  assert(
    await evaluate(`getComputedStyle(document.querySelector('${keyboard}')).display==='none'`),
    "Module return reopened dismissed keyboard"
  );
  await mathFocus();
  results.keyboardBack = {
    overlay: true,
    dismiss: true,
    backgroundRetainsDismissal: true,
    subsequentNavigation: true,
    refocus: true
  };
  const commandsBeforeBmi = await evaluate("globalThis.__unitsCommands.length");
  await switchTo("bmi");
  await delay(500);
  const bmiCommandsStart = await evaluate("globalThis.__unitsCommands.length");
  await nativeText(height, "180");
  await nativeText(weight, "75");
  await expectBmi("23,15", "Норма", "180", "75");
  const bmiCommandsEnd = await evaluate("globalThis.__unitsCommands.length");
  assert(bmiCommandsStart === bmiCommandsEnd, "BMI edits sent Worker commands");
  results.bmi = { commandsBeforeBmi, commandsDuringEdits: bmiCommandsEnd - bmiCommandsStart };
  await switchTo("units");
  await expectResult("1");
  assert(
    JSON.stringify(await readSources()) === JSON.stringify(sourceBeforeBack),
    "Switching lost Units sources"
  );
  await switchTo("bigcalc");
  assert(
    await evaluate(
      `document.querySelector('${live} .main-display .expression-input').value==='Ans'`
    ),
    "Switching lost primary Ans"
  );
  assert(
    (await evaluate("localStorage.getItem('bigcalc.history.v1')")) === primaryHistory,
    "Units changed primary history"
  );
  await tap(`${live} .main-display .expression-input`);
  await key("multiply");
  await key("3");
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('${live} .main-display > .result-output').textContent.trim()==='1'`
      ),
    "primary exact Ans*3"
  );
  const primaryBeforeBack = await evaluate(
    `document.querySelector('${live} .main-display').getBoundingClientRect().toJSON()`
  );
  await systemBack(
    () => evaluate(`document.querySelector('${live}').dataset.activeModule==='units'`),
    "primary Back uses module stack without keyboard dismissal"
  );
  await switchTo("bigcalc");
  await active("bigcalc");
  const primaryAfterBack = await evaluate(`(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      header: rect('${live} > .top-bar'),
      display: rect('${live} .main-display'),
      expression: rect('${live} .main-display .expression-editor'),
      result: rect('${live} .main-display > .result-output'),
      source: document.querySelector('${live} .main-display .expression-input').value,
      text: document.querySelector('${live} .main-display > .result-output').textContent.trim(),
      height: innerHeight
    };
  })()`);
  assert(primaryAfterBack.text === "1", "Primary Back lost result");
  assert(primaryAfterBack.source === "Ans*3", "Primary Back lost source");
  assert(
    await evaluate(
      `document.querySelector('${live}').dataset.keyboardDismissed==='false' && getComputedStyle(document.querySelector('${keyboard}')).display!=='none'`
    ),
    "Primary Back dismissed the keyboard"
  );
  assert(
    JSON.stringify(primaryAfterBack.display) === JSON.stringify(primaryBeforeBack),
    "Primary Back changed display geometry"
  );
  for (const rect of [primaryAfterBack.expression, primaryAfterBack.result]) {
    assert(
      rect.height > 20 &&
        rect.top >= primaryAfterBack.header.bottom &&
        rect.bottom <= primaryAfterBack.height,
      `Primary Back moved content outside viewport: ${JSON.stringify(primaryAfterBack)}`
    );
  }
  results.primaryAfterBack = primaryAfterBack;
  screenshot("primary-after-back");
  await tap(`${live} .history-toggle`);
  await waitFor(
    () => evaluate(`document.querySelector('${live}').dataset.historyOpen==='true'`),
    "Primary History"
  );
  await systemBack(
    () => evaluate(`document.querySelector('${live}').dataset.historyOpen==='false'`),
    "History Back"
  );
  assert(
    await evaluate(
      `document.querySelector('${live}').dataset.keyboardDismissed==='false' && getComputedStyle(document.querySelector('${keyboard}')).display!=='none'`
    ),
    "History Back did not restore the primary keyboard"
  );
  await tap(`${live} .main-display .expression-input`);
  assert(
    await evaluate(`getComputedStyle(document.querySelector('${keyboard}')).display!=='none'`),
    "Primary refocus did not restore keyboard"
  );
  results.keyboardBack.primaryRetainsKeyboard = true;
  results.keyboardBack.historyRestoresKeyboard = true;
  results.switching = true;
  await switchTo("units");
  await mathFocus();
  for (const [theme, palette] of [
    ["dark", "lavender"],
    ["light", "blue"],
    ["dark", "liquid-glass"],
    ["light", "liquid-glass"]
  ]) {
    await openSettings();
    await tap(
      `.theme-preview-hit-target[aria-label="${theme === "dark" ? "Тёмная тема" : "Светлая тема"}"]`
    );
    await tap(`.settings-palette[data-palette="${palette}"]`);
    await systemBack(
      () =>
        evaluate(
          "document.querySelector('.settings-screen').dataset.open==='false' && getComputedStyle(document.querySelector('.settings-screen')).opacity==='0'"
        ),
      "Settings Back"
    );
    await mathFocus();
    await expectResult("1");
    const appearance = await evaluate(
      `({theme:document.documentElement.dataset.theme,palette:document.documentElement.dataset.palette,overflow:document.documentElement.scrollWidth>innerWidth})`
    );
    assert(
      appearance.theme === theme && appearance.palette === palette && !appearance.overflow,
      "Units appearance mismatch"
    );
    results.appearance.push(appearance);
    screenshot(`${theme}-${palette}-math`);
    await systemBack(
      () => evaluate(`document.querySelector('${live}').dataset.keyboardDismissed==='true'`),
      "native baseline without shared keyboard"
    );
    const before = await chromeGeometry();
    await tap(from);
    await waitFor(() => imeShown(), "Units native IME");
    await waitFor(
      () => evaluate("document.documentElement.dataset.nativeInputViewport==='held'"),
      "held native viewport"
    );
    assert(
      await evaluate(`getComputedStyle(document.querySelector('${keyboard}')).display==='none'`),
      "Native field did not hide shared keyboard"
    );
    await expectStableChrome(before, `${theme}/${palette} from IME`);
    const native = await chromeGeometry();
    assert(native.surface.height < before.surface.height, "Module did not resize with IME");
    await tap(to);
    await waitFor(() => imeShown(), "to IME remains open");
    await expectStableChrome(before, `${theme}/${palette} native A→B`);
    await revealResult();
    await expectStableChrome(before, `${theme}/${palette} native result swipe`);
    await waitFor(
      () =>
        evaluate(
          `document.querySelector('${units} .units-result').getBoundingClientRect().bottom<=innerHeight+1`
        ),
      "result reachable above IME"
    );
    assert(
      await evaluate(`document.querySelector('${units}').scrollTop>0`),
      "Native swipe did not scroll module"
    );
    screenshot(`${theme}-${palette}-ime`);
    await dismissIme();
    await active("units");
    await waitFor(
      () => evaluate("document.documentElement.dataset.nativeInputViewport!=='held'"),
      "IME Back restores viewport"
    );
    await expectStableChrome(before, `${theme}/${palette} IME Back`);
    await tap(from);
    await waitFor(() => imeShown(), "return to native");
    await mathFocus();
    await waitFor(
      () => evaluate("document.documentElement.dataset.nativeInputViewport!=='held'"),
      "math restores viewport"
    );
    await expectStableChrome(before, `${theme}/${palette} native→math`);
    assert(
      JSON.stringify(await readSources()) === JSON.stringify(sourceBeforeBack),
      "IME transitions lost sources"
    );
  }
  results.displaySizes = [];
  for (const size of ["small", "medium", "large"]) {
    await openSettings();
    await tap(`.settings-display-sizes input[value="${size}"]`);
    await systemBack(
      () =>
        evaluate(
          "document.querySelector('.settings-screen').dataset.open==='false' && getComputedStyle(document.querySelector('.settings-screen')).opacity==='0'"
        ),
      "display size Settings Back"
    );
    await mathFocus();
    const before = await chromeGeometry();
    await tap(from);
    await waitFor(() => imeShown(), "display size IME");
    await waitFor(
      () => evaluate("document.documentElement.dataset.nativeInputViewport==='held'"),
      "display size viewport held"
    );
    await expectStableChrome(before, `${size} numeric fonts/IME`);
    results.displaySizes.push({ size, fonts: before.fonts });
    await mathFocus();
    await waitFor(
      () => evaluate("document.documentElement.dataset.nativeInputViewport!=='held'"),
      "display size viewport restored"
    );
  }
  assert(
    results.displaySizes[0].fonts[0] !== results.displaySizes[1].fonts[0] &&
      results.displaySizes[1].fonts[0] !== results.displaySizes[2].fonts[0],
    "Display sizes lost their numeric scaling"
  );
  results.nativeInputEvents = await evaluate("globalThis.__unitsNativeEvents");
  assert(
    results.nativeInputEvents.length > 0 &&
      results.nativeInputEvents.every((event) => event.trusted),
    "Native input was not trusted"
  );
  results.workerCount = await evaluate("globalThis.__unitsWorkers");
  results.workerCommands = await evaluate("globalThis.__unitsCommands");
  assert(
    results.workerCount === 1 &&
      results.initialUnitsCommands.some(
        (command) => command.type === "refine" && command.sessionId === initialUnitsCreate.sessionId
      ),
    "No independent Units session on shared Worker"
  );
  results.initialUnitsSession = initialUnitsCreate.sessionId;
  const compiledUnitsSource = results.workerCommands
    .filter((command) => command.type === "create")
    .at(-1).source;
  await switchTo("bigcalc");
  const saved = await evaluate(
    "JSON.parse(localStorage.getItem('bigcalc.app.calculator-state.v1'))"
  );
  const savedUnits = saved.modules.find((module) => module.moduleId === "units");
  assert(
    savedUnits &&
      JSON.stringify(savedUnits.value) === JSON.stringify(sourceBeforeBack) &&
      Object.keys(savedUnits.value).length === 3,
    "Units persisted more than three sources"
  );
  results.persisted = savedUnits;
  const oldOrigin = await evaluate("performance.timeOrigin");
  const oldWorkerTargets = (await client.Target.getTargets()).targetInfos
    .filter((target) => target.type === "worker")
    .map((target) => target.targetId);
  await connect(true);
  assert(
    (await evaluate("performance.timeOrigin")) !== oldOrigin,
    "Force-stop reused old document"
  );
  // Observe the existing post-restart Worker directly; do not reload the document.
  await evaluate(
    `(() => {globalThis.__unitsCommands=[];const original=Worker.prototype.postMessage;Worker.prototype.postMessage=function(command,...args){globalThis.__unitsCommands.push(command);return original.call(this,command,...args);};})()`
  );
  const beforeRestartUnits = await evaluate("globalThis.__unitsCommands.length");
  await switchTo("units");
  await expectResult("1");
  assert(
    JSON.stringify(await readSources()) === JSON.stringify(sourceBeforeBack),
    "Restart lost sources"
  );
  const restartTargets = (await client.Target.getTargets()).targetInfos
    .filter((target) => target.type === "worker")
    .map((target) => target.targetId);
  results.restart = {
    freshDocument: true,
    sources: await readSources(),
    workerCount: restartTargets.length,
    workerTargets: restartTargets,
    oldWorkerTargets,
    commands: await evaluate(`globalThis.__unitsCommands.slice(${beforeRestartUnits})`)
  };
  const restartedUnit = results.restart.commands.find(
    (command) => command.type === "create" && command.source === compiledUnitsSource
  );
  assert(
    results.restart.workerCount === 1 &&
      restartTargets.every((id) => !oldWorkerTargets.includes(id)) &&
      restartedUnit &&
      results.restart.commands.some(
        (command) => command.type === "refine" && command.sessionId === restartedUnit.sessionId
      ),
    "Restart did not recompute through fresh Worker session"
  );
} catch (error) {
  failure = error;
  if (client) {
    try {
      results.failureState = await evaluate(
        `({active:document.querySelector('${live}')?.dataset.activeModule,phase:document.querySelector('${units}')?.dataset.phase,result:document.querySelector('${units} .number-viewport-content')?.textContent,source:document.querySelector('${math}')?.value,viewport:[innerWidth,innerHeight],text:document.querySelector('${units}')?.textContent.slice(0,1200)})`
      );
      screenshot("failure");
    } catch {
      /* Preserve original failure. */
    }
  }
} finally {
  try {
    if (snapshot) {
      await connect(true);
      await restoreStorage(snapshot);
      results.entryStorageRestored = true;
    }
  } catch (error) {
    failure ??= error;
    results.restorationError = String(error);
  } finally {
    await client?.close().catch(() => undefined);
    try {
      adbOutput(["forward", "--remove", `tcp:${port}`]);
    } catch {
      /* Forward may not exist. */
    }
    results.status = failure ? "failed" : "passed";
    if (failure) results.error = String(failure);
    writeFileSync(path.join(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
}
if (failure) throw failure;
process.stdout.write(
  `${JSON.stringify({ status: results.status, device: results.device, webview: results.webview, conversions: results.conversions.length, errors: results.errors.length, appearances: results.appearance.length, workerCount: results.workerCount, restart: results.restart.freshDocument, entryStorageRestored: results.entryStorageRestored, regressions: results.regressions }, null, 2)}\n`
);
