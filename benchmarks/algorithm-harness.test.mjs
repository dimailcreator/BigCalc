import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  BASE_PRECISION_GRID,
  HIGH_PRECISION_GRID,
  createAlgorithmCounters,
  runAlgorithmComparison,
  serializeAlgorithmResults
} from "./algorithm-harness.mjs";
import { productionCases } from "./production-candidates.mjs";
import { BinaryFactorialE, cases as eCases } from "./e-candidates.mjs";

test("AR-8 candidates agree through sequential and direct refinement", async () => {
  const persisted = [];
  const rows = await runAlgorithmComparison({
    cases: eCases,
    precisionGrid: [30, 100, 300],
    onRow(row) {
      persisted.push(row);
    }
  });
  assert.equal(rows.length, 12);
  assert.deepEqual(persisted, rows);
});

test("AR-8 binary factorial encloses an independently accumulated tighter series", () => {
  // Sum k=0..100 with a common denominator, independently of affine splitting.
  let denominator = 1n;
  for (let k = 1n; k <= 100n; k++) denominator *= k;
  let factorial = 1n;
  let numerator = denominator;
  for (let k = 1n; k <= 100n; k++) {
    factorial *= k;
    numerator += denominator / factorial;
  }
  const candidate = new BinaryFactorialE();
  const bounds = candidate.getInterval(50, { checkpoint() {} });
  assert.ok(bounds.lower.numerator * denominator <= numerator * bounds.lower.denominator);
  assert.ok(
    bounds.upper.numerator * denominator * 101n >=
      (numerator * 101n + 2n) * bounds.upper.denominator
  );
  const blocks = candidate.blocks;
  candidate.getInterval(20, { checkpoint() {} });
  assert.equal(candidate.blocks, blocks);
});

test("AR-8 binary factorial resumes a suspended split without losing terms", () => {
  const candidate = new BinaryFactorialE();
  const paused = new Error("test pause");
  let remaining;
  const control = {
    checkpoint() {
      if (--remaining === 0) throw paused;
    }
  };
  let result;
  let pauses = 0;
  while (result === undefined) {
    remaining = 7;
    try {
      result = candidate.getInterval(100, control);
    } catch (error) {
      assert.equal(error, paused);
      pauses++;
    }
    assert.ok(pauses < 1000);
  }
  assert.ok(pauses > 0);
  assert.deepEqual(result, new BinaryFactorialE().getInterval(100, { checkpoint() {} }));
});

function fixture(events, corrupt = false) {
  return {
    name: "third",
    input: { numerator: "1", denominator: "3" },
    reference: async (digits) => verified("3".repeat(digits)),
    candidates: ["division", "recurrence"].map((family) => ({
      family,
      create(input, counters) {
        assert.deepEqual(input, { numerator: "1", denominator: "3" });
        events.push([family, "create"]);
        let prefix = "";
        let remainder = 1n;
        return {
          refine(digits) {
            events.push([family, digits]);
            counters.add("blockCount");
            counters.add("checkpointCount");
            counters.observe("workingDigits", digits + 2);
            if (family === "division") {
              counters.add("largeDivisions");
              counters.add("termCount", 1);
              prefix = (10n ** BigInt(digits) / 3n).toString();
            } else {
              while (prefix.length < digits) {
                remainder *= 10n;
                prefix += String(remainder / 3n);
                remainder %= 3n;
                counters.add("termCount");
                counters.add("largeDivisions");
              }
            }
            return corrupt && family === "recurrence" ? "4".repeat(digits) : prefix;
          },
          verify: (result) => verified(result),
          dispose() {
            events.push([family, "dispose"]);
          }
        };
      }
    }))
  };
}
function verified(digits) {
  return { digits, verifiedDigits: digits.length, sign: 1, exponent10: -1n };
}
const noMemory = () => null;

test("one harness compares distinct families, sequential state and fresh direct maximum", async () => {
  const events = [];
  let clock = 0;
  const rows = await runAlgorithmComparison({
    cases: [fixture(events)],
    precisionGrid: [3, 7, 12],
    now: () => clock++,
    memory: noMemory
  });
  assert.equal(rows.length, 8);
  assert.deepEqual(
    events.filter((event) => event[0] === "recurrence"),
    [
      ["recurrence", "create"],
      ["recurrence", 3],
      ["recurrence", 7],
      ["recurrence", 12],
      ["recurrence", "dispose"],
      ["recurrence", "create"],
      ["recurrence", 12],
      ["recurrence", "dispose"]
    ]
  );
  assert.deepEqual(
    rows.slice(4).map((row) => row.termCountDelta),
    [3, 4, 5, 12]
  );
  assert.deepEqual(
    rows.slice(4).map((row) => row.cumulativeWallTimeMs),
    [1, 2, 3, 1]
  );
  assert.equal(rows[0].largeMultiplications, null);
  assert.equal(rows[0].peakRSSBytes, null);
  assert.equal(rows[0].workingDigits, 5);
  assert.deepEqual(JSON.parse(serializeAlgorithmResults(rows, "json")), rows);
});

