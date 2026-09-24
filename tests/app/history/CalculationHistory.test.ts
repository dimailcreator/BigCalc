import { describe, expect, it } from "vitest";
import {
  ExpressionModel,
  createAnsToken,
  createCharacterToken
} from "../../../src/app/editor/ExpressionModel.js";
import {
  CalculationHistory,
  expressionSegmentsFromModel
} from "../../../src/app/history/CalculationHistory.js";

const settings = Object.freeze({
  angleMode: "degrees" as const,
  factorialMode: "integer" as const,
  maxCalculationTimeMs: 5_000
});

const value = Object.freeze({
  sign: 1 as const,
  digits: "5",
  exponent10: 0n,
  verifiedDigits: 1,
  valueExact: true,
  decimalTerminating: true,
  rounded: false
});

describe("CalculationHistory", () => {
  it("records only source snapshots and gathers nested reference closure", () => {
    let nextId = 1;
    const history = new CalculationHistory(() => `entry-${String(nextId++)}`);
    const first = history.record({
      expression: [{ kind: "source", source: "2+3" }],
      originalExpressionText: "2+3",
      displayedResultText: "5",
      settings,
      resultValue: value
    });
    const second = history.record({
      expression: [
        { kind: "reference", id: first.id },
        { kind: "source", source: "+1" }
      ],
      originalExpressionText: "5+1",
      displayedResultText: "6",
      settings: { ...settings, angleMode: "radians" },
      resultValue: { ...value, digits: "6" }
    });

    expect(history.entries).toHaveLength(2);
    expect(history.snapshotsFor([{ kind: "reference", id: second.id }])).toEqual([
      { id: second.id, expression: second.expression, settings: second.settings },
      { id: first.id, expression: first.expression, settings: first.settings }
    ]);
    expect(first.expression).toEqual([{ kind: "source", source: "2+3" }]);
    expect(second.expression).toEqual([
      { kind: "reference", id: first.id },
      { kind: "source", source: "+1" }
    ]);
  });

  it("maps editor tokens to source and identity-bearing references without decimal substitution", () => {
    const model = new ExpressionModel([
      createCharacterToken("2"),
      createCharacterToken("*"),
      createAnsToken("entry-17", "3,14159..."),
      createCharacterToken("+"),
      createAnsToken("entry-18", "0,5")
    ]);
    expect(expressionSegmentsFromModel(model)).toEqual([
      { kind: "source", source: "2*" },
      { kind: "reference", id: "entry-17" },
      { kind: "source", source: "+" },
      { kind: "reference", id: "entry-18" }
    ]);
  });

  it("rejects a duplicate stable ID and a missing reference", () => {
    const history = new CalculationHistory(() => "fixed-id");
    const input = {
      expression: [{ kind: "source" as const, source: "5" }],
      originalExpressionText: "5",
      displayedResultText: "5",
      settings,
      resultValue: value
    };
    history.record(input);
    expect(() => history.record(input)).toThrow(TypeError);
    expect(() => history.snapshotsFor([{ kind: "reference", id: "missing" }])).toThrow(TypeError);
  });

  it("restores nested references as editable tokens and updates only displayed data", () => {
    let nextId = 1;
    const original = new CalculationHistory(() => `entry-${String(nextId++)}`);
    const first = original.record({
      expression: [{ kind: "source", source: "1/3" }],
      originalExpressionText: "1/3",
      displayedResultText: "0,333",
      settings,
      resultValue: { ...value, digits: "333", exponent10: -1n, decimalTerminating: false }
    });
    const second = original.record({
      expression: [
        { kind: "reference", id: first.id },
        { kind: "source", source: "+1" }
      ],
      originalExpressionText: "0,333+1",
      displayedResultText: "1,333",
      settings,
      resultValue: { ...value, digits: "1333", decimalTerminating: false }
    });
    const restored = new CalculationHistory();
    restored.restore(
      original.entries.map((entry, index) => ({ ...entry, order: index === 0 ? 3 : 9 }))
    );
    const model = new ExpressionModel(restored.editableTokensFor(second.id));
    expect(expressionSegmentsFromModel(model)).toEqual(second.expression);
    expect(model.tokens[0]).toMatchObject({ kind: "ans", historyEntryId: first.id });
    restored.updateResult(first.id, { ...first.resultValue, verifiedDigits: 8 }, "0,33333333");
    expect(restored.get(first.id)?.expression).toEqual(first.expression);
    expect(restored.get(first.id)?.displayedResultText).toBe("0,33333333");
    expect(
      restored.record({
        expression: [{ kind: "source", source: "2" }],
        originalExpressionText: "2",
        displayedResultText: "2",
        settings,
        resultValue: { ...value, digits: "2" }
      }).order
    ).toBe(10);
  });
});
