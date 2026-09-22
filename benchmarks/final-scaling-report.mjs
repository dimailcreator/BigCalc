import { readFileSync, writeFileSync } from "node:fs";
import { compareScalingRows } from "./scaling-comparison.mjs";

const rows = compareScalingRows(
  JSON.parse(readFileSync(process.argv[2], "utf8")),
  JSON.parse(readFileSync(process.argv[3], "utf8"))
);
writeFileSync(process.argv[4], JSON.stringify(rows, null, 2) + "\n");
const show = (value) => (value === null ? "—" : value.toFixed(3));
console.log(
  "| Operation | Digits | Baseline ms | Post ms | Time ratio | RSS ratio | Checkpoint ratio | Strategy |\n|---|---:|---:|---:|---:|---:|---:|---|"
);
for (const row of rows.filter(
  (row) =>
    row.mode === "sequential" &&
    !rows.some(
      (other) =>
        other.operation === row.operation && other.mode === row.mode && other.digits > row.digits
    )
)) {
  const selected = row.algorithmSelected?.map((s) => `${s.operation}:${s.strategy}`).join(", ");
  const routes =
    row.operation === "ln2"
      ? `ln2 binary splitting; ${selected ?? ""}`
      : selected || "local nth-root router";
  console.log(
    `| ${row.operation} | ${row.digits} | ${show(row.baselineMs)} | ${show(row.postMs)} | ${show(row.timeRatio)} | ${show(row.rssRatio)} | ${show(row.checkpointRatio)} | ${row.specialGamma ? "special Gamma; " : ""}${routes} |`
  );
}