test("correctness checks use digits, never elapsed time; failures dispose sessions", async () => {
  const events = [];
  await assert.rejects(
    runAlgorithmComparison({
      cases: [fixture(events, true)],
      precisionGrid: [3],
      now: () => 1e12,
      memory: noMemory
    }),
    /prefix mismatch/
  );
  assert.deepEqual(events.at(-1), ["recurrence", "dispose"]);
  const item = fixture([]);
  item.candidates[0].create = () => ({ refine: () => null, verify: () => verified("3") });
  await assert.rejects(
    runAlgorithmComparison({ cases: [item], precisionGrid: [3] }),
    /Insufficient/
  );
});

test("sequential prefix regression is rejected even without independent reference", async () => {
  const item = fixture([]);
  delete item.reference;
  item.candidates = [
    {
      family: "broken",
      create: () => ({ refine: (n) => n, verify: (n) => verified((n === 3 ? "3" : "4").repeat(n)) })
    }
  ];
  await assert.rejects(
    runAlgorithmComparison({ cases: [item], precisionGrid: [3, 4] }),
    /prefix mismatch/
  );
});

test("metrics distinguish unsupported from zero, retain gauges, and reject invalid counts", () => {
  const counters = createAlgorithmCounters();
  counters.add("largeDivisions", 0);
  assert.equal(counters.snapshot().sqrtOperations, null);
  counters.add("sqrtOperations", 2);
  assert.equal(counters.snapshot().sqrtOperations, 2);
  counters.observe("workingDigits", 100);
  counters.observe("workingDigits", 30);
  counters.observe("retainedBigIntDigits", 50);
  counters.observe("retainedBigIntDigits", 10);
  assert.equal(counters.snapshot().largeDivisions, 0);
  assert.equal(counters.snapshot().largeMultiplications, null);
  assert.equal(counters.snapshot().workingDigits, 100);
  assert.equal(counters.snapshot().retainedBigIntDigits, 10);
  for (const value of [-1, NaN, Infinity, 0.5])
    assert.throws(() => counters.add("termCount", value));
  assert.throws(() => counters.add("unknown"));
  const copy = counters.snapshot();
  copy.termCount = 100;
  assert.equal(counters.snapshot().termCount, null);
});

test("invalid verified counts fail; exact terminating values need no artificial extra digits", async () => {
  const value = {
    ...verified("0"),
    sign: 0,
    exponent10: 0n,
    valueExact: true,
    decimalTerminating: true
  };
  const item = {
    name: "zero",
    input: {},
    candidates: [
      { family: "exact", create: () => ({ refine: () => value, verify: (result) => result }) }
    ]
  };
  assert.equal(
    (await runAlgorithmComparison({ cases: [item], precisionGrid: [10, 20] })).length,
    3
  );
  value.verifiedDigits = NaN;
  await assert.rejects(
    runAlgorithmComparison({ cases: [item], precisionGrid: [10] }),
    /invalid verified result/
  );
});

test("precision grid validation and opt-in high grid have no 10000 ceiling", async () => {
  assert.deepEqual(BASE_PRECISION_GRID, [100, 300, 1000, 3000, 10000]);
  assert.deepEqual(HIGH_PRECISION_GRID.slice(-2), [30000, 100000]);
  for (const precisionGrid of [[], [0], [3, 3], [4, 3], [NaN], [1.5]]) {
    await assert.rejects(runAlgorithmComparison({ cases: [], precisionGrid }), /Precision grid/);
  }
});

test("CSV quotes separators, quotes and newlines; null stays empty", () => {
  assert.equal(
    serializeAlgorithmResults([{ family: 'a,"b"\nc', termCount: null }], "csv"),
    '"family","termCount"\r\n"a,""b""\nc",\r\n'
  );
  assert.throws(() => serializeAlgorithmResults([], "xml"));
});

test("production adapters provide real verified refinement and provider counters", async () => {
  const cases = productionCases.filter((item) => ["pi", "e", "ln2", "exp"].includes(item.name));
  const rows = await runAlgorithmComparison({ cases, precisionGrid: [10, 20], memory: noMemory });
  assert.equal(rows.length, 12);
  const pi = rows.find((row) => row.operation === "pi");
  assert.ok(pi.termCount > 0);
  assert.ok(pi.blockCount > 0);
  assert.ok(pi.workingDigits >= 10);
  assert.ok(pi.checkpointCount > 0);
  assert.equal(rows.find((row) => row.operation === "exp").termCount, null);
});

test("production pi counters remain cumulative across the AGM routing boundary", async () => {
  const cases = productionCases.filter((item) => item.name === "pi");
  const rows = await runAlgorithmComparison({
    cases,
    precisionGrid: [100, 3000],
    memory: noMemory
  });
  assert.equal(rows.length, 3);
  assert.ok(rows[1].termCount >= rows[0].termCount);
  assert.equal(rows[1].blockCount, null);
});

test("CLI emits parseable JSON and rejects invalid selections/options before work", () => {
  const output = execFileSync(
    process.execPath,
    ["benchmarks/algorithm-comparison.mjs", "--case", "ln2", "--grid", "10,20"],
    { encoding: "utf8" }
  );
  assert.equal(JSON.parse(output).length, 3);
  for (const args of [
    ["--case", "missing"],
    ["--grid", "20,10"],
    ["--format", "xml"],
    ["--unknown"]
  ]) {
    assert.throws(() =>
      execFileSync(process.execPath, ["benchmarks/algorithm-comparison.mjs", ...args], {
        stdio: "pipe"
      })
    );
  }
});
