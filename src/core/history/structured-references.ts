import { InternalCalculationException } from "../errors/index.js";
import type {
  CalculationExpressionSegment,
  CalculationHandleCreationResult,
  CalculationReferenceSnapshot,
  CalculationSettings
} from "../api-contracts.js";
import type { EvaluationContext, PrecisionRequest } from "../evaluation/contracts.js";
import type { EvaluationGraphContext } from "../evaluation/context.js";
import { createEvaluationGraphFromSource } from "../evaluation/evaluator.js";
import {
  createCalculationHandleFromSource,
  type CalculationHandleOptions
} from "../evaluation/lifecycle.js";
import { createRegistry } from "../registry/index.js";
import type { ConstantDefinition, CoreRegistry } from "../registry/index.js";
import { parseExpression } from "../syntax/parser.js";
import type { Ball, LazyReal, RealValue } from "../values/contracts.js";

interface CompiledExpression {
  readonly source: string;
  readonly registry: CoreRegistry;
}

export function createCalculationHandleFromSegments(
  expression: readonly CalculationExpressionSegment[],
  references: readonly CalculationReferenceSnapshot[],
  options: CalculationHandleOptions
): CalculationHandleCreationResult {
  const topSegments = copySegments(expression);
  const snapshots = copySnapshots(references);
  const orderedIds = reachableReferenceIds(topSegments, snapshots);
  const compiled = new Map<string, CompiledExpression>();

  for (const id of orderedIds) {
    const snapshot = snapshots.get(id);
    if (snapshot === undefined) throw new TypeError(`Missing calculation reference: ${id}`);
    const entry = compileExpression(snapshot.expression, snapshots, compiled);
    compiled.set(id, entry);
    const parsed = parseExpression(entry.source, entry.registry);
    if (!parsed.ok) return Object.freeze({ ok: false, error: parsed.error });
  }

  const top = compileExpression(topSegments, snapshots, compiled);
  const created = createCalculationHandleFromSource(top.source, {
    ...options,
    registry: top.registry
  });
  return created.ok
    ? Object.freeze({ ok: true, handle: created.handle })
    : Object.freeze({ ok: false, error: created.error });
}

function copySnapshots(
  references: readonly CalculationReferenceSnapshot[]
): Map<string, CalculationReferenceSnapshot> {
  const candidate: unknown = references;
  if (!Array.isArray(candidate)) throw new TypeError("references must be an array");
  const snapshots = new Map<string, CalculationReferenceSnapshot>();
  for (const reference of candidate as readonly unknown[]) {
    if (!isRecord(reference)) {
      throw new TypeError("Every reference snapshot must be an object");
    }
    const id = reference.id;
    if (typeof id !== "string" || id.trim().length === 0 || snapshots.has(id)) {
      throw new TypeError("Reference IDs must be unique nonempty strings");
    }
    snapshots.set(
      id,
      Object.freeze({
        id,
        expression: copySegments(reference.expression as readonly CalculationExpressionSegment[]),
        settings: copySettings(reference.settings as CalculationSettings)
      })
    );
  }
  return snapshots;
}

function copySegments(
  expression: readonly CalculationExpressionSegment[]
): readonly CalculationExpressionSegment[] {
  const candidate: unknown = expression;
  if (!Array.isArray(candidate)) throw new TypeError("expression must be an array of segments");
  return Object.freeze(
    (candidate as readonly unknown[]).map((segment) => {
      if (!isRecord(segment)) {
        throw new TypeError("Expression segments must be objects");
      }
      if (segment.kind === "source" && typeof segment.source === "string") {
        return Object.freeze({ kind: "source", source: segment.source });
      }
      if (
        segment.kind === "reference" &&
        typeof segment.id === "string" &&
        segment.id.trim().length > 0
      ) {
        return Object.freeze({ kind: "reference", id: segment.id });
      }
      throw new TypeError("Invalid expression segment");
    })
  );
}

function copySettings(settings: CalculationSettings): CalculationSettings {
  const candidate: unknown = settings;
  if (!isRecord(candidate)) {
    throw new TypeError("Reference settings must be an object");
  }
  if (candidate.angleMode !== "radians" && candidate.angleMode !== "degrees") {
    throw new TypeError("Reference angleMode must be radians or degrees");
  }
  if (candidate.factorialMode !== "integer" && candidate.factorialMode !== "gamma") {
    throw new TypeError("Reference factorialMode must be integer or gamma");
  }
  if (
    typeof candidate.maxCalculationTimeMs !== "number" ||
    !Number.isFinite(candidate.maxCalculationTimeMs) ||
    candidate.maxCalculationTimeMs < 0
  ) {
    throw new RangeError("Reference maxCalculationTimeMs must be non-negative and finite");
  }
  return Object.freeze({
    angleMode: candidate.angleMode,
    factorialMode: candidate.factorialMode,
    maxCalculationTimeMs: candidate.maxCalculationTimeMs
  });
}

