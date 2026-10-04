import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import CDP from "chrome-remote-interface";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = process.env.ANDROID_HOME ?? path.join(workspace, ".android-sdk");
const adb = path.join(sdkRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const deviceArgs = process.env.ANDROID_SERIAL ? ["-s", process.env.ANDROID_SERIAL] : [];
const port = 9226;
const live = "#app > .calculator-shell";
const output = path.join(workspace, ".release-test", "stage34", "android");
const settingsKey = "bigcalc.app.settings.v1";
const palettes = ["lavender", "blue", "teal", "amber", "rose", "liquid-glass"];
const sizes = ["large", "medium", "small"];
if (!existsSync(adb)) throw new Error(`adb was not found at ${adb}`);
mkdirSync(output, { recursive: true });
const adbOutput = (args) =>
  execFileSync(adb, [...deviceArgs, ...args], { encoding: "utf8" }).trim();
let client;
let snapshot;
const results = { matrix: [], screenshots: [], density: [] };

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

async function waitFor(expression, accepts, label) {
  let value;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    value = await evaluate(expression);
    if (accepts(value)) return value;
    await delay(100);
  }
  throw new Error(`${label}: timed out with ${JSON.stringify(value)}`);
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
          (candidate) => candidate.type === "page" && candidate.url.startsWith("https://localhost/")
        );
      }
    } catch {
      // The process or debugging socket may not be ready yet.
    }
    if (!target) await delay(200);
  }
  if (!target) throw new Error("BigCalc WebView target was not found");
  client = await CDP({ target, host: "127.0.0.1", port, local: true });
  await client.Page.enable();
  await waitFor(
    `document.querySelector('${live} .expression-input') !== null`,
    Boolean,
    "calculator mount"
  );
}

async function press(selector) {
  await evaluate(
    `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`
  );
  await delay(150);
  const point = await evaluate(
    `(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}; })()`
  );
  await client.Input.dispatchTouchEvent({ type: "touchStart", touchPoints: [{ ...point, id: 1 }] });
  await delay(40);
  await client.Input.dispatchTouchEvent({ type: "touchEnd", touchPoints: [] });
  await delay(150);
}

async function openSettings() {
  await press(`${live} .overflow-toggle`);
  await press('.overflow-menu button[role="menuitem"]');
  await waitFor(
    "document.querySelector('.settings-screen').dataset.open",
    (value) => value === "true",
    "Settings open"
  );
}

async function back() {
  await press(".settings-back");
  await waitFor(
    "document.querySelector('.settings-screen').dataset.open",
    (value) => value === "false",
    "Settings Back"
  );
  await delay(200);
}

async function choose(theme, palette, displaySize) {
  await press(
    `.theme-preview-hit-target[aria-label="${theme === "dark" ? "Тёмная тема" : "Светлая тема"}"]`
  );
  await press(`.settings-palette[data-palette="${palette}"]`);
  await press(`.settings-display-sizes input[value="${displaySize}"]`);
  const actual = await appearance();
  assert(
    JSON.stringify(actual) === JSON.stringify({ theme, palette, displaySize }),
    `appearance mismatch: ${JSON.stringify(actual)}`
  );
}

async function appearance() {
  return evaluate(
    "({theme:document.documentElement.dataset.theme,palette:document.documentElement.dataset.palette,displaySize:document.documentElement.dataset.displaySize})"
  );
}

