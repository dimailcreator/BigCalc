import { describe, expect, it } from "vitest";
import {
  createCalculationRequestId,
  createCalculationSessionId,
  createWorkerHandleId
} from "../../../src/app/calculation/CalculationSession.js";
import {
  IDLE_CALCULATION_UI_STATE,
  createExpressionSnapshot,
  createStaleSessionDisposal,
  createViewportDemand,
  transitionCalculationUiState
} from "../../../src/app/state/CalculatorState.js";
import type {
  AppliedCalculationTransition,
  CalculationTransition,
  CalculationUiState
} from "../../../src/app/state/CalculatorState.js";

const sessionId = createCalculationSessionId("session-1");
const workerHandleId = createWorkerHandleId("handle-1");
const firstRequestId = createCalculationRequestId("request-1");
const secondRequestId = createCalculationRequestId("request-2");
const expression = createExpressionSnapshot("2+3", 1);

describe("calculation UI state machine", () => {
  it("runs the valid debounce, timeout, continue, and completion lifecycle", () => {
    let state: CalculationUiState = IDLE_CALCULATION_UI_STATE;

    const debouncing = transitionCalculationUiState(state, {
      type: "expression-changed",
      expression
    });
    requireApplied(debouncing);
    expect(debouncing.disposal).toBeNull();
    state = debouncing.state;

    const running = transitionCalculationUiState(state, {
      type: "debounce-elapsed",
      sessionId,
      workerHandleId,
      requestId: firstRequestId
    });
    requireApplied(running);
    expect(running.state.status).toBe("running");
    state = running.state;

    const paused = transitionCalculationUiState(state, {
      type: "calculation-timed-out",
      sessionId,
      requestId: firstRequestId
    });
    requireApplied(paused);
    expect(paused.state.status).toBe("pausedByTimeout");
    state = paused.state;

    const continued = transitionCalculationUiState(state, {
      type: "continue-requested",
      requestId: secondRequestId
    });
    requireApplied(continued);
    expect(continued.state).toMatchObject({
      status: "running",
      sessionId,
      workerHandleId,
      requestId: secondRequestId
    });

    const completed = transitionCalculationUiState(continued.state, {
      type: "calculation-completed",
      sessionId,
      requestId: secondRequestId
    });
    requireApplied(completed);
    expect(completed.state.status).toBe("completed");
  });

  it("freezes without cancelling or replacing the current Core handle", () => {
    const paused = createPausedState();
    const frozen = transitionCalculationUiState(paused, { type: "freeze-requested" });

    requireApplied(frozen);
    expect(frozen.disposal).toBeNull();
    expect(frozen.state).toMatchObject({
      status: "frozenByUser",
      sessionId,
      workerHandleId,
      requestId: firstRequestId
    });

    const resumed = transitionCalculationUiState(frozen.state, {
      type: "continue-requested",
      requestId: secondRequestId
    });
    requireApplied(resumed);
    expect(resumed.disposal).toBeNull();
    expect(resumed.state).toMatchObject({
      status: "running",
      sessionId,
      workerHandleId,
      requestId: secondRequestId
    });
  });

  it("cancels a frozen session only after a later expression invalidation", () => {
    const frozen = transitionCalculationUiState(createPausedState(), {
      type: "freeze-requested"
    });
    requireApplied(frozen);

    const changed = transitionCalculationUiState(frozen.state, {
      type: "expression-changed",
      expression: createExpressionSnapshot("9", 2)
    });
    requireApplied(changed);
    expect(changed.disposal).toEqual({
      sessionId,
      workerHandleId,
      cancelCore: true,
      reason: "expression-changed"
    });
  });

  it("disposes and cancels an active session when the expression changes", () => {
    const running = createRunningState();
    const nextExpression = createExpressionSnapshot("5+8", 2);
    const changed = transitionCalculationUiState(running, {
      type: "expression-changed",
      expression: nextExpression
    });

    requireApplied(changed);
    expect(changed.state).toEqual({ status: "debouncing", expression: nextExpression });
    expect(changed.disposal).toEqual({
      sessionId,
      workerHandleId,
      cancelCore: true,
      reason: "expression-changed"
    });
  });

  it.each([
    ["settings-changed", "settings-changed"],
    ["clear", "ac"],
    ["calculator-deactivated", "calculator-deactivated"]
  ] as const)("disposes an active session for %s", (eventType, reason) => {
    const running = createRunningState();
    const transition =
      eventType === "settings-changed"
        ? transitionCalculationUiState(running, { type: eventType, expression })
        : transitionCalculationUiState(running, { type: eventType });

    requireApplied(transition);
    expect(transition.disposal).toMatchObject({ cancelCore: true, reason });
  });

  it("disposes completed sessions without issuing a redundant Core cancel", () => {
    const completed = transitionCalculationUiState(createRunningState(), {
      type: "calculation-completed",
      sessionId,
      requestId: firstRequestId
    });
    requireApplied(completed);

    const changed = transitionCalculationUiState(completed.state, {
      type: "expression-changed",
      expression: createExpressionSnapshot("7", 2)
    });
    requireApplied(changed);
    expect(changed.disposal).toMatchObject({ cancelCore: false, reason: "expression-changed" });
  });

  it("ignores results from a stale session", () => {
    const running = createRunningState();
    const transition = transitionCalculationUiState(running, {
      type: "calculation-completed",
      sessionId: createCalculationSessionId("stale-session"),
      requestId: firstRequestId
    });

    expect(transition).toEqual({
      applied: false,
      state: running,
      disposal: null,
      reason: "stale-result"
    });
  });

  it("ignores an old request result from the current session", () => {
    const running = createRunningState();
    const transition = transitionCalculationUiState(running, {
      type: "calculation-failed",
      sessionId,
      requestId: secondRequestId
    });

    expect(transition.applied).toBe(false);
    expect(transition.state).toBe(running);
    if (!transition.applied) expect(transition.reason).toBe("stale-result");
  });

  it("accepts a current failure and rejects invalid lifecycle actions", () => {
    const failed = transitionCalculationUiState(createRunningState(), {
      type: "calculation-failed",
      sessionId,
      requestId: firstRequestId
    });
    requireApplied(failed);
    expect(failed.state.status).toBe("failed");

    const invalidFreeze = transitionCalculationUiState(failed.state, {
      type: "freeze-requested"
    });
    expect(invalidFreeze.applied).toBe(false);
    if (!invalidFreeze.applied) expect(invalidFreeze.reason).toBe("invalid-transition");
  });

  it("marks stale active sessions for real Core cancellation", () => {
    expect(createStaleSessionDisposal(sessionId, workerHandleId)).toEqual({
      sessionId,
      workerHandleId,
      cancelCore: true,
      reason: "stale-session"
    });
  });
});

