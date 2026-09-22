import { cases as eCases } from "./e-candidates.mjs";
import { productionCandidate } from "./production-candidates.mjs";

export const cases = eCases.map((item) => ({
  ...item,
  candidates: [...item.candidates, productionCandidate("factorial-routed", "e")]
}));
