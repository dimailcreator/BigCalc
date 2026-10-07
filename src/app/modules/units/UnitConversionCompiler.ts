import type { EvaluationRepresentation } from "../../editor/ExpressionModel.js";
import { sameDimensions } from "./UnitDimensions.js";
import { compileUnitScale } from "./UnitExpression.js";
import type { ParsedUnitExpression } from "./UnitExpression.js";

export class UnitConversionError extends Error {
  constructor(
    readonly code: "DimensionMismatch" | "AffineCounterpart" | "HistoryReferenceNotAllowed",
    message: string
  ) {
    super(message);
    this.name = "UnitConversionError";
  }
}
export interface CompiledUnitConversion {
  readonly kind: "linear" | "affine";
  readonly source: string;
  readonly valueSource: string;
  readonly requiresValueSyntaxCheck: boolean;
  /** Exact source only. A numeric factor needs a separate verified session, never a float. */
  readonly factorSource: string | null;
}

export function compileUnitConversion(
  value: string | EvaluationRepresentation,
  from: ParsedUnitExpression,
  to: ParsedUnitExpression
): CompiledUnitConversion {
  if (typeof value !== "string" && value.kind === "requires-ans-resolution")
    throw new UnitConversionError(
      "HistoryReferenceNotAllowed",
      "Units cannot use History references"
    );
  const valueSource = typeof value === "string" ? value : value.source;
  if (/(?<![a-z])ans(?![a-z])/iu.test(valueSource))
    throw new UnitConversionError("HistoryReferenceNotAllowed", "Units cannot use Ans");
  if (!sameDimensions(from.value.dimensions, to.value.dimensions))
    throw new UnitConversionError("DimensionMismatch", "Source and target dimensions differ");
  const affine = from.value.kind === "affine" || to.value.kind === "affine";
  if (affine && (!standaloneTemperature(from) || !standaloneTemperature(to)))
    throw new UnitConversionError(
      "AffineCounterpart",
      "Affine conversion requires standalone temperature units"
    );
  // This checks wrapper containment only, not mathematical grammar. An unbalanced value must
  // be parsed unchanged by Core: surrounding parentheses could accidentally repair its syntax.
  const requiresValueSyntaxCheck = !balancedDelimiters(valueSource);
  const fromScale = compileUnitScale(
    from.value.kind === "linear" ? from.value.scale : from.value.transform.scale
  );
  const toScale = compileUnitScale(
    to.value.kind === "linear" ? to.value.scale : to.value.transform.scale
  );
  let source: string;
  if (affine) {
    const fromOffset =
      from.value.kind === "affine" ? compileUnitScale(from.value.transform.inputOffset) : "0";
    const toOffset =
      to.value.kind === "affine" ? compileUnitScale(to.value.transform.inputOffset) : "0";
    source = `(((${valueSource})+(${fromOffset}))*(${fromScale}))/(${toScale})-(${toOffset})`;
  } else source = `(${valueSource})*(${fromScale})/(${toScale})`;
  return Object.freeze({
    kind: affine ? "affine" : "linear",
    source: requiresValueSyntaxCheck ? valueSource : source,
    valueSource,
    requiresValueSyntaxCheck,
    factorSource: affine ? null : `(${fromScale})/(${toScale})`
  });
}
function standaloneTemperature(expression: ParsedUnitExpression): boolean {
  return expression.value.kind === "affine" || expression.value.standaloneUnitId === "kelvin";
}
function balancedDelimiters(source: string): boolean {
  const openings: string[] = [];
  const pairs: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{" };
  for (const character of source) {
    if ("([{".includes(character)) openings.push(character);
    else if (Object.hasOwn(pairs, character) && openings.pop() !== pairs[character]) return false;
  }
  return openings.length === 0;
}