async function saved() {
  return evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(settingsKey)}))`);
}

async function source(text) {
  await press(`${live} [data-key="clear"]`);
  await evaluate(
    `(() => {const input=document.querySelector('${live} .expression-input');input.value=${JSON.stringify(text)};input.dispatchEvent(new InputEvent('input',{bubbles:true}));})()`
  );
  await waitFor(
    `document.querySelector('${live} .main-display > .result-output').dataset.kind`,
    (value) => value === "value",
    `result ${text}`
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function screenshot(name) {
  const remote = "/sdcard/bigcalc-stage34.png";
  adbOutput(["shell", "screencap", "-p", remote]);
  execFileSync(adb, [...deviceArgs, "pull", remote, path.join(output, `${name}.png`)], {
    stdio: "ignore"
  });
  results.screenshots.push(`${name}.png`);
}

async function viewportMetrics(selector) {
  return evaluate(`(() => {
    const root=document.querySelector(${JSON.stringify(selector)}), content=root.querySelector('.number-viewport-content'), probe=root.querySelector('.number-viewport-probe'), slots=[...content.querySelectorAll('.number-slot')], box=content.getBoundingClientRect();
    return {font:parseFloat(getComputedStyle(root).fontSize),ch:probe.getBoundingClientRect().width,available:Math.floor(box.width/probe.getBoundingClientRect().width),rendered:slots.length,left:slots[0].getBoundingClientRect().left-box.left,right:box.right-slots.at(-1).getBoundingClientRect().right};
  })()`);
}

try {
  await connect(true);
  snapshot = await evaluate(
    "Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('bigcalc.')).map(key=>[key,localStorage.getItem(key)]))"
  );
  writeFileSync(path.join(output, "entry-storage.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  results.device = adbOutput(["shell", "getprop", "ro.product.model"]);
  results.android = adbOutput(["shell", "getprop", "ro.build.version.release"]);
  results.webview =
    adbOutput(["shell", "dumpsys", "webviewupdate"]).match(
      /Current WebView package.*?version\): (.+)/u
    )?.[1] ?? "see dumpsys webviewupdate";
  results.viewport = await evaluate("({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})");
  await openSettings();
  await choose("light", "teal", "large");
  await press('.settings-screen [data-value="radians"]');
  await press('.settings-screen [data-value="gamma"]');
  await evaluate(
    `(() => {for(const [label,value] of [['Лимит непрерывного вычисления, секунды','2,75'],['Инерция прокрутки чисел','3,2']]){const input=document.querySelector('.settings-screen input[aria-label="'+label+'"]');input.value=value;input.dispatchEvent(new InputEvent('input',{bubbles:true}));}})()`
  );
  const settings = await saved();
  assert(
    settings.angleMode === "radians" &&
      settings.factorialMode === "gamma" &&
      settings.maxCalculationTimeMs === 2750 &&
      settings.numberScrollInertia === 3.2,
    "custom settings not saved"
  );
  await back();
  await source("1/7");
  await evaluate(
    `(() => {const original=Worker.prototype.postMessage;globalThis.__stage34Commands=[];Worker.prototype.postMessage=function(message,...rest){globalThis.__stage34Commands.push(message);return original.call(this,message,...rest);};})()`
  );
  await openSettings();
  for (const theme of ["dark", "light"]) {
    for (const palette of palettes) {
      for (const displaySize of sizes) {
        await choose(theme, palette, displaySize);
        assert(
          JSON.stringify(await saved()) ===
            JSON.stringify({ ...settings, theme, palette, displaySize }),
          "a presentation change lost other settings"
        );
        results.matrix.push(await appearance());
      }
    }
  }
  const commands = await evaluate("globalThis.__stage34Commands");
  process.stdout.write("Stage 34: 36 Settings combinations applied and persisted.\n");
  assert(
    !commands.some(({ type }) => ["create", "cancel", "dispose"].includes(type)),
    "appearance changed a calculation handle"
  );
  results.presentationLifecycleCommands = commands.filter(({ type }) =>
    ["create", "cancel", "dispose"].includes(type)
  ).length;
  await back();

  for (const theme of ["dark", "light"]) {
    for (const palette of palettes) {
      await openSettings();
      await choose(theme, palette, "medium");
      if (palette === "liquid-glass") {
        await evaluate(
          `document.querySelector('.settings-appearance').scrollIntoView({block:'center'})`
        );
        await delay(350);
        screenshot(`${theme}-glass-settings`);
      }
      await back();
      screenshot(`${theme}-${palette}-medium`);
    }
  }

  for (const text of ["1/7", "√(40!)"]) {
    await source(text);
    await press(`${live} [data-key="equals"]`);
    await waitFor(
      `document.querySelector('${live} .expression-input').value`,
      (value) => value === "Ans",
      "lone Ans"
    );
  }
  process.stdout.write("Stage 34: dark/light palette screenshots captured.\n");
  // Compare resting geometry after the equals key's release animation finishes.
  await delay(600);
  const protectedGeometry = () =>
    evaluate(
      `(() => {const root=document.querySelector('${live}');return [root,...root.querySelectorAll('.top-bar,.calculator-keyboard,.keyboard-key')].map(node=>({box:node.getBoundingClientRect().toJSON(),font:getComputedStyle(node).fontSize})).filter(item=>item.box.width>0&&item.box.height>0);})()`
    );
  const baseline = await protectedGeometry();
  for (const displaySize of sizes) {
    await openSettings();
    await choose("dark", "liquid-glass", displaySize);
    await back();
    const item = {
      displaySize,
      main: await viewportMetrics(`${live} .main-display > .result-output`),
      ans: await viewportMetrics(`${live} .expression-ans-viewport`)
    };
    const geometry = await protectedGeometry();
    assert(
      JSON.stringify(geometry) === JSON.stringify(baseline),
      `display size changed shell/keyboard geometry: ${JSON.stringify(geometry.map((item, index) => ({ index, before: baseline[index], after: item })).filter(({ before, after }) => JSON.stringify(before) !== JSON.stringify(after)))}`
    );
    screenshot(`dark-glass-${displaySize}-ans`);
    await press(`${live} .history-toggle`);
    await delay(400);
    item.history = await viewportMetrics(`${live} .history-result`);
    item.compactResult = await viewportMetrics(`${live} .main-display > .result-output`);
    item.compactAns = await viewportMetrics(`${live} .expression-ans-viewport`);
    item.historyExpressionFont = await evaluate(
      `parseFloat(getComputedStyle(document.querySelector('${live} .history-expression')).fontSize)`
    );
    for (const measured of [item.main, item.ans, item.history, item.compactResult, item.compactAns])
      assert(
        measured.left >= -1 && measured.right >= -1,
        `clipped ${displaySize} slots: ${JSON.stringify(measured)}`
      );
    screenshot(`dark-glass-${displaySize}-history`);
    results.density.push(item);
    await press(`${live} .history-toggle`);
    await delay(250);
  }
  for (const target of ["main", "ans", "history"]) {
    const [large, medium, small] = results.density.map((item) => item[target].available);
    assert(
      large < medium && medium < small,
      `density not ordered for ${target}: ${large},${medium},${small}`
    );
  }
  process.stdout.write("Stage 34: main/Ans/History density and containment passed.\n");

  results.caret = [];
  for (const [theme, displaySize] of [
    ["light", "small"],
    ["dark", "large"]
  ]) {
    await openSettings();
    await choose(theme, "liquid-glass", displaySize);
    await back();
    await source("1234");
    await evaluate(
      `(() => {const input=document.querySelector('${live} .expression-input');input.focus();input.setSelectionRange(2,2);document.dispatchEvent(new Event('selectionchange'));})()`
    );
    await press(`${live} [data-key="5"]`);
    const caret = await evaluate(
      `(() => {const input=document.querySelector('${live} .expression-input'),caret=document.querySelector('${live} .expression-caret');return {source:input.value,visible:caret!==null&&caret.getBoundingClientRect().height>0,boundary:caret?[...caret.parentElement.children].slice(0,[...caret.parentElement.children].indexOf(caret)).filter(e=>e.classList.contains('expression-token')).length:null};})()`
    );
    assert(
      caret.source === "12534" && caret.visible && caret.boundary === 3,
      `caret regression: ${JSON.stringify(caret)}`
    );
    results.caret.push({ theme, displaySize, ...caret });
    await press(`${live} .history-toggle`);
    await delay(400);
    const containment = await viewportMetrics(`${live} .history-result`);
    assert(containment.left >= -1 && containment.right >= -1, "Liquid Glass History clips slots");
    screenshot(`${theme}-glass-${displaySize}-history-regression`);
    await press(`${live} .history-toggle`);
  }

  await evaluate(
    `(() => {globalThis.__stage34FrameGaps=[];let previous=performance.now();const sample=now=>{globalThis.__stage34FrameGaps.push(now-previous);previous=now;globalThis.__stage34Frame=requestAnimationFrame(sample);};globalThis.__stage34Frame=requestAnimationFrame(sample);})()`
  );
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await openSettings();
    await choose(cycle % 2 ? "light" : "dark", "liquid-glass", "small");
    await evaluate(
      "document.querySelector('.settings-content').scrollTo({top:0,behavior:'instant'})"
    );
    await delay(200);
    await press('.settings-palette[data-palette="teal"]');
    await press('.settings-palette[data-palette="liquid-glass"]');
    await back();
  }
  results.liquidGlassFrameGapMaxMs = await evaluate(
    "(() => {cancelAnimationFrame(globalThis.__stage34Frame);return Math.max(...globalThis.__stage34FrameGaps);})()"
  );
  assert(results.liquidGlassFrameGapMaxMs < 1000, "Liquid Glass had a frame gap over one second");

  await openSettings();
  await choose("light", "liquid-glass", "small");
  await back();
  results.restartSettings = await saved();
  const firstFrameProbe = `(() => {const observer=new MutationObserver(()=>{if(document.querySelector('#app > .calculator-shell')){globalThis.__stage34FirstMount={theme:document.documentElement.dataset.theme,palette:document.documentElement.dataset.palette,displaySize:document.documentElement.dataset.displaySize};observer.disconnect();}});observer.observe(document,{childList:true,subtree:true});})()`;
  await client.Page.addScriptToEvaluateOnNewDocument({ source: firstFrameProbe });
  await client.Page.reload();
  await waitFor(
    "globalThis.__stage34FirstMount",
    (value) =>
      value?.theme === "light" &&
      value?.palette === "liquid-glass" &&
      value?.displaySize === "small",
    "appearance at first calculator mount"
  );
  results.firstMount = await evaluate("globalThis.__stage34FirstMount");
  await connect(true);
  assert(
    JSON.stringify(await saved()) === JSON.stringify(results.restartSettings),
    "force-stop lost settings"
  );
  results.afterForceStop = await appearance();
  assert(
    JSON.stringify(results.afterForceStop) === JSON.stringify(results.firstMount),
    "force-stop restored wrong appearance"
  );
  adbOutput(["shell", "input", "keyevent", "KEYCODE_HOME"]);
  await delay(400);
  adbOutput(["shell", "am", "start", "-n", "com.bigcalc.app/.MainActivity"]);
  await delay(700);
  assert(
    JSON.stringify(await appearance()) === JSON.stringify(results.firstMount),
    "foreground lost appearance"
  );
  await press(`${live} .expression-input`);
  results.imeHidden = /mInputShown=false/u.test(adbOutput(["shell", "dumpsys", "input_method"]));
  assert(results.imeHidden, "expression focus opened IME");
  results.status = "passed";
  writeFileSync(path.join(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ status: results.status, device: results.device, matrix: results.matrix.length, density: results.density, caret: results.caret, liquidGlassFrameGapMaxMs: results.liquidGlassFrameGapMaxMs, firstMount: results.firstMount, afterForceStop: results.afterForceStop, imeHidden: results.imeHidden }, null, 2)}\n`
  );
} finally {
  try {
    if (snapshot && client) {
      // The outgoing App flushes its repositories on navigation. Restore in the
      // next document before bootstrap so that flush cannot overwrite the snapshot.
      const { identifier } = await client.Page.addScriptToEvaluateOnNewDocument({
        source: `(() => {for(const key of Object.keys(localStorage).filter(key=>key.startsWith('bigcalc.')))localStorage.removeItem(key);for(const [key,value] of Object.entries(${JSON.stringify(snapshot)}))localStorage.setItem(key,value);globalThis.__stage34SnapshotRestored=true;})()`
      });
      await client.Page.reload();
      await waitFor("globalThis.__stage34SnapshotRestored", Boolean, "entry snapshot restoration");
      await waitFor(`document.querySelector('${live}') !== null`, Boolean, "restored mount");
      await client.Page.removeScriptToEvaluateOnNewDocument({ identifier });
      const restored = await evaluate(
        "Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('bigcalc.')).map(key=>[key,localStorage.getItem(key)]))"
      );
      assert(
        Object.keys(restored).length === Object.keys(snapshot).length &&
          Object.entries(snapshot).every(([key, value]) => restored[key] === value),
        "entry settings/history snapshot was not restored"
      );
      process.stdout.write("Stage 34: entry settings/history snapshot restored and verified.\n");
    }
  } finally {
    await client?.close().catch(() => undefined);
    try {
      adbOutput(["forward", "--remove", `tcp:${port}`]);
    } catch {
      // Discovery might have failed before creating a forwarding.
    }
  }
}
