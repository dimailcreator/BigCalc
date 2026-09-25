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
const workerAsset = readdirSync(path.join(workspace, "dist-app", "assets")).find((name) =>
  /^calculator\.worker-.*\.js$/u.test(name)
);

if (!existsSync(adb)) throw new Error(`adb was not found at ${adb}`);
if (workerAsset === undefined) throw new Error("Production Worker asset was not found");

let target;
const discoveryDeadline = performance.now() + 20_000;
while (target === undefined && performance.now() < discoveryDeadline) {
  try {
    const appPid = adbOutput(["shell", "pidof", "com.bigcalc.app"]);
    const socketName = `webview_devtools_remote_${appPid}`;
    if (!adbOutput(["shell", "cat", "/proc/net/unix"]).includes(`@${socketName}`)) {
      await delay(200);
      continue;
    }
    try {
      adbOutput(["forward", "--remove", "tcp:9222"]);
    } catch {
      // No previous forwarding exists.
    }
    adbOutput(["forward", "tcp:9222", `localabstract:${socketName}`]);
    const targets = await CDP.List({ host: "127.0.0.1", port: 9222 });
    target = targets.find(
      (candidate) => candidate.type === "page" && candidate.url.startsWith("https://localhost/")
    );
  } catch {
    // The app may still be creating its WebView.
  }
  if (target === undefined) await delay(200);
}
if (target === undefined) throw new Error("BigCalc WebView page was not found");

const client = await CDP({ target, host: "127.0.0.1", port: 9222, local: true });
const { Runtime } = client;
await Runtime.enable();
Runtime.exceptionThrown(({ exceptionDetails }) => {
  process.stderr.write(
    `WebView exception: ${exceptionDetails.exception?.description ?? exceptionDetails.text}\n`
  );
});
Runtime.consoleAPICalled(({ type, args }) => {
  if (type === "error") {
    process.stderr.write(
      `WebView console error: ${args.map((arg) => arg.value ?? arg.description).join(" ")}\n`
    );
  }
});

