// Incrementally persisted, budgeted AR-7 comparison. A paused point is not a
// verified timing. Precision and iteration counts are never bounded by the budget.
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createEvaluationContext, verifiedNumberFromBall } from "../dist/core/index.js";
import {
  getChudnovskyPiRationalInterval,
  getPiProviderStateSnapshot
} from "../dist/core/math/constants.js";
import { AgmPiProvider } from "../dist/core/math/pi-agm.js";
import {
  enablePiInstrumentation,
  piInstrumentation
} from "../dist/core/math/pi-instrumentation.js";
import { intervalToRoundedBall } from "../dist/core/math/elementary.js";

const grid = (process.argv[2] ?? "3000,10000,30000,100000").split(",").map(Number);
const budgetMs = Number(process.argv[3] ?? 20000);
const output = process.argv[4] ?? "benchmarks/results/ar-7-pi-budget.json";
if (![...grid, budgetMs].every((n) => Number.isSafeInteger(n) && n > 0))
  throw new Error("Invalid grid/budget");
const rows = [],
  references = new Map();
const save = () =>
  writeFileSync(
    output,
    JSON.stringify({ node: process.version, platform: process.platform, budgetMs, rows }, null, 2) +
      "\n"
  );
for (const family of process.argv[5] ? [process.argv[5]] : ["agm", "chudnovsky"]) {
  for (const mode of ["sequential", "direct"]) {
    let previous = "",
      deadline = Infinity,
      checkpoints = 0;
    const pause = new Error("Benchmark cooperative budget");
    const make = () => {
      const context = createEvaluationContext({
        checkpoint() {
          checkpoints++;
          if (performance.now() >= deadline) throw pause;
        }
      });
      enablePiInstrumentation(context);
      return { context, agm: new AgmPiProvider() };
    };
    let owner = make(),
      skipOptional = false;
    for (const digits of grid) {
      if (digits > 30000 && skipOptional) {
        rows.push({
          family,
          mode,
          requestedDigits: digits,
          status: "not-attempted-after-budget",
          verifiedDigits: null
        });
        save();
        continue;
      }
      if (mode === "direct") {
        owner = make();
        checkpoints = 0;
      }
      globalThis.gc?.();
      const started = performance.now();
      deadline = started + budgetMs;
      console.log("start", family, mode, digits);
      let bounds,
        wallTimeMs,
        verified = null,
        extractionMs = null;
      let status = "budget-exceeded";
      try {
        bounds =
          family === "agm"
            ? owner.agm.getInterval(digits + 8, owner.context)
            : getChudnovskyPiRationalInterval(owner.context, digits + 8);
        wallTimeMs = performance.now() - started;
        deadline = Infinity;
        const extractionStart = performance.now();
        verified = verifiedNumberFromBall(
          intervalToRoundedBall(bounds, 4 * digits + 64, owner.context.backend),
          { significantDigits: digits },
          owner.context.backend
        );
        extractionMs = performance.now() - extractionStart;
        if (verified.verifiedDigits < digits || !verified.digits.startsWith(previous))
          throw new Error("Insufficient/regressed prefix");
        const prefix = verified.digits.slice(0, digits);
        if (references.has(digits) && references.get(digits) !== prefix)
          throw new Error("Cross-family/direct prefix mismatch");
        references.set(digits, prefix);
        if (mode === "sequential") previous = prefix;
        status = wallTimeMs <= budgetMs ? "verified" : "verified-over-budget";
      } catch (error) {
        if (error !== pause) throw error;
        wallTimeMs = performance.now() - started;
        skipOptional = true;
      }
      deadline = Infinity;
      const snapshot =
        family === "agm"
          ? owner.agm.getSnapshot()
          : { ...getPiProviderStateSnapshot(owner.context) };
      delete snapshot.sqrtInterval;
      rows.push({
        family,
        mode,
        requestedDigits: digits,
        status,
        wallTimeMs,
        extractionMs,
        verifiedDigits: verified?.verifiedDigits ?? null,
        checkpoints,
        rssBytes: process.memoryUsage().rss,
        ...piInstrumentation(owner.context),
        snapshot
      });
      save();
      console.log(family, mode, digits, status, Math.round(wallTimeMs));
    }
  }
}
