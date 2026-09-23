import type {
  ActiveCalculationIdentity,
  CalculationRequestId,
  CalculationSessionId,
  WorkerHandleId
} from "../calculation/CalculationSession.js";

export interface ExpressionSnapshot {
  readonly source: string;
  readonly revision: number;
}

export interface ViewportDemand {
  readonly significantDigits: number;
  readonly reason: "initial" | "scroll";
}

export interface IdleCalculationUiState {
  readonly status: "idle";
}

export interface DebouncingCalculationUiState {
  readonly status: "debouncing";
  readonly expression: ExpressionSnapshot;
}

interface SessionBoundCalculationUiState extends ActiveCalculationIdentity {
  readonly expression: ExpressionSnapshot;
}

export interface RunningCalculationUiState extends SessionBoundCalculationUiState {
  readonly status: "running";
}

export interface PausedByTimeoutCalculationUiState extends SessionBoundCalculationUiState {
  readonly status: "pausedByTimeout";
}

export interface FrozenByUserCalculationUiState extends SessionBoundCalculationUiState {
  readonly status: "frozenByUser";
}

export interface CompletedCalculationUiState extends SessionBoundCalculationUiState {
  readonly status: "completed";
}

export interface FailedCalculationUiState extends SessionBoundCalculationUiState {
  readonly status: "failed";
}

export type CalculationUiState =
  | IdleCalculationUiState
  | DebouncingCalculationUiState
  | RunningCalculationUiState
  | PausedByTimeoutCalculationUiState
  | FrozenByUserCalculationUiState
  | CompletedCalculationUiState
  | FailedCalculationUiState;

export interface CalculatorUiState {
  readonly expression: ExpressionSnapshot;
  readonly calculation: CalculationUiState;
  readonly viewportDemand: ViewportDemand | null;
}

export type SessionDisposalReason =
  "expression-changed" | "settings-changed" | "ac" | "calculator-deactivated" | "stale-session";

export interface SessionDisposal {
  readonly sessionId: CalculationSessionId;
  readonly workerHandleId: WorkerHandleId;
  readonly cancelCore: boolean;
  readonly reason: SessionDisposalReason;
}

interface ExpressionChangedEvent {
  readonly type: "expression-changed";
  readonly expression: ExpressionSnapshot;
}

interface SettingsChangedEvent {
  readonly type: "settings-changed";
  readonly expression: ExpressionSnapshot;
}

interface DebounceElapsedEvent extends ActiveCalculationIdentity {
  readonly type: "debounce-elapsed";
}

interface AsyncCalculationEvent {
  readonly sessionId: CalculationSessionId;
  readonly requestId: CalculationRequestId;
}

interface CalculationCompletedEvent extends AsyncCalculationEvent {
  readonly type: "calculation-completed";
}

interface CalculationFailedEvent extends AsyncCalculationEvent {
  readonly type: "calculation-failed";
}

interface CalculationTimedOutEvent extends AsyncCalculationEvent {
  readonly type: "calculation-timed-out";
}

interface ContinueRequestedEvent {
  readonly type: "continue-requested";
  readonly requestId: CalculationRequestId;
}

interface FreezeRequestedEvent {
  readonly type: "freeze-requested";
}

interface ClearEvent {
  readonly type: "clear";
}

interface CalculatorDeactivatedEvent {
  readonly type: "calculator-deactivated";
}

export type CalculationUiEvent =
  | ExpressionChangedEvent
  | SettingsChangedEvent
  | DebounceElapsedEvent
  | CalculationCompletedEvent
  | CalculationFailedEvent
  | CalculationTimedOutEvent
  | ContinueRequestedEvent
  | FreezeRequestedEvent
  | ClearEvent
  | CalculatorDeactivatedEvent;

export interface AppliedCalculationTransition {
  readonly applied: true;
  readonly state: CalculationUiState;
  readonly disposal: SessionDisposal | null;
}

export interface IgnoredCalculationTransition {
  readonly applied: false;
  readonly state: CalculationUiState;
  readonly disposal: null;
  readonly reason: "invalid-transition" | "stale-result";
}

export type CalculationTransition = AppliedCalculationTransition | IgnoredCalculationTransition;

export const IDLE_CALCULATION_UI_STATE: IdleCalculationUiState = Object.freeze({ status: "idle" });

export function createExpressionSnapshot(source: string, revision: number): ExpressionSnapshot {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new RangeError("Expression revision must be a non-negative safe integer");
  }

  return Object.freeze({ source, revision });
}