try {
  await waitFor(
    () => evaluate("globalThis.document.querySelector('.expression-input') !== null"),
    20_000
  );
  const metrics = await evaluate(`(() => {
    const navigation = globalThis.performance.getEntriesByType("navigation")[0];
    const shell = globalThis.document.querySelector(".calculator-shell");
    const viewport = globalThis.document.querySelector('meta[name="viewport"]');
    return {
      title: globalThis.document.title,
      domContentLoadedMs:
        navigation instanceof globalThis.PerformanceNavigationTiming
          ? Math.round(navigation.domContentLoadedEventEnd)
          : null,
      loadEventMs:
        navigation instanceof globalThis.PerformanceNavigationTiming
          ? Math.round(navigation.loadEventEnd)
          : null,
      safeAreaPaddingTop:
        shell === null ? null : globalThis.getComputedStyle(shell).paddingTop,
      viewportFit: viewport?.getAttribute("content") ?? null,
      portrait: globalThis.innerWidth < globalThis.innerHeight,
      bigintClone:
        globalThis.structuredClone({ exponent10: 12345678901234567890n }).exponent10.toString()
    };
  })()`);

  assertEqual(metrics.title, "BigCalc", "document title");
  assertEqual(metrics.bigintClone, "12345678901234567890", "bigint structured clone");
  assertEqual(metrics.portrait, true, "portrait viewport");
  if (!metrics.viewportFit?.includes("viewport-fit=cover")) {
    throw new Error("viewport-fit=cover is missing in Android WebView");
  }

  const calculations = [];
  calculations.push(await calculate("2+3", (value) => value === "5"));
  calculations.push(await calculate("π", (value) => value.startsWith("3,14159")));
  calculations.push(await calculate("e", (value) => value.startsWith("2,71828")));
  calculations.push(await calculate("sin(30)", (value) => value === "0,5"));
  const workerLifecycle = await probeWorkerLifecycle(workerAsset);
  assertEqual(workerLifecycle.pauseStatus, "paused", "soft timeout status");
  assertEqual(workerLifecycle.continueStatus, "paused", "continued handle status");
  assertEqual(
    workerLifecycle.continueSessionId,
    workerLifecycle.createdSessionId,
    "continued session identity"
  );
  assertEqual(workerLifecycle.exponentType, "bigint", "Worker exponent transport type");
  assertEqual(workerLifecycle.exponent10, "1000", "Worker exponent value");

  await startLongCalculation(workerAsset);
  await delay(250);
  const responsivenessStart = performance.now();
  const responsiveTitle = await evaluate("globalThis.document.title");
  const responsivenessMs = Math.round(performance.now() - responsivenessStart);
  assertEqual(responsiveTitle, "BigCalc", "UI responsiveness probe");

  await waitFor(
    () =>
      evaluate(
        '["paused", "complete", "failed", "error"].includes(globalThis.__stage5LongProbe?.status)'
      ),
    20_000
  );
  const longCalculation = await evaluate("globalThis.__stage5LongProbe");
  if (longCalculation.status !== "paused" && longCalculation.status !== "complete") {
    throw new Error(`Long Worker calculation failed: ${JSON.stringify(longCalculation)}`);
  }
  await evaluate("globalThis.__stage5LongWorker?.terminate()");

  adbOutput(["shell", "input", "keyevent", "3"]);
  await delay(500);
  adbOutput(["shell", "am", "start", "-n", "com.bigcalc.app/.MainActivity"]);
  await delay(1_000);
  assertEqual(await evaluate("globalThis.document.title"), "BigCalc", "foreground restore");
  const afterForeground = await calculate("2+3", (value) => value === "5");

  await evaluate('globalThis.document.querySelector(".overflow-toggle")?.click()');
  await waitFor(
    () => evaluate('globalThis.document.querySelector(".overflow-layer")?.hidden === false'),
    5_000
  );
  adbOutput(["shell", "input", "keyevent", "4"]);
  await waitFor(
    () => evaluate('globalThis.document.querySelector(".overflow-layer")?.hidden === true'),
    5_000
  );

  await evaluate('globalThis.document.querySelector(".drawer-toggle")?.click()');
  await waitFor(
    () =>
      evaluate('globalThis.document.querySelector(".calculator-drawer-layer")?.hidden === false'),
    5_000
  );
  adbOutput(["shell", "input", "keyevent", "4"]);
  await waitFor(
    () =>
      evaluate('globalThis.document.querySelector(".calculator-drawer-layer")?.hidden === true'),
    5_000
  );

  await evaluate('globalThis.document.querySelector(".overflow-toggle")?.click()');
  await evaluate('globalThis.document.querySelector(".overflow-menu button")?.click()');
  await waitFor(
    () =>
      evaluate('globalThis.document.querySelector(".settings-screen")?.dataset.open === "true"'),
    5_000
  );
  adbOutput(["shell", "input", "keyevent", "4"]);
  await waitFor(
    () =>
      evaluate('globalThis.document.querySelector(".settings-screen")?.dataset.open === "false"'),
    5_000
  );

  await evaluate('globalThis.document.querySelector(".history-toggle")?.click()');
  await waitFor(
    () =>
      evaluate(
        'globalThis.document.querySelector(".calculator-shell")?.dataset.historyOpen === "true"'
      ),
    5_000
  );
  adbOutput(["shell", "input", "keyevent", "4"]);
  await waitFor(
    () =>
      evaluate(
        'globalThis.document.querySelector(".calculator-shell")?.dataset.historyOpen === "false"'
      ),
    5_000
  );
  assertEqual(await evaluate("globalThis.document.title"), "BigCalc", "Android Back app retention");

  const memory = adbOutput(["shell", "dumpsys", "meminfo", "com.bigcalc.app"]);
  const totalPssKb = /TOTAL PSS:\s+(\d+)/u.exec(memory)?.[1] ?? null;

  process.stdout.write(
    `${JSON.stringify(
      {
        metrics,
        calculations,
        workerLifecycle,
        responsivenessMs,
        longCalculation,
        afterForeground,
        androidBackLayers: ["overflow", "drawer", "settings", "history"],
        totalPssKb: totalPssKb === null ? null : Number(totalPssKb)
      },
      null,
      2
    )}\n`
  );
} finally {
  await evaluate("globalThis.__stage5LongWorker?.terminate()").catch(() => undefined);
  await client.close();
  adbOutput(["forward", "--remove", "tcp:9222"]);
}

async function calculate(source, accepts) {
  const startedAt = performance.now();
  await setExpression(source);
  try {
    await waitFor(
      () =>
        evaluate(`(() => {
        const input = globalThis.document.querySelector(".expression-input");
        const result = globalThis.document.querySelector(".main-display > .result-output");
        return input?.value === ${JSON.stringify(source)} && result?.dataset.kind === "value";
      })()`),
      10_000
    );
  } catch (error) {
    const state = await evaluate(`(() => ({
      source: globalThis.document.querySelector(".expression-input")?.value,
      phase: globalThis.document.querySelector(".main-display")?.dataset.phase,
      result: globalThis.document.querySelector(".main-display > .result-output")?.textContent,
      kind: globalThis.document.querySelector(".main-display > .result-output")?.dataset.kind
    }))()`);
    throw new Error(`Calculation ${source} did not complete: ${JSON.stringify(state)}`, {
      cause: error
    });
  }
  const value = await evaluate(
    'globalThis.document.querySelector(".main-display > .result-output")?.textContent ?? ""'
  );
  const visibleValue = value.trim();
  if (!accepts(visibleValue)) throw new Error(`Unexpected result for ${source}: ${visibleValue}`);
  return { source, value: visibleValue, elapsedMs: Math.round(performance.now() - startedAt) };
}

