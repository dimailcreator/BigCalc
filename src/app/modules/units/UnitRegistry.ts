import type { UnitDimensions } from "./UnitDimensions.js";
import { unitDimensions } from "./UnitDimensions.js";
import type { UnitAffineTransform, UnitScale } from "./UnitExpression.js";
import { copyScale, decimalScale, multiplyScales } from "./UnitExpression.js";
import { UnitDomainError, UnitRegistryConfigurationError } from "./UnitErrors.js";
import type { UnitSourceRange } from "./UnitErrors.js";
import { BUILTIN_UNITS, SI_PREFIXES } from "./UnitRegistryEntries.js";

interface UnitDefinitionBase {
  readonly id: string;
  readonly symbols: readonly string[];
  readonly names: readonly string[];
  readonly dimensions: UnitDimensions;
  readonly convention: string;
}
export type UnitDefinition = UnitDefinitionBase &
  (
    | { readonly kind: "linear"; readonly scale: UnitScale; readonly prefixes: boolean }
    | { readonly kind: "affine"; readonly transform: UnitAffineTransform; readonly prefixes: false }
  );
export interface UnitPrefix {
  readonly id: string;
  readonly power10: bigint;
  readonly symbols: readonly string[];
  readonly names: readonly string[];
}
export interface ResolvedUnit {
  readonly definition: UnitDefinition;
  readonly prefix: UnitPrefix | null;
  readonly scale: UnitScale;
}
interface PrefixCandidate {
  readonly unit: UnitDefinition;
  readonly prefix: UnitPrefix;
  readonly length: number;
}

export function normalizeUnitName(name: string): string {
  return name
    .normalize("NFC")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/([\p{L}\p{N}])[-_]+(?=[\p{L}\p{N}])/gu, "$1");
}

/** Immutable audited vocabulary, independent of App settings and Core registry. */
export class UnitRegistry {
  readonly entries: readonly UnitDefinition[];
  readonly prefixes: readonly UnitPrefix[];
  readonly #symbols = new Map<string, UnitDefinition>();
  readonly #names = new Map<string, UnitDefinition>();

