import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import CDP from "chrome-remote-interface";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = process.env.ANDROID_HOME ?? path.join(workspace, ".android-sdk");
const adb = path.join(sdkRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const port = 9224;
if (!existsSync(adb)) throw new Error(`adb was not found at ${adb}`);
const deviceArgs = process.env.ANDROID_SERIAL ? ["-s", process.env.ANDROID_SERIAL] : [];
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
  const waitForExpanded = async (selector, expected) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const actual = await evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-expanded')`
      );
      if (actual === expected) return;
      await delay(100);
    }
    const events = await evaluate("globalThis.__stage32rEvents?.slice(-12)");
    throw new Error(
      `${selector} did not reach aria-expanded=${expected}; events: ${JSON.stringify(events)}`
    );
  };
  const touch = async (selector, holdMs = 40) => {
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) throw new Error('Button was not found');
      const rect = element.getBoundingClientRect();
      return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
    })()`);
    await Input.dispatchTouchEvent({
      type: "touchStart",
      touchPoints: [{ x: point.x, y: point.y, id: 1 }]
    });
    await delay(holdMs);
    await Input.dispatchTouchEvent({ type: "touchEnd", touchPoints: [] });
  };

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate("document.querySelector('.drawer-toggle') !== null")) break;
    await delay(100);
  }
  if (!(await evaluate("document.querySelector('.drawer-toggle') !== null")))
    throw new Error("BigCalc controls did not finish mounting");

  await evaluate(`(() => {
    const events = [];
    const removers = [];
    const types = ['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchend','click','contextmenu','select','selectionchange'];
    for (const type of types) {
      const listener = event => {
        const input = document.querySelector('.expression-input');
        const target = event.target instanceof Element ? event.target : null;
        const targetName = typeof target?.className === 'string'
          ? target.className
          : target?.closest('button,input')?.className ?? null;
        events.push({
          type, target: targetName,
          pointerType: event.pointerType ?? null, button: event.button ?? null,
          buttons: event.buttons ?? null, detail: event.detail ?? null,
          timeStamp: event.timeStamp, isTrusted: event.isTrusted,
          selectionStart: input?.selectionStart ?? null,
          selectionEnd: input?.selectionEnd ?? null,
          selectionDirection: input?.selectionDirection ?? null,
          activeElement: document.activeElement?.className ?? null
        });
      };
      window.addEventListener(type, listener, {capture:true});
      removers.push(() => window.removeEventListener(type, listener, {capture:true}));
    }
    globalThis.__stage32rEvents = events;
    globalThis.__stage32rStop = () => removers.forEach(remove => remove());
  })()`);

  const controls = [
    { selector: ".drawer-toggle", label: "drawer" },
    { selector: ".overflow-toggle", label: "overflow" },
    { selector: ".history-toggle", label: "history" }
  ];
  const results = [];
  for (const { selector, label } of controls) {
    const initialCount = await evaluate("globalThis.__stage32rEvents.length");
    for (let cycle = 0; cycle < 10; cycle += 1) {
      await touch(selector);
      await waitForExpanded(selector, "true");
      await delay(120);
      await waitForExpanded(selector, "true");
      if (label === "history") await touch(selector);
      else adbOutput(["shell", "input", "keyevent", "4"]);
      await waitForExpanded(selector, "false");
      await delay(80);
    }
    const trace = await evaluate(`globalThis.__stage32rEvents.slice(${String(initialCount)})`);
    const clicks = trace.filter((event) => event.type === "click");
    results.push({
      control: label,
      openCloseCycles: 10,
      pointerDowns: trace.filter(
        (event) => event.type === "pointerdown" && event.target?.includes(selector.slice(1))
      ).length,
      pointerUps: trace.filter(
        (event) => event.type === "pointerup" && event.target?.includes(selector.slice(1))
      ).length,
      clicks: clicks.length,
      clickDetails: [...new Set(clicks.map((event) => event.detail))],
      clickTargets: [...new Set(clicks.map((event) => event.target))],
      firstEvents: trace.slice(0, 6)
    });
  }
  const swipeStart = await evaluate(`(() => {
    const rect = document.querySelector('.drawer-toggle').getBoundingClientRect();
    return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
  })()`);
  await Input.dispatchTouchEvent({
    type: "touchStart",
    touchPoints: [{ x: swipeStart.x, y: swipeStart.y, id: 1 }]
  });
  for (let step = 1; step <= 4; step += 1) {
    await delay(30);
    await Input.dispatchTouchEvent({
      type: "touchMove",
      touchPoints: [{ x: swipeStart.x + 2, y: swipeStart.y + step * 23, id: 1 }]
    });
  }
  await Input.dispatchTouchEvent({ type: "touchEnd", touchPoints: [] });
  await waitForExpanded(".history-toggle", "true");
  await waitForExpanded(".drawer-toggle", "false");
  adbOutput(["shell", "input", "keyevent", "4"]);
  await waitForExpanded(".history-toggle", "false");
  await evaluate("globalThis.__stage32rStop()");
  process.stdout.write(
    `${JSON.stringify({ status: "passed", device: adbOutput(["shell", "getprop", "ro.product.model"]), results, topBarSwipe: "history-only" }, null, 2)}\n`
  );
} finally {
  await client?.close().catch(() => undefined);
  try {
    adbOutput(["forward", "--remove", `tcp:${String(port)}`]);
  } catch {
    // The WebView may not have started far enough to create this forwarding.
  }
}
