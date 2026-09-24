import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CalculationSettingsDto,
  CreateCalculationResponse,
  RefinementResultDto
} from "../../../src/app/calculation/CalculationProtocol.js";
import { createWorkerHandleId } from "../../../src/app/calculation/CalculationSession.js";
import type {
  CalculationRequestId,
  CalculationSessionId
} from "../../../src/app/calculation/CalculationSession.js";
import { LiveCalculatorController } from "../../../src/app/calculator/LiveCalculatorController.js";
import type {
  CalculationGateway,
  LiveCalculatorViewState
} from "../../../src/app/calculator/LiveCalculatorController.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("LiveCalculatorController", () => {
  it("waits for a full 150 ms quiet period before creating a calculation", async () => {
    vi.useFakeTimers();
    const gateway = new FakeGateway();
    const controller = createController(gateway);

    controller.setExpression("2");
    await vi.advanceTimersByTimeAsync(100);
    controller.setExpression("2+3");
    await vi.advanceTimersByTimeAsync(149);
    expect(gateway.creates).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(gateway.creates).toHaveLength(1);
    expect(gateway.creates[0]?.source).toBe("2+3");
  });

  it("ignores a late refinement from a disposed stale session", async () => {
    vi.useFakeTimers();
    const gateway = new FakeGateway();
    const states: LiveCalculatorViewState[] = [];
    const controller = createController(gateway, (state) => states.push(state));

    controller.setExpression("π");
    await vi.advanceTimersByTimeAsync(150);
    expect(gateway.refinements).toHaveLength(1);

    controller.setExpression("2+3");
    await vi.advanceTimersByTimeAsync(150);
    expect(gateway.refinements).toHaveLength(2);
    expect(gateway.disposals).toEqual([gateway.refinements[0]?.sessionId]);

    gateway.refinements[0]?.deferred.resolve(complete("314159", 0n));
    await Promise.resolve();
    expect(controller.state.resultText).toBe("");

    gateway.refinements[1]?.deferred.resolve(complete("5", 0n, true));
    await Promise.resolve();
    expect(controller.state).toMatchObject({
      source: "2+3",
      phase: "completed",
      resultText: "5",
      resultKind: "value"
    });
    expect(states.at(-1)?.resultText).toBe("5");
  });

  it("hides automatic mathematical errors until explicit equals", async () => {
    vi.useFakeTimers();
    const gateway = new FakeGateway();
    gateway.creationError = {
      type: "create-failed",
      sessionId: null,
      error: {
        kind: "calc-error",
        code: "SyntaxError",
        message: "Unexpected end"
      }
    };
    const controller = createController(gateway);

    controller.setExpression("1+");
    await vi.advanceTimersByTimeAsync(150);
    expect(controller.state).toMatchObject({ phase: "failed", resultText: "" });

    controller.evaluateExplicitly();
    expect(controller.state).toMatchObject({
      phase: "failed",
      resultText: "Ошибка синтаксиса",
      resultKind: "error"
    });
  });

  it("continues the same paused session when equals is pressed", async () => {
    vi.useFakeTimers();
    const gateway = new FakeGateway();
    const controller = createController(gateway);

    controller.setExpression("π");
    await vi.advanceTimersByTimeAsync(150);
    const first = gateway.refinements[0];
    if (first === undefined) throw new Error("Expected initial refinement");
    first.deferred.resolve({
      status: "paused",
      reason: "time-limit",
      requestedDigits: 24,
      verifiedDigits: 0,
      partial: null
    });
    await Promise.resolve();
    expect(controller.state).toMatchObject({
      phase: "pausedByTimeout",
      timeoutDialogOpen: false
    });
    expect(gateway.continuations).toHaveLength(0);

    controller.evaluateExplicitly();
    expect(gateway.continuations).toHaveLength(1);
    expect(gateway.continuations[0]?.sessionId).toBe(first.sessionId);
    gateway.continuations[0]?.deferred.resolve(complete("314159", 0n));
    await Promise.resolve();
    expect(controller.state.resultText).toBe("3,14159...");
  });

  it("keeps an incomplete initial partial result hidden until initial demand completes", async () => {
    vi.useFakeTimers();
    const gateway = new FakeGateway();
    const controller = createController(gateway);
    controller.setExpression("π");
    await vi.advanceTimersByTimeAsync(150);
    gateway.refinements[0]?.deferred.resolve({
      status: "paused",
      reason: "time-limit",
      requestedDigits: 24,
      verifiedDigits: 6,
      partial: {
        sign: 1,
        digits: "314159",
        exponent10: 0n,
        verifiedDigits: 6,
        valueExact: false,
        decimalTerminating: false,
        rounded: false
      }
    });
    await Promise.resolve();
    expect(controller.state).toMatchObject({
      phase: "pausedByTimeout",
      resultKind: "empty",
      resultValue: null,
      timeoutDialogOpen: false
    });

    controller.evaluateExplicitly();
    gateway.continuations[0]?.deferred.resolve(paused(24));
    await Promise.resolve();
    expect(controller.state.timeoutDialogOpen).toBe(true);
  });

  it("keeps the first initial timeout silent when equals was pressed during the running slice", async () => {
    vi.useFakeTimers();
    const gateway = new FakeGateway();
    const controller = createController(gateway);
    controller.setExpression("π");
    await vi.advanceTimersByTimeAsync(150);
    controller.evaluateExplicitly();
    expect(gateway.continuations).toHaveLength(0);
    gateway.refinements[0]?.deferred.resolve(paused(24));
    await Promise.resolve();
    expect(controller.state).toMatchObject({
      phase: "pausedByTimeout",
      timeoutDialogOpen: false
    });

    controller.evaluateExplicitly();
    gateway.continuations[0]?.deferred.resolve(paused(24));
    await Promise.resolve();
    expect(controller.state.timeoutDialogOpen).toBe(true);
  });

  it("shows a dialog on repeated initial timeout and continues the existing handle", async () => {
    vi.useFakeTimers();
    const gateway = new FakeGateway();
    const controller = createController(gateway);
    controller.setExpression("π");
    await vi.advanceTimersByTimeAsync(150);
    const initial = gateway.refinements[0];
    if (initial === undefined) throw new Error("Expected initial refinement");
    initial.deferred.resolve(paused(24));
    await Promise.resolve();
    controller.evaluateExplicitly();
    gateway.continuations[0]?.deferred.resolve(paused(24));
    await Promise.resolve();

    expect(controller.state).toMatchObject({
      phase: "pausedByTimeout",
      timeoutDialogOpen: true,
      resultKind: "empty"
    });
    expect(gateway.creates).toHaveLength(1);
    controller.evaluateExplicitly();
    expect(gateway.continuations).toHaveLength(1);

    controller.continueAfterTimeout();
    expect(gateway.continuations).toHaveLength(2);
    expect(gateway.continuations[1]?.sessionId).toBe(initial.sessionId);
    expect(controller.state.timeoutDialogOpen).toBe(false);
    gateway.continuations[1]?.deferred.resolve(complete("314159", 0n));
    await Promise.resolve();
    expect(controller.state.phase).toBe("completed");
    expect(gateway.creates).toHaveLength(1);
  });

  it("freezes a timed out handle without cancelling it and equals unfreezes it", async () => {
    vi.useFakeTimers();
    const gateway = new FakeGateway();
    const controller = createController(gateway);
    controller.setExpression("π");
    await vi.advanceTimersByTimeAsync(150);
    gateway.refinements[0]?.deferred.resolve(paused(24));
    await Promise.resolve();
    controller.evaluateExplicitly();
    gateway.continuations[0]?.deferred.resolve(paused(24));
    await Promise.resolve();

    controller.freezeAfterTimeout();
    expect(controller.state).toMatchObject({
      phase: "frozenByUser",
      timeoutDialogOpen: false
    });
    expect(gateway.cancellations).toHaveLength(0);
    expect(gateway.disposals).toHaveLength(0);
    controller.requestMoreDigits(56);
    expect(gateway.continuations).toHaveLength(1);

    controller.evaluateExplicitly();
    expect(gateway.continuations).toHaveLength(2);
    expect(gateway.continuations[1]?.sessionId).toBe(gateway.refinements[0]?.sessionId);
    gateway.continuations[1]?.deferred.resolve(paused(24));
    await Promise.resolve();
    expect(controller.state.timeoutDialogOpen).toBe(true);
    expect(gateway.creates).toHaveLength(1);
  });

  it("cancels and disposes a frozen session on expression change", async () => {
    vi.useFakeTimers();
    const gateway = new FakeGateway();
    const controller = createController(gateway);
    controller.setExpression("π");
    await vi.advanceTimersByTimeAsync(150);
    gateway.refinements[0]?.deferred.resolve(paused(24));
    await Promise.resolve();
    controller.evaluateExplicitly();
    gateway.continuations[0]?.deferred.resolve(paused(24));
    await Promise.resolve();
    controller.freezeAfterTimeout();

    const oldSessionId = gateway.refinements[0]?.sessionId;
    controller.setExpression("2+3");
    expect(gateway.cancellations).toEqual([oldSessionId]);
    await Promise.resolve();
    expect(gateway.disposals).toEqual([oldSessionId]);
    await vi.advanceTimersByTimeAsync(150);
    expect(gateway.creates).toHaveLength(2);
    expect(controller.state).toMatchObject({
      source: "2+3",
      phase: "running",
      timeoutDialogOpen: false
    });
  });

  it("restarts with a changed soft time limit and rejects invalid limits", async () => {
    vi.useFakeTimers();
    const gateway = new FakeGateway();
    const controller = createController(gateway);
    controller.setExpression("π");
    await vi.advanceTimersByTimeAsync(150);
    expect(() => {
      controller.setMaxCalculationTimeMs(Number.NaN);
    }).toThrow(RangeError);
    controller.setMaxCalculationTimeMs(1000);
    await vi.advanceTimersByTimeAsync(150);
    expect(gateway.creates).toHaveLength(2);
    expect(gateway.creates[1]?.settings.maxCalculationTimeMs).toBe(1000);
    expect(gateway.cancellations).toEqual([gateway.creates[0]?.sessionId]);
  });

  it("recalculates for settings and AC preserves the selected modes", async () => {
    vi.useFakeTimers();
    const gateway = new FakeGateway();
    const controller = createController(gateway);

    controller.setExpression("sin(30)");
    await vi.advanceTimersByTimeAsync(150);
    controller.toggleAngleMode();
    await vi.advanceTimersByTimeAsync(150);

    expect(gateway.creates).toHaveLength(2);
    expect(gateway.creates[0]?.settings.angleMode).toBe("degrees");
    expect(gateway.creates[1]?.settings.angleMode).toBe("radians");
    controller.toggleFactorialMode();
    controller.clear();
    expect(controller.state).toMatchObject({
      source: "",
      resultText: "",
      phase: "idle",
      settings: { angleMode: "radians", factorialMode: "gamma" }
    });
  });

  it("queues viewport digit demands on the same session and ignores a stale additional result", async () => {
    vi.useFakeTimers();
    const gateway = new FakeGateway();
    const controller = createController(gateway);
    controller.setExpression("π");
    await vi.advanceTimersByTimeAsync(150);
    const initial = gateway.refinements[0];
    if (initial === undefined) throw new Error("Expected initial refinement");
    initial.deferred.resolve(complete("314159", 0n));
    await Promise.resolve();
    expect(controller.state.resultValue?.digits).toBe("314159");

    controller.requestMoreDigits(56);
    controller.requestMoreDigits(106);
    expect(gateway.refinements).toHaveLength(2);
    expect(gateway.refinements[1]?.significantDigits).toBe(56);
    expect(gateway.refinements[1]?.sessionId).toBe(initial.sessionId);
    gateway.refinements[1]?.deferred.resolve(complete("314159" + "2".repeat(50), 0n));
    await Promise.resolve();
    expect(gateway.refinements).toHaveLength(3);
    expect(gateway.refinements[2]?.significantDigits).toBe(106);

    controller.setExpression("2+3");
    gateway.refinements[2]?.deferred.resolve(complete("3".repeat(106), 0n));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(150);
    gateway.refinements[3]?.deferred.resolve(complete("5", 0n, true));
    await Promise.resolve();
    expect(controller.state).toMatchObject({ source: "2+3", resultText: "5" });
    expect(controller.state.resultValue?.digits).toBe("5");
  });

  it("auto-continues a soft timeout during additional digit loading", async () => {
    vi.useFakeTimers();
    const gateway = new FakeGateway();
    const controller = createController(gateway);
    controller.setExpression("π");
    await vi.advanceTimersByTimeAsync(150);
    gateway.refinements[0]?.deferred.resolve(complete("314159", 0n));
    await Promise.resolve();

    controller.requestMoreDigits(56);
    gateway.refinements[1]?.deferred.resolve({
      status: "paused",
      reason: "time-limit",
      requestedDigits: 56,
      verifiedDigits: 10,
      partial: {
        sign: 1,
        digits: "3141592653",
        exponent10: 0n,
        verifiedDigits: 10,
        valueExact: false,
        decimalTerminating: false,
        rounded: false
      }
    });
    await Promise.resolve();
    expect(controller.state.resultValue?.digits).toBe("3141592653");
    expect(controller.state.timeoutDialogOpen).toBe(false);
    expect(gateway.continuations).toHaveLength(1);
    gateway.continuations[0]?.deferred.resolve(complete("314159" + "2".repeat(50), 0n));
    await Promise.resolve();
    expect(controller.state.phase).toBe("completed");
    expect(controller.state.resultValue?.verifiedDigits).toBe(56);
  });
});

