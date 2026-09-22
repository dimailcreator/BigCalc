import { performance } from "node:perf_hooks";

export const BASE_PRECISION_GRID = Object.freeze([100, 300, 1000, 3000, 10000]);
export const HIGH_PRECISION_GRID = Object.freeze([...BASE_PRECISION_GRID, 30000, 100000]);
const counts = [
  "termCount",
  "blockCount",
  "largeMultiplications",
  "largeDivisions",
  "sqrtOperations",
  "checkpointCount"
];
const gauges = ["workingDigits", "peakBigIntDigits", "retainedBigIntDigits"];

// Candidate-local, optional instrumentation. Unknown is null, never a proxy or zero.
// Kernels can receive these callbacks through their benchmark adapter; Core API is unaffected.
export function createAlgorithmCounters() {
  const values = Object.fromEntries([...counts, ...gauges].map((key) => [key, null]));
  function validate(key, value, allowed) {
    if (!allowed.includes(key) || !Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`Invalid algorithm metric: ${key}=${value}`);
    }
  }
  return {
    add(key, amount = 1) {
      validate(key, amount, counts);
      const next = (values[key] ?? 0) + amount;
      validate(key, next, counts);
      values[key] = next;
    },
    observe(key, value) {
      validate(key, value, gauges);
      values[key] = key === "retainedBigIntDigits" ? value : Math.max(values[key] ?? 0, value);
    },
    snapshot() {
      return { ...values };
    }
  };
}

export function validatePrecisionGrid(grid) {
  if (
    !Array.isArray(grid) ||
    grid.length === 0 ||
    grid.some((n, i) => !Number.isSafeInteger(n) || n <= 0 || (i > 0 && n <= grid[i - 1]))
  ) {
    throw new TypeError("Precision grid must contain strictly increasing positive safe integers");
  }
}

function assertVerified(value, requested) {
  if (
    !value ||
    !Number.isSafeInteger(value.verifiedDigits) ||
    value.verifiedDigits <= 0 ||
    typeof value.digits !== "string" ||
    value.verifiedDigits > value.digits.length ||
    (value.verifiedDigits < requested && !(value.valueExact && value.decimalTerminating)) ||
    !/^[0-9]+$/.test(value.digits) ||
    ![-1, 0, 1].includes(value.sign) ||
    typeof value.exponent10 !== "bigint"
  ) {
    throw new Error(`Insufficient or invalid verified result at ${requested} digits`);
  }
}

function assertSamePrefix(a, b, digits) {
  if (
    a.sign !== b.sign ||
    a.exponent10 !== b.exponent10 ||
    a.digits.slice(0, digits).padEnd(digits, "0") !== b.digits.slice(0, digits).padEnd(digits, "0")
  ) {
    throw new Error(`Verified prefix mismatch at ${digits} digits`);
  }
}

/**
 * A case owns the common input; candidates only select the algorithm family.
 * create(input, counters) returns { refine(digits), verify(result, digits), snapshot?(), dispose?() }.
 * refine returns an opaque mathematical result; verify extracts a Core VerifiedNumber outside timing.
 * snapshot returns cumulative counters and gauges, optionally overriding callback instrumentation.
 * reference(digits), when provided, supplies independently obtained verified digits outside timing.
 * onRow(row) is awaited after validation, outside timing, for incremental result persistence.
 */
