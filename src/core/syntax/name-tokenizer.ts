import { ambiguousIdentifierError, unknownIdentifierError } from "../errors/index.js";
import type { AmbiguousIdentifierError, UnknownIdentifierError } from "../errors/index.js";
import type { CoreRegistry, NameMatch } from "../registry/index.js";

export type NameTokenizationError = UnknownIdentifierError | AmbiguousIdentifierError;

export type NameTokenizationResult =
  | { readonly ok: true; readonly tokens: readonly NameToken[] }
  | { readonly ok: false; readonly error: NameTokenizationError };

export type NameToken = RegisteredNameToken | ImplicitMultiplicationToken | SourceCharacterToken;

export interface RegisteredNameToken {
  readonly kind: "registered-name";
  readonly nameKind: NameMatch["kind"];
  readonly canonicalName: string;
  readonly sourceName: string;
  readonly start: number;
  readonly end: number;
}

export interface ImplicitMultiplicationToken {
  readonly kind: "implicit-multiplication";
  readonly start: number;
  readonly end: number;
}

export interface SourceCharacterToken {
  readonly kind: "source-character";
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

interface Segmentation {
  readonly matches: readonly NameMatch[];
  readonly score: readonly number[];
}

export function tokenizeRegisteredNames(
  source: string,
  registry: CoreRegistry
): NameTokenizationResult {
  const tokens: NameToken[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    if (character === undefined) {
      break;
    }

    if (!isNameCharacter(character)) {
      tokens.push({
        kind: "source-character",
        value: character,
        start: index,
        end: index + 1
      });
      index += 1;
      continue;
    }

    const start = index;
    while (index < source.length && isNameCharacter(source[index] ?? "")) {
      index += 1;
    }

    const segment = source.slice(start, index);
    const result = segmentRegisteredNameRun(segment, start, registry);

    if (!result.ok) {
      return result;
    }

    appendRegisteredNamesWithImplicitMultiplication(tokens, result.tokens);
  }

  return { ok: true, tokens };
}

export function segmentRegisteredNameRun(
  source: string,
  sourceOffset: number,
  registry: CoreRegistry
): NameTokenizationResult {
  const exact = exactWholeName(source, sourceOffset, registry);

  if (exact !== null) {
    return {
      ok: true,
      tokens: [registeredNameToken(exact)]
    };
  }

  const segmentations = bestSegmentations(source, sourceOffset, registry, 0, new Map());

  if (segmentations.length === 0) {
    return {
      ok: false,
      error: unknownIdentifierError(source, undefined, {
        start: sourceOffset,
        end: sourceOffset + source.length
      })
    };
  }

  if (segmentations.length > 1) {
    return {
      ok: false,
      error: ambiguousIdentifierError(
        source,
        segmentations.map((segmentation) =>
          segmentation.matches.map((match) => match.canonicalName).join("*")
        ),
        undefined,
        { start: sourceOffset, end: sourceOffset + source.length }
      )
    };
  }

  const [segmentation] = segmentations;

  if (segmentation === undefined) {
    return {
      ok: false,
      error: unknownIdentifierError(source)
    };
  }

  return {
    ok: true,
    tokens: segmentation.matches.map(registeredNameToken)
  };
}

function appendRegisteredNamesWithImplicitMultiplication(
  target: NameToken[],
  source: readonly NameToken[]
): void {
  for (const token of source) {
    if (target.at(-1)?.kind === "registered-name" && token.kind === "registered-name") {
      target.push({
        kind: "implicit-multiplication",
        start: token.start,
        end: token.start
      });
    }

    target.push(token);
  }
}

function exactWholeName(
  source: string,
  sourceOffset: number,
  registry: CoreRegistry
): NameMatch | null {
  const matches = registry
    .matchNamesAt(source, 0)
    .filter((match) => match.start === 0 && match.end === source.length)
    .map((match) => shiftMatch(match, sourceOffset));

  if (matches.length === 0) {
    return null;
  }

  return matches[0] ?? null;
}

function bestSegmentations(
  source: string,
  sourceOffset: number,
  registry: CoreRegistry,
  relativeStart: number,
  cache: Map<number, readonly Segmentation[]>
): readonly Segmentation[] {
  if (relativeStart === source.length) {
    return [{ matches: [], score: [] }];
  }

  const cached = cache.get(relativeStart);
  if (cached !== undefined) {
    return cached;
  }

  let best: readonly Segmentation[] = [];
  for (const relativeMatch of registry.matchNamesAt(source, relativeStart)) {
    const relativeEnd = relativeMatch.end;

    if (relativeEnd <= relativeStart || relativeEnd > source.length) {
      continue;
    }

    const match = shiftMatch(relativeMatch, sourceOffset);
    const rest = bestSegmentations(source, sourceOffset, registry, relativeEnd, cache);

    for (const restSegmentation of rest) {
      const lengths = [match.end - match.start, ...restSegmentation.score].sort(
        (left, right) => right - left
      );
      const candidate = {
        matches: [match, ...restSegmentation.matches],
        score: lengths
      };

      const comparison = compareScores(candidate.score, best[0]?.score ?? []);

      if (best.length === 0 || comparison > 0) {
        best = [candidate];
      } else if (comparison === 0) {
        best = [...best, candidate];
      }
    }
  }

  cache.set(relativeStart, best);
  return best;
}

function shiftMatch(match: NameMatch, offset: number): NameMatch {
  return {
    ...match,
    start: match.start + offset,
    end: match.end + offset
  };
}

function compareScores(left: readonly number[], right: readonly number[]): number {
  const length = left.length > right.length ? left.length : right.length;

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;

    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

function registeredNameToken(match: NameMatch): RegisteredNameToken {
  return {
    kind: "registered-name",
    nameKind: match.kind,
    canonicalName: match.canonicalName,
    sourceName: match.sourceName,
    start: match.start,
    end: match.end
  };
}

function isNameCharacter(character: string): boolean {
  return /^[A-Za-zπ]$/.test(character);
}
