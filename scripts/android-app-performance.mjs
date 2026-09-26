import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import CDP from "chrome-remote-interface";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = process.env.ANDROID_HOME ?? path.join(workspace, ".android-sdk");
const adb = path.join(sdkRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const outputPath = path.resolve(
  workspace,
  process.env.STAGE22_ANDROID_OUTPUT ?? "test-results/stage22-android.json"
);
const workerAsset = readdirSync(path.join(workspace, "dist-app", "assets")).find((name) =>
  /^calculator\.worker-.*\.js$/u.test(name)
);
if (!existsSync(adb)) throw new Error("adb was not found at " + adb);
if (workerAsset === undefined) throw new Error("Run npm run build:app before this probe");
const serial = process.env.ANDROID_SERIAL;
const adbOutput = (args) =>
  execFileSync(adb, serial === undefined ? args : ["-s", serial, ...args], {
    encoding: "utf8",
    timeout: 45_000
  }).trim();
const isEmulator = adbOutput(["shell", "getprop", "ro.kernel.qemu"]) === "1";
if (!isEmulator && process.env.STAGE22_ALLOW_PHYSICAL !== "1") {
  throw new Error(
    "This probe changes app data. Use the physical checklist or set STAGE22_ALLOW_PHYSICAL=1"
  );
}

let client;
let Runtime;
try {
  if (isEmulator) adbOutput(["shell", "pm", "clear", "com.bigcalc.app"]);
  adbOutput(["shell", "am", "force-stop", "com.bigcalc.app"]);
  const launchStart = performance.now();
  const launchOutput = adbOutput([
    "shell",
    "am",
    "start",
    "-W",
    "-n",
    "com.bigcalc.app/.MainActivity"
  ]);
  const activityTotal = /TotalTime:\s*(\d+)/u.exec(launchOutput);
  await connect();
  const report = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    environment: {
      mode: isEmulator
        ? "Android emulator, installed debug APK"
        : "Physical Android, installed APK",
      model: adbOutput(["shell", "getprop", "ro.product.model"]),
      androidSdk: adbOutput(["shell", "getprop", "ro.build.version.sdk"]),
      webViewPackage:
        /Current WebView package \(name, version\): ([^\r\n]+)/u.exec(
          adbOutput(["shell", "dumpsys", "webviewupdate"])
        )?.[1] ?? null,
      deviceMemoryMiB: Math.round(
        Number(
          /MemTotal:\s+(\d+)\s+kB/u.exec(adbOutput(["shell", "cat", "/proc/meminfo"]))?.[1] ?? 0
        ) / 1024
      ),
      serial: serial ?? adbOutput(["get-serialno"]),
      appDataCleared: isEmulator,
      viewport: await evaluate("({width:innerWidth,height:innerHeight})")
    },
    metrics: {
      appStartup: {
        activityTotalMs: activityTotal === null ? null : Number(activityTotal[1]),
        automationReadyWallMs: elapsed(launchStart),
        navigation: await evaluate(
          "(() => { const n = performance.getEntriesByType('navigation')[0];" +
            "return {domContentLoadedMs:Math.round(n.domContentLoadedEventEnd)," +
            "loadEventMs:Math.round(n.loadEventEnd)}; })()"
        )
      }
    }
  };
  const metrics = report.metrics;
  const settings = { angleMode: "radians", factorialMode: "integer", maxCalculationTimeMs: 30_000 };

  const firstStart = performance.now();
  await setExpression("2+3");
  await waitFor(() =>
    evaluate(
      'document.querySelector(".main-display > .result-output")?.textContent?.trim() === "5"'
    )
  );
  metrics.firstCalculationMs = elapsed(firstStart);

  const workerStart = performance.now();
  await evaluate(
    "globalThis.__stage22Worker = new Worker(new URL('/assets/' + " +
      JSON.stringify(workerAsset) +
      ", location.href), {type:'module'})"
  );
  expectType(
    await workerCommand({ type: "create", sessionId: "stage22-start", source: "2+3", settings }),
    "created"
  );
  metrics.workerStartupMs = elapsed(workerStart);
  await workerCommand({ type: "dispose", sessionId: "stage22-start" });

  const digitStart = performance.now();
  await workerCommand({ type: "create", sessionId: "stage22-digits", source: "π", settings });
  const digits = await workerCommand(
    {
      type: "refine",
      sessionId: "stage22-digits",
      requestId: "stage22-digits-refine",
      significantDigits: 1200
    },
    45_000
  );
  assert(
    digits.type === "refinement-result" &&
      digits.result.status === "complete" &&
      digits.result.value.verifiedDigits >= 1200,
    "The Android Worker did not verify 1200 digits"
  );
  metrics.refinedDigits = {
    requested: 1200,
    verified: digits.result.value.verifiedDigits,
    elapsedMs: elapsed(digitStart)
  };
  await workerCommand({ type: "dispose", sessionId: "stage22-digits" });

  await setExpression("1/7");
  await waitFor(() =>
    evaluate('document.querySelector(".main-display")?.dataset.phase === "completed"')
  );
  const scrollStart = performance.now();
  await evaluate(
    'document.querySelector(".main-display > .result-output")' +
      '.dispatchEvent(new WheelEvent("wheel",{deltaX:15000,cancelable:true}))'
  );
  await waitFor(
    () =>
      evaluate(
        'BigInt(document.querySelector(".main-display > .result-output")?.dataset.logicalStart ?? "0") >= 1000n'
      ),
    10_000
  );
  metrics.deepViewport = {
    firstResponseMs: elapsed(scrollStart),
    logicalStart: await evaluate(
      'document.querySelector(".main-display > .result-output")?.dataset.logicalStart'
    )
  };
  await evaluate('document.querySelector(".keyboard-key-equals")?.click()');
  await waitFor(
    () =>
      evaluate(
        'JSON.parse(localStorage.getItem("bigcalc.history.v1"))?.entries.at(-1)?.resultValue.verifiedDigits >= 1000'
      ),
    30_000
  );
  metrics.deepViewport.verifiedDigits = await evaluate(
    'JSON.parse(localStorage.getItem("bigcalc.history.v1")).entries.at(-1).resultValue.verifiedDigits'
  );
  metrics.deepViewport.totalMs = elapsed(scrollStart);

  const exponentStart = performance.now();
  await setExpression("e^e^e^(e+0,2)");
  await waitFor(
    () => evaluate('document.querySelector(".main-display")?.dataset.phase === "completed"'),
    30_000
  );
  metrics.longExponentViewport = {
    elapsedMs: elapsed(exponentStart),
    representation: await evaluate(
      'document.querySelector(".main-display > .result-output")?.dataset.representation'
    ),
    textLength: await evaluate(
      'document.querySelector(".main-display > .result-output")?.textContent.length'
    )
  };

  const baselinePssKb = appPssKb();
  await evaluate(
    "(() => { globalThis.__stage22FrameGaps=[]; let last=performance.now();" +
      "const tick=now=>{__stage22FrameGaps.push(now-last);last=now;" +
      "if(__stage22FrameGaps.length<600)requestAnimationFrame(tick)};" +
      "requestAnimationFrame(tick) })()"
  );
  await workerCommand({
    type: "create",
    sessionId: "stage22-long",
    source: "π",
    settings: { ...settings, maxCalculationTimeMs: 5_000 }
  });
  const longStart = performance.now();
  const longPromise = workerCommand(
    {
      type: "refine",
      sessionId: "stage22-long",
      requestId: "stage22-long-refine",
      significantDigits: 5000
    },
    40_000
  );
  await delay(300);
  const duringPssKb = appPssKb();
  const keyboardResponseMs = await evaluate(
    "(async()=>{const input=document.querySelector('.expression-input');" +
      "const start=performance.now();input.value='7+8';" +
      "input.dispatchEvent(new InputEvent('input',{bubbles:true}));" +
      "await new Promise(resolve=>requestAnimationFrame(resolve));" +
      "return Math.round(performance.now()-start)})()"
  );
  const longResult = await longPromise;
  assert(
    longResult.type === "refinement-result" &&
      (longResult.result.status === "complete" || longResult.result.status === "paused"),
    "Long Android Worker failed: " + (longResult.result.error?.code ?? longResult.type)
  );
  const frameGaps = await evaluate("globalThis.__stage22FrameGaps");
  await workerCommand({ type: "dispose", sessionId: "stage22-long" });
  await delay(500);
  metrics.longCalculation = {
    source: "π, 5000 verified digits",
    status: longResult.result.status,
    elapsedMs: elapsed(longStart),
    keyboardResponseMs,
    frameGapP95Ms: percentile(frameGaps, 0.95),
    maxFrameGapMs: Math.round(Math.max(...frameGaps)),
    appPssKb: { before: baselinePssKb, during: duringPssKb, afterDispose: appPssKb() }
  };
  assert(keyboardResponseMs < 1500, "Android UI input was blocked by Worker refinement");

  const cyclePssKb = [];
  const cycleStart = performance.now();
  for (let index = 0; index < 120; index += 1) {
    const sessionId = "stage22-cycle-" + String(index);
    expectType(
      await workerCommand({ type: "create", sessionId, source: "1/7", settings }),
      "created"
    );
    if (index % 4 !== 0) {
      const refined = await workerCommand({
        type: "refine",
        sessionId,
        requestId: "stage22-cycle-refine-" + String(index),
        significantDigits: 25
      });
      assert(refined.type === "refinement-result" && refined.result.status === "complete");
    }
    if (index % 4 === 3) await workerCommand({ type: "cancel", sessionId });
    expectType(await workerCommand({ type: "dispose", sessionId }), "disposed");
    if (index % 40 === 39) cyclePssKb.push(appPssKb());
  }
  metrics.workerLifecycle = {
    cycles: 120,
    elapsedMs: elapsed(cycleStart),
    appPssKbAfterEach40: cyclePssKb
  };
  assert(
    cyclePssKb[2] < cyclePssKb[0] + 50_000,
    "App PSS grew more than 50 MiB across lifecycle batches: " + cyclePssKb.join(", ")
  );

  const uiStart = performance.now();
  for (let index = 0; index < 20; index += 1) {
    await setExpression(String(index) + "+1");
    await waitFor(
      () =>
        evaluate(
          'document.querySelector(".main-display > .result-output")?.textContent?.trim() === ' +
            JSON.stringify(String(index + 1))
        ),
      10_000
    );
  }
  metrics.repeatedUiCalculations = { count: 20, elapsedMs: elapsed(uiStart) };

  await setExpression("2+3");
  await waitFor(() =>
    evaluate(
      'document.querySelector(".main-display > .result-output")?.textContent?.trim() === "5"'
    )
  );
  await evaluate('document.querySelector(".keyboard-key-equals")?.click()');
  await waitFor(() => evaluate('localStorage.getItem("bigcalc.history.v1") !== null'));
  const seed = await evaluate(
    "(()=>{const stored=JSON.parse(localStorage.getItem('bigcalc.history.v1'));" +
      "const entry=stored.entries.at(-1);" +
      "stored.entries=Array.from({length:200},(_,i)=>({...entry,id:'stage22-history-'+i,order:i}));" +
      "return JSON.stringify(stored)})()"
  );
  await client.Page.enable();
  await client.Page.addScriptToEvaluateOnNewDocument({
    source: 'localStorage.setItem("bigcalc.history.v1", ' + JSON.stringify(seed) + ");"
  });
  const reloadStart = performance.now();
  await client.Page.reload();
  await waitFor(() => evaluate('document.querySelector(".history-toggle") !== null'), 30_000);
  metrics.history = { entries: 200, reloadMs: elapsed(reloadStart) };
  const openStart = performance.now();
  await evaluate('document.querySelector(".history-toggle").click()');
  await waitFor(
    () => evaluate('document.querySelector(".calculator-shell")?.dataset.historyOpen === "true"'),
    10_000
  );
  metrics.history.openMs = elapsed(openStart);
  await waitFor(
    () => evaluate('document.querySelectorAll(".history-card").length === 200'),
    30_000
  );
  metrics.history.allCardsReadyMs = elapsed(openStart);
  metrics.history.renderedCards = await evaluate(
    'document.querySelectorAll(".history-card").length'
  );
  assert(metrics.history.renderedCards === 200, "Android History did not render 200 cards");
  metrics.history.scrollMs = await evaluate(
    "(()=>{const list=document.querySelector('.history-list');" +
      "const start=performance.now();list.scrollTop=list.scrollHeight;" +
      "return Math.round(performance.now()-start)})()"
  );
  await evaluate('document.querySelector(".history-toggle").click()');

  await setExpression("2+3");
  await waitFor(() =>
    evaluate(
      'document.querySelector(".main-display > .result-output")?.textContent?.trim() === "5"'
    )
  );
  const backgroundStart = performance.now();
  adbOutput(["shell", "input", "keyevent", "KEYCODE_HOME"]);
  await waitFor(() => {
    const top = /topResumedActivity=ActivityRecord\{[^\r\n]*/u.exec(
      adbOutput(["shell", "dumpsys", "activity", "activities"])
    )?.[0];
    return top !== undefined && !top.includes("com.bigcalc.app/");
  }, 15_000);
  await delay(600);
  adbOutput(["shell", "am", "start", "-n", "com.bigcalc.app/.MainActivity"]);
  await waitFor(() => evaluate('document.visibilityState === "visible"'), 15_000);
  metrics.backgroundForeground = {
    elapsedMs: elapsed(backgroundStart),
    expressionRetained: await evaluate(
      'document.querySelector(".expression-input")?.value === "2+3"'
    ),
    appPssKb: appPssKb()
  };
  assert(
    metrics.backgroundForeground.expressionRetained,
    "Expression was lost on foreground return"
  );

  await evaluate("globalThis.__stage22Worker?.terminate()");
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\nSaved: " + outputPath + "\n");
} finally {
  await client?.close().catch(() => undefined);
  try {
    if (adbOutput(["forward", "--list"]).includes("tcp:9224")) {
      adbOutput(["forward", "--remove", "tcp:9224"]);
    }
  } catch {
    // No forwarding remains if connection never reached WebView.
  }
}

function appPssKb() {
  const match = /TOTAL PSS:\s+(\d+)/u.exec(
    adbOutput(["shell", "dumpsys", "meminfo", "com.bigcalc.app"])
  );
  if (match === null) throw new Error("Android TOTAL PSS metric was unavailable");
  return Number(match[1]);
}

function elapsed(start) {
  return Math.round(performance.now() - start);
}

function percentile(values, share) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.ceil((sorted.length - 1) * share)]);
}

