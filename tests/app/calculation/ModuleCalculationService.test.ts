import { afterEach, describe, expect, it, vi } from "vitest";
import { ModuleCalculationService } from "../../../src/app/calculation/ModuleCalculationService.js";
import { CalculationTransportError } from "../../../src/app/calculation/CalculationClient.js";
import type { CalculationClient } from "../../../src/app/calculation/CalculationClient.js";
import type { CalculationGateway } from "../../../src/app/calculator/LiveCalculatorController.js";
import type {
  CalculationSettingsDto,
  CreateCalculationResponse,
  RefinementResultDto
} from "../../../src/app/calculation/CalculationProtocol.js";
import { createWorkerHandleId } from "../../../src/app/calculation/CalculationSession.js";
import { LiveCalculatorController } from "../../../src/app/calculator/LiveCalculatorController.js";
import { CalculationHistory } from "../../../src/app/history/CalculationHistory.js";
import { HistoryResultRefiner } from "../../../src/app/history/HistoryResultRefiner.js";
import { defineCalculatorModule } from "../../../src/app/modules/CalculatorModule.js";
import { CalculatorModuleHost } from "../../../src/app/modules/CalculatorModuleHost.js";
import type { CalculatorModuleServices } from "../../../src/app/input/CalculatorInputs.js";

const settings: CalculationSettingsDto = {
  angleMode: "radians",
  factorialMode: "integer",
  maxCalculationTimeMs: 5000
};
const value = {
  sign: 1 as const,
  digits: "5",
  exponent10: 0n,
  verifiedDigits: 1,
  valueExact: true,
  decimalTerminating: true,
  rounded: false
};
const complete: RefinementResultDto = { status: "complete", requestedDigits: 10, value };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup() {
  const create = vi.fn<CalculationGateway["create"]>(
    (sessionId): Promise<CreateCalculationResponse> =>
      Promise.resolve({
        type: "created",
        sessionId,
        workerHandleId: createWorkerHandleId(`handle-${sessionId}`)
      })
  );
  const gateway = {
    create,
    createStructured: vi.fn<CalculationGateway["createStructured"]>((...args) =>
      create(args[0], "structured", args[3])
    ),
    refine: vi.fn<CalculationGateway["refine"]>(() => Promise.resolve(complete)),
    continue: vi.fn<CalculationGateway["continue"]>(() => Promise.resolve(complete)),
    cancel: vi.fn<CalculationGateway["cancel"]>(() => Promise.resolve()),
    dispose: vi.fn<CalculationGateway["dispose"]>(() => Promise.resolve())
  };
  const service = new ModuleCalculationService(gateway, settings);
  const a = service.createScope();
  const b = service.createScope();
  a.activate();
  b.activate();
  const calculations = (services: CalculatorModuleServices) => {
    if (!services.calculations) throw new Error("Missing calculations");
    return services.calculations;
  };
  const currentSettings = (services: CalculatorModuleServices) => {
    if (!services.settings) throw new Error("Missing settings");
    return services.settings;
  };
  return {
    gateway,
    service,
    a,
    b,
    ca: calculations(a.services),
    cb: calculations(b.services),
    sa: currentSettings(a.services),
    sb: currentSettings(b.services)
  };
}
afterEach(() => vi.useRealTimers());

