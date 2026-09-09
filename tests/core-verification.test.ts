import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { internalFloatToRational } from "../src/core/backend/index.js";
import {
  ballToOutwardInterval,
  compareRational,
  createCalculationHandleFromSource,
  createEvaluationContext,
  createEvaluationGraphFromAst,
  createEvaluationGraphFromSource,
  createRational,
  createWorkerTransportHost,
  integerRational,
  parseExpression,
  verifiedNumberFromBall
} from "../src/core/index.js";
import type {
  Ball,
  EvaluationGraphContext,
  EvaluationSettings,
  Rational,
  VerifiedNumber
} from "../src/core/index.js";

interface ExactCase {
  readonly source: string;
  readonly expected: Rational;
  readonly settings?: Partial<EvaluationSettings>;
}

interface DifferentialCase {
  readonly source: string;
  readonly sign: -1 | 1;
  readonly digits: string;
  readonly exponent10: bigint;
  readonly settings?: Partial<EvaluationSettings>;
}

const EXACT_CASES: readonly ExactCase[] = [
  { source: "0", expected: integerRational(0n) },
  { source: "12,50", expected: createRational(25n, 2n) },
  { source: "1/3+1/6", expected: createRational(1n, 2n) },
  { source: "7/9-2/3", expected: createRational(1n, 9n) },
  { source: "(-4/7)*(21/8)", expected: createRational(-3n, 2n) },
  { source: "(5/6)/(10/9)", expected: createRational(3n, 4n) },
  { source: "-2^2", expected: integerRational(-4n) },
  { source: "(-2)^2", expected: integerRational(4n) },
  { source: "2^2^3", expected: integerRational(256n) },
  { source: "(2/3)^-3", expected: createRational(27n, 8n) },
  { source: "(4/9)^(1/2)", expected: createRational(2n, 3n) },
  { source: "(-8)^(1/3)", expected: integerRational(-2n) },
  { source: "(32/243)^(1/5)", expected: createRational(2n, 3n) },
  { source: "50%", expected: createRational(1n, 2n) },
  { source: "50%%", expected: createRational(1n, 200n) },
  { source: "(3!)%", expected: createRational(3n, 50n) },
  { source: "0!+5!", expected: integerRational(121n) },
  { source: "2(3+4)", expected: integerRational(14n) },
  { source: "(2+3)(4+5)", expected: integerRational(45n) },
  { source: "2/3(4+5)", expected: createRational(2n, 27n) },
  { source: "abs(-4/7)", expected: createRational(4n, 7n) },
  { source: "abs[0](-3)", expected: integerRational(-3n) },
  { source: "abs[2](-3)", expected: integerRational(3n) },
  { source: "exp(0)+ln(1)", expected: integerRational(1n) },
  { source: "log(1000)", expected: integerRational(3n) },
  { source: "log2(1/8)", expected: integerRational(-3n) },
  { source: "log1,5(3,375)", expected: integerRational(3n) },
  { source: "log{2+3}[2](3125)", expected: integerRational(1n) },
  {
    source: "sin(180)+cos(180)",
    expected: integerRational(-1n),
    settings: { angleMode: "degrees" }
  },
  { source: "tan(360)", expected: integerRational(0n), settings: { angleMode: "degrees" } },
  { source: "6!", expected: integerRational(720n), settings: { factorialMode: "gamma" } }
];

// Decimal reference points are copied from independent high-precision tables. More digits
// are retained than requested so truncation error is far below the tested Ball radius.
const DIFFERENTIAL_CASES: readonly DifferentialCase[] = [
  {
    source: "π",
    sign: 1,
    digits: "31415926535897932384626433832795028841971693993751",
    exponent10: 0n
  },
  {
    source: "e",
    sign: 1,
    digits: "27182818284590452353602874713526624977572470936999",
    exponent10: 0n
  },
  {
    source: "sin(1)",
    sign: 1,
    digits: "84147098480789650665250232163029899962256306079837",
    exponent10: -1n
  },
  {
    source: "abs(sin(-1))",
    sign: 1,
    digits: "84147098480789650665250232163029899962256306079837",
    exponent10: -1n
  },
  {
    source: "cos(1)",
    sign: 1,
    digits: "54030230586813971740093660744297660373231042061792",
    exponent10: -1n
  },
  {
    source: "tan(1)",
    sign: 1,
    digits: "15574077246549022305069748074583601730872507723815",
    exponent10: 0n
  },
  {
    source: "exp(1)",
    sign: 1,
    digits: "27182818284590452353602874713526624977572470936999",
    exponent10: 0n
  },
  {
    source: "ln(2)",
    sign: 1,
    digits: "69314718055994530941723212145817656807550013436025",
    exponent10: -1n
  },
  {
    source: "log(2)",
    sign: 1,
    digits: "30102999566398119521373889472449302676818988146211",
    exponent10: -1n
  },
  {
    source: "log{3}(2)",
    sign: 1,
    digits: "63092975357145743709952711434276085429958564013188",
    exponent10: -1n
  },
  {
    source: "2^(1/2)",
    sign: 1,
    digits: "14142135623730950488016887242096980785696718753769",
    exponent10: 0n
  },
  {
    source: "(1/3)!",
    sign: 1,
    digits: "8929795115692492112185643136582258813762",
    exponent10: -1n,
    settings: { factorialMode: "gamma" }
  },
  {
    source: "(-4/3)!",
    sign: -1,
    digits: "4062353818279201250835864084463541356557",
    exponent10: 0n,
    settings: { factorialMode: "gamma" }
  }
];

