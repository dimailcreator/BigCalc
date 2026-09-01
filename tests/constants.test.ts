import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { internalFloatToRational } from "../src/core/backend/index.js";
import {
  ballToOutwardInterval,
  compareRational,
  createEvaluationContext,
  createEvaluationGraphFromSource,
  createRational,
  verifiedNumberFromBall
} from "../src/core/index.js";
import type { Ball, EvaluationContext, LazyReal, Rational } from "../src/core/index.js";

const PI_REFERENCE_DIGITS = [
  "31415926535897932384626433832795028841971693993751",
  "05820974944592307816406286208998628034825342117067",
  "98214808651328230664709384460955058223172535940812",
  "84811174502841027019385211055596446229489549303819",
  "64428810975665933446128475648233786783165271201909",
  "14564856692346034861045432664821339360726024914127",
  "37245870066063155881748815209209628292540917153643",
  "67892590360011330530548820466521384146951941511609",
  "43305727036575959195309218611738193261179310511854",
  "80744623799627495673518857527248912279381830119491",
  "29833673362440656643086021394946395224737190702179",
  "86094370277053921717629317675238467481846766940513",
  "20005681271452635608277857713427577896091736371787",
  "21468440901224953430146549585371050792279689258923",
  "54201995611212902196086403441815981362977477130996",
  "05187072113499999983729780499510597317328160963185",
  "95024459455346908302642522308253344685035261931188",
  "17101000313783875288658753320838142061717766914730",
  "35982534904287554687311595628638823537875937519577",
  "81857780532171226806613001927876611195909216420198"
].join("");
const E_REFERENCE_DIGITS = [
  "27182818284590452353602874713526624977572470936999",
  "59574966967627724076630353547594571382178525166427",
  "42746639193200305992181741359662904357290033429526",
  "05956307381323286279434907632338298807531952510190",
  "11573834187930702154089149934884167509244761460668",
  "08226480016847741185374234544243710753907774499206",
  "95517027618386062613313845830007520449338265602976",
  "06737113200709328709127443747047230696977209310141",
  "69283681902551510865746377211125238978442505695369",
  "67707854499699679468644549059879316368892300987931",
  "27736178215424999229576351482208269895193668033182",
  "52886939849646510582093923982948879332036250944311",
  "73012381970684161403970198376793206832823764648042",
  "95311802328782509819455815301756717361332069811250",
  "99618188159304169035159888851934580727386673858942",
  "28792284998920868058257492796104841984443634632449",
  "68487560233624827041978623209002160990235304369941",
  "84914631409343173814364054625315209618369088870701",
  "67683964243781405927145635490613031072085103837505",
  "101157477041718986106873969655212671546889570350354"
].join("");
const PI_PLUS_E_PREFIX_100 =
  "5859874482048838473822930854632165381954416493075065395941912220031893036639756593199417003867283495";

