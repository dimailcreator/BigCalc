import { cases as coldCases, gammaCandidate } from "./gamma-candidates.mjs";
// Coefficients for a different argument are prepared outside the timed region.
// Use --grid 300; setup cost is deliberately excluded in this amortization probe.
export const cases = coldCases
  .filter((c) => ["gamma-one-third", "gamma-three-quarters", "gamma-general"].includes(c.name))
  .map((c) => ({
    ...c,
    input: { ...c.input, warmDigits: 300 },
    candidates: ["stirling-warm", "spouge-warm"].map(gammaCandidate)
  }));