void describe("stage 36 end-to-end core verification", () => {
  void it("evaluates a broad parser-to-AST-to-exact-Rational table", () => {
    for (const testCase of EXACT_CASES) {
      const parsed = parseExpression(testCase.source);
      assert.equal(parsed.ok, true, testCase.source);
      const graph = createEvaluationGraphFromAst(
        parsed.ast,
        createEvaluationContext(contextOptions(testCase.settings))
      );
      const actual = graph.evaluate();

      assert.equal(actual.kind, "rational", testCase.source);
      assert.equal(actual.numerator, testCase.expected.numerator, testCase.source);
      assert.equal(actual.denominator, testCase.expected.denominator, testCase.source);
    }
  });

  void it("contains independent high-precision reference points for every approximate built-in", async () => {
    for (const testCase of DIFFERENTIAL_CASES) {
      const created = createEvaluationGraphFromSource(
        testCase.source,
        contextOptions(testCase.settings)
      );
      assert.equal(created.ok, true, testCase.source);
      const request = { significantDigits: 20 } as const;
      const ball = await created.graph.refine(request);
      const verified = verifiedNumberFromBall(ball, request, created.context.backend);
      const reference = decimalReference(testCase);

      assert.equal(verified.sign, testCase.sign, testCase.source);
      assert.equal(verified.exponent10, testCase.exponent10, testCase.source);
      assert.equal(verified.verifiedDigits >= request.significantDigits, true, testCase.source);
      assertBallContainsRational(ball, reference, created.context, testCase.source);
    }
  });

  void it("keeps verified digits monotonic through the canonical 10-to-1000 sequence", async () => {
    const created = createEvaluationGraphFromSource("sin(1)+ln(2)+2^(1/2)");
    assert.equal(created.ok, true);
    let previousDigits = "";
    let previousSign: VerifiedNumber["sign"] | null = null;
    let previousExponent: bigint | null = null;

    for (const significantDigits of [10, 20, 50, 100, 300, 1_000]) {
      const request = { significantDigits } as const;
      const ball = await created.graph.refine(request);
      const verified = verifiedNumberFromBall(ball, request, created.context.backend);

      assert.equal(verified.verifiedDigits >= significantDigits, true);
      assert.equal(verified.digits.startsWith(previousDigits), true);
      if (previousSign !== null && previousExponent !== null) {
        assert.equal(verified.sign, previousSign);
        assert.equal(verified.exponent10, previousExponent);
      }
      previousDigits = verified.digits;
      previousSign = verified.sign;
      previousExponent = verified.exponent10;
    }
  });

  void it("supports parameterized refinement beyond 1000 digits within the test budget", async () => {
    for (const source of ["ln(2)", "sin(1)", "2^(1/2)"]) {
      const created = createEvaluationGraphFromSource(source);
      assert.equal(created.ok, true, source);
      let prefix = "";

      for (const significantDigits of [1_200, 1_500]) {
        const request = { significantDigits } as const;
        const ball = await created.graph.refine(request);
        const verified = verifiedNumberFromBall(ball, request, created.context.backend);
        assert.equal(verified.verifiedDigits >= significantDigits, true, source);
        assert.equal(verified.digits.startsWith(prefix), true, source);
        prefix = verified.digits;
      }
    }
  });

  void it("does not treat the precision cutoff as a global built-in precision limit", async () => {
    for (const testCase of DIFFERENTIAL_CASES.filter(({ sign }) => sign > 0)) {
      const created = createEvaluationGraphFromSource(testCase.source, {
        settings: {
          ...testCase.settings,
          precisionCutoffDigits: 8
        }
      });
      assert.equal(created.ok, true, testCase.source);
      const request = { significantDigits: 20 } as const;
      const ball = await created.graph.refine(request);
      const verified = verifiedNumberFromBall(ball, request, created.context.backend);

      assert.equal(ball.precisionCutoff, undefined, testCase.source);
      assert.equal(verified.verifiedDigits >= request.significantDigits, true, testCase.source);
    }
  });

  void it("proves valid values adjacent to every restricted-domain boundary", async () => {
    const validCases: readonly DifferentialCase[] = [
      { source: "1/sin(1/1000000)", sign: 1, digits: "1000000166666", exponent10: 6n },
      { source: "ln(1/100000000000000000000)", sign: -1, digits: "4605170185988", exponent10: 1n },
      { source: "log{1+1/1000000}(2)", sign: 1, digits: "693147527133", exponent10: 5n },
      { source: "tan(π/2+1/1000000)", sign: -1, digits: "999999999999", exponent10: 5n },
      { source: "(-2)^(5/3)", sign: -1, digits: "317480210393", exponent10: 0n },
      {
        source: "(-1+1/100000000000000000000)!",
        sign: 1,
        digits: "999999999999",
        exponent10: 19n,
        settings: { factorialMode: "gamma" }
      }
    ];

    for (const testCase of validCases) {
      const created = createEvaluationGraphFromSource(
        testCase.source,
        contextOptions(testCase.settings)
      );
      assert.equal(created.ok, true, testCase.source);
      const request = { significantDigits: 10 } as const;
      const ball = await created.graph.refine(request);
      const verified = verifiedNumberFromBall(ball, request, created.context.backend);
      assert.equal(verified.sign, testCase.sign, testCase.source);
      assert.equal(verified.exponent10, testCase.exponent10, testCase.source);
      assert.equal(verified.verifiedDigits >= request.significantDigits, true, testCase.source);
    }

    const invalidCases = [
      { source: "1/0", code: "DivisionByZeroError", settings: {} },
      { source: "ln(0)", code: "DomainError", settings: {} },
      { source: "log{1}(2)", code: "DomainError", settings: {} },
      { source: "tan(90)", code: "DomainError", settings: { angleMode: "degrees" as const } },
      { source: "(-2)^(1/2)", code: "DomainError", settings: {} },
      { source: "(-1)!", code: "DomainError", settings: { factorialMode: "gamma" as const } }
    ];

    for (const testCase of invalidCases) {
      const parsed = parseExpression(testCase.source);
      assert.equal(parsed.ok, true, testCase.source);
      const graph = createEvaluationGraphFromAst(
        parsed.ast,
        createEvaluationContext({ settings: testCase.settings })
      );
      assert.throws(() => graph.evaluate(), { code: testCase.code }, testCase.source);
    }
  });

  void it("covers soft timeout, continue, cancel, and hard failure on real graphs", async () => {
    let ticks = 0;
    let advance = false;
    const created = createCalculationHandleFromSource("sin(1)+ln(2)+2^(1/2)", {
      now: () => (advance ? ticks++ : ticks),
      settings: { maxCalculationTimeMs: 3 }
    });
    assert.equal(created.ok, true);

    const first = await created.handle.refine({ significantDigits: 10 });
    assert.equal(first.status, "complete");
    ticks = 0;
    advance = true;
    const paused = await created.handle.refine({ significantDigits: 300 });
    assert.equal(paused.status, "paused");
    assert.equal(paused.verifiedDigits >= 10, true);

    ticks = 0;
    advance = false;
    const continued = await created.handle.continue();
    assert.equal(continued.status, "complete");
    assert.equal(continued.value.digits.startsWith(first.value.digits), true);

    const cancelled = createCalculationHandleFromSource("π");
    assert.equal(cancelled.ok, true);
    cancelled.handle.cancel();
    assert.equal((await cancelled.handle.refine({ significantDigits: 20 })).status, "cancelled");

    const limited = createCalculationHandleFromSource("π", {
      resourceLimits: { maxRequestedDigits: 5 }
    });
    assert.equal(limited.ok, true);
    const failed = await limited.handle.refine({ significantDigits: 6 });
    assert.equal(failed.status, "failed");
    assert.equal(failed.error.code, "ResourceLimitError");
  });

  void it("runs a mixed lazy expression through serializable Worker DTOs", async () => {
    const host = createWorkerTransportHost();
    const created = await host.handleCommand({
      type: "create",
      handleId: "stage-36",
      source: "sin(1)+ln(2)+2^(1/2)"
    });
    assert.equal(created.type, "created");

    const refined = await host.handleCommand({
      type: "refine",
      handleId: "stage-36",
      significantDigits: 50
    });
    assert.equal(refined.type, "complete");
    assert.equal(refined.value.verifiedDigits >= 50, true);
    assert.doesNotThrow(() => JSON.stringify(refined));
    assert.equal(typeof refined.value.exponent10, "string");
  });
});

function decimalReference(testCase: DifferentialCase): Rational {
  const integerDigits = BigInt(testCase.digits);
  const decimalShift = testCase.exponent10 - BigInt(testCase.digits.length - 1);
  const signedDigits = testCase.sign > 0 ? integerDigits : -integerDigits;
  return decimalShift >= 0n
    ? createRational(signedDigits * 10n ** decimalShift)
    : createRational(signedDigits, 10n ** -decimalShift);
}

function contextOptions(settings?: Partial<EvaluationSettings>) {
  return settings === undefined ? {} : { settings };
}

function assertBallContainsRational(
  ball: Ball,
  reference: Rational,
  context: EvaluationGraphContext,
  label: string
): void {
  const precisionBits = Math.max(ball.center.precisionBits, ball.radius.precisionBits);
  const interval = ballToOutwardInterval(ball, precisionBits, context.backend);
  const lower = internalFloatToRational(interval.lower);
  const upper = internalFloatToRational(interval.upper);

  assert.equal(compareRational(lower, reference) <= 0, true, `${label}: lower containment`);
  assert.equal(compareRational(reference, upper) <= 0, true, `${label}: upper containment`);
}