  constructor(
    units: readonly UnitDefinition[] = BUILTIN_UNITS,
    prefixes: readonly UnitPrefix[] = SI_PREFIXES
  ) {
    const ids = new Set<string>();
    this.entries = Object.freeze(
      units.map((unit) => {
        uniqueId(ids, unit.id);
        const dimensions: readonly bigint[] = unit.dimensions;
        if (dimensions.length !== 7 || dimensions.some((power) => typeof power !== "bigint"))
          throw new UnitRegistryConfigurationError(
            "InvalidDefinition",
            `Invalid dimensions: ${unit.id}`
          );
        const common = {
          id: unit.id,
          symbols: Object.freeze([...unit.symbols]),
          names: Object.freeze([...unit.names]),
          dimensions: unitDimensions(...unit.dimensions),
          convention: unit.convention
        };
        const snapshot: UnitDefinition =
          unit.kind === "linear"
            ? Object.freeze({
                ...common,
                kind: "linear",
                scale: copyScale(unit.scale),
                prefixes: unit.prefixes
              })
            : Object.freeze({
                ...common,
                kind: "affine",
                prefixes: false,
                transform: Object.freeze({
                  inputOffset: copyScale(unit.transform.inputOffset),
                  scale: copyScale(unit.transform.scale)
                })
              });
        for (const symbol of snapshot.symbols)
          addAlias(this.#symbols, symbol.normalize("NFC"), snapshot);
        for (const name of snapshot.names) addAlias(this.#names, normalizeUnitName(name), snapshot);
        return snapshot;
      })
    );
    const prefixIds = new Set<string>();
    const symbols = new Map<string, UnitPrefix>();
    const names = new Map<string, UnitPrefix>();
    this.prefixes = Object.freeze(
      prefixes.map((prefix) => {
        uniqueId(prefixIds, prefix.id);
        if (typeof prefix.power10 !== "bigint")
          throw new UnitRegistryConfigurationError(
            "InvalidDefinition",
            "Prefix power must be an exact integer"
          );
        const snapshot = Object.freeze({
          ...prefix,
          symbols: Object.freeze([...prefix.symbols]),
          names: Object.freeze([...prefix.names])
        });
        for (const symbol of snapshot.symbols) addAlias(symbols, symbol.normalize("NFC"), snapshot);
        for (const name of snapshot.names) addAlias(names, normalizeUnitName(name), snapshot);
        return snapshot;
      })
    );
  }

  resolve(token: string, range: UnitSourceRange = { start: 0, end: token.length }): ResolvedUnit {
    const normalized = token.normalize("NFC");
    const direct = this.#direct(normalized);
    if (direct) return resolved(direct, null);
    const candidates: PrefixCandidate[] = [];
    for (const prefix of this.prefixes) {
      for (const symbol of prefix.symbols) {
        const alias = symbol.normalize("NFC");
        if (normalized.startsWith(alias)) {
          const unit = this.#direct(normalized.slice(alias.length));
          if (unit) candidates.push({ unit, prefix, length: alias.length });
        }
      }
      for (const name of prefix.names) {
        const alias = normalizeUnitName(name);
        const remainder = namedPrefixRemainder(normalized, alias);
        const unit = remainder === null ? undefined : this.#direct(remainder);
        if (unit) candidates.push({ unit, prefix, length: alias.length });
      }
    }
    const permitted = candidates.filter(({ unit }) => unit.kind === "linear" && unit.prefixes);
    const pool = permitted.length > 0 ? permitted : candidates;
    if (pool.length === 0)
      throw new UnitDomainError("UnknownUnit", range, `Unknown unit: ${token}`);
    const longest = Math.max(...pool.map((candidate) => candidate.length));
    const winners = new Map(
      pool
        .filter((candidate) => candidate.length === longest)
        .map((candidate) => [JSON.stringify([candidate.prefix.id, candidate.unit.id]), candidate])
    );
    if (winners.size !== 1)
      throw new UnitDomainError("AmbiguousAlias", range, `Ambiguous unit: ${token}`);
    const winner = winners.values().next().value;
    if (!winner) throw new UnitDomainError("UnknownUnit", range, `Unknown unit: ${token}`);
    if (winner.unit.kind === "affine")
      throw new UnitDomainError(
        "PrefixOnAffine",
        range,
        "Affine temperature units cannot have prefixes"
      );
    if (!winner.unit.prefixes)
      throw new UnitDomainError(
        "PrefixNotAllowed",
        range,
        `Prefixes are not allowed for ${winner.unit.id}`
      );
    return resolved(winner.unit, winner.prefix);
  }

  #direct(token: string): UnitDefinition | undefined {
    return this.#symbols.get(token) ?? this.#names.get(normalizeUnitName(token));
  }
}

function uniqueId(ids: Set<string>, id: string): void {
  if (!id) throw new UnitRegistryConfigurationError("InvalidDefinition", "Empty canonical ID");
  if (ids.has(id))
    throw new UnitRegistryConfigurationError("DuplicateId", `Duplicate canonical ID: ${id}`);
  ids.add(id);
}
function addAlias<T extends { readonly id: string }>(
  map: Map<string, T>,
  alias: string,
  value: T
): void {
  if (!alias || /[\s*×·/÷^()+]/u.test(alias))
    throw new UnitRegistryConfigurationError("InvalidDefinition", `Invalid alias: ${alias}`);
  const existing = map.get(alias);
  if (existing && existing.id !== value.id)
    throw new UnitRegistryConfigurationError("AmbiguousAlias", `Conflicting alias: ${alias}`);
  map.set(alias, value);
}
function resolved(definition: UnitDefinition, prefix: UnitPrefix | null): ResolvedUnit {
  const scale = definition.kind === "linear" ? definition.scale : definition.transform.scale;
  return Object.freeze({
    definition,
    prefix,
    scale: prefix === null ? scale : multiplyScales(decimalScale(prefix.power10), scale)
  });
}
function namedPrefixRemainder(token: string, alias: string): string | null {
  let seen = "";
  for (let index = 0; index < token.length; index++) {
    const character = token.charAt(index);
    if ((character === "-" || character === "_") && index > 0) continue;
    seen += normalizeUnitName(character);
    if (!alias.startsWith(seen)) return null;
    if (seen === alias) return token.slice(index + 1).replace(/^[-_]+/u, "");
  }
  return null;
}

export const DEFAULT_UNIT_REGISTRY = new UnitRegistry();
