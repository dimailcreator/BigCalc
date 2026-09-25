import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import CDP from "chrome-remote-interface";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = process.env.ANDROID_HOME ?? path.join(workspace, ".android-sdk");
const adb = path.join(sdkRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
if (!existsSync(adb)) throw new Error(`adb was not found at ${adb}`);
const workerAsset = readdirSync(path.join(workspace, "dist-app", "assets")).find((name) =>
  /^calculator\.worker-.*\.js$/u.test(name)
);
if (workerAsset === undefined) throw new Error("Production Worker asset was not found");

let client;
let Runtime;
let webViewScreenY = 0;
const results = {};

try {
  await connect();
  const initial = await geometry();
  assert(initial.innerWidth < initial.innerHeight, "portrait viewport");
  assert(
    initial.screenHeight - initial.innerHeight >= 48,
    `WebView did not account for system bars: ${JSON.stringify(initial)}`
  );
  assert(initial.top >= 12, `header has no safe padding: ${JSON.stringify(initial)}`);
  assert(
    initial.bottom <= initial.innerHeight - 16,
    `keyboard has no safe padding: ${JSON.stringify(initial)}`
  );
  results.safeArea = initial;

  await setExpression("2+3");
  await waitFor(() =>
    evaluate('document.querySelector(".main-display")?.dataset.phase === "completed"')
  );
  await evaluate('document.querySelector(".keyboard-key-equals")?.click()');
  await waitFor(() => evaluate('document.querySelector(".expression-input")?.value === "5"'));
  results.historySaved = await evaluate('localStorage.getItem("bigcalc.history.v1") !== null');
  assert(results.historySaved, "explicit result was not persisted");

  await evaluate(`(() => {
    const setItem = Storage.prototype.setItem;
    globalThis.__stage21StorageWrites = 0;
    Storage.prototype.setItem = function (key, value) {
      if (key === "bigcalc.app.settings.v1") globalThis.__stage21StorageWrites += 1;
      return setItem.call(this, key, value);
    };
    globalThis.__stage21RestoreSetItem = () => { Storage.prototype.setItem = setItem; };
  })()`);

  await setExpression("π");
  await startActiveWorker(workerAsset);
  await waitFor(() => evaluate('globalThis.__stage21ActiveProbe?.status === "running"'));
  await returnFromHome();
  await waitFor(
    () =>
      evaluate(
        '["complete", "paused", "failed", "error"].includes(globalThis.__stage21ActiveProbe?.status)'
      ),
    30_000
  );
  results.activeWorker = await evaluate("globalThis.__stage21ActiveProbe");
  assert(
    results.activeWorker.status === "complete" || results.activeWorker.status === "paused",
    `active Worker failed across background: ${JSON.stringify(results.activeWorker)}`
  );
  await evaluate("globalThis.__stage21ActiveWorker?.terminate()");
  await waitFor(() =>
    evaluate(`(() => {
      const display = document.querySelector(".main-display");
      const result = document.querySelector(".main-display > .result-output");
      return display?.dataset.phase === "completed" && result?.textContent?.trim().startsWith("3,14159");
    })()`)
  );
  results.activeWorkerReturn = await evaluate(
    'document.querySelector(".main-display > .result-output")?.textContent?.trim()'
  );
  assert(
    results.activeWorkerReturn?.startsWith("3,14159"),
    `Worker did not finish after foreground return: ${JSON.stringify(results.activeWorkerReturn)}`
  );
  results.backgroundFlush = await evaluate("globalThis.__stage21StorageWrites");
  assert(results.backgroundFlush >= 1, "background transition did not flush settings");
  await evaluate("globalThis.__stage21RestoreSetItem()");

  await openSettings();
  await evaluate('document.querySelector(".settings-segment[data-value=radians]")?.click()');
  await evaluate('document.querySelector(".settings-segment[data-value=gamma]")?.click()');
  await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Лимит непрерывного вычисления, секунды"]');
    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await waitFor(() => evaluate('document.querySelector(".settings-numeric input")?.value === "0"'));
  await delay(300);
  const inputCenter = await evaluate(`(() => {
    const r = document.querySelector('input[aria-label="Лимит непрерывного вычисления, секунды"]').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  await refreshWebViewScreenY();
  adbOutput([
    "shell",
    "input",
    "tap",
    String(inputCenter.x),
    String(inputCenter.y + webViewScreenY)
  ]);
  try {
    await waitFor(
      () => /mInputShown=true/u.test(adbOutput(["shell", "dumpsys", "input_method"])),
      10_000
    );
  } catch (error) {
    const focus = await evaluate(`(() => ({
      active: document.activeElement?.getAttribute("aria-label"),
      settingsOpen: document.querySelector(".settings-screen")?.dataset.open,
      innerHeight, viewportHeight: visualViewport.height
    }))()`);
    throw new Error(`IME did not open: ${JSON.stringify({ inputCenter, webViewScreenY, focus })}`, {
      cause: error
    });
  }
  await waitFor(() => evaluate(`innerHeight <= ${initial.innerHeight - 100}`), 5_000);
  results.imeViewport = await evaluate(`(() => ({
    innerHeight,
    viewportHeight: visualViewport.height,
    inputBottom: document.querySelector('input[aria-label="Лимит непрерывного вычисления, секунды"]').getBoundingClientRect().bottom
  }))()`);
  assert(
    results.imeViewport.inputBottom <= results.imeViewport.viewportHeight,
    `settings input is obscured by the software keyboard: ${JSON.stringify(results.imeViewport)}`
  );
  adbOutput(["shell", "input", "keyevent", "4"]);
  await waitFor(
    () => !/mInputShown=true/u.test(adbOutput(["shell", "dumpsys", "input_method"])),
    5_000
  );
  await waitFor(() => evaluate(`innerHeight === ${initial.innerHeight}`), 5_000);
  assert(
    await evaluate('document.querySelector(".settings-screen")?.dataset.open === "true"'),
    "Back closed settings before IME"
  );
  results.softwareKeyboardBack = true;

  const inertiaCenter = await evaluate(`(() => {
    const r = document.querySelector('input[aria-label="Инерция прокрутки чисел"]').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  await refreshWebViewScreenY();
  adbOutput([
    "shell",
    "input",
    "tap",
    String(inertiaCenter.x),
    String(inertiaCenter.y + webViewScreenY)
  ]);
  await waitFor(
    () => /mInputShown=true/u.test(adbOutput(["shell", "dumpsys", "input_method"])),
    10_000
  );
  results.inertiaSettingsIme = true;
  adbOutput(["shell", "input", "keyevent", "4"]);
  await waitFor(
    () => !/mInputShown=true/u.test(adbOutput(["shell", "dumpsys", "input_method"])),
    5_000
  );

  await returnFromHome();
  assert(
    await evaluate('document.querySelector(".settings-screen")?.dataset.open === "true"'),
    "settings overlay was lost on Home"
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await evaluate('document.querySelector(".settings-screen")?.dataset.open === "false"'))
      break;
    adbOutput(["shell", "input", "keyevent", "4"]);
    await delay(300);
  }
  assert(
    await evaluate('document.querySelector(".settings-screen")?.dataset.open === "false"'),
    "Back did not close settings after foreground return"
  );
  results.overlayReturn = true;

  await setExpression("π");
  await waitFor(() =>
    evaluate('document.querySelector(".main-display")?.dataset.phase === "pausedByTimeout"')
  );
  await returnFromHome();
  assert(
    await evaluate('document.querySelector(".main-display")?.dataset.phase === "pausedByTimeout"'),
    "paused session was lost on Home"
  );
  await evaluate('document.querySelector(".keyboard-key-equals")?.click()');
  await waitFor(() => evaluate('document.querySelector(".timeout-overlay")?.hidden === false'));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await evaluate('document.querySelector(".main-display")?.dataset.phase === "frozenByUser"'))
      break;
    adbOutput(["shell", "input", "keyevent", "4"]);
    await delay(300);
  }
  assert(
    await evaluate('document.querySelector(".main-display")?.dataset.phase === "frozenByUser"'),
    "Back did not freeze a paused calculation"
  );
  await returnFromHome();
  assert(
    await evaluate('document.querySelector(".main-display")?.dataset.phase === "frozenByUser"'),
    "frozen session was lost on Home"
  );
  results.pausedAndFrozenReturn = true;

  const oldContext = await evaluate("performance.timeOrigin");
  await client.close();
  client = undefined;
  adbOutput(["shell", "am", "force-stop", "com.bigcalc.app"]);
  await foreground();
  await connect();
  await waitFor(() =>
    evaluate('document.querySelector(".main-display")?.dataset.phase === "idle"')
  );
  const fresh = await evaluate(`(() => ({
    source: document.querySelector(".expression-input")?.value,
    phase: document.querySelector(".main-display")?.dataset.phase,
    history: localStorage.getItem("bigcalc.history.v1"),
    settings: [...document.querySelectorAll(".keyboard-key-mode")].map(b => ({label:b.getAttribute("aria-label"), pressed:b.getAttribute("aria-pressed")})),
    timeOrigin: performance.timeOrigin
  }))()`);
  assert(fresh.timeOrigin !== oldContext, "process recreation reused the old page");
  assert(fresh.source === "", "process recreation restored a phantom live expression");
  assert(fresh.history?.includes("2+3"), "history was not restored");
  assert(
    await evaluate('localStorage.getItem("bigcalc.app.settings.v1")?.includes("radians")'),
    "math settings were not restored"
  );
  results.processRecreation = { phase: fresh.phase, source: fresh.source, history: true };

  await openSettings();
  await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Лимит непрерывного вычисления, секунды"]');
    input.value = "5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  adbOutput(["shell", "input", "keyevent", "4"]);
  await waitFor(() =>
    evaluate('document.querySelector(".settings-screen")?.dataset.open === "false"')
  );
  await setExpression("2+3");
  await waitFor(() =>
    evaluate('document.querySelector(".main-display")?.dataset.phase === "completed"')
  );
  results.freshWorker = true;
  const expressionCenter = await evaluate(`(() => {
    const r = document.querySelector(".expression-input").getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  await refreshWebViewScreenY();
  adbOutput([
    "shell",
    "input",
    "tap",
    String(expressionCenter.x),
    String(expressionCenter.y + webViewScreenY)
  ]);
  await delay(600);
  results.expressionIme = await evaluate(`(() => ({
    focused: document.activeElement?.classList.contains("expression-input"),
    inputMode: document.querySelector(".expression-input")?.inputMode,
    innerHeight,
    viewportHeight: visualViewport.height
  }))()`);
  assert(
    results.expressionIme.focused &&
      results.expressionIme.inputMode === "none" &&
      results.expressionIme.innerHeight === initial.innerHeight &&
      !/mInputShown=true/u.test(adbOutput(["shell", "dumpsys", "input_method"])),
    `expression tap opened IME or lost focus: ${JSON.stringify(results.expressionIme)}`
  );
  await evaluate('document.querySelector(".keyboard-key-ac")?.click()');
  adbOutput(["shell", "input", "text", "7+8"]);
  await waitFor(() =>
    evaluate(`(() => document.querySelector(".expression-input")?.value === "7+8" &&
      document.querySelector(".main-display > .result-output")?.textContent?.trim() === "15")()`)
  );
  results.hardwareKeyboard = true;
  await evaluate('document.querySelector(".history-toggle")?.click()');
  await waitFor(() =>
    evaluate('document.querySelector(".calculator-shell")?.dataset.historyOpen === "true"')
  );
  adbOutput(["shell", "input", "text", "9"]);
  await delay(200);
  assert(
    await evaluate('document.querySelector(".expression-input")?.value === "7+8"'),
    "physical input edited expression while History was open"
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (
      await evaluate('document.querySelector(".calculator-shell")?.dataset.historyOpen === "false"')
    )
      break;
    adbOutput(["shell", "input", "keyevent", "4"]);
    await delay(300);
  }
  assert(
    await evaluate('document.querySelector(".calculator-shell")?.dataset.historyOpen === "false"'),
    `Android Back did not close History: ${JSON.stringify({
      ime: /mInputShown=true/u.test(adbOutput(["shell", "dumpsys", "input_method"])),
      focused: await evaluate("document.activeElement?.className")
    })}`
  );
  adbOutput(["shell", "input", "text", "9"]);
  await waitFor(() => evaluate('document.querySelector(".expression-input")?.value === "7+89"'));
  results.historyKeyboardRestored = true;
  await setExpression("1/3");
  await waitFor(() =>
    evaluate('document.querySelector(".main-display > .result-output")?.dataset.kind === "value"')
  );
  const resultCenter = await evaluate(`(() => {
    const r = document.querySelector(".main-display > .result-output").getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  await touchSwipe(resultCenter, { x: resultCenter.x - 95, y: resultCenter.y }, 20);
  const releasedDigit = BigInt(
    await evaluate('document.querySelector(".main-display > .result-output")?.dataset.logicalStart')
  );
  await waitFor(
    async () =>
      BigInt(
        await evaluate(
          'document.querySelector(".main-display > .result-output")?.dataset.logicalStart'
        )
      ) > releasedDigit,
    2_000
  );
  assert(
    await evaluate('document.querySelector(".calculator-shell")?.dataset.historyOpen === "false"'),
    "horizontal result touch opened History"
  );
  results.touchInertia = true;
  await touchSwipe(resultCenter, { x: resultCenter.x + 2, y: resultCenter.y + 80 }, 60);
  await waitFor(() =>
    evaluate('document.querySelector(".calculator-shell")?.dataset.historyOpen === "true"')
  );
  results.touchHistory = true;
  await evaluate('document.querySelector(".history-toggle")?.click()');
  await waitFor(() =>
    evaluate('document.querySelector(".calculator-shell")?.dataset.historyOpen === "false"')
  );
  if (/mInputShown=true/u.test(adbOutput(["shell", "dumpsys", "input_method"]))) {
    adbOutput(["shell", "input", "keyevent", "4"]);
  }
  await waitFor(() => evaluate(`innerHeight === ${initial.innerHeight}`), 5_000);
  await evaluate("document.activeElement?.blur()");

  const oldRotation = adbOutput(["shell", "settings", "get", "system", "user_rotation"]);
  const oldAccelerometer = adbOutput([
    "shell",
    "settings",
    "get",
    "system",
    "accelerometer_rotation"
  ]);
  try {
    adbOutput(["shell", "settings", "put", "system", "accelerometer_rotation", "0"]);
    adbOutput(["shell", "settings", "put", "system", "user_rotation", "1"]);
    await delay(1_200);
    results.portraitLock = await evaluate("innerWidth < innerHeight");
    assert(results.portraitLock, "portrait lock failed after rotation request");
  } finally {
    adbOutput(["shell", "settings", "put", "system", "user_rotation", oldRotation]);
    adbOutput(["shell", "settings", "put", "system", "accelerometer_rotation", oldAccelerometer]);
  }

  if (process.env.BIGCALC_TEST_CUTOUT === "1") {
    const cutout = "com.android.internal.display.cutout.emulation.tall";
    assert(
      adbOutput(["shell", "cmd", "overlay", "list"]).includes(cutout),
      "cutout overlay unavailable"
    );
    await client.close();
    client = undefined;
    adbOutput(["shell", "cmd", "overlay", "enable", cutout]);
    try {
      await delay(1_000);
      await connect();
      await waitFor(async () => {
        try {
          const current = await geometry();
          await refreshWebViewScreenY();
          return webViewScreenY >= 48 && current.innerHeight <= current.screenHeight - 72;
        } catch {
          await client?.close().catch(() => undefined);
          client = undefined;
          await connect();
          return false;
        }
      }, 15_000);
      const withCutout = await geometry();
      assert(
        webViewScreenY >= 48,
        `WebView overlaps display cutout: ${JSON.stringify(withCutout)}`
      );
      assert(
        withCutout.innerHeight <= withCutout.screenHeight - 72,
        "cutout and nav bar insets not applied"
      );
      results.cutout = { screenY: webViewScreenY, viewportHeight: withCutout.innerHeight };
    } finally {
      adbOutput(["shell", "cmd", "overlay", "disable", cutout]);
    }
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} finally {
  await client?.close().catch(() => undefined);
  try {
    adbOutput(["forward", "--remove", "tcp:9223"]);
  } catch {
    // The WebView may not have started far enough to create this forwarding.
  }
}

async function connect() {
  const deadline = performance.now() + 40_000;
  let lastError;
  while (performance.now() < deadline) {
    let appPid;
    try {
      appPid = adbOutput(["shell", "pidof", "com.bigcalc.app"]);
    } catch {
      await delay(200);
      continue;
    }
    const sockets = adbOutput(["shell", "cat", "/proc/net/unix"]);
    for (const match of sockets.matchAll(/@(webview_devtools_remote_\d+)/gu)) {
      if (match[1] !== `webview_devtools_remote_${appPid}`) continue;
      adbOutput(["forward", "tcp:9223", `localabstract:${match[1]}`]);
      try {
        const targets = await CDP.List({ host: "127.0.0.1", port: 9223 });
        const target = targets.find(
          (item) => item.type === "page" && item.url.startsWith("https://localhost/")
        );
        if (target === undefined) continue;
        webViewScreenY = JSON.parse(target.description).screenY;
        client = await CDP({ target, host: "127.0.0.1", port: 9223, local: true });
        Runtime = client.Runtime;
        await Runtime.enable();
        await waitFor(() => evaluate('document.querySelector(".expression-input") !== null'));
        return;
      } catch (error) {
        lastError = error;
        await client?.close().catch(() => undefined);
        client = undefined;
      }
    }
    await delay(200);
  }
  throw new Error("BigCalc WebView did not start", { cause: lastError });
}

async function geometry() {
  return evaluate(`(() => {
    const header = document.querySelector(".top-bar").getBoundingClientRect();
    const keyboard = document.querySelector(".calculator-keyboard").getBoundingClientRect();
    return { top: header.top, bottom: keyboard.bottom, innerWidth, innerHeight, screenHeight: screen.height };
  })()`);
}

async function refreshWebViewScreenY() {
  const targets = await CDP.List({ host: "127.0.0.1", port: 9223 });
  const target = targets.find(
    (item) => item.type === "page" && item.url.startsWith("https://localhost/")
  );
  if (target === undefined) throw new Error("BigCalc WebView disappeared");
  webViewScreenY = JSON.parse(target.description).screenY;
}

async function setExpression(source) {
  await evaluate('document.querySelector(".keyboard-key-ac")?.click()');
  await evaluate(`(() => {
    const input = document.querySelector(".expression-input");
    input.value = ${JSON.stringify(source)};
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  })()`);
}

async function touchSwipe(from, to, stepDelayMs) {
  const point = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
  await client.Input.dispatchTouchEvent({ type: "touchStart", touchPoints: point(from.x, from.y) });
  for (let step = 1; step <= 4; step += 1) {
    await delay(stepDelayMs);
    await client.Input.dispatchTouchEvent({
      type: "touchMove",
      touchPoints: point(
        from.x + ((to.x - from.x) * step) / 4,
        from.y + ((to.y - from.y) * step) / 4
      )
    });
  }
  await client.Input.dispatchTouchEvent({ type: "touchEnd", touchPoints: [] });
}

async function startActiveWorker(assetName) {
  await evaluate(`(() => {
    const worker = new Worker(new URL("/assets/" + ${JSON.stringify(assetName)}, location.href), {
      type: "module"
    });
    globalThis.__stage21ActiveWorker = worker;
    globalThis.__stage21ActiveProbe = { status: "starting" };
    worker.onmessage = (event) => {
      if (event.data?.type === "created") {
        globalThis.__stage21ActiveProbe = { status: "running" };
        worker.postMessage({
          type: "refine",
          sessionId: "stage21-active",
          requestId: "stage21-active-refine",
          significantDigits: 5000
        });
      } else if (event.data?.type === "refinement-result") {
        globalThis.__stage21ActiveProbe = {
          status: event.data.result.status,
          errorCode: event.data.result.error?.code ?? null,
          errorMessage: event.data.result.error?.message ?? null,
          verifiedDigits: event.data.result.verifiedDigits ??
            event.data.result.value?.verifiedDigits ?? null
        };
      } else {
        globalThis.__stage21ActiveProbe = { status: "error", responseType: event.data?.type };
      }
    };
    worker.onerror = (event) => {
      globalThis.__stage21ActiveProbe = { status: "error", message: event.message };
    };
    worker.postMessage({
      type: "create",
      sessionId: "stage21-active",
      source: "π",
      settings: { angleMode: "degrees", factorialMode: "integer", maxCalculationTimeMs: 20000 }
    });
  })()`);
}

async function openSettings() {
  await evaluate('document.querySelector(".overflow-toggle")?.click()');
  await evaluate('document.querySelector(".overflow-menu button")?.click()');
  await waitFor(() =>
    evaluate('document.querySelector(".settings-screen")?.dataset.open === "true"')
  );
}

async function foreground() {
  adbOutput(["shell", "am", "start", "-n", "com.bigcalc.app/.MainActivity"]);
  await delay(700);
}

async function returnFromHome() {
  adbOutput(["shell", "input", "keyevent", "3"]);
  await waitFor(() => evaluate('document.visibilityState === "hidden"'), 5_000);
  await foreground();
  await waitFor(() => evaluate('document.visibilityState === "visible"'), 5_000);
}

async function evaluate(expression) {
  const response = await Runtime.evaluate({ expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails !== undefined) {
    throw new Error(
      response.exceptionDetails.exception?.description ?? "WebView evaluation failed"
    );
  }
  return response.result.value;
}

async function waitFor(check, timeoutMs = 10_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Condition was not met within ${timeoutMs} ms`);
}

function adbOutput(args) {
  return execFileSync(adb, args, { encoding: "utf8" }).trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
