import type { CalculatorKeyboardTarget } from "../keyboard/CalculatorKeyboard.js";
import type {
  CalculatorMathInputRegistration,
  CalculatorModuleServiceScope
} from "./CalculatorInputs.js";

interface KeyboardPort {
  setTarget(target: CalculatorKeyboardTarget): void;
  clearTarget(): void;
}

interface InputField {
  readonly input: HTMLInputElement | HTMLTextAreaElement;
  readonly target: CalculatorKeyboardTarget | null;
  readonly removeListeners: () => void;
}

interface InputScope {
  readonly fields: Set<InputField>;
  selected: InputField | null;
  disposed: boolean;
}

export interface CalculatorInputCoordinatorOptions {
  readonly keyboard: KeyboardPort;
  readonly onMathTargetChange: (active: boolean) => void;
  readonly suppressSoftwareKeyboard?: boolean;
  readonly document?: Document;
}

/** One shared keyboard route, with remembered field selection per runtime owner. */
export class CalculatorInputCoordinator {
  readonly #options: CalculatorInputCoordinatorOptions;
  readonly #document: Document;
  readonly #scopes = new Set<InputScope>();
  #active: InputScope | null = null;
  #target: CalculatorKeyboardTarget | null = null;
  #suspended = false;
  #historyInteraction = false;
  #background = false;
  #restoreFocus: InputField | null = null;
  #disposed = false;
  readonly #onFocus = (): void => {
    if (this.#suspended || this.#background) return;
    const scope = this.#active;
    const input = this.#document.activeElement;
    if (scope === null) return;
    const registered = [...scope.fields].find((field) => field.input === input);
    if (registered !== undefined) this.#select(scope, registered);
    else if (isNativeTextInput(input)) {
      scope.selected = null;
      this.refresh();
    }
  };

  constructor(options: CalculatorInputCoordinatorOptions) {
    this.#options = options;
    this.#document = options.document ?? document;
    this.#document.addEventListener("focusin", this.#onFocus);
    options.keyboard.clearTarget();
  }