function assert(condition, message = "Stage 22 Android probe failed") {
  if (!condition) throw new Error(message);
}

function expectType(response, type) {
  assert(response.type === type, "Expected " + type + ", received " + response.type);
}

async function setExpression(source) {
  await evaluate('document.querySelector(".keyboard-key-ac")?.click()');
  await evaluate(
    "(()=>{const input=document.querySelector('.expression-input');" +
      "input.value=" +
      JSON.stringify(source) +
      ";input.dispatchEvent(new InputEvent('input',{bubbles:true}))})()"
  );
}

async function workerCommand(command, timeoutMs = 20_000) {
  const text = await evaluate(
    "new Promise((resolve,reject)=>{const command=" +
      JSON.stringify(command) +
      ";const worker=globalThis.__stage22Worker;" +
      "const timer=setTimeout(()=>{worker.removeEventListener('message',onMessage);" +
      "reject(new Error('Worker '+command.type+' timed out'))}," +
      String(timeoutMs) +
      ");const onMessage=event=>{const response=event.data;" +
      "if(response.sessionId!==command.sessionId)return;" +
      "if(command.requestId!==undefined&&response.requestId!==command.requestId)return;" +
      "worker.removeEventListener('message',onMessage);clearTimeout(timer);" +
      "resolve(JSON.stringify(response,(_,value)=>typeof value==='bigint'?value.toString():value))};" +
      "worker.addEventListener('message',onMessage);worker.postMessage(command)})"
  );
  return JSON.parse(text);
}

