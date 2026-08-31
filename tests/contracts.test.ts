import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ambiguousIdentifierError,
  cancelledError,
  divisionByZeroError,
  domainError,
  internalCalculationError,
  precisionError,
  registryConfigurationError,
  resourceLimitError,
  syntaxError,
  unknownIdentifierError
} from "../src/core/index.js";
import type {
  Ball,
  LazyReal,
  Rational,
  RealValue,
  RefinementResult,
  VerifiedNumber
} from "../src/core/index.js";

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

function realValueKind(value: RealValue): "rational" | "lazy-real" {
  switch (value.kind) {
    case "rational":
      return value.denominator === 1n ? "rational" : "rational";
    case "lazy-real":
      return "lazy-real";
    default:
      return assertNever(value);
  }
}

function resultStatus(result: RefinementResult): string {
  switch (result.status) {
    case "complete":
      return `complete:${String(result.value.verifiedDigits)}`;
    case "paused":
      return `paused:${result.reason}:${String(result.verifiedDigits)}`;
    case "cancelled":
      return `cancelled:${String(result.verifiedDigits)}`;
    case "failed":
      return `failed:${result.error.code}`;
    default:
      return assertNever(result);
  }
}

function assertStructuredData(value: unknown): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return;
  }

  assert.notEqual(typeof value, "function");
  assert.notEqual(typeof value, "symbol");

  if (Array.isArray(value)) {
    for (const item of value) {
      assertStructuredData(item);
    }
    return;
  }

  assert.equal(typeof value, "object");
  assert.equal(Object.getPrototypeOf(value), Object.prototype);

  for (const item of Object.values(value as Record<string, unknown>)) {
    assertStructuredData(item);
  }
}

const zeroInternalFloat = {
  kind: "internal-float",
  sign: 0,
  significand: 0n,
  exponent: 0n,
  precisionBits: 1
} as const;

void describe("stage 1 contracts", () => {
  void it("distinguishes Rational and LazyReal through RealValue.kind", async () => {
    const rational: Rational = {
      kind: "rational",
      numerator: 1n,
      denominator: 3n
    };

    const exactZeroBall: Ball = {
      kind: "ball",
      center: zeroInternalFloat,
      radius: zeroInternalFloat
    };

    const lazyReal: LazyReal = {
      kind: "lazy-real",
      refine() {
        return Promise.resolve(exactZeroBall);
      }
    };

    assert.equal(realValueKind(rational), "rational");
    assert.equal(realValueKind(lazyReal), "lazy-real");
    assert.deepEqual(
      await lazyReal.refine(
        { significantDigits: 10 },
        {
          settings: {
            angleMode: "radians",
            factorialMode: "integer",
            maxCalculationTimeMs: 1000
          }
        }
      ),
      exactZeroBall
    );
  });

  void it("represents ExactZero and RoundedZero in VerifiedNumber metadata", () => {
    const exactZero: VerifiedNumber = {
      sign: 0,
      digits: "0",
      exponent10: 0n,
      verifiedDigits: 1,
      valueExact: true,
      decimalTerminating: true,
      rounded: false,
      zeroKind: "exact"
    };

    const roundedZero: VerifiedNumber = {
      sign: 0,
      digits: "0",
      exponent10: 0n,
      verifiedDigits: 1,
      valueExact: false,
      decimalTerminating: false,
      rounded: true,
      zeroKind: "rounded"
    };

    assert.equal(exactZero.zeroKind, "exact");
    assert.equal(roundedZero.zeroKind, "rounded");
    assertStructuredData(exactZero);
    assertStructuredData(roundedZero);
  });

  void it("narrows RefinementResult by status", () => {
    const value: VerifiedNumber = {
      sign: 1,
      digits: "123",
      exponent10: 0n,
      verifiedDigits: 3,
      valueExact: true,
      decimalTerminating: true,
      rounded: false
    };

    const results: readonly RefinementResult[] = [
      { status: "complete", requestedDigits: 3, value },
      {
        status: "paused",
        reason: "time-limit",
        requestedDigits: 10,
        verifiedDigits: 3,
        partial: value
      },
      { status: "cancelled", requestedDigits: 10, verifiedDigits: 3, partial: value },
      { status: "failed", error: divisionByZeroError(), requestedDigits: 10, partial: null }
    ];

    assert.deepEqual(results.map(resultStatus), [
      "complete:3",
      "paused:time-limit:3",
      "cancelled:3",
      "failed:DivisionByZeroError"
    ]);
  });

  void it("keeps public result and error shapes structured", () => {
    const errors = [
      syntaxError("Unexpected token", { start: 0, end: 1 }),
      unknownIdentifierError("foo"),
      ambiguousIdentifierError("sincos", ["sin", "cos"]),
      domainError("ln"),
      divisionByZeroError(),
      precisionError("Cannot prove requested digits", 100),
      resourceLimitError("hard-watchdog", "Hard resource limit reached"),
      cancelledError(),
      internalCalculationError("Invariant violation"),
      registryConfigurationError(
        "ReservedNameOverride",
        "Built-in name cannot be overridden",
        "sin"
      )
    ];

    for (const error of errors) {
      assertStructuredData(error);
    }

    assert.equal(errors[0]?.kind, "calc-error");
    assert.equal(errors[9]?.kind, "registry-configuration-error");
  });
});
