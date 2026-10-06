import { describe, expect, it, vi } from "vitest";
import { CalculatorInputCoordinator } from "../../../src/app/input/CalculatorInputCoordinator.js";
import type { ExpressionEditor } from "../../../src/app/editor/ExpressionEditor.js";
import type { CalculatorKeyboardTarget } from "../../../src/app/keyboard/CalculatorKeyboard.js";
import type { CalculatorModuleServiceScope } from "../../../src/app/input/CalculatorInputs.js";

function inputs(scope: CalculatorModuleServiceScope) {
  const service = scope.services.inputs;
  if (service === undefined) throw new Error("Missing input service");
  return service;
}

class TestDocument extends EventTarget {
  activeElement: TestInput | null = null;
}
class TestInput extends EventTarget {
  readonly tagName = "INPUT";
  readonly type = "text";
  inputMode = "text";
  disabled = false;
  readOnly = false;
  isConnected = true;
  hidden = false;
  inert = false;
  constructor(readonly document: TestDocument) {
    super();
  }
  closest(): object | null {
    return this.hidden || this.inert ? {} : null;
  }
  getClientRects(): readonly object[] {
    return this.isConnected && !this.hidden ? [{}] : [];
  }
  focus(): void {
    this.document.activeElement = this;
    this.dispatchEvent(new Event("focus"));
    this.document.dispatchEvent(new Event("focusin"));
  }
  blur(): void {
    if (this.document.activeElement === this) this.document.activeElement = null;
  }
}
function setup() {
  const document = new TestDocument();
  let routed: CalculatorKeyboardTarget | null = null;
  let visible = false;
  const keyboard = {
    clearTarget: vi.fn(() => {
      routed = null;
    }),
    setTarget: vi.fn((target: CalculatorKeyboardTarget) => {
      routed = target;
    })
  };
  const coordinator = new CalculatorInputCoordinator({
    document: document as unknown as Document,
    keyboard,
    suppressSoftwareKeyboard: true,
    onMathTargetChange: (active) => {
      visible = active;
    }
  });
  const math = () => {
    const input = new TestInput(document);
    const stop = vi.fn();
    const editing = vi.fn();
    const submit = vi.fn();
    const target: CalculatorKeyboardTarget = {
      editor: {
        input,
        stopBackspaceHold: stop,
        setEditingSurfaceActive: editing
      } as unknown as ExpressionEditor,
      clear: vi.fn(),
      submit
    };
    return { input, target, stop, editing, submit };
  };
  return { document, coordinator, keyboard, math, routed: () => routed, visible: () => visible };
}