async function evaluate(expression) {
  const response = await Runtime.evaluate({ expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails !== undefined) {
    throw new Error(
      response.exceptionDetails.exception?.description ?? response.exceptionDetails.text
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
  throw new Error("Condition was not met within " + String(timeoutMs) + " ms");
}

async function connect() {
  const deadline = performance.now() + 60_000;
  while (performance.now() < deadline) {
    try {
      const pid = adbOutput(["shell", "pidof", "com.bigcalc.app"]);
      const socket = "webview_devtools_remote_" + pid;
      if (!adbOutput(["shell", "cat", "/proc/net/unix"]).includes("@" + socket)) {
        await delay(200);
        continue;
      }
      try {
        if (adbOutput(["forward", "--list"]).includes("tcp:9224")) {
          adbOutput(["forward", "--remove", "tcp:9224"]);
        }
      } catch {
        // Fresh run.
      }
      adbOutput(["forward", "tcp:9224", "localabstract:" + socket]);
      const targets = await CDP.List({ host: "127.0.0.1", port: 9224 });
      const target = targets.find(
        (candidate) => candidate.type === "page" && candidate.url.startsWith("https://localhost/")
      );
      if (target === undefined) continue;
      client = await CDP({ target, host: "127.0.0.1", port: 9224, local: true });
      Runtime = client.Runtime;
      await Runtime.enable();
      await waitFor(() => evaluate('document.querySelector(".expression-input") !== null'), 20_000);
      return;
    } catch {
      await client?.close().catch(() => undefined);
      client = undefined;
      await delay(300);
    }
  }
  throw new Error("BigCalc WebView did not start for Stage 22");
}
