// Persist each verified row outside timing, before any later interruption.
import { writeFileSync } from "node:fs";
import { cases } from "./e-candidates.mjs";
import { runAlgorithmComparison } from "./algorithm-harness.mjs";

const output = process.argv[2] ?? "benchmarks/results/ar-8-e.json";
const repetitions = Number(process.argv[3] ?? 2);
if (!Number.isSafeInteger(repetitions) || repetitions < 1) throw new Error("Invalid repetitions");
const rows = [];
// Keep all families in the same harness run so prefixes are cross-checked.
for (let repeat = 1; repeat <= repetitions; repeat++) {
  await runAlgorithmComparison({
    cases,
    precisionGrid: [1000, 3000, 10000, 30000],
    onRow(row) {
      rows.push({ repeat, ...row });
      writeFileSync(
        output,
        JSON.stringify({ node: process.version, platform: process.platform, rows }, null, 2) + "\n"
      );
      console.log(repeat, row.family, row.mode, row.requestedDigits, Math.round(row.wallTimeMs));
    }
  });
}