async function probeWorkerLifecycle(assetName) {
  return evaluate(`(async () => {
    const worker = new globalThis.Worker(
      new globalThis.URL("/assets/" + ${JSON.stringify(assetName)}, globalThis.location.href),
      { type: "module" }
    );
    const send = (command, expectedType) => new globalThis.Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => reject(new Error(
        "Worker response timeout for " + command.type
      )), 12000);
      worker.onmessage = (event) => {
        globalThis.clearTimeout(timer);
        if (event.data?.type !== expectedType) {
          reject(new Error("Unexpected Worker response: " + JSON.stringify(event.data)));
        } else {
          resolve(event.data);
        }
      };
      worker.onerror = (event) => {
        globalThis.clearTimeout(timer);
        reject(new Error("Worker error: " + event.message));
      };
      worker.postMessage(command);
    });
    const settings = {
      angleMode: "degrees",
      factorialMode: "integer",
      maxCalculationTimeMs: 0
    };
    const startedAt = globalThis.performance.now();
    try {
      const created = await send(
        { type: "create", sessionId: "stage5-pause", source: "π", settings },
        "created"
      );
      const startupMs = Math.round(globalThis.performance.now() - startedAt);
      const paused = await send(
        {
          type: "refine",
          sessionId: "stage5-pause",
          requestId: "stage5-refine",
          significantDigits: 1000
        },
        "refinement-result"
      );
      const continued = await send(
        { type: "continue", sessionId: "stage5-pause", requestId: "stage5-continue" },
        "refinement-result"
      );
      await send({ type: "dispose", sessionId: "stage5-pause" }, "disposed");

      await send(
        {
          type: "create",
          sessionId: "stage5-exponent",
          source: "10^1000",
          settings: { ...settings, maxCalculationTimeMs: 5000 }
        },
        "created"
      );
      const power = await send(
        {
          type: "refine",
          sessionId: "stage5-exponent",
          requestId: "stage5-power",
          significantDigits: 2
        },
        "refinement-result"
      );
      await send({ type: "dispose", sessionId: "stage5-exponent" }, "disposed");

      return {
        startupMs,
        workerHandleId: created.workerHandleId,
        createdSessionId: created.sessionId,
        pauseStatus: paused.result?.status,
        continueStatus: continued.result?.status,
        continueSessionId: continued.sessionId,
        exponentType: typeof power.result?.value?.exponent10,
        exponent10: power.result?.value?.exponent10?.toString()
      };
    } finally {
      worker.terminate();
    }
  })()`);
}

async function startLongCalculation(assetName) {
  await evaluate(`(() => {
    const worker = new globalThis.Worker(
      new globalThis.URL("/assets/" + ${JSON.stringify(assetName)}, globalThis.location.href),
      { type: "module" }
    );
    globalThis.__stage5LongWorker = worker;
    const startedAt = globalThis.performance.now();
    globalThis.__stage5LongProbe = { status: "starting" };
    worker.onmessage = (event) => {
      if (event.data?.type === "created") {
        globalThis.__stage5LongProbe = { status: "running" };
        worker.postMessage({
          type: "refine",
          sessionId: "stage5-long",
          requestId: "stage5-long-request",
          significantDigits: 5000
        });
      } else if (event.data?.type === "refinement-result") {
        globalThis.__stage5LongProbe = {
          status: event.data.result.status,
          elapsedMs: Math.round(globalThis.performance.now() - startedAt),
          errorCode: event.data.result.error?.code ?? null,
          errorMessage: event.data.result.error?.message ?? null,
          verifiedDigits: event.data.result.verifiedDigits ??
            event.data.result.value?.verifiedDigits ?? null
        };
      } else {
        globalThis.__stage5LongProbe = {
          status: "error",
          responseType: event.data?.type ?? "unknown"
        };
      }
    };
    worker.onerror = (event) => {
      globalThis.__stage5LongProbe = { status: "error", message: event.message };
    };
    worker.postMessage({
      type: "create",
      sessionId: "stage5-long",
      source: "π",
      settings: {
        angleMode: "degrees",
        factorialMode: "integer",
        maxCalculationTimeMs: 5000
      }
    });
  })()`);
}

async function setExpression(source) {
  await evaluate(`(() => {
    const input = globalThis.document.querySelector(".expression-input");
    if (!(input instanceof globalThis.HTMLInputElement)) throw new Error("Input not found");
    input.value = ${JSON.stringify(source)};
    input.dispatchEvent(new globalThis.InputEvent("input", { bubbles: true }));
  })()`);
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

async function waitFor(check, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Condition was not met within ${String(timeoutMs)} ms`);
}

function adbOutput(args) {
  return execFileSync(adb, args, { encoding: "utf8" }).trim();
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
