import {
  cancelledError,
  internalCalculationError,
  isCalcError,
  ResourceLimitException
} from "../errors/index.js";
import type { CalcError } from "../errors/index.js";
import { parseExpression } from "../syntax/parser.js";
import type { ExpressionNode } from "../syntax/ast.js";
import { verifiedNumberFromBall } from "../formatting/verified-number.js";
import type { EvaluationContextOptions, EvaluationGraphContext } from "./context.js";
import { createEvaluationContext } from "./context.js";
import type {
  CalculationHandle,
  CancelledResult,
  CompletedResult,
  FailedResult,
  PausedResult,
  PrecisionRequest,
  RefinementResult
} from "./contracts.js";
import { createEvaluationGraphFromAst } from "./evaluator.js";
import { createEvaluationGraph } from "./graph.js";
import type { EvaluationGraph, EvaluationNode } from "./graph.js";

export type CalculationHandleState =
  "idle" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface CalculationHandleOptions extends EvaluationContextOptions {
  readonly now?: () => number;
  readonly resourceLimits?: CalculationResourceLimits;
}

export interface CalculationResourceLimits {
  readonly maxCheckpointsPerRun?: number;
  readonly maxRequestedDigits?: number;
}

export type CalculationHandleFromSourceResult =
  | {
      readonly ok: true;
      readonly ast: ExpressionNode;
      readonly context: EvaluationGraphContext;
      readonly graph: EvaluationGraph;
      readonly handle: CalculationHandle;
    }
  | { readonly ok: false; readonly error: CalcError };

export function createCalculationHandle(
  root: EvaluationNode,
  options: CalculationHandleOptions = {}
): CalculationHandle {
  const runtime = new CalculationRuntime(options.now ?? Date.now, options.resourceLimits);
  const context = createLifecycleContext(options, runtime);
  const graph = createEvaluationGraph(root, context);

  return new DefaultCalculationHandle(graph, runtime);
}

export function createCalculationHandleFromSource(
  source: string,
  options: CalculationHandleOptions = {}
): CalculationHandleFromSourceResult {
  const runtime = new CalculationRuntime(options.now ?? Date.now, options.resourceLimits);
  const context = createLifecycleContext(options, runtime);
  const parsed = parseExpression(source, context.registry);

  if (!parsed.ok) {
    return parsed;
  }

  const graph = createEvaluationGraphFromAst(parsed.ast, context);

  return {
    ok: true,
    ast: parsed.ast,
    context,
    graph,
    handle: new DefaultCalculationHandle(graph, runtime)
  };
}

class DefaultCalculationHandle implements CalculationHandle {
  private state: CalculationHandleState = "idle";
  private lastRequest: PrecisionRequest | null = null;
  private lastCompleted: CompletedResult | null = null;
  private lastFailure: CalcError | null = null;

  constructor(
    private readonly graph: EvaluationGraph,
    private readonly runtime: CalculationRuntime
  ) {}

  refine(request: PrecisionRequest): Promise<RefinementResult> {
    if (this.state === "cancelled") {
      return Promise.resolve(this.cancelledResult(request));
    }

    if (this.state === "failed") {
      return Promise.resolve(
        this.failedResult(
          this.lastFailure ?? internalCalculationError("Failed calculation cannot be refined")
        )
      );
    }

    if (this.state === "running") {
      return Promise.resolve(this.failedResult(internalCalculationError("Calculation is running")));
    }

    this.lastRequest = request;

    return this.run(request);
  }

  continue(): Promise<RefinementResult> {
    if (this.state === "cancelled") {
      return Promise.resolve(this.cancelledResult(this.lastRequest));
    }

    if (this.state === "failed") {
      return Promise.resolve(
        this.failedResult(
          this.lastFailure ?? internalCalculationError("Failed calculation cannot continue")
        )
      );
    }

    if (this.state !== "paused" || this.lastRequest === null) {
      return Promise.resolve(
        this.failedResult(internalCalculationError("Only a paused calculation can continue"))
      );
    }

    return this.run(this.lastRequest);
  }

  cancel(): void {
    if (this.state === "cancelled" || this.state === "completed" || this.state === "failed") {
      return;
    }

    this.state = "cancelled";
    this.runtime.cancel();
  }

