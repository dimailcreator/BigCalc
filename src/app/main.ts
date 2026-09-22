import { CORE_PUBLIC_API_VERSION } from "@bigcalc/core";
import "./styles/base.css";

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (appRoot === null) {
  throw new Error("BigCalc application root was not found");
}

const shell = document.createElement("main");
const heading = document.createElement("h1");

shell.className = "app-shell";
heading.textContent = "BigCalc app booted";

appRoot.dataset.coreApiVersion = CORE_PUBLIC_API_VERSION;
shell.append(heading);
appRoot.replaceChildren(shell);