interface PendingRefinement {
  readonly sessionId: CalculationSessionId;
  readonly requestId: CalculationRequestId;
  readonly deferred: Deferred<RefinementResultDto>;
  readonly significantDigits?: number;
}

class FakeGateway implements CalculationGateway {
  readonly creates: {
    readonly sessionId: CalculationSessionId;
    readonly source: string;
    readonly settings: CalculationSettingsDto;
  }[] = [];
  readonly refinements: PendingRefinement[] = [];
  readonly continuations: PendingRefinement[] = [];
  readonly disposals: CalculationSessionId[] = [];
  readonly cancellations: CalculationSessionId[] = [];
  creationError: {
    readonly type: "create-failed";
    readonly sessionId: null;
    readonly error: Extract<CreateCalculationResponse, { readonly type: "create-failed" }>["error"];
  } | null = null;

  create(
    sessionId: CalculationSessionId,
    source: string,
    settings: CalculationSettingsDto
  ): Promise<CreateCalculationResponse> {
    this.creates.push({ sessionId, source, settings });
    if (this.creationError !== null) {
      return Promise.resolve({
        type: "create-failed",
        sessionId,
        error: this.creationError.error
      });
    }
    return Promise.resolve({
      type: "created",
      sessionId,
      workerHandleId: createWorkerHandleId(`handle-${sessionId}`)
    });
  }