  private async run(request: PrecisionRequest): Promise<RefinementResult> {
    this.state = "running";

    try {
      this.runtime.guardRequest(request.significantDigits);
      this.runtime.start(this.graph.context.settings.maxCalculationTimeMs);

      const ball = await this.graph.refine(request);
      const value = verifiedNumberFromBall(ball, request, this.graph.context.backend);
      const completed: CompletedResult = Object.freeze({
        status: "complete",
        requestedDigits: request.significantDigits,
        value
      });

      this.lastCompleted = completed;
      this.lastFailure = null;
      this.state = "completed";

      return completed;
    } catch (error: unknown) {
      if (error instanceof SoftTimeoutSignal) {
        this.state = "paused";
        return this.pausedResult(request);
      }

      if (error instanceof CancelledSignal) {
        this.state = "cancelled";
        return this.cancelledResult(request);
      }

      this.state = "failed";

      if (isCalcError(error)) {
        this.lastFailure = error;
        return this.failedResult(error);
      }

      throw error;
    } finally {
      this.runtime.stop();
    }
  }

  private pausedResult(request: PrecisionRequest): PausedResult {
    const partial = this.lastCompleted?.value ?? null;

    return Object.freeze({
      status: "paused",
      reason: "time-limit",
      requestedDigits: request.significantDigits,
      verifiedDigits: partial?.verifiedDigits ?? 0,
      partial
    });
  }

  private cancelledResult(request: PrecisionRequest | null): CancelledResult {
    const partial = this.lastCompleted?.value ?? null;

    return Object.freeze({
      status: "cancelled",
      requestedDigits: request?.significantDigits ?? this.lastRequest?.significantDigits ?? 0,
      verifiedDigits: partial?.verifiedDigits ?? 0,
      partial
    });
  }

  private failedResult(error: CalcError): FailedResult {
    const partial = this.lastCompleted?.value ?? null;
    const base = {
      status: "failed",
      error,
      partial
    } as const;

    return this.lastRequest === null
      ? Object.freeze(base)
      : Object.freeze({ ...base, requestedDigits: this.lastRequest.significantDigits });
  }
}

class CalculationRuntime {
  private static readonly DEFAULT_MAX_CHECKPOINTS_PER_RUN = 1_000_000;
  private static readonly DEFAULT_MAX_REQUESTED_DIGITS = 100_000;

  private deadlineMs: number | null = null;
  private cancelled = false;
  private checkpointsThisRun = 0;
  private readonly maxCheckpointsPerRun: number;
  private readonly maxRequestedDigits: number;

  constructor(
    private readonly now: () => number,
    resourceLimits: CalculationResourceLimits = {}
  ) {
    this.maxCheckpointsPerRun = validatePositiveSafeInteger(
      resourceLimits.maxCheckpointsPerRun,
      CalculationRuntime.DEFAULT_MAX_CHECKPOINTS_PER_RUN,
      "maxCheckpointsPerRun"
    );
    this.maxRequestedDigits = validatePositiveSafeInteger(
      resourceLimits.maxRequestedDigits,
      CalculationRuntime.DEFAULT_MAX_REQUESTED_DIGITS,
      "maxRequestedDigits"
    );
  }

  start(maxCalculationTimeMs: number): void {
    this.deadlineMs = this.now() + Math.max(0, maxCalculationTimeMs);
    this.checkpointsThisRun = 0;
  }

  stop(): void {
    this.deadlineMs = null;
  }

  cancel(): void {
    this.cancelled = true;
  }

  guardRequest(significantDigits: number): void {
    if (significantDigits > this.maxRequestedDigits) {
      throw new ResourceLimitException(
        "memory",
        `Requested digits exceed hard size guard: ${String(significantDigits)} > ${String(this.maxRequestedDigits)}`
      );
    }
  }

  checkpoint(): void {
    if (this.cancelled) {
      throw new CancelledSignal();
    }

    this.checkpointsThisRun += 1;
    if (this.checkpointsThisRun > this.maxCheckpointsPerRun) {
      throw new ResourceLimitException(
        "hard-watchdog",
        `Hard watchdog checkpoint limit reached: ${String(this.maxCheckpointsPerRun)}`
      );
    }

    if (this.deadlineMs !== null && this.now() >= this.deadlineMs) {
      throw new SoftTimeoutSignal();
    }
  }
}

function validatePositiveSafeInteger(
  value: number | undefined,
  fallback: number,
  name: string
): number {
  const resolved = value ?? fallback;

  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }

  return resolved;
}

class SoftTimeoutSignal extends Error {
  constructor() {
    super("Calculation paused by soft timeout");
    this.name = "SoftTimeoutSignal";
  }
}

class CancelledSignal extends Error {
  constructor() {
    super(cancelledError().message);
    this.name = "CancelledSignal";
  }
}

function createLifecycleContext(
  options: CalculationHandleOptions,
  runtime: CalculationRuntime
): EvaluationGraphContext {
  const userCheckpoint = options.checkpoint;

  return createEvaluationContext({
    ...options,
    checkpoint(): void {
      userCheckpoint?.();
      runtime.checkpoint();
    }
  });
}
