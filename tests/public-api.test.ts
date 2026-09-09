import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as api from "../src/core/api.js";
import type { CalculationOptions, CalculationSettings, RefinementResult } from "../src/core/api.js";

void describe("stage 38 frozen public API", () => {
  void it("exports only the documented runtime surface", () => {
    assert.deepEqual(Object.keys(api).sort(), [
      "CORE_PUBLIC_API_VERSION",
      "CORE_STAGE",
      "DEFAULT_CALCULATION_SETTINGS",
      "createCalculationHandle",
      "createCoreSmokeProbe",
      "formatVerifiedNumber"
    ]);
    assert.equal(api.CORE_PUBLIC_API_VERSION, "1.0.0");
    assert.equal(api.CORE_STAGE, "stage-38");
  });

  void it("creates and refines a calculation using only public settings", async () => {
    const options = {
      settings: {
        angleMode: "degrees",
        factorialMode: "gamma",
        maxCalculationTimeMs: 1_000
      }
    } satisfies CalculationOptions;
    const created = api.createCalculationHandle("sin(30)+(-1/2)!", options);

    if (!created.ok) assert.fail(created.error.message);

    const result = await created.handle.refine({ significantDigits: 20 });
    assertRefinementResult(result);
    if (result.status !== "complete") assert.fail(`Expected complete, got ${result.status}`);
    assert.equal(result.value.verifiedDigits >= 20, true);
    assert.equal(api.formatVerifiedNumber(result.value).text.length > 0, true);
  });

  void it("returns typed parse and mathematical errors without exposing internals", async () => {
    const syntaxFailure = api.createCalculationHandle("1+");
    if (syntaxFailure.ok) assert.fail("Expected syntax failure");
    assert.equal(syntaxFailure.error.code, "SyntaxError");

    const created = api.createCalculationHandle("1/0");
    if (!created.ok) assert.fail(created.error.message);
    const result = await created.handle.refine({ significantDigits: 10 });
    if (result.status !== "failed") assert.fail(`Expected failure, got ${result.status}`);
    assert.equal(result.error.code, "DivisionByZeroError");
  });

  void it("supports pause and cancellation through the public handle", async () => {
    const pausing = api.createCalculationHandle("π", {
      settings: { maxCalculationTimeMs: 0 }
    });
    if (!pausing.ok) assert.fail(pausing.error.message);
    const paused = await pausing.handle.refine({ significantDigits: 1_000 });
    if (paused.status !== "paused") assert.fail(`Expected pause, got ${paused.status}`);
    const continued = await pausing.handle.continue();
    assert.equal(continued.status, "paused");

    const cancelling = api.createCalculationHandle("π");
    if (!cancelling.ok) assert.fail(cancelling.error.message);
    cancelling.handle.cancel();
    const cancelled = await cancelling.handle.refine({ significantDigits: 20 });
    assert.equal(cancelled.status, "cancelled");
  });

  void it("rejects invalid runtime settings at the public boundary", () => {
    assert.throws(
      () =>
        api.createCalculationHandle("1", {
          settings: { maxCalculationTimeMs: Number.POSITIVE_INFINITY }
        }),
      RangeError
    );
  });
});

type PublicSettingKey = keyof CalculationSettings;
type ExpectedSettingKey = "angleMode" | "factorialMode" | "maxCalculationTimeMs";
const publicSettingsAreExact: Record<PublicSettingKey, true> = {
  angleMode: true,
  factorialMode: true,
  maxCalculationTimeMs: true
};
const expectedSettingsAreExact: Record<ExpectedSettingKey, true> = publicSettingsAreExact;
void expectedSettingsAreExact;

function assertRefinementResult(result: RefinementResult): void {
  assert.equal(["complete", "paused", "cancelled", "failed"].includes(result.status), true);
}
