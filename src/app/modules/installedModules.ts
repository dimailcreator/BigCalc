import type { RegisteredCalculatorModule } from "./CalculatorModule.js";
import { bmiCalculatorModule } from "./bmi/BmiCalculatorModule.js";
import { unitsCalculatorModule } from "./units/UnitsCalculatorModule.js";

/** Add bundled calculators here; the main screen and navigation need no changes. */
export const installedModules: readonly RegisteredCalculatorModule[] = [
  bmiCalculatorModule,
  unitsCalculatorModule
];
