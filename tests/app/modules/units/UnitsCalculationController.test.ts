import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnitsCalculationController } from "../../../../src/app/modules/units/UnitsCalculationController.js";
import type { UnitsSources } from "../../../../src/app/modules/units/UnitsCalculationController.js";
import { CalculationTransportError } from "../../../../src/app/calculation/CalculationClient.js";
import type {
  ModuleCalculationCreation,
  ModuleCalculationSession,
  ModuleEvaluationSettings
} from "../../../../src/app/calculation/ModuleCalculationService.js";
import type {
  CalculationSettingsDto,
  RefinementResultDto,
  VerifiedNumberDto
} from "../../../../src/app/calculation/CalculationProtocol.js";

const initial: CalculationSettingsDto = Object.freeze({
  angleMode: "radians",
  factorialMode: "integer",
  maxCalculationTimeMs: 5000
});
const sources: UnitsSources = { valueSource: "1", fromUnitText: "km/h", toUnitText: "m/s" };
function number(digits = "277777777777777777", exact = false): VerifiedNumberDto {
  return {
    sign: 1,
    digits,
    exponent10: -1n,
    verifiedDigits: digits.length,
    valueExact: exact,
    decimalTerminating: exact,
    rounded: false
  };
}
function complete(value = number()): RefinementResultDto {
  return { status: "complete", requestedDigits: value.verifiedDigits, value };
}
const paused: RefinementResultDto = {
  status: "paused",
  reason: "time-limit",
  requestedDigits: 18,
  verifiedDigits: 0,
  partial: null
};
const syntax: RefinementResultDto = {
  status: "failed",
  error: { kind: "calc-error", code: "SyntaxError", message: "Invalid value" }
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function session(source: string, settings: CalculationSettingsDto) {
  return {
    source,
    settings,
    ready: Promise.resolve<ModuleCalculationCreation>({ ok: true }),
    refine: vi.fn<ModuleCalculationSession["refine"]>(() => Promise.resolve(complete())),
    continue: vi.fn<ModuleCalculationSession["continue"]>(() => Promise.resolve(complete())),
    cancel: vi.fn<ModuleCalculationSession["cancel"]>(() => Promise.resolve()),
    dispose: vi.fn<ModuleCalculationSession["dispose"]>(() => Promise.resolve())
  };
}
function latest(sessions: ReturnType<typeof session>[]): ReturnType<typeof session> {
  const result = sessions.at(-1);
  if (result === undefined) throw new Error("No test session created");
  return result;
}
function setup() {
  const sessions: ReturnType<typeof session>[] = [];
  const create = vi.fn((source: string, settings: CalculationSettingsDto = initial) => {
    const next = session(source, settings);
    sessions.push(next);
    return next;
  });
  let current = initial;
  const listeners = new Set<(settings: CalculationSettingsDto) => void>();
  const settings: ModuleEvaluationSettings = {
    read: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
  const changed = vi.fn();
  const controller = new UnitsCalculationController({ create }, settings, changed, {
    initialSignificantDigits: 18,
    debounceMs: 150,
    initialSources: sources
  });
  const update = (next: CalculationSettingsDto) => {
    current = Object.freeze(next);
    for (const listener of listeners) listener(current);
  };
  const start = () => {
    controller.activate();
    controller.submit();
    return latest(sessions);
  };
  return { controller, create, sessions, changed, update, listeners, start };
}
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Units module source revisions and lifecycle", () => {
  it("starts inactive and debounces rapid edits into one latest source", async () => {
    const s = setup();
    expect(s.controller.state.phase).toBe("idle");
    expect(s.create).not.toHaveBeenCalled();
    s.controller.activate();
    for (const valueSource of ["2", "3", "4"]) s.controller.setSources({ ...sources, valueSource });
    await vi.advanceTimersByTimeAsync(149);
    expect(s.create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.create).toHaveBeenCalledTimes(1);
    expect(s.sessions[0]?.source).toMatch(/^\(4\)/);
    expect(s.controller.state.result).toEqual(number());
  });
  it.each(["valueSource", "fromUnitText", "toUnitText"] as const)(
    "immediately clears output for a new %s revision",
    async (field) => {
      const s = setup();
      const old = s.start();
      await flush();
      const generation = s.controller.state.generation;
      s.controller.setSources({ ...sources, [field]: "" });
      expect(s.controller.state).toMatchObject({
        result: null,
        error: null,
        phase: "idle",
        generation: generation + 1
      });
      expect(old.cancel).toHaveBeenCalledTimes(1);
      expect(old.dispose).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(300);
      expect(s.create).toHaveBeenCalledTimes(1);
    }
  );
  it("snapshots original source and editor representation before debounce", async () => {
    const s = setup();
    s.controller.activate();
    const input = { ...sources };
    const editor = { kind: "source" as const, source: "π" };
    s.controller.setSources(input, editor);
    editor.source = "4";
    input.fromUnitText = "s";
    await vi.advanceTimersByTimeAsync(150);
    expect(s.sessions[0]?.source).toMatch(/^\(π\)/);
    expect(s.controller.state.sources).toEqual({ ...sources, valueSource: "π" });
    expect(Object.isFrozen(s.controller.state.sources)).toBe(true);
  });
  it.each([
    ["m", "s", "DimensionMismatch", "conversion"],
    ["unknown", "m", "UnknownUnit", "fromUnit"],
    ["m", "unknown", "UnknownUnit", "toUnit"],
    ["°C*m", "K", "AffineInProduct", "fromUnit"],
    ["°C", "K*m/m", "AffineCounterpart", "conversion"]
  ])("blocks %s → %s before Worker", (fromUnitText, toUnitText, code, field) => {
    const s = setup();
    s.controller.activate();
    s.controller.setSources({ valueSource: "1", fromUnitText, toUnitText });
    s.controller.submit();
    expect(s.create).not.toHaveBeenCalled();
    expect(s.controller.state.error).toMatchObject({ kind: "unit", field, error: { code } });
  });
  it.each(["(", "m^", "m/"])(
    "keeps incomplete unit %s neutral live, diagnostic on submit",
    async (fromUnitText) => {
      const s = setup();
      s.controller.activate();
      s.controller.setSources({ ...sources, fromUnitText });
      await vi.advanceTimersByTimeAsync(150);
      expect(s.controller.state).toMatchObject({ phase: "idle", result: null, error: null });
      s.controller.submit();
      expect(s.controller.state.error?.kind).toBe("unit");
      expect(s.create).not.toHaveBeenCalled();
    }
  );
  it("rejects typed and structured Ans before session creation", () => {
    const s = setup();
    s.controller.activate();
    s.controller.setSources({ ...sources, valueSource: "Ans+1" });
    s.controller.submit();
    expect(s.controller.state.error).toMatchObject({
      kind: "unit",
      field: "value",
      error: { code: "HistoryReferenceNotAllowed" }
    });
    s.controller.setSources(sources, { kind: "requires-ans-resolution", tokens: [] });
    s.controller.submit();
    expect(s.create).not.toHaveBeenCalled();
  });
  it("parses wrapper-escaping value unchanged with Core and never refines it", async () => {
    const s = setup();
    s.controller.activate();
    s.controller.setSources({ ...sources, valueSource: "1)*2+(3" });
    s.create.mockImplementationOnce(
      (source: string, settings: CalculationSettingsDto = initial) => {
        const handle = session(source, settings);

        handle.ready = Promise.resolve({ ok: false, error: syntax.error });
        s.sessions.push(handle);
        return handle;
      }
    );
    s.controller.submit();
    await flush();
    expect(s.sessions[0]?.source).toBe("1)*2+(3");
    expect(s.sessions[0]?.refine).not.toHaveBeenCalled();
    expect(s.controller.state.error).toMatchObject({
      kind: "core",
      error: { code: "SyntaxError" }
    });
  });
  it("keeps incomplete mathematical syntax neutral live and exposes Core's error on submit", async () => {
    const s = setup();
    s.controller.activate();
    s.create.mockImplementation((source: string, settings: CalculationSettingsDto = initial) => {
      const handle = session(source, settings);
      handle.refine.mockResolvedValue(syntax);
      s.sessions.push(handle);
      return handle;
    });
    s.controller.setSources({ ...sources, valueSource: "1+" });
    await vi.advanceTimersByTimeAsync(150);
    expect(s.controller.state).toMatchObject({ phase: "idle", error: null, result: null });
    s.controller.submit();
    await flush();
    expect(s.controller.state.error).toMatchObject({
      kind: "core",
      error: { code: "SyntaxError" }
    });
  });
  it("never treats an accepted unbalanced raw value as a conversion result", async () => {
    const s = setup();
    s.controller.activate();
    s.controller.setSources({ ...sources, valueSource: "1)" });
    s.controller.submit();
    await flush();
    expect(s.controller.state.error).toMatchObject({
      kind: "transport",
      error: { code: "ProtocolViolation" }
    });
    expect(latest(s.sessions).refine).not.toHaveBeenCalled();
    expect(s.controller.state.result).toBeNull();
  });
  it("retains synchronous create failure as transport, clears it when source changes", () => {
    const s = setup();
    s.create.mockImplementationOnce(() => {
      throw new CalculationTransportError("SessionDisposed", "inactive scope");
    });
    s.controller.activate();
    s.controller.submit();
    expect(s.controller.state.error).toMatchObject({
      kind: "transport",
      error: { code: "SessionDisposed" }
    });
    s.controller.setSources({ ...sources, valueSource: "2" });
    expect(s.controller.state.error).toBeNull();
  });
  it.each(["complete", "failed", "cancelled", "transport"])(
    "ignores stale %s after newer source",
    async (outcome) => {
      const s = setup();
      const pending = deferred<RefinementResultDto>();
      s.start();
      // Start a distinct pending revision, then replace it with a completed one.
      s.controller.setSources({ ...sources, valueSource: "2" });
      s.create.mockImplementationOnce(
        (source: string, settings: CalculationSettingsDto = initial) => {
          const next = session(source, settings);
          next.refine.mockReturnValue(pending.promise);
          s.sessions.push(next);
          return next;
        }
      );
      s.controller.submit();
      const stale = latest(s.sessions);
      s.controller.setSources({ ...sources, valueSource: "3" });
      s.controller.submit();
      await flush();
      const before = s.controller.state;
      if (outcome === "transport")
        pending.reject(new CalculationTransportError("WorkerCrashed", "old crash"));
      else
        pending.resolve(
          outcome === "complete"
            ? complete(number("999"))
            : outcome === "failed"
              ? syntax
              : { status: "cancelled", requestedDigits: 18, verifiedDigits: 0, partial: null }
        );
      await flush();
      expect(s.controller.state).toEqual(before);
      expect(stale.cancel).toHaveBeenCalledTimes(1);
      expect(stale.dispose).toHaveBeenCalledTimes(1);
    }
  );
  it("ignores stale ready rejection, including value syntax preflight", async () => {
    const s = setup();
    const pending = deferred<ModuleCalculationCreation>();
    s.create.mockImplementationOnce(
      (source: string, settings: CalculationSettingsDto = initial) => {
        const next = session(source, settings);
        next.ready = pending.promise;
        s.sessions.push(next);
        return next;
      }
    );
    s.controller.activate();
    s.controller.setSources({ ...sources, valueSource: "(" });
    s.controller.submit();
    s.controller.setSources(sources);
    s.controller.submit();
    await flush();
    pending.reject(new CalculationTransportError("SessionDisposed", "stale creation"));
    await flush();
    expect(s.controller.state.phase).toBe("completed");
    expect(s.controller.state.error).toBeNull();
  });
  it("continues first hidden pause; repeat explicit pause opens dialog; cancel freezes without losing handle", async () => {
    const s = setup();
    s.controller.activate();
    s.create.mockImplementationOnce(
      (source: string, settings: CalculationSettingsDto = initial) => {
        const next = session(source, settings);
        next.refine.mockResolvedValue(paused);
        next.continue.mockResolvedValueOnce(paused).mockResolvedValueOnce(complete());
        s.sessions.push(next);
        return next;
      }
    );
    await vi.advanceTimersByTimeAsync(150);
    const handle = latest(s.sessions);
    expect(s.controller.state).toMatchObject({
      phase: "pausedByTimeout",
      timeoutDialogOpen: false,
      result: null
    });
    s.controller.submit();
    await flush();
    expect(s.controller.state).toMatchObject({ phase: "pausedByTimeout", timeoutDialogOpen: true });
    s.controller.cancelTimeout();
    expect(s.controller.state.phase).toBe("frozenByUser");
    expect(handle.cancel).not.toHaveBeenCalled();
    expect(handle.dispose).not.toHaveBeenCalled();
    s.controller.continueCalculation();
    await flush();
    expect(s.controller.state.phase).toBe("completed");
    expect(handle.continue).toHaveBeenCalledTimes(2);
    expect(s.create).toHaveBeenCalledTimes(1);
  });
  it("explicit submit during running does not duplicate pending refinement and opens timeout dialog", async () => {
    const s = setup();
    const pending = deferred<RefinementResultDto>();
    s.create.mockImplementationOnce(
      (source: string, settings: CalculationSettingsDto = initial) => {
        const next = session(source, settings);
        next.refine.mockReturnValue(pending.promise);
        s.sessions.push(next);
        return next;
      }
    );
    const handle = s.start();
    s.controller.submit();
    s.controller.submit();
    pending.resolve(paused);
    await flush();
    expect(handle.refine).toHaveBeenCalledTimes(1);
    expect(handle.continue).not.toHaveBeenCalled();
    expect(s.controller.state.timeoutDialogOpen).toBe(true);
  });
  it("confirms completed source without creating any new calculation or history work", async () => {
    const s = setup();
    const handle = s.start();
    await flush();
    const result = s.controller.state.result;
    s.controller.submit();
    await vi.advanceTimersByTimeAsync(200);
    expect(s.create).toHaveBeenCalledTimes(1);
    expect(handle.refine).toHaveBeenCalledTimes(1);
    expect(s.controller.state.result).toBe(result);
  });
  it("retries a failed session on explicit submit", async () => {
    const s = setup();
    s.create.mockImplementationOnce(
      (source: string, settings: CalculationSettingsDto = initial) => {
        const next = session(source, settings);
        next.refine.mockRejectedValue(new CalculationTransportError("WorkerCrashed", "crash"));
        s.sessions.push(next);
        return next;
      }
    );
    const old = s.start();
    await flush();
    expect(s.controller.state.error).toMatchObject({
      kind: "transport",
      error: { code: "WorkerCrashed" }
    });
    expect(old.dispose).toHaveBeenCalledTimes(1);
    s.controller.submit();
    await flush();
    expect(s.create).toHaveBeenCalledTimes(2);
    expect(s.controller.state.phase).toBe("completed");
  });
  it.each(["DomainError", "DivisionByZeroError", "PrecisionError", "ResourceLimitError"] as const)(
    "retains Core %s as a separate error",
    async (code) => {
      const s = setup();
      s.create.mockImplementationOnce(
        (source: string, settings: CalculationSettingsDto = initial) => {
          const next = session(source, settings);
          const error =
            code === "DomainError"
              ? { kind: "calc-error" as const, code, message: "bad", operation: "sqrt" }
              : code === "ResourceLimitError"
                ? { kind: "calc-error" as const, code, message: "bad", resource: "memory" as const }
                : { kind: "calc-error" as const, code, message: "bad" };
          next.refine.mockResolvedValue({ status: "failed", error });
          s.sessions.push(next);
          return next;
        }
      );
      s.start();
      await flush();
      expect(s.controller.state.error).toMatchObject({ kind: "core", error: { code } });
    }
  );
  it("requests only initial viewport demand and coalesces additional demand on the same handle", async () => {
    const s = setup();
    const handle = s.start();
    await flush();
    expect(handle.refine.mock.calls).toEqual([[18]]);
    const pending = deferred<RefinementResultDto>();
    handle.refine
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(complete(number("2" + "7".repeat(89))));
    s.controller.requestMoreDigits(40);
    s.controller.requestMoreDigits(60);
    s.controller.requestMoreDigits(90);
    expect(handle.refine.mock.calls).toEqual([[18], [40]]);
    pending.resolve(complete(number("2" + "7".repeat(39))));
    await flush();
    expect(handle.refine.mock.calls).toEqual([[18], [40], [90]]);
    expect(s.create).toHaveBeenCalledTimes(1);
  });
  it("automatically continues additional-digit timeout with monotonic partial results", async () => {
    const s = setup();
    const handle = s.start();
    await flush();
    handle.refine.mockResolvedValueOnce({ ...paused, partial: number("2777"), verifiedDigits: 4 });
    const resumed = deferred<RefinementResultDto>();
    handle.continue.mockReturnValueOnce(resumed.promise);
    s.controller.requestMoreDigits(60);
    await flush();
    expect(handle.continue).toHaveBeenCalledTimes(1);
    expect(s.controller.state.result?.verifiedDigits).toBe(18);
    expect(s.controller.state.timeoutDialogOpen).toBe(false);
    resumed.resolve(complete(number("2" + "7".repeat(59))));
    await flush();
    expect(s.controller.state.result?.verifiedDigits).toBe(60);
  });
  it("ignores stale continuation after source replacement", async () => {
    const s = setup();
    const handle = s.start();
    await flush();
    const resumed = deferred<RefinementResultDto>();
    handle.refine.mockResolvedValueOnce(paused);
    handle.continue.mockReturnValueOnce(resumed.promise);
    s.controller.requestMoreDigits(60);
    await flush();
    s.controller.setSources({ ...sources, valueSource: "8" });
    s.controller.submit();
    await flush();
    resumed.resolve(complete(number("999")));
    await flush();
    expect(s.controller.state.result).toEqual(number());
    expect(s.controller.state.sources.valueSource).toBe("8");
  });
  it.each(["exact", "rounded"])(
    "does not request more digits for a finite %s result",
    async (kind) => {
      const s = setup();
      s.create.mockImplementationOnce(
        (source: string, settings: CalculationSettingsDto = initial) => {
          const next = session(source, settings);
          next.refine.mockResolvedValue(
            complete({ ...number("5", kind === "exact"), rounded: kind === "rounded" })
          );
          s.sessions.push(next);
          return next;
        }
      );
      const handle = s.start();
      await flush();
      s.controller.requestMoreDigits(1000);
      expect(handle.refine).toHaveBeenCalledTimes(1);
    }
  );
  it("settings change cancels old work; identical evaluation settings do not recreate it", async () => {
    const s = setup();
    const old = s.start();
    await flush();
    s.update({ ...initial });
    expect(old.cancel).not.toHaveBeenCalled();
    s.update({ ...initial, angleMode: "degrees" });
    expect(old.cancel).toHaveBeenCalledTimes(1);
    expect(s.controller.state.result).toBeNull();
    await vi.advanceTimersByTimeAsync(150);
    expect(s.sessions.at(-1)?.settings.angleMode).toBe("degrees");
  });
  it("deactivation cancels pending work; reactivation recomputes; disposal unsubscribes", async () => {
    const s = setup();
    const pending = deferred<RefinementResultDto>();
    s.create.mockImplementationOnce(
      (source: string, settings: CalculationSettingsDto = initial) => {
        const next = session(source, settings);
        next.refine.mockReturnValue(pending.promise);
        s.sessions.push(next);
        return next;
      }
    );
    const old = s.start();
    s.controller.deactivate();
    pending.resolve(complete());
    await flush();
    expect(s.controller.state).toMatchObject({ active: false, result: null, phase: "idle" });
    expect(old.cancel).toHaveBeenCalledTimes(1);
    expect(old.dispose).toHaveBeenCalledTimes(1);
    s.controller.activate();
    await vi.advanceTimersByTimeAsync(150);
    expect(s.create).toHaveBeenCalledTimes(2);
    s.controller.dispose();
    s.controller.dispose();
    expect(s.listeners.size).toBe(0);
    s.controller.activate();
    s.controller.submit();
    s.update({ ...initial, angleMode: "degrees" });
    await vi.advanceTimersByTimeAsync(300);
    expect(s.create).toHaveBeenCalledTimes(2);
  });
  it.each([0, -1, 1.5, Infinity, NaN])("rejects invalid precision demand %s", (digits) => {
    const s = setup();
    expect(() => {
      s.controller.requestMoreDigits(digits);
    }).toThrow(RangeError);
  });
});
