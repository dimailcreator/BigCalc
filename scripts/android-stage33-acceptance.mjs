import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import CDP from "chrome-remote-interface";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = process.env.ANDROID_HOME ?? path.join(workspace, ".android-sdk");
const adb = path.join(sdkRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const deviceArgs = process.env.ANDROID_SERIAL ? ["-s", process.env.ANDROID_SERIAL] : [];
const port = 9225;
if (!existsSync(adb)) throw new Error(`adb was not found at ${adb}`);
const adbOutput = (args) =>
  execFileSync(adb, [...deviceArgs, ...args], { encoding: "utf8" }).trim();

let client;
try {
  adbOutput(["shell", "am", "force-stop", "com.bigcalc.app"]);
  adbOutput(["shell", "am", "start", "-n", "com.bigcalc.app/.MainActivity"]);
  let pid = "";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      pid = adbOutput(["shell", "pidof", "com.bigcalc.app"]);
      if (
        pid &&
        adbOutput(["shell", "cat", "/proc/net/unix"]).includes(`@webview_devtools_remote_${pid}`)
      )
        break;
    } catch {
      // The WebView process may still be starting.
    }
    pid = "";
    await delay(250);
  }
  if (!pid) throw new Error("BigCalc WebView did not start");
  try {
    execFileSync(adb, [...deviceArgs, "forward", "--remove", `tcp:${String(port)}`], {
      stdio: "ignore"
    });
  } catch {
    // No previous forwarding exists.
  }
  adbOutput(["forward", `tcp:${String(port)}`, `localabstract:webview_devtools_remote_${pid}`]);
  let target;
  for (let attempt = 0; attempt < 80 && target === undefined; attempt += 1) {
    target = (await CDP.List({ host: "127.0.0.1", port })).find(
      (candidate) => candidate.type === "page" && candidate.url.startsWith("https://localhost/")
    );
    if (target === undefined) await delay(250);
  }
  if (target === undefined) throw new Error("BigCalc WebView target was not found");
  client = await CDP({ target, host: "127.0.0.1", port, local: true });
  const { Runtime, Input } = client;
  const evaluate = async (expression) => {
    const response = await Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (response.exceptionDetails !== undefined)
      throw new Error(
        response.exceptionDetails.exception?.description ?? "WebView evaluation failed"
      );
    return response.result.value;
  };
  const waitFor = async (expression, accepts, label) => {
    let value;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      value = await evaluate(expression);
      if (accepts(value)) return value;
      await delay(100);
    }
    throw new Error(`${label}: timed out with ${JSON.stringify(value)}`);
  };
  const setExpression = async (source) => {
    await evaluate(`(() => {
      const input = document.querySelector('.expression-input');
      input.value = ${JSON.stringify(source)};
      input.dispatchEvent(new InputEvent('input', {bubbles: true}));
    })()`);
  };
  const press = async (selector) => {
    const point = await evaluate(`(() => {
      const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
    })()`);
    await Input.dispatchTouchEvent({ type: "touchStart", touchPoints: [{ ...point, id: 1 }] });
    await delay(40);
    await Input.dispatchTouchEvent({ type: "touchEnd", touchPoints: [] });
  };

  await waitFor(
    "document.querySelector('.expression-input') !== null",
    (value) => value === true,
    "calculator mount"
  );

  const calculations = [];
  for (const [source, expected] of [
    ["π-π", (value) => value === "0"],
    ["e-e", (value) => value === "0"],
    ["e^ln(2)", (value) => value === "2"],
    ["sin[1+1](0)", (value) => value === "0"],
    ["sin[4/2](0)", (value) => value === "0"]
  ]) {
    await setExpression(source);
    const value = await waitFor(
      "document.querySelector('.main-display > .result-output')?.textContent?.trim() ?? ''",
      expected,
      source
    );
    calculations.push({ source, value });
  }

  await setExpression("");
  await evaluate(`(() => {
    const input = document.querySelector('.expression-input');
    const data = new DataTransfer();
    data.setData('text/plain', '√(2+3)');
    input.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: data}));
  })()`);
  await waitFor(
    "document.querySelector('.expression-input')?.value",
    (value) => value === "√(2+3)",
    "paste √ source"
  );
  await waitFor(
    "document.querySelector('.main-display > .result-output')?.textContent?.trim() ?? ''",
    (value) => value.startsWith("2,23606"),
    "paste √ result"
  );

  await setExpression("√(4/9)");
  await waitFor(
    "document.querySelector('.main-display > .result-output')?.dataset.kind",
    (value) => value === "value",
    "history source result"
  );
  const historyBefore = await evaluate(
    "JSON.parse(localStorage.getItem('bigcalc.history.v1') ?? '{\"entries\":[]}').entries.length"
  );
  await press('[data-key="equals"]');
  await waitFor(
    "document.querySelector('.expression-input')?.value",
    (value) => value === "Ans",
    "save √ expression"
  );
  const historyAfter = await evaluate(
    "JSON.parse(localStorage.getItem('bigcalc.history.v1') ?? '{\"entries\":[]}').entries"
  );
  if (
    historyAfter.length !== historyBefore + 1 ||
    historyAfter.at(-1)?.originalExpressionText !== "√(4/9)"
  )
    throw new Error("√ expression was not saved in History");
  await press('[data-key="clear"]');
  await press(".history-toggle");
  await waitFor(
    "document.querySelector('.calculator-shell')?.dataset.historyOpen",
    (value) => value === "true",
    "open History"
  );
  await press(".history-card .history-expression");
  await press(".history-toggle");
  await waitFor(
    "document.querySelector('.expression-input')?.value",
    (value) => value === "√(4/9)",
    "restore √ expression"
  );

  await press(".drawer-toggle");
  await waitFor(
    "document.querySelector('.drawer-toggle')?.getAttribute('aria-expanded')",
    (value) => value === "true",
    "first tap"
  );
  await press(".drawer-toggle");
  await waitFor(
    "document.querySelector('.drawer-toggle')?.getAttribute('aria-expanded')",
    (value) => value === "false",
    "second tap"
  );

  const expressionPoint = await evaluate(`(() => {
    const rect = document.querySelector('.expression-input').getBoundingClientRect();
    return {x: rect.right - Math.min(30, rect.width / 2), y: rect.top + rect.height / 2};
  })()`);
  await Input.dispatchTouchEvent({
    type: "touchStart",
    touchPoints: [{ ...expressionPoint, id: 1 }]
  });
  await delay(1_100);
  await Input.dispatchTouchEvent({ type: "touchEnd", touchPoints: [] });
  const longPressInput = await evaluate(`(() => {
    const input = document.querySelector('.expression-input');
    return {inputMode: input.inputMode, focused: document.activeElement === input,
      start: input.selectionStart, end: input.selectionEnd};
  })()`);
  const imeHidden = !/mInputShown=true/u.test(adbOutput(["shell", "dumpsys", "input_method"]));
  if (longPressInput.inputMode !== "none" || !longPressInput.focused || !imeHidden)
    throw new Error(
      `Expression long press opened IME or lost focus: ${JSON.stringify(longPressInput)}`
    );

  process.stdout.write(
    `${JSON.stringify({ status: "passed", device: adbOutput(["shell", "getprop", "ro.product.model"]), calculations, paste: "√(2+3)", savedAndRestored: "√(4/9)", separateDrawerTaps: 2, longPressInput, imeHidden }, null, 2)}\n`
  );
} finally {
  await client?.close().catch(() => undefined);
  try {
    adbOutput(["forward", "--remove", `tcp:${String(port)}`]);
  } catch {
    // The app may not have started far enough to create forwarding.
  }
}
