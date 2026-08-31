import type { EvaluationContext } from "../evaluation/contracts.js";
import type { RealValue } from "../values/contracts.js";

export type FunctionArity =
  | { readonly kind: "fixed"; readonly count: number }
  | { readonly kind: "range"; readonly min: number; readonly max: number };

export interface FunctionDefinition {
  readonly kind: "function";
  readonly name: string;
  readonly arity: FunctionArity;
  readonly supportsIteration: boolean;
  readonly angleSensitive: boolean;
  evaluate(args: readonly RealValue[], context: EvaluationContext): RealValue;
}

export interface ConstantDefinition {
  readonly kind: "constant";
  readonly name: string;
  createValue(context: EvaluationContext): RealValue;
}

export type RegistryDefinition = FunctionDefinition | ConstantDefinition;

export interface RegisteredName {
  readonly kind: RegistryDefinition["kind"];
  readonly canonicalName: string;
  readonly sourceName: string;
  readonly matchLength: number;
}

export interface NameMatch {
  readonly kind: RegistryDefinition["kind"];
  readonly canonicalName: string;
  readonly sourceName: string;
  readonly start: number;
  readonly end: number;
}

export interface CoreRegistry {
  getFunction(name: string): FunctionDefinition | null;
  getConstant(name: string): ConstantDefinition | null;
  getKnownNames(): readonly RegisteredName[];
  matchNamesAt(source: string, start: number): readonly NameMatch[];
}

export interface ExtensionRegistryDefinitions {
  readonly functions?: readonly FunctionDefinition[];
  readonly constants?: readonly ConstantDefinition[];
}