describe("application contract validation", () => {
  it("rejects empty opaque identifiers", () => {
    expect(() => createCalculationSessionId(" ")).toThrow(TypeError);
    expect(() => createWorkerHandleId("")).toThrow(TypeError);
    expect(() => createCalculationRequestId("\t")).toThrow(TypeError);
  });

  it("validates expression revisions and viewport demand", () => {
    expect(() => createExpressionSnapshot("1", -1)).toThrow(RangeError);
    expect(() => createExpressionSnapshot("1", 1.5)).toThrow(RangeError);
    expect(createViewportDemand(50, "scroll")).toEqual({
      significantDigits: 50,
      reason: "scroll"
    });
    expect(() => createViewportDemand(0, "initial")).toThrow(RangeError);
  });
});

function createRunningState(): CalculationUiState {
  const debouncing = transitionCalculationUiState(IDLE_CALCULATION_UI_STATE, {
    type: "expression-changed",
    expression
  });
  requireApplied(debouncing);

  const running = transitionCalculationUiState(debouncing.state, {
    type: "debounce-elapsed",
    sessionId,
    workerHandleId,
    requestId: firstRequestId
  });
  requireApplied(running);
  return running.state;
}

function createPausedState(): CalculationUiState {
  const paused = transitionCalculationUiState(createRunningState(), {
    type: "calculation-timed-out",
    sessionId,
    requestId: firstRequestId
  });
  requireApplied(paused);
  return paused.state;
}

function requireApplied(
  transition: CalculationTransition
): asserts transition is AppliedCalculationTransition {
  if (!transition.applied) {
    throw new Error(`Expected applied transition, got ${transition.reason}`);
  }
}
