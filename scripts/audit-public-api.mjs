import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(workspace, "package.json"), "utf8"));

assert.equal(packageJson.main, "./dist/core/api.js");
assert.equal(packageJson.types, "./dist/core/api.d.ts");
assert.deepEqual(Object.keys(packageJson.exports), ["."]);

const api = await import(packageJson.name);
assert.deepEqual(Object.keys(api).sort(), [
  "CORE_PUBLIC_API_VERSION",
  "CORE_STAGE",
  "DEFAULT_CALCULATION_SETTINGS",
  "createCalculationHandle",
  "createCoreSmokeProbe",
  "formatVerifiedNumber"
]);
await assert.rejects(() => import(`${packageJson.name}/core/index.js`), {
  code: "ERR_PACKAGE_PATH_NOT_EXPORTED"
});

const declarations = await collectDeclarationClosure(path.join(workspace, "dist/core/api.d.ts"));
for (const requiredType of [
  "CalculationHandle",
  "CalculationSettings",
  "PrecisionRequest",
  "RefinementResult",
  "VerifiedNumber",
  "CalcError"
]) {
  assert.match(declarations, new RegExp(`\\b${requiredType}\\b`));
}

for (const forbiddenName of [
  "BigFloatBackend",
  "InternalFloat",
  "NonNegativeInternalFloat",
  "Ball",
  "Rational",
  "LazyReal",
  "RealValue",
  "EvaluationGraph",
  "EvaluationNode",
  "Chudnovsky",
  "Stirling",
  "Spouge",
  "ScaledInterval",
  "Bernoulli",
  "MathComputationContext",
  "WorkerTransport",
  "HTMLElement",
  "Document",
  "postMessage"
]) {
  assert.doesNotMatch(declarations, new RegExp(`\\b${forbiddenName}\\b`));
}

process.stdout.write("Public API audit passed: package root and declaration closure are clean.\n");

async function collectDeclarationClosure(entry) {
  const visited = new Set();
  const chunks = [];

  async function visit(file) {
    const resolved = path.resolve(file);
    if (visited.has(resolved)) return;
    visited.add(resolved);

    const source = await readFile(resolved, "utf8");
    chunks.push(source);

    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const declarationPath = path.resolve(
        path.dirname(resolved),
        specifier.replace(/\.js$/, ".d.ts")
      );
      await visit(declarationPath);
    }
  }

  await visit(entry);
  return chunks.join("\n");
}