describe("scoped calculator input coordination", () => {
  it("blocks delayed math DOM events after native selection or owner deactivation", () => {
    const s = setup();
    const scope = s.coordinator.createScope();
    const math = s.math();
    const text = new TestInput(s.document);
    inputs(scope).registerMath(math.target);
    inputs(scope).registerText(text as unknown as HTMLInputElement);
    const edited = vi.fn();
    math.input.addEventListener("beforeinput", edited);
    scope.activate();
    math.input.focus();
    math.input.dispatchEvent(new Event("beforeinput", { cancelable: true }));
    expect(edited).toHaveBeenCalledTimes(1);
    text.focus();
    const delayed = new Event("beforeinput", { cancelable: true });
    math.input.dispatchEvent(delayed);
    expect(delayed.defaultPrevented).toBe(true);
    scope.deactivate();
    math.input.dispatchEvent(new Event("beforeinput", { cancelable: true }));
    expect(edited).toHaveBeenCalledTimes(1);
  });

  it("defaults to the first math field without focusing it, and keeps native text independent", () => {
    const s = setup();
    const scope = s.coordinator.createScope();
    const math = s.math();
    const text = new TestInput(s.document);
    inputs(scope).registerMath(math.target);
    inputs(scope).registerText(text as unknown as HTMLInputElement);
    expect(s.routed()).toBeNull();
    scope.activate();
    expect(s.routed()).toBe(math.target);
    expect(math.input.inputMode).toBe("none");
    expect(text.inputMode).toBe("text");
    expect(s.document.activeElement).toBeNull();
    text.focus();
    expect(s.routed()).toBeNull();
    expect(s.visible()).toBe(false);
    math.input.focus();
    expect(s.routed()).toBe(math.target);
  });

  it("scope isolation preserves selection while inactive owners cannot steal input or submit", () => {
    const s = setup();
    const a = s.coordinator.createScope();
    const b = s.coordinator.createScope();
    const first = s.math();
    const second = s.math();
    const ar = inputs(a).registerMath(first.target);
    const br = inputs(b).registerMath(second.target);
    a.activate();
    ar.activate();
    br.activate();
    br.submit();
    expect(s.routed()).toBe(first.target);
    expect(s.document.activeElement).toBe(first.input);
    expect(second.submit).not.toHaveBeenCalled();
    a.deactivate();
    expect(s.document.activeElement).toBeNull();
    b.activate();
    br.submit();
    expect(second.submit).toHaveBeenCalledTimes(1);
    expect(s.routed()).toBe(second.target);
    b.deactivate();
    a.activate();
    expect(s.routed()).toBe(first.target);
    expect(s.document.activeElement).toBeNull();
  });

  it("overlay suspension retains selection and cannot steal a native Settings focus", () => {
    const s = setup();
    const scope = s.coordinator.createScope();
    const math = s.math();
    const registration = inputs(scope).registerMath(math.target);
    scope.activate();
    s.coordinator.setSuspended(true);
    registration.activate();
    registration.submit();
    expect(s.routed()).toBeNull();
    const settings = new TestInput(s.document);
    settings.focus();
    s.coordinator.setSuspended(false);
    expect(s.routed()).toBeNull();
    expect(s.document.activeElement).toBe(settings);
    settings.blur();
    s.coordinator.refresh();
    expect(s.routed()).toBe(math.target);
    expect(math.submit).not.toHaveBeenCalled();
  });

  it("only a still-active available math field can regain focus after background", () => {
    const s = setup();
    const scope = s.coordinator.createScope();
    const math = s.math();
    const registration = inputs(scope).registerMath(math.target);
    scope.activate();
    registration.activate();
    s.coordinator.setBackground(true);
    s.coordinator.setBackground(true);
    expect(s.routed()).toBeNull();
    expect(s.document.activeElement).toBeNull();
    s.coordinator.setBackground(false);
    expect(s.document.activeElement).toBe(math.input);
    s.coordinator.setBackground(true);
    math.input.hidden = true;
    s.coordinator.setBackground(false);
    expect(s.routed()).toBeNull();
    expect(s.document.activeElement).toBeNull();
  });

  it("background/module switching never restores the detached editor", () => {
    const s = setup();
    const a = s.coordinator.createScope();
    const b = s.coordinator.createScope();
    const first = s.math();
    const second = s.math();
    const ar = inputs(a).registerMath(first.target);
    inputs(b).registerMath(second.target);
    a.activate();
    ar.activate();
    s.coordinator.setBackground(true);
    a.deactivate();
    b.activate();
    s.coordinator.setBackground(false);
    expect(s.routed()).toBe(second.target);
    expect(s.document.activeElement).toBeNull();
  });

  it("unregister is idempotent; stale registrations cannot revive or submit a reused target", () => {
    const s = setup();
    const scope = s.coordinator.createScope();
    const math = s.math();
    const old = inputs(scope).registerMath(math.target);
    scope.activate();
    old.activate();
    old.dispose();
    old.dispose();
    const next = inputs(scope).registerMath(math.target);
    old.activate();
    old.submit();
    expect(math.submit).not.toHaveBeenCalled();
    next.submit();
    expect(math.submit).toHaveBeenCalledTimes(1);
    scope.dispose();
    scope.dispose();
    next.activate();
    next.submit();
    expect(math.submit).toHaveBeenCalledTimes(1);
    expect(s.routed()).toBeNull();
    expect(() => inputs(scope).registerMath(math.target)).toThrow("disposed");
  });

  it("rejects duplicate ownership and does not route hidden/inert/disconnected inputs", () => {
    const s = setup();
    const scope = s.coordinator.createScope();
    const math = s.math();
    inputs(scope).registerMath(math.target);
    expect(() => inputs(s.coordinator.createScope()).registerMath(math.target)).toThrow(
      "already registered"
    );
    scope.activate();
    for (const property of ["hidden", "inert", "disabled"] as const) {
      math.input[property] = true;
      s.coordinator.refresh();
      expect(s.routed()).toBeNull();
      math.input[property] = false;
    }
    math.input.isConnected = false;
    s.coordinator.refresh();
    expect(s.routed()).toBeNull();
  });

  it("native-only scopes never expose the keyboard, and disposal releases listeners", () => {
    const s = setup();
    const scope = s.coordinator.createScope();
    const text = new TestInput(s.document);
    const registration = inputs(scope).registerText(text as unknown as HTMLInputElement);
    scope.activate();
    registration.activate();
    expect(s.routed()).toBeNull();
    expect(s.document.activeElement).toBe(text);
    s.coordinator.dispose();
    s.coordinator.dispose();
    scope.activate();
    registration.activate();
    text.focus();
    expect(s.visible()).toBe(false);
    expect(() => s.coordinator.createScope()).toThrow("disposed");
  });
});
