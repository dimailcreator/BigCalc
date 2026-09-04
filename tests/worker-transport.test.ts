import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWorkerTransportHost } from "../src/core/index.js";
import type { WorkerTransportResponse } from "../src/core/index.js";

void describe("worker-compatible calculation transport", () => {
  void it("runs sequential refine calls through a serializable DTO protocol", async () => {
    const host = createWorkerTransportHost();

    const created = await host.handleCommand({ type: "create", handleId: "pi", source: "π" });
    assertSerializableDto(created);
    assert.deepEqual(created, {
      type: "created",
      handleId: "pi"
    });
    assert.equal(host.activeHandleCount, 1);

    const first = await host.handleCommand({
      type: "refine",
      handleId: "pi",
      significantDigits: 10
    });
    assertSerializableDto(first);
    assert.equal(first.type, "complete");
    assert.equal(first.value.digits.startsWith("3141592653"), true);
    assert.equal(first.value.exponent10, "0");

    const second = await host.handleCommand({
      type: "refine",
      handleId: "pi",
      significantDigits: 20
    });
    assertSerializableDto(second);
    assert.equal(second.type, "complete");
    assert.equal(second.value.digits.startsWith(first.value.digits), true);
    assert.equal(second.value.verifiedDigits >= 20, true);
  });

  void it("preserves worker-side graph state across pause and continue", async () => {
    let ticks = 0;
    let advance = false;
    const host = createWorkerTransportHost({ now: () => (advance ? ticks++ : ticks) });

    const created = await host.handleCommand({
      type: "create",
      handleId: "slow",
      source: "π",
      options: { settings: { maxCalculationTimeMs: 3 } }
    });
    assert.equal(created.type, "created");

    const first = await host.handleCommand({
      type: "refine",
      handleId: "slow",
      significantDigits: 10
    });
    assert.equal(first.type, "complete");

    ticks = 0;
    advance = true;
    const paused = await host.handleCommand({
      type: "refine",
      handleId: "slow",
      significantDigits: 1000
    });
    assert.equal(paused.type, "paused");
    assert.notEqual(paused.partial, null);
    assert.equal(paused.partial?.digits, first.value.digits);

    ticks = 0;
    advance = false;
    const continued = await host.handleCommand({ type: "continue", handleId: "slow" });
    assertSerializableDto(continued);
    assert.equal(continued.type, "complete");
    assert.equal(continued.value.verifiedDigits >= 1000, true);
  });

  void it("cancels handles through transport without exposing the handle object", async () => {
    const host = createWorkerTransportHost();

    assert.equal(
      (await host.handleCommand({ type: "create", handleId: "cancel-me", source: "1/3" })).type,
      "created"
    );

    const cancelled = await host.handleCommand({ type: "cancel", handleId: "cancel-me" });
    assertSerializableDto(cancelled);
    assert.equal(cancelled.type, "cancelled");

    const refined = await host.handleCommand({
      type: "refine",
      handleId: "cancel-me",
      significantDigits: 8
    });
    assert.equal(refined.type, "cancelled");
  });

  void it("keeps multiple worker-side handles independent", async () => {
    const host = createWorkerTransportHost();

    assert.equal(
      (await host.handleCommand({ type: "create", handleId: "third", source: "1/3" })).type,
      "created"
    );
    assert.equal(
      (await host.handleCommand({ type: "create", handleId: "seventh", source: "1/7" })).type,
      "created"
    );
    assert.equal(host.activeHandleCount, 2);

    const third = await host.handleCommand({
      type: "refine",
      handleId: "third",
      significantDigits: 12
    });
    const seventh = await host.handleCommand({
      type: "refine",
      handleId: "seventh",
      significantDigits: 12
    });

    assert.equal(third.type, "complete");
    assert.equal(seventh.type, "complete");
    assert.equal(third.value.digits, "333333333333");
    assert.equal(seventh.value.digits, "142857142857");
  });

  void it("cleans up disposed handles", async () => {
    const host = createWorkerTransportHost();

    assert.equal(
      (await host.handleCommand({ type: "create", handleId: "tmp", source: "2" })).type,
      "created"
    );
    assert.equal(host.activeHandleCount, 1);

    const disposed = await host.handleCommand({ type: "dispose", handleId: "tmp" });
    assertSerializableDto(disposed);
    assert.deepEqual(disposed, {
      type: "disposed",
      handleId: "tmp"
    });
    assert.equal(host.activeHandleCount, 0);

    const refined = await host.handleCommand({
      type: "refine",
      handleId: "tmp",
      significantDigits: 1
    });
    assert.equal(refined.type, "failed");
    assert.equal(refined.error.code, "InternalCalculationError");
  });
});

function assertSerializableDto(response: WorkerTransportResponse): void {
  assert.doesNotThrow(() => JSON.stringify(response));
  assertStructuredCloneableData(response);
}

function assertStructuredCloneableData(value: unknown): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return;
  }

  assert.notEqual(typeof value, "bigint");
  assert.notEqual(typeof value, "function");
  assert.notEqual(typeof value, "symbol");

  if (Array.isArray(value)) {
    for (const item of value) {
      assertStructuredCloneableData(item);
    }
    return;
  }

  assert.equal(typeof value, "object");
  assert.equal(Object.getPrototypeOf(value), Object.prototype);

  for (const item of Object.values(value as Record<string, unknown>)) {
    assertStructuredCloneableData(item);
  }
}
