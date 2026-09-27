import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import CDP from "chrome-remote-interface";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = process.env.ANDROID_HOME ?? path.join(workspace, ".android-sdk");
const adb = path.join(sdkRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const port = 9223;
if (!existsSync(adb)) throw new Error(`adb was not found at ${adb}`);

const deviceArgs = process.env.ANDROID_SERIAL ? ["-s", process.env.ANDROID_SERIAL] : [];
const adbOutput = (args) =>
  execFileSync(adb, [...deviceArgs, ...args], { encoding: "utf8" }).trim();
const removeForward = () => {
  try {
    execFileSync(adb, [...deviceArgs, "forward", "--remove", `tcp:${String(port)}`], {
      stdio: "ignore"
    });
  } catch {
    // No forwarding was registered.
  }
};
let previousPid = "";
try {
  previousPid = adbOutput(["shell", "pidof", "com.bigcalc.app"]);
} catch {
  // The app may not be running before this smoke test.
}
adbOutput(["shell", "am", "force-stop", "com.bigcalc.app"]);
adbOutput(["shell", "am", "start", "-n", "com.bigcalc.app/.MainActivity"]);
let pid = "";
for (let attempt = 0; attempt < 120 && !pid; attempt += 1) {
  try {
    const candidate = adbOutput(["shell", "pidof", "com.bigcalc.app"]);
    if (
      candidate &&
      candidate !== previousPid &&
      adbOutput(["shell", "cat", "/proc/net/unix"]).includes(
        `@webview_devtools_remote_${candidate}`
      )
    )
      pid = candidate;
  } catch {
    // The process and debugging socket may appear later.
  }
  if (!pid) await delay(250);
}
if (!pid) throw new Error("BigCalc did not start on the selected Android device");
removeForward();
adbOutput(["forward", `tcp:${String(port)}`, `localabstract:webview_devtools_remote_${pid}`]);

let client;
try {
  let target;
  for (let attempt = 0; attempt < 80 && target === undefined; attempt += 1) {
    try {
      const targets = await CDP.List({ host: "127.0.0.1", port });
      target = targets.find(
        (candidate) => candidate.type === "page" && candidate.url.startsWith("https://localhost/")
      );
    } catch {
      // WebView debugging socket may appear after the app process.
    }
    if (target === undefined) await delay(250);
  }
  if (target === undefined) throw new Error("BigCalc WebView target was not found");
  client = await CDP({ target, host: "127.0.0.1", port, local: true });
  const { Runtime, Input } = client;
  await Runtime.enable();

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
  await evaluate(`(() => {
    globalThis.__stage27TouchEvents = [];
    for (const type of ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "click", "contextmenu"])
      document.addEventListener(type, (event) => {
        globalThis.__stage27TouchEvents.push({ type, target: event.target?.className ?? "", x: event.clientX ?? null, y: event.clientY ?? null });
      }, { capture: true });
  })()`);
  const waitFor = async (expression, expected) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if ((await evaluate(expression)) === expected) return;
      await delay(100);
    }
    const actual = await evaluate(expression);
    const events = await evaluate(`globalThis.__stage27TouchEvents`);
    throw new Error(
      `Expected ${expression} to become ${String(expected)}, got ${String(actual)}; events: ${JSON.stringify(events)}`
    );
  };
  const press = async (selector, holdMs) => {
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) throw new Error("Button not found");
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) throw new Error("Button is not visible");
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await Input.dispatchTouchEvent({
      type: "touchStart",
      touchPoints: [{ x: point.x, y: point.y, id: 1 }]
    });
    await delay(holdMs);
    await Input.dispatchTouchEvent({ type: "touchEnd", touchPoints: [] });
  };

  await waitFor(`document.querySelector('[data-key="clear"]') !== null`, true);
  await evaluate(`document.querySelector('[data-key="clear"]').click()`);
  await waitFor(`document.querySelector('.expression-input').value`, "");

  await press('[data-key="7"]', 100);
  await waitFor(`document.querySelector('.expression-input').value`, "7");
  await press('[data-key="plus"]', 1_000);
  await waitFor(`document.querySelector('.expression-input').value`, "7+");
  await press('[data-key="7"]', 3_000);
  await waitFor(`document.querySelector('.expression-input').value`, "7+7");
  const historyBefore = await evaluate(
    `JSON.parse(localStorage.getItem('bigcalc.history.v1') ?? '{"entries":[]}').entries.length`
  );
  await press('[data-key="equals"]', 1_000);
  await waitFor(`document.querySelector('.expression-input').value`, "Ans");
  const historyAfter = await evaluate(
    `JSON.parse(localStorage.getItem('bigcalc.history.v1') ?? '{"entries":[]}').entries.length`
  );
  if (historyAfter !== historyBefore + 1)
    throw new Error(`Equals created ${String(historyAfter - historyBefore)} history entries`);
  await press('[data-key="clear"]', 1_000);
  await waitFor(`document.querySelector('.expression-input').value`, "");

  const oldMode = await evaluate(`document.querySelector('[data-key="angle"]').textContent`);
  await press('[data-key="angle"]', 1_000);
  const newMode = await evaluate(`document.querySelector('[data-key="angle"]').textContent`);
  if (newMode === oldMode) throw new Error("Angle mode did not change after held release");

  await press(".history-toggle", 1_000);
  await waitFor(`document.querySelector('.calculator-shell').dataset.historyOpen`, "true");
  await press(".history-toggle", 1_000);
  await waitFor(`document.querySelector('.calculator-shell').dataset.historyOpen`, "false");

  process.stdout.write(
    `${JSON.stringify({ status: "passed", device: adbOutput(["shell", "getprop", "ro.product.model"]), holdsMs: [100, 1_000, 3_000], controls: ["7", "+", "=", "AC", "deg/rad", "history"] }, null, 2)}\n`
  );
} finally {
  await client?.close();
  removeForward();
}
