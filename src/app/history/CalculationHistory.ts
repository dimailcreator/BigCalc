import type {
  CalculationExpressionSegmentDto,
  CalculationReferenceSnapshotDto,
  CalculationSettingsDto,
  VerifiedNumberDto
} from "../calculation/CalculationProtocol.js";
import type { ExpressionModel } from "../editor/ExpressionModel.js";

export interface CalculationHistoryEntry {
  readonly id: string;
  readonly expression: readonly CalculationExpressionSegmentDto[];
  readonly originalExpressionText: string;
  readonly displayedResultText: string;
  readonly settings: CalculationSettingsDto;
  readonly resultValue: VerifiedNumberDto;
}

export interface RecordCalculationInput {
  readonly expression: readonly CalculationExpressionSegmentDto[];
  readonly originalExpressionText: string;
  readonly displayedResultText: string;
  readonly settings: CalculationSettingsDto;
  readonly resultValue: VerifiedNumberDto;
}

/** Runtime history for Stage 14. Persistence and History UI are added in Stage 15. */
export class CalculationHistory {
  readonly #entries = new Map<string, CalculationHistoryEntry>();
  readonly #createId: () => string;

  constructor(createId: () => string = () => crypto.randomUUID()) {
    this.#createId = createId;
  }

  get entries(): readonly CalculationHistoryEntry[] {
    return Object.freeze([...this.#entries.values()]);
  }

  get(id: string): CalculationHistoryEntry | null {
    return this.#entries.get(id) ?? null;
  }

  record(input: RecordCalculationInput): CalculationHistoryEntry {
    const id = this.#createId();
    if (id.trim().length === 0 || this.#entries.has(id)) {
      throw new TypeError("History IDs must be unique nonempty strings");
    }
    const entry: CalculationHistoryEntry = Object.freeze({
      id,
      expression: copySegments(input.expression),
      originalExpressionText: input.originalExpressionText,
      displayedResultText: input.displayedResultText,
      settings: Object.freeze({ ...input.settings }),
      resultValue: Object.freeze({ ...input.resultValue })
    });
    this.#entries.set(id, entry);
    return entry;
  }

  snapshotsFor(
    expression: readonly CalculationExpressionSegmentDto[]
  ): readonly CalculationReferenceSnapshotDto[] {
    const collected = new Map<string, CalculationReferenceSnapshotDto>();
    const visit = (id: string): void => {
      if (collected.has(id)) return;
      const entry = this.#entries.get(id);
      if (entry === undefined) throw new TypeError(`Missing history entry: ${id}`);
      const snapshot: CalculationReferenceSnapshotDto = Object.freeze({
        id,
        expression: entry.expression,
        settings: entry.settings
      });
      collected.set(id, snapshot);
      for (const segment of entry.expression) {
        if (segment.kind === "reference") visit(segment.id);
      }
    };
    for (const segment of expression) {
      if (segment.kind === "reference") visit(segment.id);
    }
    return Object.freeze([...collected.values()]);
  }
}

export function expressionSegmentsFromModel(
  model: ExpressionModel
): readonly CalculationExpressionSegmentDto[] {
  const segments: CalculationExpressionSegmentDto[] = [];
  let source = "";
  const flush = (): void => {
    if (source.length > 0) {
      segments.push(Object.freeze({ kind: "source", source }));
      source = "";
    }
  };
  for (const token of model.tokens) {
    if (token.kind === "ans") {
      flush();
      segments.push(Object.freeze({ kind: "reference", id: token.historyEntryId }));
    } else {
      source += token.kind === "character" ? token.value : token.name;
    }
  }
  flush();
  return Object.freeze(segments);
}

function copySegments(
  expression: readonly CalculationExpressionSegmentDto[]
): readonly CalculationExpressionSegmentDto[] {
  return Object.freeze(expression.map((segment) => Object.freeze({ ...segment })));
}
