import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CORE_PUBLIC_API_VERSION, CORE_STAGE, createCoreSmokeProbe } from "../src/core/index.js";

void describe("core public entrypoint", () => {
  void it("can be imported without browser APIs", () => {
    const probe = createCoreSmokeProbe();

    assert.equal(CORE_PUBLIC_API_VERSION, "0.0.0");
    assert.equal(CORE_STAGE, "stage-17");
    assert.deepEqual(probe, {
      apiVersion: CORE_PUBLIC_API_VERSION,
      stage: CORE_STAGE,
      browserApiFree: true
    });
  });
});
