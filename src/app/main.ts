import { createBrowserCalculationClient } from "./calculation/CalculationClient.js";
import "./styles/base.css";

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (appRoot === null) {
  throw new Error("BigCalc application root was not found");
}

const shell = document.createElement("main");
const heading = document.createElement("h1");
const calculationClient = createBrowserCalculationClient();

shell.className = "app-shell";
heading.textContent = "BigCalc app booted";

appRoot.dataset.calculationWorker = "started";
shell.append(heading);
appRoot.replaceChildren(shell);

window.addEventListener(
  "pagehide",
  () => {
    calculationClient.terminate();
  },
  { once: true }
);
