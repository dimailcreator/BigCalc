import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BASE_PRECISION_GRID,
  HIGH_PRECISION_GRID,
  runAlgorithmComparison,
  serializeAlgorithmResults,
  validatePrecisionGrid
} from "./algorithm-harness.mjs";
import { productionCases } from "./production-candidates.mjs";

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 1) {
  const key = args[i];
  if (
    !["--grid", "--case", "--family", "--module", "--format", "--output", "--high"].includes(key) ||
    key in options
  )
    throw new Error(`Unknown or duplicate option: ${key}`);
  if (key === "--high") options[key] = true;
  else {
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing value: ${key}`);
    options[key] = args[++i];
  }
}
if (options["--high"] && options["--grid"]) throw new Error("Choose --high or --grid");
const precisionGrid = options["--grid"]
  ? options["--grid"].split(",").map(Number)
  : options["--high"]
    ? HIGH_PRECISION_GRID
    : BASE_PRECISION_GRID;
validatePrecisionGrid(precisionGrid);
const format = options["--format"] ?? "json";
if (!["json", "csv"].includes(format)) throw new Error("Format must be json or csv");
let cases = options["--module"]
  ? (await import(pathToFileURL(resolve(options["--module"])).href)).cases
  : productionCases;
if (options["--case"]) cases = cases.filter((item) => item.name === options["--case"]);
if (options["--family"])
  cases = cases
    .map((item) => ({
      ...item,
      candidates: item.candidates.filter((candidate) => candidate.family === options["--family"])
    }))
    .filter((item) => item.candidates.length);
if (!cases.length) throw new Error("No matching benchmark cases/families");
const rows = await runAlgorithmComparison({ cases, precisionGrid });
const output = serializeAlgorithmResults(rows, format);
if (options["--output"]) await writeFile(options["--output"], output, "utf8");
else process.stdout.write(output);
