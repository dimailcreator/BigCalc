/** Floating-point estimates choose work only; the omitted exact term proves the result. */
export function estimateStirlingTerms(digits: number, argument: number): number {
  let logFactorial = 0;
  for (let k = 1; k <= Math.ceil(Math.PI * argument); k++) {
    logFactorial += Math.log(2 * k - 1) + Math.log(2 * k);
    // |B_2k| < 4 (2k)! / (2 pi)^(2k), used here only as a cost estimate.
    const logTerm =
      Math.log(4) +
      logFactorial -
      2 * k * Math.log(2 * Math.PI) -
      Math.log(2 * k * (2 * k - 1)) -
      (2 * k - 1) * Math.log(argument);
    if (k > 1 && logTerm < -(digits + 12) * Math.LN10) return k - 1;
  }
  return Number.POSITIVE_INFINITY;
}

export function planStirlingWork(digits: number, minimumShift: number, minimumTerms: number) {
  const candidates = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8].map((factor) =>
    Math.max(64, minimumShift, Math.ceil(factor * digits) + 16)
  );
  const plans = candidates.map((shiftTarget) =>
    estimateStirlingWork(digits, shiftTarget, minimumTerms)
  );
  return plans.reduce((best, plan) => (plan.estimatedCost < best.estimatedCost ? plan : best));
}

export function estimateStirlingWork(digits: number, shiftTarget: number, minimumTerms: number) {
  const estimatedCorrectionTerms = Math.max(
    minimumTerms,
    estimateStirlingTerms(digits, shiftTarget)
  );
  const m = estimatedCorrectionTerms;
  // Balanced rational recurrence, tangent convolution, shrinking correction terms,
  // and the final exp. These weights are internal routing heuristics, not bounds.
  const recurrenceCost = shiftTarget * Math.log2(shiftTarget + 1) * Math.log2(digits + 1);
  const coefficientCost = 0.05 * m * m * Math.log2(m + 1) ** 2;
  const powerCost = m * digits;
  const expCost = digits * Math.sqrt(digits + Math.log2(shiftTarget + 1));
  return {
    shiftTarget,
    estimatedCorrectionTerms,
    estimatedCost: recurrenceCost + coefficientCost + powerCost + expCost
  };
}
