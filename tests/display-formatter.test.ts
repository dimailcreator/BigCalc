import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatVerifiedNumber } from "../src/core/index.js";
import type { VerifiedNumber } from "../src/core/index.js";

void describe("display formatter boundary", () => {
  void it("places the decimal comma for ordinary values", () => {
    assert.deepEqual(formatVerifiedNumber(verified({ digits: "313319591", exponent10: 2n })), {
      text: "313,319591...",
      notation: "plain",
      usedVerifiedDigits: 9
    });
  });

  void it("handles negative decimal exponents in plain notation", () => {
    assert.equal(
      formatVerifiedNumber(verified({ digits: "4", exponent10: -4n, exact: true })).text,
      "0,0004"
    );
    assert.equal(
      formatVerifiedNumber(verified({ sign: -1, digits: "125", exponent10: -1n, exact: true }))
        .text,
      "-0,125"
    );
  });

  void it("formats exact zero and rounded zero distinctly without invented digits", () => {
    assert.deepEqual(formatVerifiedNumber(zero("exact")), {
      text: "0",
      notation: "plain",
      usedVerifiedDigits: 0
    });
    assert.deepEqual(formatVerifiedNumber(zero("rounded")), {
      text: "...0",
      notation: "plain",
      usedVerifiedDigits: 0
    });
  });

  void it("uses scientific notation beyond the display threshold", () => {
    assert.deepEqual(
      formatVerifiedNumber(verified({ digits: "28284", exponent10: 136n }), {
        scientificNotationThreshold: 6
      }),
      {
        text: "2,8284E136",
        notation: "scientific",
        usedVerifiedDigits: 5
      }
    );
  });

  void it("does not append unverified significant digits", () => {
    const formatted = formatVerifiedNumber(verified({ digits: "1234", exponent10: 5n }), {
      scientificNotationThreshold: 12
    });

    assert.equal(formatted.text, "1234...");
    assert.equal(formatted.usedVerifiedDigits, 4);
  });

  void it("pads only exact terminating positional zeros", () => {
    assert.equal(
      formatVerifiedNumber(verified({ digits: "12", exponent10: 3n, exact: true })).text,
      "1200"
    );
  });
});

function verified(options: {
  readonly sign?: -1 | 1;
  readonly digits: string;
  readonly exponent10: bigint;
  readonly exact?: boolean;
}): VerifiedNumber {
  return Object.freeze({
    sign: options.sign ?? 1,
    digits: options.digits,
    exponent10: options.exponent10,
    verifiedDigits: options.digits.length,
    valueExact: options.exact ?? false,
    decimalTerminating: options.exact ?? false,
    rounded: false
  });
}

function zero(zeroKind: "exact" | "rounded"): VerifiedNumber {
  return Object.freeze({
    sign: 0,
    digits: "",
    exponent10: 0n,
    verifiedDigits: 0,
    valueExact: zeroKind === "exact",
    decimalTerminating: true,
    rounded: zeroKind === "rounded",
    zeroKind
  });
}