  refine(
    sessionId: CalculationSessionId,
    requestId: CalculationRequestId,
    significantDigits: number
  ): Promise<RefinementResultDto> {
    const deferred = createDeferred<RefinementResultDto>();
    this.refinements.push({ sessionId, requestId, deferred, significantDigits });
    return deferred.promise;
  }

  continue(
    sessionId: CalculationSessionId,
    requestId: CalculationRequestId
  ): Promise<RefinementResultDto> {
    const deferred = createDeferred<RefinementResultDto>();
    this.continuations.push({ sessionId, requestId, deferred });
    return deferred.promise;
  }

  cancel(sessionId: CalculationSessionId): Promise<void> {
    this.cancellations.push(sessionId);
    return Promise.resolve();
  }

  dispose(sessionId: CalculationSessionId): Promise<void> {
    this.disposals.push(sessionId);
    return Promise.resolve();
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) throw new Error("Failed to create test deferred");
  return { promise, resolve: resolvePromise };
}

function createController(
  gateway: CalculationGateway,
  onChange: (state: LiveCalculatorViewState) => void = () => undefined
): LiveCalculatorController {
  return new LiveCalculatorController(gateway, onChange, {
    initialSignificantDigits: 24
  });
}

function complete(digits: string, exponent10: bigint, exact = false): RefinementResultDto {
  return {
    status: "complete",
    requestedDigits: digits.length,
    value: {
      sign: 1,
      digits,
      exponent10,
      verifiedDigits: digits.length,
      valueExact: exact,
      decimalTerminating: exact,
      rounded: false
    }
  };
}

function paused(requestedDigits: number): RefinementResultDto {
  return {
    status: "paused",
    reason: "time-limit",
    requestedDigits,
    verifiedDigits: 0,
    partial: null
  };
}
