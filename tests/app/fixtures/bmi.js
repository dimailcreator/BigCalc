import "../../../src/app/styles/tokens.css";
import "../../../src/app/styles/base.css";
import { defineCalculatorModule } from "../../../src/app/modules/CalculatorModule.ts";
import { CalculatorModuleHost } from "../../../src/app/modules/CalculatorModuleHost.ts";
import { CalculatorModuleSurface } from "../../../src/app/modules/CalculatorModuleSurface.ts";
import { bmiCalculatorModule } from "../../../src/app/modules/bmi/BmiCalculatorModule.ts";

// Test-only mounting: installedModules stays unchanged until Stage 4.
const document = globalThis.document;
const saved = [];
const host = new CalculatorModuleHost(
  [
    defineCalculatorModule({ id: "primary", title: "Primary", createState: () => null }),
    bmiCalculatorModule
  ],
  {
    load: () => globalThis.__bmiRestoredInputs ?? null,
    save: (_declaration, value) => {
      saved.push(value);
      return true;
    }
  }
);
const shell = document.createElement("main");
shell.className = "calculator-shell";
const header = document.createElement("header");
header.className = "top-bar";
const title = document.createElement("h1");
title.textContent = "ИМТ";
header.append(title);
shell.append(header);
document.getElementById("app").append(shell);
const surface = new CalculatorModuleSurface(shell, host);
host.navigationModules[0].onDeactivate();
host.navigationModules[1].onActivate();
surface.setActive(host.activeId);
globalThis.__bmiFixture = { host, saved };
