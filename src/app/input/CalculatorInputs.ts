import type { CalculatorKeyboardTarget } from "../keyboard/CalculatorKeyboard.js";
import type {
  ModuleCalculations,
  ModuleEvaluationSettings
} from "../calculation/ModuleCalculationService.js";

export interface CalculatorInputRegistration {
  activate(): void;
  deactivate(): void;
  dispose(): void;
}

export interface CalculatorMathInputRegistration extends CalculatorInputRegistration {
  /** Use from the editor's physical Enter callback; inactive registrations cannot submit. */
  submit(): void;
}

export interface CalculatorModuleInputs {
  registerMath(target: CalculatorKeyboardTarget): CalculatorMathInputRegistration;
  registerText(input: HTMLInputElement | HTMLTextAreaElement): CalculatorInputRegistration;
}

export interface CalculatorModuleServices {
  readonly inputs?: CalculatorModuleInputs;
  readonly calculations?: ModuleCalculations;
  readonly settings?: ModuleEvaluationSettings;
  readonly presentation?: CalculatorModulePresentation;
}

export interface ModuleTimeoutActions {
  readonly onContinue: () => void;
  readonly onFreeze: () => void;
}

export interface CalculatorModulePresentation {
  readInertia(): number;
  subscribeInertia(listener: (value: number) => void): () => void;
  setTimeout(actions: ModuleTimeoutActions | null): void;
}

/** Application-owned lifetime; modules receive only services, never scope management. */
export interface CalculatorModuleServiceScope {
  readonly services: CalculatorModuleServices;
  activate(): void;
  deactivate(): void;
  dispose(): void;
}
