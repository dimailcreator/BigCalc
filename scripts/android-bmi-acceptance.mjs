import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import CDP from "chrome-remote-interface";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = process.env.ANDROID_HOME ?? path.join(workspace, ".android-sdk");
const adb = path.join(sdkRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const deviceArgs = process.env.ANDROID_SERIAL ? ["-s", process.env.ANDROID_SERIAL] : [];
const port = 9227;
const live = "#app > .calculator-shell";
const bmi = `${live} > .calculator-module-screen[data-module-id="bmi"]`;
const height = `${bmi} input[id$="-height"]`;
const weight = `${bmi} input[id$="-weight"]`;
const output = path.join(workspace, ".release-test", "bmi", "android");
const apk = path.join(workspace, "android/app/build/outputs/apk/debug/app-debug.apk");
const withRegressions = process.argv.slice(2).includes("--with-regressions");
if (process.argv.slice(2).some((arg) => arg !== "--with-regressions"))
  throw new Error("Usage: npm run test:android:bmi -- [--with-regressions]");
if (!existsSync(adb) || !existsSync(apk))
  throw new Error("Build/install debug APK and provide Android SDK first");
mkdirSync(output, { recursive: true });
const adbOutput = (args) =>
  execFileSync(adb, [...deviceArgs, ...args], { encoding: "utf8" }).trim();
const results = { categories: [], appearance: [], screenshots: [], regressions: [] };
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
    source: `(() => {for(const key of Object.keys(localStorage).filter(key=>key.startsWith('bigcalc.')))localStorage.removeItem(key);for(const [key,value] of Object.entries(${JSON.stringify(value)}))localStorage.setItem(key,value);globalThis.__bmiStorageRestored=true;})()`
  });
  try {
    await client.Page.reload();
    await waitFor(
      () =>
        evaluate(`globalThis.__bmiStorageRestored && document.querySelector('${live}') !== null`),
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
  assert(/^[0-9]*(?:[,.][0-9]*)?$/u.test(text), "Only numeric test text is allowed");
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
  return evaluate(`(() => {
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height};
    };
    const wall = getComputedStyle(document.body,'::before');
    return {header:rect('${live} > .top-bar'),drawer:rect('${live} .drawer-toggle'),overflow:rect('${live} .overflow-toggle'),wallpaper:{height:wall.height,top:wall.top,width:wall.width}};
  })()`);
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
  results.imeChromeChecks ??= [];
  results.imeChromeChecks.push({ label, before, after });
}

async function swipeModule(up) {
  const point = await evaluate(`(() => {
    const r=document.querySelector('${bmi}').getBoundingClientRect();
    return {x:(r.x+r.width*.85)*devicePixelRatio,top:(r.top+30)*devicePixelRatio,bottom:(Math.min(r.bottom,innerHeight)-30)*devicePixelRatio};
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
    "500"
  ]);
  await delay(500);
  assert(imeShown(), "Module swipe dismissed IME");
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
  const remote = "/sdcard/bigcalc-bmi-acceptance.png";
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

try {
  assert(
    adbOutput(["shell", "getprop", "ro.kernel.qemu"]) !== "1",
    "Physical Android device is required"
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
  results.apkSha256 = createHash("sha256").update(readFileSync(apk)).digest("hex");
  results.viewport = await evaluate("({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})");
  await restoreStorage({});
  if (withRegressions) {
    assert(process.env.npm_execpath, "Use npm run test:android:bmi -- --with-regressions");
    await client.close();
    client = undefined;
    for (const name of ["smoke", "lifecycle", "stage34"]) {
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
  await tap(`${live} [data-key="2"]`);
  await tap(`${live} [data-key="plus"]`);
  await tap(`${live} [data-key="3"]`);
  await waitFor(
    () =>
      evaluate(
        `document.querySelector('${live} .main-display > .result-output').textContent.trim() === '5'`
      ),
    "primary result"
  );
  await tap(`${live} [data-key="equals"]`);
  await waitFor(
    () => evaluate(`document.querySelector('${live} .expression-input').value === 'Ans'`),
    "primary Ans"
  );
  const primaryHistory = await evaluate("localStorage.getItem('bigcalc.history.v1')");
  await tap(`${live} .expression-input`);
  await delay(500);
  assert(!imeShown(), "Primary expression opened IME");
  results.primaryImeSuppressed = true;
  await switchTo("bmi");
  await evaluate(
    `(() => {globalThis.__bmiCommands=[];globalThis.__bmiInputEvents=[];const original=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...rest){globalThis.__bmiCommands.push(message.type);return original.call(this,message,...rest);};for(const input of document.querySelectorAll('${bmi} input'))input.addEventListener('input',event=>globalThis.__bmiInputEvents.push({id:input.id,trusted:event.isTrusted}));})()`
  );
  assert(
    await evaluate(
      `(() => {const shell=document.querySelector('${live}');return shell.querySelector('.history-toggle').hidden && getComputedStyle(shell.querySelector('.calculator-keyboard')).display==='none' && !document.querySelector('${bmi} button, ${bmi} .history-panel, ${bmi} .calculator-keyboard');})()`
    ),
    "BMI exposed primary/custom controls"
  );
  const initialChrome = await chromeGeometry();
  await nativeText(height, "180");
  results.heightIme = imeShown();
  await expectStableChrome(initialChrome, "height IME");
  screenshot("height-ime");
  await nativeText(weight, "75");
  results.weightIme = imeShown();
  await expectStableChrome(initialChrome, "weight IME");
  await expectBmi("23,15", "Норма", "180", "75");
  await swipeModule(true);
  results.imeLayout = await evaluate(
    `(() => {const module=document.querySelector('${bmi}'), card=module.querySelector('.bmi-result').getBoundingClientRect();return {width:innerWidth,height:innerHeight,cardTop:card.top,cardBottom:card.bottom,moduleScrollTop:module.scrollTop,pageScrollY:scrollY,horizontalOverflow:document.documentElement.scrollWidth>innerWidth};})()`
  );
  assert(
    imeShown() &&
      results.imeLayout.cardTop >= 0 &&
      results.imeLayout.cardBottom <= results.imeLayout.height + 1 &&
      results.imeLayout.pageScrollY === 0 &&
      !results.imeLayout.horizontalOverflow,
    "BMI result is unreachable with IME or page overflowed"
  );
  screenshot("base-ime");
  await swipeModule(false);
  assert(
    await evaluate(
      `document.querySelector('${height}').getBoundingClientRect().top >= document.querySelector('${live} > .top-bar').getBoundingClientRect().bottom`
    ),
    "Native reverse swipe did not restore the height field"
  );
  await nativeText(height, "100");
  for (const [text, number, category] of [
    ["18,49", "18,49", "Недостаточная масса"],
    ["18,5", "18,5", "Норма"],
    ["25", "25", "Избыточная масса"],
    ["30", "30", "Ожирение I степени"],
    ["35", "35", "Ожирение II степени"],
    ["40", "40", "Ожирение III степени"],
    ["18.5", "18,5", "Норма"],
    ["29,996", "30", "Избыточная масса"]
  ]) {
    await nativeText(weight, text);
    await expectBmi(number, category, "100", text);
    results.categories.push({ height: "100", weight: text, number, category });
  }
  await nativeText(height, "0");
  assert(
    await evaluate(
      `document.querySelector('${height}').getAttribute('aria-invalid')==='true' && document.querySelector('${bmi} .bmi-result-number').hidden`
    ),
    "Invalid input left stale result"
  );
  await nativeText(height, "");
  assert(
    await evaluate(
      `document.querySelector('${height}').getAttribute('aria-invalid')==='false' && document.querySelector('${bmi} .bmi-result-number').hidden`
    ),
    "Empty input validation mismatch"
  );
  await nativeText(height, "180");
  await nativeText(weight, "75");
  await expectBmi("23,15", "Норма", "180", "75");
  results.workerCommandsDuringBmi = await evaluate("globalThis.__bmiCommands");
  assert(results.workerCommandsDuringBmi.length === 0, "BMI input sent Worker commands");
  results.nativeInputEvents = await evaluate("globalThis.__bmiInputEvents");
  assert(
    results.nativeInputEvents.length > 0 &&
      results.nativeInputEvents.every((event) => event.trusted),
    "BMI input was not native/trusted"
  );
  assert(
    (await evaluate("localStorage.getItem('bigcalc.history.v1')")) === primaryHistory,
    "BMI changed primary history"
  );
  await dismissIme();
  await active("bmi");
  results.imeBackPreservesBmi = true;
  await tap(`${live} .drawer-toggle`);
  await systemBack(
    () => evaluate("document.querySelector('.calculator-drawer-layer').hidden"),
    "Drawer Back"
  );
  await active("bmi");
  await openSettings();
  await systemBack(
    () => evaluate("document.querySelector('.settings-screen').dataset.open==='false'"),
    "Settings Back"
  );
  await active("bmi");
  await tap(`${live} .overflow-toggle`);
  await tap('.overflow-menu button[role="menuitem"]:last-child');
  await waitFor(
    () => evaluate("document.querySelector('.about-screen').dataset.open==='true'"),
    "About open"
  );
  assert(
    await evaluate(
      "document.querySelector('.about-card').textContent.includes('уже доступен калькулятор ИМТ')"
    ),
    "About still describes BMI as future"
  );
  await systemBack(
    () => evaluate("document.querySelector('.about-screen').dataset.open==='false'"),
    "About Back"
  );
  await active("bmi");
  await systemBack(
    () => evaluate(`document.querySelector('${live}').dataset.activeModule==='bigcalc'`),
    "module stack Back"
  );
  assert(
    await evaluate(
      `document.querySelector('${live} .expression-input').value==='Ans' && document.querySelector('${live} .main-display > .result-output').textContent.trim()==='5'`
    ),
    "Switching lost primary state"
  );
  results.navigation = {
    drawer: true,
    settings: true,
    about: true,
    moduleStack: true,
    primaryState: true
  };
  await switchTo("bmi");
  await expectBmi("23,15", "Норма", "180", "75");
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
      "appearance Settings Back"
    );
    await expectBmi("23,15", "Норма", "180", "75");
    const actual = await evaluate(
      `(() => {const card=document.querySelector('${bmi} .bmi-result');return {theme:document.documentElement.dataset.theme,palette:document.documentElement.dataset.palette,filter:getComputedStyle(card).backdropFilter,overflow:document.documentElement.scrollWidth>innerWidth};})()`
    );
    assert(
      actual.theme === theme &&
        actual.palette === palette &&
        !actual.overflow &&
        (actual.filter !== "none") === (palette === "liquid-glass"),
      "BMI appearance mismatch"
    );
    results.appearance.push(actual);
    screenshot(`${theme}-${palette}`);
    const beforeIme = await chromeGeometry();
    await tap(weight);
    await waitFor(() => imeShown(), `${theme}/${palette} IME`);
    await expectStableChrome(beforeIme, `${theme}/${palette} IME`);
    await swipeModule(true);
    await expectBmi("23,15", "Норма", "180", "75");
    assert(
      await evaluate(
        `document.querySelector('${bmi} .bmi-result').getBoundingClientRect().bottom <= innerHeight + 1`
      ),
      "Appearance result is unreachable above IME"
    );
    screenshot(`${theme}-${palette}-ime`);
    await dismissIme();
    await delay(300);
    await expectStableChrome(beforeIme, `${theme}/${palette} IME closed`);
  }
  await switchTo("bigcalc");
  const saved = await evaluate(
    "JSON.parse(localStorage.getItem('bigcalc.app.calculator-state.v1'))"
  );
  assert(
    JSON.stringify(saved) ===
      JSON.stringify({
        schemaVersion: 1,
        modules: [{ moduleId: "bmi", revision: 1, value: { heightText: "180", weightText: "75" } }]
      }),
    "BMI persisted more than source texts"
  );
  results.persisted = saved;
  const oldOrigin = await evaluate("performance.timeOrigin");
  await connect(true);
  assert((await evaluate("performance.timeOrigin")) !== oldOrigin, "Force-stop reused document");
  await active("bigcalc");
  await switchTo("bmi");
  await expectBmi("23,15", "Норма", "180", "75");
  results.restart = true;
  await switchTo("bigcalc");
  await tap(`${live} .expression-input`);
  await delay(500);
  assert(!imeShown(), "Primary expression IME suppression regressed after restart");
  results.primaryImeAfterRestart = true;
} catch (error) {
  failure = error;
  if (client) {
    try {
      results.failureState = await evaluate(
        `({source:document.querySelector('${live} .expression-input')?.value,phase:document.querySelector('${live} .main-display')?.dataset.phase,result:document.querySelector('${live} .main-display > .result-output')?.textContent,active:document.querySelector('${live}')?.dataset.activeModule,viewport:[innerWidth,innerHeight]})`
      );
      screenshot("failure");
    } catch {
      // Keep the original failure if diagnostic collection is unavailable.
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
      // Connection might have failed before creating a forward.
    }
    results.status = failure ? "failed" : "passed";
    if (failure) results.error = String(failure);
    writeFileSync(path.join(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
}
if (failure) throw failure;
process.stdout.write(
  `${JSON.stringify({ status: results.status, device: results.device, android: results.android, webview: results.webview, ime: results.ime, categoryCases: results.categories.length, appearances: results.appearance.length, trustedInputEvents: results.nativeInputEvents.length, workerCommandsDuringBmi: results.workerCommandsDuringBmi.length, imeLayout: results.imeLayout, navigation: results.navigation, restart: results.restart, entryStorageRestored: results.entryStorageRestored, regressions: results.regressions }, null, 2)}\n`
);
