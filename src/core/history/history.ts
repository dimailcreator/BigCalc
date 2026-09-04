import { InternalCalculationException, internalCalculationError } from "../errors/index.js";
import type { CalcError } from "../errors/index.js";
import type { EvaluationContext, PrecisionRequest } from "../evaluation/contracts.js";
import { createEvaluationSettings } from "../evaluation/context.js";
import {
  createCalculationHandleFromSource,
  type CalculationHandleOptions
} from "../evaluation/lifecycle.js";
import { createEvaluationGraphFromSource } from "../evaluation/evaluator.js";
import type { EvaluationGraphContext } from "../evaluation/context.js";
import { createRegistry } from "../registry/index.js";
import type { ConstantDefinition, CoreRegistry } from "../registry/index.js";
import type { Ball, LazyReal } from "../values/contracts.js";
import type {
  HistoryAnsCalculationOptions,
  HistoryCalculationHandleResult,
  HistoryEntry,
  HistoryRepository,
  HistoryReevaluationOptions,
  HistoryService,
  RecordHistoryEntryInput
} from "./contracts.js";

const ANS_NAME = "Ans";

export function createInMemoryHistoryRepository(): HistoryRepository {
  return new InMemoryHistoryRepository();
}

export function createHistoryService(
  repository: HistoryRepository = createInMemoryHistoryRepository()
): HistoryService {
  return new DefaultHistoryService(repository);
}

export function createHistoryAnsRegistry(entry: HistoryEntry): CoreRegistry {
  return createRegistry({
    constants: [createAnsConstantDefinition(entry)]
  });
}

export function createCalculationHandleFromHistoryEntry(
  entry: HistoryEntry,
  options: HistoryReevaluationOptions = {}
): HistoryCalculationHandleResult {
  const created = createCalculationHandleFromSource(entry.originalExpression, {
    ...options,
    settings: entry.settings
  });

  return attachHistoryEntry(entry, created);
}

class InMemoryHistoryRepository implements HistoryRepository {
  private nextSequence = 1;
  private latestId: string | null = null;
  private readonly entries = new Map<string, HistoryEntry>();

  record(input: RecordHistoryEntryInput): HistoryEntry {
    const id = `history-${String(this.nextSequence)}`;
    this.nextSequence += 1;

    const entry = Object.freeze({
      id,
      originalExpression: input.originalExpression,
      displayedResultText: input.displayedResultText,
      settings: createEvaluationSettings(input.settings)
    });

    this.entries.set(id, entry);
    this.latestId = id;

    return entry;
  }

  get(id: string): HistoryEntry | null {
    return this.entries.get(id) ?? null;
  }

  getLatest(): HistoryEntry | null {
    return this.latestId === null ? null : this.get(this.latestId);
  }

  list(): readonly HistoryEntry[] {
    return Object.freeze([...this.entries.values()]);
  }
}

class DefaultHistoryService implements HistoryService {
  constructor(private readonly repository: HistoryRepository) {}

  recordCalculation(input: RecordHistoryEntryInput): HistoryEntry {
    return this.repository.record(input);
  }

  getEntry(id: string): HistoryEntry | null {
    return this.repository.get(id);
  }

  getLatestEntry(): HistoryEntry | null {
    return this.repository.getLatest();
  }

  listEntries(): readonly HistoryEntry[] {
    return this.repository.list();
  }

  createCalculationHandleFromHistoryEntry(
    id: string,
    options: HistoryReevaluationOptions = {}
  ): HistoryCalculationHandleResult {
    const entry = this.repository.get(id);

    if (entry === null) {
      return missingHistoryEntry(id);
    }

    return createCalculationHandleFromHistoryEntry(entry, options);
  }

  createCalculationHandleFromAns(
    options: HistoryAnsCalculationOptions = {}
  ): HistoryCalculationHandleResult {
    const entry = this.resolveAnsEntry(options.ansEntryId);

    if (!entry.ok) {
      return entry;
    }

    return createCalculationHandleFromHistoryEntry(entry.entry, withoutAnsId(options));
  }

  createCalculationHandleFromSourceWithAns(
    source: string,
    options: HistoryAnsCalculationOptions = {}
  ): HistoryCalculationHandleResult {
    const entry = this.resolveAnsEntry(options.ansEntryId);

    if (!entry.ok) {
      return entry;
    }

    const calculationOptions = withoutAnsId(options);
    const created = createCalculationHandleFromSource(source, {
      ...calculationOptions,
      registry: createHistoryAnsRegistry(entry.entry)
    });

    return attachHistoryEntry(entry.entry, created);
  }

  private resolveAnsEntry(
    entryId: string | undefined
  ):
    | { readonly ok: true; readonly entry: HistoryEntry }
    | { readonly ok: false; readonly error: CalcError } {
    if (entryId !== undefined) {
      const entry = this.repository.get(entryId);
      return entry === null ? missingHistoryEntry(entryId) : { ok: true, entry };
    }

    const latest = this.repository.getLatest();

    return latest === null
      ? {
          ok: false,
          error: internalCalculationError("Ans requires at least one history entry")
        }
      : { ok: true, entry: latest };
  }
}

function createAnsConstantDefinition(entry: HistoryEntry): ConstantDefinition {
  return Object.freeze({
    kind: "constant",
    name: ANS_NAME,
    createValue(): LazyReal {
      let graph: ReturnType<typeof createEvaluationGraphFromSource> | null = null;

      return Object.freeze({
        kind: "lazy-real",
        refine(request: PrecisionRequest, context: EvaluationContext): Promise<Ball> {
          const graphContext = requireGraphContext(context);

          graph ??= createEvaluationGraphFromSource(entry.originalExpression, {
            settings: entry.settings,
            backend: graphContext.backend,
            checkpoint: () => {
              graphContext.checkpoint();
            }
          });

          if (!graph.ok) {
            throw new InternalCalculationException(
              `Unable to re-evaluate Ans history entry ${entry.id}: ${graph.error.message}`
            );
          }

          return graph.graph.refine(request);
        }
      });
    }
  });
}

function attachHistoryEntry(
  entry: HistoryEntry,
  result: ReturnType<typeof createCalculationHandleFromSource>
): HistoryCalculationHandleResult {
  if (!result.ok) {
    return result;
  }

  return Object.freeze({
    ok: true,
    entry,
    ast: result.ast,
    context: result.context,
    graph: result.graph,
    handle: result.handle
  });
}

function missingHistoryEntry(id: string): { readonly ok: false; readonly error: CalcError } {
  return {
    ok: false,
    error: internalCalculationError(`History entry not found: ${id}`)
  };
}

function withoutAnsId(options: HistoryAnsCalculationOptions): CalculationHandleOptions {
  return {
    ...(options.backend === undefined ? {} : { backend: options.backend }),
    ...(options.checkpoint === undefined ? {} : { checkpoint: options.checkpoint }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.resourceLimits === undefined ? {} : { resourceLimits: options.resourceLimits }),
    ...(options.settings === undefined ? {} : { settings: options.settings })
  };
}

function requireGraphContext(context: EvaluationContext): EvaluationGraphContext {
  const candidate = context as Partial<EvaluationGraphContext>;

  if (
    candidate.backend === undefined ||
    candidate.registry === undefined ||
    candidate.checkpoint === undefined
  ) {
    throw new InternalCalculationException("Ans evaluation requires a graph-aware context");
  }

  return candidate as EvaluationGraphContext;
}