function reachableReferenceIds(
  expression: readonly CalculationExpressionSegment[],
  snapshots: ReadonlyMap<string, CalculationReferenceSnapshot>
): readonly string[] {
  const state = new Map<string, "visiting" | "visited">();
  const ordered: string[] = [];
  const visit = (id: string): void => {
    const current = state.get(id);
    if (current === "visiting") throw new TypeError(`Cyclic calculation reference: ${id}`);
    if (current === "visited") return;
    const snapshot = snapshots.get(id);
    if (snapshot === undefined) throw new TypeError(`Missing calculation reference: ${id}`);
    state.set(id, "visiting");
    for (const segment of snapshot.expression) {
      if (segment.kind === "reference") visit(segment.id);
    }
    state.set(id, "visited");
    ordered.push(id);
  };
  for (const segment of expression) {
    if (segment.kind === "reference") visit(segment.id);
  }
  return ordered;
}

function compileExpression(
  expression: readonly CalculationExpressionSegment[],
  snapshots: ReadonlyMap<string, CalculationReferenceSnapshot>,
  compiled: ReadonlyMap<string, CompiledExpression>
): CompiledExpression {
  const plainSource = expression
    .filter((segment) => segment.kind === "source")
    .map((segment) => segment.source)
    .join("")
    .toLowerCase();
  const names = new Map<string, string>();
  const usedNames = new Set<string>();
  const definitions: ConstantDefinition[] = [];

  for (const segment of expression) {
    if (segment.kind !== "reference" || names.has(segment.id)) continue;
    const snapshot = snapshots.get(segment.id);
    if (snapshot === undefined) throw new TypeError(`Missing calculation reference: ${segment.id}`);
    let placeholderIndex = names.size;
    let name = `bigcalcansreference${letters(placeholderIndex)}`;
    while (plainSource.includes(name) || usedNames.has(name)) {
      placeholderIndex += 1;
      name = `bigcalcansreference${letters(placeholderIndex)}`;
    }
    names.set(segment.id, name);
    usedNames.add(name);
    definitions.push(createReferenceDefinition(name, snapshot, compiled));
  }

  return Object.freeze({
    source: expression
      .map((segment) =>
        segment.kind === "source" ? segment.source : (names.get(segment.id) ?? "")
      )
      .join(""),
    registry: createRegistry({ constants: definitions })
  });
}

function createReferenceDefinition(
  name: string,
  snapshot: CalculationReferenceSnapshot,
  compiled: ReadonlyMap<string, CompiledExpression>
): ConstantDefinition {
  let graph: ReturnType<typeof createEvaluationGraphFromSource> | null = null;
  return Object.freeze({
    kind: "constant",
    name,
    createValue(context: EvaluationContext): RealValue {
      const parent = requireGraphContext(context);
      const expression = compiled.get(snapshot.id);
      if (expression === undefined) {
        throw new InternalCalculationException(
          `Missing compiled calculation reference: ${snapshot.id}`
        );
      }
      graph ??= createEvaluationGraphFromSource(expression.source, {
        registry: expression.registry,
        settings: snapshot.settings,
        backend: parent.backend,
        checkpoint: () => {
          parent.checkpoint();
        },
        guardBigIntDigits: (estimatedDigits) => {
          parent.guardBigIntDigits?.(estimatedDigits);
        }
      });
      if (!graph.ok) {
        throw new InternalCalculationException(
          `Unable to evaluate calculation reference ${snapshot.id}: ${graph.error.message}`
        );
      }

      const savedGraph = graph.graph;
      const value = savedGraph.evaluate();
      if (value.kind === "rational") return value;
      const lazy: LazyReal = Object.freeze({
        kind: "lazy-real",
        refine(request: PrecisionRequest): Promise<Ball> {
          return savedGraph.refine(request);
        }
      });
      return lazy;
    }
  });
}

function letters(index: number): string {
  let value = index;
  let result = "";
  for (let position = 0; position < 8; position += 1) {
    result = String.fromCharCode(97 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  if (value > 0) throw new RangeError("Too many calculation references in one expression");
  return result;
}

function requireGraphContext(context: EvaluationContext): EvaluationGraphContext {
  const candidate = context as Partial<EvaluationGraphContext>;
  if (
    candidate.backend === undefined ||
    candidate.registry === undefined ||
    candidate.checkpoint === undefined ||
    candidate.guardBigIntDigits === undefined
  ) {
    throw new InternalCalculationException("Reference evaluation requires a graph-aware context");
  }
  return candidate as EvaluationGraphContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
