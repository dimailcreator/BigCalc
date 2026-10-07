export interface UnitSourceRange {
  readonly start: number;
  readonly end: number;
}
export type UnitDomainErrorCode =
  | "EmptyExpression"
  | "UnknownUnit"
  | "UnexpectedToken"
  | "UnclosedParenthesis"
  | "ExtraParenthesis"
  | "MissingExponent"
  | "InvalidExponent"
  | "AffineInProduct"
  | "AffineInQuotient"
  | "AffinePower"
  | "PrefixOnAffine"
  | "PrefixNotAllowed"
  | "AmbiguousAlias";

/** Unit syntax/domain failures remain separate from Core math and transport errors. */
export class UnitDomainError extends Error {
  constructor(
    readonly code: UnitDomainErrorCode,
    readonly range: UnitSourceRange,
    message: string
  ) {
    super(message);
    this.name = "UnitDomainError";
    this.range = Object.freeze({ ...range });
  }
}
export class UnitRegistryConfigurationError extends Error {
  constructor(
    readonly code: "DuplicateId" | "AmbiguousAlias" | "InvalidDefinition",
    message: string
  ) {
    super(message);
    this.name = "UnitRegistryConfigurationError";
  }
}