  createScope(): CalculatorModuleServiceScope {
    if (this.#disposed) throw new Error("Input coordinator is disposed");
    const scope: InputScope = { fields: new Set(), selected: null, disposed: false };
    this.#scopes.add(scope);
    return {
      services: {
        inputs: {
          registerMath: (target) => this.#register(scope, target.editor.input, target),
          registerText: (input) => this.#register(scope, input, null)
        }
      },
      activate: () => {
        if (scope.disposed || this.#active === scope) return;
        this.#stopRouting();
        this.#blurScope(this.#active);
        this.#active = scope;
        this.refresh();
      },
      deactivate: () => {
        if (this.#active !== scope) return;
        this.#stopRouting();
        this.#blurScope(scope);
        this.#active = null;
        this.#restoreFocus = null;
        this.refresh();
      },
      dispose: () => {
        if (scope.disposed) return;
        scope.disposed = true;
        if (this.#active === scope) {
          this.#stopRouting();
          this.#blurScope(scope);
          this.#active = null;
        }
        for (const field of scope.fields) {
          field.target?.editor.stopBackspaceHold();
          field.target?.editor.setEditingSurfaceActive(false);
          field.removeListeners();
          if (this.#restoreFocus === field) this.#restoreFocus = null;
        }
        scope.fields.clear();
        scope.selected = null;
        this.#scopes.delete(scope);
        this.refresh();
      }
    };
  }

  setSuspended(suspended: boolean, historyInteraction = false): void {
    if (this.#suspended === suspended && this.#historyInteraction === historyInteraction) return;
    this.#suspended = suspended;
    this.#historyInteraction = historyInteraction;
    if (suspended) this.#stopRouting();
    this.refresh();
  }

  setBackground(background: boolean): void {
    if (this.#background === background || this.#disposed) return;
    this.#background = background;
    if (background) {
      const selected = this.#active?.selected ?? null;
      this.#restoreFocus = this.#document.activeElement === selected?.input ? selected : null;
      this.#stopRouting();
      this.#blurScope(this.#active);
    }
    this.refresh();
    if (!background) {
      const restore = this.#restoreFocus;
      this.#restoreFocus = null;
      if (
        !this.#suspended &&
        restore !== null &&
        this.#active?.selected === restore &&
        restore.target !== null &&
        this.#target === restore.target
      )
        restore.input.focus({ preventScroll: true });
    }
  }

  /** Call after application surfaces/inert state are updated, never before mounting. */
  refresh(): void {
    const selected = this.#active?.selected;
    const focused = this.#document.activeElement;
    const target =
      !this.#disposed &&
      !this.#suspended &&
      !this.#background &&
      selected !== undefined &&
      selected !== null &&
      selected.target !== null &&
      available(selected.input) &&
      (!isNativeTextInput(focused) || focused === selected.input)
        ? selected.target
        : null;
    if (this.#target !== target) {
      this.#stopRouting();
      this.#target = target;
      if (target !== null) this.#options.keyboard.setTarget(target);
    }
    for (const scope of this.#scopes) {
      for (const field of scope.fields) {
        field.target?.editor.setEditingSurfaceActive(field.target === target);
      }
    }
    this.#options.onMathTargetChange(target !== null);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stopRouting();
    this.#document.removeEventListener("focusin", this.#onFocus);
    for (const scope of this.#scopes) {
      scope.disposed = true;
      for (const field of scope.fields) {
        field.target?.editor.stopBackspaceHold();
        field.target?.editor.setEditingSurfaceActive(false);
        field.removeListeners();
      }
      scope.fields.clear();
      scope.selected = null;
    }
    this.#scopes.clear();
    this.#active = null;
    this.#restoreFocus = null;
    this.#options.onMathTargetChange(false);
  }

  #register(
    scope: InputScope,
    input: HTMLInputElement | HTMLTextAreaElement,
    target: CalculatorKeyboardTarget | null
  ): CalculatorMathInputRegistration {
    if (scope.disposed || this.#disposed) throw new Error("Input scope is disposed");
    if ([...this.#scopes].some((owner) => [...owner.fields].some((field) => field.input === input)))
      throw new Error("Input is already registered");
    if (target !== null && this.#options.suppressSoftwareKeyboard) input.inputMode = "none";
    const onFocus = (): void => {
      this.#select(scope, field);
    };
    const onEdit = (event: Event): void => {
      if (
        this.#disposed ||
        scope.disposed ||
        this.#active !== scope ||
        scope.selected !== field ||
        !available(input) ||
        this.#background ||
        (this.#suspended && !this.#historyInteraction)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const editEvents = [
      "keydown",
      "beforeinput",
      "input",
      "paste",
      "compositionstart",
      "compositionend"
    ];
    const field: InputField = {
      input,
      target,
      removeListeners() {
        input.removeEventListener("focus", onFocus);
        if (target !== null)
          for (const type of editEvents) input.removeEventListener(type, onEdit, true);
      }
    };
    input.addEventListener("focus", onFocus);
    if (target !== null) for (const type of editEvents) input.addEventListener(type, onEdit, true);
    scope.fields.add(field);
    if (scope.selected === null && target !== null) scope.selected = field;
    this.refresh();
    const registration: CalculatorMathInputRegistration = {
      activate: () => {
        if (scope.disposed || !scope.fields.has(field)) return;
        this.#select(scope, field);
        if (this.#active === scope && !this.#suspended && !this.#background && available(input))
          input.focus({ preventScroll: true });
      },
      deactivate: () => {
        if (scope.selected !== field) return;
        scope.selected = null;
        if (this.#active === scope) this.#blurScope(scope);
        this.refresh();
      },
      submit: () => {
        if (
          !scope.disposed &&
          scope.fields.has(field) &&
          this.#active === scope &&
          target !== null &&
          this.#target === target
        )
          target.submit();
      },
      dispose: () => {
        if (!scope.fields.has(field)) return;
        if (scope.selected === field) scope.selected = null;
        if (this.#restoreFocus === field) this.#restoreFocus = null;
        if (this.#target === target && target !== null) this.#stopRouting();
        if (this.#document.activeElement === input) input.blur();
        target?.editor.stopBackspaceHold();
        target?.editor.setEditingSurfaceActive(false);
        field.removeListeners();
        scope.fields.delete(field);
        this.refresh();
      }
    };
    return registration;
  }

  #select(scope: InputScope, field: InputField): void {
    if (this.#disposed || scope.disposed || !scope.fields.has(field)) return;
    if (this.#active === scope && (this.#suspended || this.#background)) return;
    scope.selected = field;
    if (this.#active !== scope) return;
    if (
      field.target !== null &&
      isNativeTextInput(this.#document.activeElement) &&
      this.#document.activeElement !== field.input
    ) {
      (this.#document.activeElement as HTMLElement).blur();
    }
    this.refresh();
  }

  #blurScope(scope: InputScope | null): void {
    if (scope === null) return;
    for (const field of scope.fields) {
      field.target?.editor.stopBackspaceHold();
      if (this.#document.activeElement === field.input) field.input.blur();
    }
  }

  #stopRouting(): void {
    this.#options.keyboard.clearTarget();
    this.#target = null;
  }
}

function available(input: HTMLInputElement | HTMLTextAreaElement): boolean {
  return (
    input.isConnected &&
    !input.disabled &&
    !input.closest("[hidden], [inert]") &&
    input.getClientRects().length > 0
  );
}

function isNativeTextInput(element: Element | null): boolean {
  if (element === null || !/^(INPUT|TEXTAREA)$/u.test(element.tagName)) return false;
  const input = element as HTMLInputElement;
  return (
    input.inputMode !== "none" &&
    !input.disabled &&
    !input.readOnly &&
    !/^(button|checkbox|radio|range|submit)$/u.test(input.type)
  );
}