export async function runAlgorithmComparison({
  cases,
  precisionGrid = BASE_PRECISION_GRID,
  onRow = () => {},
  now = () => performance.now(),
  memory = () => ({
    rssBytes: process.memoryUsage().rss,
    peakRSSBytes: process.resourceUsage().maxRSS * 1024
  }),
  collectGarbage = () => globalThis.gc?.()
}) {
  validatePrecisionGrid(precisionGrid);
  const rows = [];
  const names = new Set();
  for (const item of cases) {
    if (!item.name || names.has(item.name) || !item.candidates?.length)
      throw new TypeError("Invalid benchmark case");
    names.add(item.name);
    const families = new Set();
    const expected = new Map();
    if (item.reference) {
      for (const digits of precisionGrid) {
        const value = await item.reference(digits);
        assertVerified(value, digits);
        expected.set(digits, value);
      }
    }
    for (const candidate of item.candidates) {
      if (!candidate.family || families.has(candidate.family))
        throw new TypeError("Duplicate or empty algorithm family");
      families.add(candidate.family);
      for (const mode of ["sequential", "direct"]) {
        const counters = createAlgorithmCounters();
        // A fresh session owns all mutable caches for each family and each mode.
        const session = await candidate.create(structuredClone(item.input), counters);
        let previous;
        let previousMetrics = Object.fromEntries(counts.map((key) => [key, 0]));
        let cumulativeWallTimeMs = 0;
        try {
          for (const requestedDigits of mode === "direct"
            ? [precisionGrid.at(-1)]
            : precisionGrid) {
            collectGarbage();
            const started = now();
            const result = await session.refine(requestedDigits);
            const wallTimeMs = now() - started;
            cumulativeWallTimeMs += wallTimeMs;
            // Record process observations before extraction/snapshot allocations and GC.
            const observedMemory = memory();
            const metrics = { ...counters.snapshot(), ...session.snapshot?.() };
            const extractionStarted = now();
            const verified = await session.verify(result, requestedDigits);
            const extractionMs = now() - extractionStarted;
            assertVerified(verified, requestedDigits);
            if (previous) assertSamePrefix(previous.value, verified, previous.digits);
            if (expected.has(requestedDigits))
              assertSamePrefix(expected.get(requestedDigits), verified, requestedDigits);
            else expected.set(requestedDigits, verified);
            previous = { value: verified, digits: requestedDigits };
            const row = {
              operation: item.name,
              input: JSON.stringify(item.input),
              family: candidate.family,
              mode,
              requestedDigits,
              wallTimeMs,
              cumulativeWallTimeMs,
              extractionMs,
              workingDigits: metrics.workingDigits,
              termCount: metrics.termCount,
              blockCount: metrics.blockCount,
              largeMultiplications: metrics.largeMultiplications,
              largeDivisions: metrics.largeDivisions,
              sqrtOperations: metrics.sqrtOperations,
              checkpointCount: metrics.checkpointCount,
              peakBigIntDigits: metrics.peakBigIntDigits,
              retainedBigIntDigits: metrics.retainedBigIntDigits,
              rssBytes: observedMemory?.rssBytes ?? null,
              peakRSSBytes: observedMemory?.peakRSSBytes ?? null
            };
            for (const key of [...counts, ...gauges]) {
              const value = metrics[key];
              if (value !== null && (!Number.isSafeInteger(value) || value < 0))
                throw new TypeError(`Invalid snapshot metric: ${key}`);
              if (counts.includes(key)) {
                if (value !== null && previousMetrics[key] !== null && value < previousMetrics[key])
                  throw new Error(`Counter regressed: ${key}`);
                row[`${key}Delta`] =
                  value === null || previousMetrics[key] === null
                    ? null
                    : value - previousMetrics[key];
              }
            }
            previousMetrics = metrics;
            rows.push(row);
            await onRow(row);
          }
        } finally {
          await session.dispose?.();
        }
      }
    }
  }
  return rows;
}

export function serializeAlgorithmResults(rows, format) {
  if (format === "json") return `${JSON.stringify(rows, null, 2)}\n`;
  if (format !== "csv") throw new TypeError(`Unknown output format: ${format}`);
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => (value == null ? "" : `"${String(value).replaceAll('"', '""')}"`);
  return (
    [
      columns.map(escape).join(","),
      ...rows.map((row) => columns.map((key) => escape(row[key])).join(","))
    ].join("\r\n") + "\r\n"
  );
}
