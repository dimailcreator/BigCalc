import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createEvaluationSettings,
  createHistoryService,
  formatVerifiedNumber
} from "../src/core/index.js";
import type { HistoryEntry } from "../src/core/index.js";

void describe("history semantics and Ans", () => {
  void it("keeps saved evaluation settings independent from current settings", async () => {
    const history = createHistoryService();
    const entry = history.recordCalculation({
      originalExpression: "sin(30)",
      displayedResultText: "0,5",
      settings: createEvaluationSettings({ angleMode: "degrees" })
    });
    assert.equal(entry.id, "history-1");
    assert.equal(history.getEntry(entry.id), entry);

    const created = history.createCalculationHandleFromAns({
      settings: { angleMode: "radians" }
    });
    assert.equal(created.ok, true);
    assert.equal(created.entry.id, entry.id);

    const result = await created.handle.refine({ significantDigits: 1 });
    assert.equal(result.status, "complete");
    assert.equal(result.value.sign, 1);
    assert.equal(result.value.digits, "5");
    assert.equal(result.value.exponent10, -1n);
  });

  void it("uses the original expression for Ans instead of displayed text", async () => {
    const history = createHistoryService();
    history.recordCalculation({
      originalExpression: "1/7",
      displayedResultText: "0,142",
      settings: createEvaluationSettings()
    });

    const created = history.createCalculationHandleFromSourceWithAns("Ans+0");
    assert.equal(created.ok, true);

    const result = await created.handle.refine({ significantDigits: 20 });
    assert.equal(result.status, "complete");
    assert.equal(result.value.digits, "14285714285714285714");
    assert.equal(result.value.exponent10, -1n);
  });

  void it("re-evaluates history entries without requiring old lazy-state", async () => {
    const history = createHistoryService();
    const entry = history.recordCalculation({
      originalExpression: "π",
      displayedResultText: "3,14...",
      settings: createEvaluationSettings()
    });

    assertHistoryEntryDto(entry);

    const created = history.createCalculationHandleFromHistoryEntry(entry.id);
    assert.equal(created.ok, true);
    assert.equal(created.entry.id, entry.id);
    assert.notEqual(created.graph, undefined);

    const result = await created.handle.refine({ significantDigits: 12 });
    assert.equal(result.status, "complete");
    assert.equal(formatVerifiedNumber(result.value).text.startsWith("3,14159265358"), true);
  });
});

function assertHistoryEntryDto(entry: HistoryEntry): void {
  const keys = Object.keys(entry).sort();

  assert.deepEqual(keys, ["displayedResultText", "id", "originalExpression", "settings"]);
}
