import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.STAGE22_PORT ?? "4174");
const baseUrl = `http://127.0.0.1:${String(port)}`;
const outputPath = path.resolve(
  workspace,
  process.env.STAGE22_OUTPUT ?? "test-results/stage22-browser.json"
);
const workerAsset = (await readdir(path.join(workspace, "dist-app", "assets"))).find((name) =>
  /^calculator\.worker-.*\.js$/u.test(name)
);
if (workerAsset === undefined) throw new Error("Build the app before running Stage 22 probes");

const server = spawn(
  process.execPath,
  [
    path.join(workspace, "node_modules", "vite", "bin", "vite.js"),
    "preview",
    "--config",
    "vite.config.js",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort"
  ],
  { cwd: workspace, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
);
let serverOutput = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (chunk) => {
    serverOutput += String(chunk);
  });
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const report = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    environment: {
      mode: "Chromium headless, Vite production preview",
      browser: browser.version(),
      platform: process.platform,
      cpuLogicalCount: os.cpus().length,
      hostMemoryMiB: Math.round(os.totalmem() / 1024 ** 2),
      viewport: { width: 390, height: 844 }
    },
    metrics: {}
  };
  const metrics = report.metrics;

  const navigationStart = performance.now();
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator(".expression-input").waitFor();
  await page.waitForFunction(
    () => globalThis.document.querySelector("#app")?.dataset.calculationWorker === "started"
  );
  metrics.appStartup = {
    wallMs: elapsed(navigationStart),
    navigation: await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0];
      return {
        responseEndMs: Math.round(entry.responseEnd),
        domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd),
        loadEventMs: Math.round(entry.loadEventEnd)
      };
    })
  };

  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });
  const firstStart = performance.now();
  await input.fill("2+3");
  await result.getByText("5", { exact: true }).waitFor();
  metrics.firstCalculationMs = elapsed(firstStart);

  const workerStart = performance.now();
  await page.evaluate((asset) => {
    globalThis.__stage22Worker = new Worker(new URL(`/assets/${asset}`, location.href), {
      type: "module"
    });
  }, workerAsset);
  const settings = { angleMode: "radians", factorialMode: "integer", maxCalculationTimeMs: 30_000 };
  assertResponse(
    await workerCommand(page, {
      type: "create",
      sessionId: "stage22-startup",
      source: "2+3",
      settings
    }),
    "created"
  );
  metrics.workerStartupMs = elapsed(workerStart);
  assertResponse(
    await workerCommand(page, {
      type: "refine",
      sessionId: "stage22-startup",
      requestId: "stage22-startup-refine",
      significantDigits: 20
    }),
    "refinement-result"
  );
  await workerCommand(page, { type: "dispose", sessionId: "stage22-startup" });

  const repeatedStart = performance.now();
  const cycleTimes = [];
  for (let index = 0; index < 80; index += 1) {
    const sessionId = `stage22-cycle-${String(index)}`;
    const cycleStart = performance.now();
    assertResponse(
      await workerCommand(page, { type: "create", sessionId, source: "1/7", settings }),
      "created"
    );
    if (index % 4 !== 0) {
      const refined = await workerCommand(page, {
        type: "refine",
        sessionId,
        requestId: `stage22-cycle-refine-${String(index)}`,
        significantDigits: 30
      });
      assert(refined.type === "refinement-result" && refined.result.status === "complete");
    }
    if (index % 4 === 3) await workerCommand(page, { type: "cancel", sessionId });
    assertResponse(await workerCommand(page, { type: "dispose", sessionId }), "disposed");
    cycleTimes.push(elapsed(cycleStart));
  }
  metrics.workerLifecycle = {
    cycles: cycleTimes.length,
    totalMs: elapsed(repeatedStart),
    medianMs: percentile(cycleTimes, 0.5),
    p95Ms: percentile(cycleTimes, 0.95)
  };

  const precisionStart = performance.now();
  assertResponse(
    await workerCommand(page, {
      type: "create",
      sessionId: "stage22-precision",
      source: "π",
      settings
    }),
    "created"
  );
  const precision = await workerCommand(
    page,
    {
      type: "refine",
      sessionId: "stage22-precision",
      requestId: "stage22-precision-refine",
      significantDigits: 1200
    },
    45_000
  );
  assert(
    precision.type === "refinement-result" &&
      precision.result.status === "complete" &&
      precision.result.value.verifiedDigits >= 1200,
    "The Worker did not verify 1200 digits"
  );
  metrics.refinedDigits = {
    requested: 1200,
    verified: precision.result.value.verifiedDigits,
    elapsedMs: elapsed(precisionStart)
  };
  await workerCommand(page, { type: "dispose", sessionId: "stage22-precision" });

  await input.fill("1/7");
  await page.waitForFunction(
    () => globalThis.document.querySelector(".main-display")?.dataset.phase === "completed"
  );
  const scrollStart = performance.now();
  await result.evaluate((node) =>
    node.dispatchEvent(new globalThis.WheelEvent("wheel", { deltaX: 20_000, cancelable: true }))
  );
  await page.waitForFunction(
    () =>
      BigInt(
        globalThis.document.querySelector(".main-display > .result-output")?.dataset.logicalStart ??
          "0"
      ) >= 1000n
  );
  const scrollResponseMs = elapsed(scrollStart);
  await page.waitForFunction(
    () =>
      globalThis.document.querySelectorAll(
        ".main-display > .result-output .number-slot-placeholder"
      ).length === 0,
    { timeout: 45_000 }
  );
  metrics.deepViewport = {
    logicalStart: await result.getAttribute("data-logical-start"),
    firstResponseMs: scrollResponseMs,
    digitsReadyMs: elapsed(scrollStart),
    slotCount: await result.locator(".number-slot").count(),
    renderedText: (await result.textContent()).trim()
  };
  await page.getByRole("button", { name: "Равно" }).click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("bigcalc.history.v1"))?.entries.at(-1)?.resultValue
        .verifiedDigits >= 1000,
    undefined,
    { timeout: 45_000 }
  );
  metrics.deepViewport.verifiedDigits = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("bigcalc.history.v1")).entries.at(-1).resultValue
        .verifiedDigits
  );

  const exponentStart = performance.now();
  await input.fill("e^e^e^(e+0,2)");
  await page.waitForFunction(
    () => globalThis.document.querySelector(".main-display")?.dataset.phase === "completed",
    { timeout: 30_000 }
  );
  metrics.longExponentViewport = {
    elapsedMs: elapsed(exponentStart),
    representation: await result.getAttribute("data-representation"),
    textLength: (await result.textContent()).length
  };

  const heapBefore = await pageHeap(cdp);
  await page.evaluate(() => {
    globalThis.__stage22FrameGaps = [];
    let previous = performance.now();
    const tick = (now) => {
      globalThis.__stage22FrameGaps.push(now - previous);
      previous = now;
      if (globalThis.__stage22FrameGaps.length < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const longSettings = { ...settings, maxCalculationTimeMs: 5_000 };
  await workerCommand(page, {
    type: "create",
    sessionId: "stage22-long",
    source: "π",
    settings: longSettings
  });
  const longStart = performance.now();
  const longRefinement = workerCommand(
    page,
    {
      type: "refine",
      sessionId: "stage22-long",
      requestId: "stage22-long-refine",
      significantDigits: 5_000
    },
    35_000
  );
  await delay(250);
  const heapDuring = await pageHeap(cdp);
  const keyboardStart = performance.now();
  await input.fill("7+8");
  await page.waitForFunction(
    () => globalThis.document.querySelector(".expression-input")?.value === "7+8"
  );
  const keyboardResponseMs = elapsed(keyboardStart);
  const longResult = await longRefinement;
  assert(longResult.type === "refinement-result", "Long Worker did not answer");
  assert(
    longResult.result.status === "complete" || longResult.result.status === "paused",
    `Long Worker failed: ${longResult.result.error?.code ?? longResult.result.status}`
  );
  const frameGaps = await page.evaluate(() => globalThis.__stage22FrameGaps);
  metrics.longCalculation = {
    source: "π, 5000 verified digits",
    status: longResult.result.status,
    elapsedMs: elapsed(longStart),
    keyboardResponseMs,
    frameGapP95Ms: percentile(frameGaps, 0.95),
    maxFrameGapMs: Math.round(Math.max(...frameGaps)),
    mainHeapBeforeBytes: heapBefore,
    mainHeapDuringBytes: heapDuring
  };
  await workerCommand(page, { type: "dispose", sessionId: "stage22-long" });
  await cdp.send("HeapProfiler.collectGarbage");
  metrics.longCalculation.mainHeapAfterDisposeBytes = await pageHeap(cdp);
  assert(keyboardResponseMs < 1000, "The UI thread stopped responding during Worker refinement");

  const uiCycleStart = performance.now();
  for (let index = 0; index < 25; index += 1) {
    await input.fill(`${String(index)}+1`);
    await page.waitForFunction(
      (expected) =>
        globalThis.document.querySelector(".main-display > .result-output")?.textContent?.trim() ===
        expected,
      String(index + 1)
    );
  }
  metrics.repeatedUiCalculations = { count: 25, elapsedMs: elapsed(uiCycleStart) };

  await input.fill("2+3");
  await result.getByText("5", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Равно" }).click();
  const historySeed = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("bigcalc.history.v1"));
    const entry = stored.entries.at(-1);
    stored.entries = Array.from({ length: 200 }, (_, index) => ({
      ...entry,
      id: `stage22-history-${String(index)}`,
      order: index
    }));
    return JSON.stringify(stored);
  });
  await page.addInitScript((savedHistory) => {
    localStorage.setItem("bigcalc.history.v1", savedHistory);
  }, historySeed);
  const historyReloadStart = performance.now();
  await page.reload({ waitUntil: "load" });
  await page.locator(".history-toggle").waitFor();
  metrics.history = { entries: 200, reloadMs: elapsed(historyReloadStart) };
  const historyOpenStart = performance.now();
  await page.getByRole("button", { name: "История", exact: true }).click();
  await page.getByRole("region", { name: "История вычислений" }).waitFor();
  metrics.history.openMs = elapsed(historyOpenStart);
  await page.waitForFunction(() => document.querySelectorAll(".history-card").length === 200);
  metrics.history.allCardsReadyMs = elapsed(historyOpenStart);
  metrics.history.renderedCards = await page.locator(".history-card").count();
  assert(
    metrics.history.renderedCards === 200,
    `History rendered ${String(metrics.history.renderedCards)} of 200 saved entries`
  );
  metrics.history.scrollMs = await page.locator(".history-panel").evaluate((node) => {
    const start = performance.now();
    node.scrollTop = node.scrollHeight;
    return Math.round(performance.now() - start);
  });

  await page.getByRole("button", { name: "История", exact: true }).click();
  await input.fill("2+3");
  await result.getByText("5", { exact: true }).waitFor();
  const backgroundStart = performance.now();
  const otherPage = await context.newPage();
  await otherPage.goto("about:blank");
  await page.bringToFront();
  await page.locator(".expression-input").waitFor();
  metrics.backgroundForeground = {
    elapsedMs: elapsed(backgroundStart),
    expressionRetained: (await input.inputValue()).length > 0
  };
  assert(metrics.backgroundForeground.expressionRetained, "Expression was lost after tab return");

  await page.evaluate(() => globalThis.__stage22Worker?.terminate());
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\nSaved: ${outputPath}\n`);
  await cdp.detach();
  await context.close();
} finally {
  await browser?.close();
  server.kill();
}

function elapsed(start) {
  return Math.round(performance.now() - start);
}

function percentile(values, share) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.ceil((sorted.length - 1) * share)]);
}

function assert(condition, message = "Stage 22 probe failed") {
  if (!condition) throw new Error(message);
}

function assertResponse(response, type) {
  assert(response?.type === type, `Expected ${type}, received ${String(response?.type)}`);
}

async function pageHeap(cdp) {
  const usage = await cdp.send("Runtime.getHeapUsage");
  return usage.usedSize;
}

async function workerCommand(page, command, timeoutMs = 15_000) {
  return page.evaluate(
    ({ value, timeout }) =>
      new Promise((resolve, reject) => {
        const worker = globalThis.__stage22Worker;
        const timer = setTimeout(() => {
          worker.removeEventListener("message", onMessage);
          reject(new Error(`Worker ${value.type} timed out`));
        }, timeout);
        const onMessage = (event) => {
          const response = event.data;
          if (response.sessionId !== value.sessionId) return;
          if (value.requestId !== undefined && response.requestId !== value.requestId) return;
          worker.removeEventListener("message", onMessage);
          clearTimeout(timer);
          resolve(response);
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage(value);
      }),
    { value: command, timeout: timeoutMs }
  );
}

async function waitForServer() {
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite preview exited: ${serverOutput}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await delay(200);
  }
  throw new Error(`Vite preview did not start: ${serverOutput}`);
}