void describe("built-in constants π and e", () => {
  void it("refines π and e as LazyReal values to 10, 100, and 1000 digits", async () => {
    assert.equal(PI_REFERENCE_DIGITS.length, 1000);
    assert.equal(E_REFERENCE_DIGITS.length, 1001);

    await assertConstantDigits("π", PI_REFERENCE_DIGITS);
    await assertConstantDigits("e", E_REFERENCE_DIGITS);
  });

  void it("keeps verified prefixes monotonic while continuing one constant state", async () => {
    const result = createEvaluationGraphFromSource("π");
    assert.equal(result.ok, true);

    let previousDigits = "";
    let previousCompletedTerms = 0;

    let expectedRootRefinementCalls = 0;

    for (const significantDigits of [10, 100, 1000]) {
      expectedRootRefinementCalls += 1;
      const ball = await result.graph.refine({ significantDigits });
      const verified = verifiedNumberFromBall(ball, { significantDigits }, result.context.backend);
      const snapshot = result.graph.root.getStateSnapshot();

      assert.equal(verified.verifiedDigits >= significantDigits, true);
      assert.equal(verified.digits.startsWith(previousDigits), true);
      assert.equal(snapshot.refinementCalls, expectedRootRefinementCalls);
      assert.equal(snapshot.highestCompletedDigits, significantDigits);
      assert.equal(snapshot.highestRequestedDigits, significantDigits);
      assert.equal(snapshot.cacheHits, 0);
      previousDigits = verified.digits;

      const constantValue = result.graph.evaluate() as StatefulConstantLazyReal;
      const state = constantValue.getStateSnapshot();
      assert.equal(state.completedTerms > previousCompletedTerms, true);
      previousCompletedTerms = state.completedTerms;
    }
  });

  void it("reuses built-in constant LazyReal state within one evaluation context", async () => {
    const context = createEvaluationContext();
    const piDefinition = context.registry.getConstant("π");
    assert.ok(piDefinition !== null);

    const first = piDefinition.createValue(context) as StatefulConstantLazyReal;
    const second = piDefinition.createValue(context) as StatefulConstantLazyReal;
    const otherContextValue = piDefinition.createValue(createEvaluationContext());

    assert.equal(first, second);
    assert.notEqual(first, otherContextValue);

    await first.refine({ significantDigits: 100 }, context);
    assert.equal(second.getStateSnapshot().completedTerms, first.getStateSnapshot().completedTerms);
  });

  void it("lets π and e participate in ordinary lazy arithmetic expressions", async () => {
    const result = createEvaluationGraphFromSource("π+e");
    assert.equal(result.ok, true);

    const ball = await result.graph.refine({ significantDigits: 1000 });
    const verified = verifiedNumberFromBall(
      ball,
      { significantDigits: 1000 },
      result.context.backend
    );

    assert.equal(verified.sign, 1);
    assert.equal(verified.exponent10, 0n);
    assert.equal(verified.verifiedDigits >= 1000, true);
    assert.equal(verified.digits.startsWith(PI_PLUS_E_PREFIX_100), true);
  });
});

async function assertConstantDigits(source: "π" | "e", expectedDigits: string): Promise<void> {
  const result = createEvaluationGraphFromSource(source);
  assert.equal(result.ok, true);

  for (const significantDigits of [10, 100, 1000]) {
    const ball = await result.graph.refine({ significantDigits });
    const verified = verifiedNumberFromBall(ball, { significantDigits }, result.context.backend);

    assert.equal(verified.sign, 1);
    assert.equal(verified.exponent10, 0n);
    assert.equal(verified.verifiedDigits >= significantDigits, true);
    const referenceDigits = expectedDigits.slice(0, significantDigits);

    assert.equal(verified.digits.startsWith(referenceDigits), true);
    assertBallInsideKnownPrefix(ball, referenceDigits, result.context);
  }
}

function assertBallInsideKnownPrefix(
  ball: Ball,
  prefixDigits: string,
  context: EvaluationContext
): void {
  const graphContext = context as ReturnType<typeof createEvaluationContext>;
  const interval = ballToOutwardInterval(
    ball,
    Math.max(512, ball.center.precisionBits, ball.radius.precisionBits),
    graphContext.backend
  );
  const lower = internalFloatToRational(interval.lower);
  const upper = internalFloatToRational(interval.upper);
  const referenceLower = decimalPrefixLowerBound(prefixDigits);
  const referenceUpper = createRational(referenceLower.numerator + 1n, referenceLower.denominator);

  assert.equal(compareRational(referenceLower, lower) <= 0, true);
  assert.equal(compareRational(upper, referenceUpper) <= 0, true);
}

function decimalPrefixLowerBound(digits: string): Rational {
  return createRational(BigInt(digits), 10n ** BigInt(digits.length - 1));
}

type StatefulConstantLazyReal = LazyReal & {
  getStateSnapshot(): {
    readonly completedTerms: number;
  };
};
