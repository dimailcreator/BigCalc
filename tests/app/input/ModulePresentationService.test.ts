import { describe, expect, it, vi } from "vitest";
import { ModulePresentationService } from "../../../src/app/input/ModulePresentationService.js";
import type { CalculatorModuleServiceScope } from "../../../src/app/input/CalculatorInputs.js";

function inner() {
  return { services: {}, activate: vi.fn(), deactivate: vi.fn(), dispose: vi.fn() };
}
const actions = () => ({ onContinue: vi.fn(), onFreeze: vi.fn() });
function presentation(scope: CalculatorModuleServiceScope) {
  const value = scope.services.presentation;
  if (value === undefined) throw new Error("Missing presentation service");
  return value;
}
function timeout(service: ModulePresentationService) {
  const value = service.timeoutActions;
  if (value === null) throw new Error("Missing timeout actions");
  return value;
}
describe("Module presentation ownership", () => {
  it("ignores inactive/disposed timeout requests and releases before inner cleanup", () => {
    const changed = vi.fn();
    const service = new ModulePresentationService(1, changed);
    const wrapped = inner();
    const scope = service.createScope(wrapped);
    const ui = presentation(scope);
    const handlers = actions();
    ui.setTimeout(handlers);
    expect(service.timeoutActions).toBeNull();
    scope.activate();
    ui.setTimeout(handlers);
    expect(service.timeoutActions).toBe(handlers);
    expect(changed).toHaveBeenCalledTimes(1);
    ui.setTimeout(handlers);
    expect(changed).toHaveBeenCalledTimes(1);
    vi.mocked(wrapped.deactivate).mockImplementation(() => {
      expect(service.timeoutActions).toBeNull();
    });
    scope.deactivate();
    ui.setTimeout(handlers);
    expect(service.timeoutActions).toBeNull();
    scope.activate();
    ui.setTimeout(handlers);
    scope.dispose();
    scope.dispose();
    expect(wrapped.dispose).toHaveBeenCalledTimes(1);
    ui.setTimeout(handlers);
    expect(service.timeoutActions).toBeNull();
    expect(() => ui.subscribeInertia(vi.fn())).toThrow();
  });
  it("never routes old owner callbacks to the new owner", () => {
    const service = new ModulePresentationService(1, vi.fn());
    const first = service.createScope(inner());
    const second = service.createScope(inner());
    const old = actions();
    const current = actions();
    first.activate();
    presentation(first).setTimeout(old);
    first.deactivate();
    second.activate();
    presentation(second).setTimeout(current);
    presentation(first).setTimeout(old);
    timeout(service).onContinue();
    timeout(service).onFreeze();
    expect(old.onContinue).not.toHaveBeenCalled();
    expect(old.onFreeze).not.toHaveBeenCalled();
    expect(current.onContinue).toHaveBeenCalledOnce();
    expect(current.onFreeze).toHaveBeenCalledOnce();
    second.dispose();
    expect(service.timeoutActions).toBeNull();
  });
  it("updates inertia independently, suppresses equal values and unsubscribes", () => {
    const service = new ModulePresentationService(2, vi.fn());
    const scope = service.createScope(inner());
    const listener = vi.fn();
    const ui = presentation(scope);
    expect(ui.readInertia()).toBe(2);
    const unsubscribe = ui.subscribeInertia(listener);
    service.updateInertia(2);
    expect(listener).not.toHaveBeenCalled();
    service.updateInertia(3);
    expect(listener).toHaveBeenCalledWith(3);
    expect(ui.readInertia()).toBe(3);
    unsubscribe();
    service.updateInertia(4);
    expect(listener).toHaveBeenCalledTimes(1);
    ui.subscribeInertia(listener);
    scope.dispose();
    service.updateInertia(5);
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it.each([0, -1, NaN, Infinity])("rejects invalid inertia %s", (value) => {
    expect(() => new ModulePresentationService(value, vi.fn())).toThrow(RangeError);
    expect(() => {
      new ModulePresentationService(1, vi.fn()).updateInertia(value);
    }).toThrow(RangeError);
  });
  it("service disposal clears handlers and all observers idempotently", () => {
    const changed = vi.fn();
    const service = new ModulePresentationService(1, changed);
    const scope = service.createScope(inner());
    const listener = vi.fn();
    scope.activate();
    presentation(scope).subscribeInertia(listener);
    presentation(scope).setTimeout(actions());
    service.dispose();
    service.dispose();
    service.updateInertia(2);
    expect(listener).not.toHaveBeenCalled();
    expect(service.timeoutActions).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(() => service.createScope(inner())).toThrow();
  });
});