export function createViewportDemand(
  significantDigits: number,
  reason: ViewportDemand["reason"]
): ViewportDemand {
  if (!Number.isSafeInteger(significantDigits) || significantDigits <= 0) {
    throw new RangeError("Viewport demand must request a positive safe integer digit count");
  }

  return Object.freeze({ significantDigits, reason });
}

export function createInitialCalculatorUiState(): CalculatorUiState {
  return Object.freeze({
    expression: createExpressionSnapshot("", 0),
    calculation: IDLE_CALCULATION_UI_STATE,
    viewportDemand: null
  });
}

export function createStaleSessionDisposal(
  sessionId: CalculationSessionId,
  workerHandleId: WorkerHandleId
): SessionDisposal {
  return Object.freeze({
    sessionId,
    workerHandleId,
    cancelCore: true,
    reason: "stale-session"
  });
}

export function transitionCalculationUiState(
  state: CalculationUiState,
  event: CalculationUiEvent
): CalculationTransition {
  switch (event.type) {
    case "expression-changed":
      return beginDebounce(state, event.expression, "expression-changed");
    case "settings-changed":
      return beginDebounce(state, event.expression, "settings-changed");
    case "debounce-elapsed":
      if (state.status !== "debouncing") return ignored(state, "invalid-transition");
      return applied(freezeSessionState("running", state.expression, event), null);
    case "calculation-completed":
      return finishRunningCalculation(state, event, "completed");
    case "calculation-failed":
      return finishRunningCalculation(state, event, "failed");
    case "calculation-timed-out":
      return finishRunningCalculation(state, event, "pausedByTimeout");
    case "continue-requested":
      if (state.status !== "pausedByTimeout" && state.status !== "frozenByUser") {
        return ignored(state, "invalid-transition");
      }
      if (event.requestId === state.requestId) return ignored(state, "invalid-transition");
      return applied(
        freezeSessionState("running", state.expression, {
          sessionId: state.sessionId,
          workerHandleId: state.workerHandleId,
          requestId: event.requestId
        }),
        null
      );
    case "freeze-requested":
      if (state.status !== "pausedByTimeout") return ignored(state, "invalid-transition");
      return applied(freezeSessionState("frozenByUser", state.expression, state), null);
    case "clear":
      return applied(IDLE_CALCULATION_UI_STATE, disposalFor(state, "ac"));
    case "calculator-deactivated":
      return applied(IDLE_CALCULATION_UI_STATE, disposalFor(state, "calculator-deactivated"));
  }
}

function beginDebounce(
  state: CalculationUiState,
  expression: ExpressionSnapshot,
  reason: "expression-changed" | "settings-changed"
): AppliedCalculationTransition {
  return applied(Object.freeze({ status: "debouncing", expression }), disposalFor(state, reason));
}

function finishRunningCalculation(
  state: CalculationUiState,
  event: AsyncCalculationEvent,
  status: "completed" | "failed" | "pausedByTimeout"
): CalculationTransition {
  if (state.status !== "running") return ignored(state, "stale-result");
  if (event.sessionId !== state.sessionId || event.requestId !== state.requestId) {
    return ignored(state, "stale-result");
  }

  return applied(freezeSessionState(status, state.expression, state), null);
}

function freezeSessionState<TStatus extends SessionBoundStatus>(
  status: TStatus,
  expression: ExpressionSnapshot,
  identity: ActiveCalculationIdentity
): SessionStateFor<TStatus> {
  return Object.freeze({
    status,
    expression,
    sessionId: identity.sessionId,
    workerHandleId: identity.workerHandleId,
    requestId: identity.requestId
  }) as SessionStateFor<TStatus>;
}

type SessionBoundStatus = "running" | "pausedByTimeout" | "frozenByUser" | "completed" | "failed";

type SessionStateFor<TStatus extends SessionBoundStatus> = Extract<
  CalculationUiState,
  { readonly status: TStatus }
>;

function disposalFor(
  state: CalculationUiState,
  reason: Exclude<SessionDisposalReason, "stale-session">
): SessionDisposal | null {
  if (state.status === "idle" || state.status === "debouncing") return null;

  return Object.freeze({
    sessionId: state.sessionId,
    workerHandleId: state.workerHandleId,
    cancelCore:
      state.status === "running" ||
      state.status === "pausedByTimeout" ||
      state.status === "frozenByUser",
    reason
  });
}

function applied(
  state: CalculationUiState,
  disposal: SessionDisposal | null
): AppliedCalculationTransition {
  return Object.freeze({ applied: true, state, disposal });
}

function ignored(
  state: CalculationUiState,
  reason: IgnoredCalculationTransition["reason"]
): IgnoredCalculationTransition {
  return Object.freeze({ applied: false, state, disposal: null, reason });
}