describe("module calculations over the shared transport", () => {
  it("does not deliver queued settings callbacks after owner disposal or unsubscribe", () => {
    const s = setup();
    const stale = vi.fn();
    const removed = vi.fn();
    const live = vi.fn();
    let unsubscribe: () => void = () => undefined;
    s.sa.subscribe(() => {
      s.a.dispose();
    });
    s.sa.subscribe(stale);
    s.sb.subscribe(() => {
      unsubscribe();
    });
    unsubscribe = s.sb.subscribe(removed);
    s.sb.subscribe(live);
    s.service.updateSettings({ ...settings, factorialMode: "gamma" });
    expect(stale).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
    expect(live).toHaveBeenCalledTimes(1);
  });
  it.each([0, 0.5])(
    "preserves the existing non-negative finite timeout contract: %s ms",
    (maxCalculationTimeMs) => {
      const s = setup();
      s.service.updateSettings({ ...settings, maxCalculationTimeMs });
      expect(s.ca.create("1").settings.maxCalculationTimeMs).toBe(maxCalculationTimeMs);
    }
  );
  it("copies only evaluation settings and keeps each session's snapshot immutable", async () => {
    const s = setup();
    const input = { ...settings, theme: "dark" };
    const session = s.ca.create("2+3", input);
    input.angleMode = "degrees";
    expect(session.settings).toEqual(settings);
    expect(Object.isFrozen(session.settings)).toBe(true);
    expect(Object.isFrozen(s.sa.read())).toBe(true);
    expect(await session.ready).toEqual({ ok: true });
    expect(await session.refine(10)).toEqual(complete);
  });

  it("routes independent sessions and isolates cancel/dispose, including two sessions of one owner", async () => {
    const s = setup();
    const first = s.ca.create("1");
    const factor = s.ca.create("2");
    const second = s.cb.create("3");
    await Promise.all([first.ready, factor.ready, second.ready]);
    const ids = s.gateway.create.mock.calls.map(([id]) => id);
    expect(new Set(ids).size).toBe(3);
    await first.cancel();
    await first.cancel();
    await expect(first.continue()).rejects.toMatchObject({ code: "SessionDisposed" });
    expect(s.gateway.cancel.mock.calls).toEqual([[ids[0]]]);
    await factor.dispose();
    await factor.dispose();
    expect(s.gateway.dispose.mock.calls).toEqual([[ids[1]]]);
    await expect(second.refine(10)).resolves.toEqual(complete);
    expect(s.gateway.refine.mock.calls[0]?.[0]).toBe(ids[2]);
  });

  it("retains a paused handle and continues it without affecting other owners", async () => {
    const s = setup();
    s.gateway.refine.mockResolvedValueOnce({
      status: "paused",
      reason: "time-limit",
      requestedDigits: 10,
      verifiedDigits: 0,
      partial: null
    });
    const session = s.ca.create("π");
    expect((await session.refine(10)).status).toBe("paused");
    await s.cb.create("1").dispose();
    expect(s.gateway.cancel).not.toHaveBeenCalled();
    expect((await session.continue()).status).toBe("complete");
    expect(s.gateway.refine.mock.calls[0]?.[0]).toBe(s.gateway.continue.mock.calls[0]?.[0]);
    expect(s.gateway.refine.mock.calls[0]?.[1]).not.toBe(s.gateway.continue.mock.calls[0]?.[1]);
  });

  it("allows at most one pending refinement even while creation is pending", async () => {
    const s = setup();
    const creation = deferred<CreateCalculationResponse>();
    s.gateway.create.mockReturnValueOnce(creation.promise);
    const session = s.ca.create("π");
    const pending = session.refine(10);
    await expect(session.continue()).rejects.toMatchObject({ code: "DuplicatePendingOperation" });
    const id = s.gateway.create.mock.calls[0]?.[0];
    if (!id) throw new Error("Missing session ID");
    creation.resolve({
      type: "created",
      sessionId: id,
      workerHandleId: createWorkerHandleId("pending")
    });
    await pending;
    expect(s.gateway.refine).toHaveBeenCalledTimes(1);
  });

  it("disposes a late created handle and prevents its old result from winning", async () => {
    const s = setup();
    const creation = deferred<CreateCalculationResponse>();
    s.gateway.create.mockReturnValueOnce(creation.promise);
    const old = s.ca.create("old");
    const pending = expect(old.refine(10)).rejects.toMatchObject({ code: "SessionDisposed" });
    await old.dispose();
    const next = s.ca.create("next");
    const id = s.gateway.create.mock.calls[0]?.[0];
    if (!id) throw new Error("Missing ID");
    creation.resolve({
      type: "created",
      sessionId: id,
      workerHandleId: createWorkerHandleId("late")
    });
    await pending;
    expect(s.gateway.dispose.mock.calls).toEqual([[id], [id]]);
    await expect(next.refine(10)).resolves.toEqual(complete);
    expect(s.gateway.refine.mock.calls[0]?.[0]).not.toBe(id);
  });

  it("rejects a delayed refinement after owner deactivation and keeps another owner usable", async () => {
    const s = setup();
    const result = deferred<RefinementResultDto>();
    s.gateway.refine.mockReturnValueOnce(result.promise);
    const old = s.ca.create("π");
    await old.ready;
    const work = old.refine(10);
    await Promise.resolve();
    const rejection = expect(work).rejects.toMatchObject({ code: "SessionDisposed" });
    s.a.deactivate();
    result.resolve(complete);
    await rejection;
    expect(() => s.ca.create("inactive")).toThrow(CalculationTransportError);
    await expect(s.cb.create("2").refine(10)).resolves.toEqual(complete);
    s.a.activate();
    await expect(s.ca.create("3").refine(10)).resolves.toEqual(complete);
  });

  it("preserves mathematical create/refinement errors as DTOs, separately from transport failures", async () => {
    const s = setup();
    const syntax = {
      kind: "calc-error" as const,
      code: "SyntaxError" as const,
      message: "Invalid source"
    };
    s.gateway.create.mockImplementationOnce((sessionId) =>
      Promise.resolve({ type: "create-failed", sessionId, error: syntax })
    );
    const broken = s.ca.create("(");
    expect(await broken.ready).toEqual({ ok: false, error: syntax });
    expect(await broken.refine(10)).toEqual({ status: "failed", error: syntax });
    expect(s.gateway.refine).not.toHaveBeenCalled();
    const failure: RefinementResultDto = {
      status: "failed",
      error: { kind: "calc-error", code: "DomainError", operation: "sqrt", message: "Negative" }
    };
    s.gateway.refine.mockResolvedValueOnce(failure);
    expect(await s.cb.create("√(-1)").refine(10)).toEqual(failure);
  });

  it.each(["WorkerCrashed", "ProtocolViolation", "WorkerRejectedCommand"] as const)(
    "preserves %s transport failure",
    async (code) => {
      const s = setup();
      s.gateway.create.mockRejectedValueOnce(
        new CalculationTransportError(code, "Transport failed", "CoreBoundaryFailure")
      );
      await expect(s.ca.create("1").refine(10)).rejects.toMatchObject({
        name: "CalculationTransportError",
        code,
        workerCode: "CoreBoundaryFailure"
      });
      s.gateway.refine.mockRejectedValueOnce(new Error("Unexpected transport failure"));
      await expect(s.cb.create("2").refine(10)).rejects.toMatchObject({
        code: "ProtocolViolation"
      });
    }
  );

  it("invalidates old work before notifying settings subscribers; snapshot and unsubscribe stay isolated", async () => {
    const s = setup();
    const old = s.ca.create("1");
    const observed: CalculationSettingsDto[] = [];
    const listener = vi.fn((next: CalculationSettingsDto) => {
      observed.push(next);
      expect(s.gateway.dispose).toHaveBeenCalled();
    });
    const unsubscribe = s.sa.subscribe(listener);
    const other = vi.fn();
    s.sb.subscribe(other);
    s.service.updateSettings({ ...settings, angleMode: "degrees" });
    await expect(old.refine(10)).rejects.toMatchObject({ code: "SessionDisposed" });
    expect(s.sa.read()).toBe(observed[0]);
    expect(s.sa.read()).toBe(s.sb.read());
    expect(old.settings.angleMode).toBe("radians");
    s.service.updateSettings({ ...settings, angleMode: "degrees" });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    unsubscribe();
    s.service.updateSettings({ ...settings, factorialMode: "gamma" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(2);
    s.b.dispose();
    s.service.updateSettings(settings);
    expect(other).toHaveBeenCalledTimes(2);
  });

  it("cleans multiple sessions and subscriptions on App disposal without terminating the gateway", async () => {
    const s = setup();
    const sessions = [s.ca.create("1"), s.ca.create("2"), s.cb.create("3")];
    await Promise.all(sessions.map((session) => session.ready));
    const listener = vi.fn();
    s.sa.subscribe(listener);
    s.service.dispose();
    s.service.dispose();
    s.a.dispose();
    expect(s.gateway.dispose).toHaveBeenCalledTimes(3);
    expect(() => s.service.createScope()).toThrow(CalculationTransportError);
    expect(() => s.ca.create("4")).toThrow(CalculationTransportError);
    expect(() => s.sa.subscribe(listener)).toThrow(CalculationTransportError);
    s.service.updateSettings({ ...settings, angleMode: "degrees" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("uses globally unique IDs across two primary controllers, history and module owners", async () => {
    vi.useFakeTimers();
    const s = setup();
    const controllers = [1, 2].map(
      () =>
        new LiveCalculatorController(s.gateway, vi.fn(), {
          initialSignificantDigits: 10,
          initialSettings: settings,
          debounceMs: 0
        })
    );
    for (const controller of controllers) controller.setExpression("2+3");
    await vi.advanceTimersByTimeAsync(0);
    const history = new CalculationHistory(() => "entry");
    const entry = history.record({
      expression: [{ kind: "source", source: "2+3" }],
      originalExpressionText: "2+3",
      displayedResultText: "5",
      resultValue: value,
      settings: { ...settings, angleMode: "degrees" }
    });
    const refiner = new HistoryResultRefiner(
      s.gateway as unknown as CalculationClient,
      history,
      entry,
      vi.fn()
    );
    refiner.request(20);
    await Promise.all([s.ca.create("4").refine(10), s.cb.create("5").refine(10)]);
    const ids = s.gateway.create.mock.calls.map(([id]) => id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    const requests = s.gateway.refine.mock.calls.map(([, request]) => request);
    expect(new Set(requests).size).toBe(requests.length);
    expect(s.gateway.createStructured.mock.calls[0]?.[3].angleMode).toBe("degrees");
    expect(s.gateway.createStructured.mock.calls[0]?.[2]).toEqual([]);
    // Structured replay owns the historical snapshot, independent of current module settings.
    expect(entry.settings.angleMode).toBe("degrees");
    for (const controller of controllers) controller.dispose();
    refiner.dispose();
    s.service.dispose();
  });

  it("activates scope before module hooks and disposes its calculations before deactivation", async () => {
    const s = setup();
    let services: CalculatorModuleServices | undefined;
    let session: ReturnType<typeof s.ca.create> | undefined;
    const host = new CalculatorModuleHost(
      [
        defineCalculatorModule({ id: "primary", title: "Primary", createState: () => null }),
        defineCalculatorModule({
          id: "probe",
          title: "Probe",
          createState: () => null,
          createView(_state, context) {
            services = context;
            return { root: {} as HTMLElement };
          },
          activate() {
            session = services?.calculations?.create("2+3");
          },
          deactivate() {
            expect(s.gateway.dispose).toHaveBeenCalled();
          }
        })
      ],
      { load: () => null, save: () => true },
      () => s.service.createScope()
    );
    host.navigationModules[0]?.onDeactivate?.();
    host.navigationModules[1]?.onActivate?.();
    expect(session).toBeDefined();
    await session?.ready;
    host.navigationModules[1]?.onDeactivate?.();
    await expect(session?.refine(10)).rejects.toMatchObject({ code: "SessionDisposed" });
    host.dispose();
  });
});
