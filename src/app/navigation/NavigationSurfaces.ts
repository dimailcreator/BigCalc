import type { CalculatorModuleRegistration } from "./NavigationController.js";

export class CalculatorDrawer {
  readonly root: HTMLDivElement;
  readonly #firstItem: HTMLButtonElement;
  #open = false;

  constructor(
    modules: readonly CalculatorModuleRegistration[],
    activeModuleId: string,
    onSelect: (id: string) => void,
    onClose: () => void
  ) {
    this.root = document.createElement("div");
    this.root.className = "calculator-drawer-layer";
    this.root.hidden = true;
    const scrim = document.createElement("button");
    scrim.type = "button";
    scrim.className = "calculator-drawer-scrim";
    scrim.setAttribute("aria-label", "Закрыть список калькуляторов");
    scrim.tabIndex = -1;
    scrim.addEventListener("click", onClose);
    const panel = document.createElement("nav");
    panel.className = "calculator-drawer";
    panel.setAttribute("aria-label", "Калькуляторы");
    const heading = document.createElement("h2");
    heading.textContent = "Калькуляторы";
    const subtitle = document.createElement("p");
    subtitle.textContent = "Выберите режим";
    panel.append(heading, subtitle);
    for (const module of modules) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calculator-drawer-item";
      button.textContent = module.title;
      button.dataset.moduleId = module.id;
      button.setAttribute("aria-current", String(module.id === activeModuleId));
      button.addEventListener("click", () => {
        onSelect(module.id);
      });
      panel.append(button);
    }
    const firstItem = panel.querySelector<HTMLButtonElement>(".calculator-drawer-item");
    if (firstItem === null) throw new Error("Calculator drawer needs a registered module");
    this.#firstItem = firstItem;
    this.root.append(scrim, panel);
    this.root.addEventListener("keydown", (event) => {
      trapTab(event, [...panel.querySelectorAll<HTMLButtonElement>(".calculator-drawer-item")]);
    });
  }

  setOpen(open: boolean): void {
    if (this.#open === open) return;
    this.#open = open;
    this.root.hidden = !open;
    if (open) this.#firstItem.focus();
  }

  setActiveModule(id: string): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-module-id]")) {
      button.setAttribute("aria-current", String(button.dataset.moduleId === id));
    }
  }
}

export class OverflowMenu {
  readonly root: HTMLDivElement;
  readonly #settingsButton: HTMLButtonElement;
  #open = false;

  constructor(onSettings: () => void, onAbout: () => void, onClose: () => void) {
    this.root = document.createElement("div");
    this.root.className = "overflow-layer";
    this.root.hidden = true;
    const scrim = document.createElement("button");
    scrim.type = "button";
    scrim.className = "overflow-scrim";
    scrim.setAttribute("aria-label", "Закрыть меню");
    scrim.tabIndex = -1;
    scrim.addEventListener("click", onClose);
    const menu = document.createElement("div");
    menu.className = "overflow-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Меню приложения");
    this.#settingsButton = document.createElement("button");
    this.#settingsButton.type = "button";
    this.#settingsButton.textContent = "Настройки";
    this.#settingsButton.setAttribute("role", "menuitem");
    this.#settingsButton.addEventListener("click", onSettings);
    const about = document.createElement("button");
    about.type = "button";
    about.textContent = "О проекте";
    about.setAttribute("role", "menuitem");
    about.addEventListener("click", onAbout);
    menu.append(this.#settingsButton, about);
    this.root.append(scrim, menu);
    this.root.addEventListener("keydown", (event) => {
      trapTab(event, [this.#settingsButton, about]);
    });
  }

  setOpen(open: boolean): void {
    if (this.#open === open) return;
    this.#open = open;
    this.root.hidden = !open;
    if (open) this.#settingsButton.focus();
  }
}

export class AboutScreen {
  readonly root: HTMLElement;
  readonly #back: HTMLButtonElement;
  #open = false;

  constructor(onBack: () => void) {
    this.root = document.createElement("section");
    this.root.className = "about-screen";
    this.root.setAttribute("aria-label", "О проекте BigCalc");
    this.root.setAttribute("aria-hidden", "true");
    this.root.inert = true;
    const top = document.createElement("header");
    top.className = "settings-top-bar";
    this.#back = document.createElement("button");
    this.#back.type = "button";
    this.#back.className = "settings-back";
    this.#back.textContent = "←";
    this.#back.setAttribute("aria-label", "Назад к калькулятору");
    this.#back.addEventListener("click", onBack);
    const title = document.createElement("h2");
    title.textContent = "О проекте";
    top.append(this.#back, title);
    const content = document.createElement("div");
    content.className = "about-content";
    const hero = document.createElement("div");
    hero.className = "about-hero";
    const eyebrow = document.createElement("div");
    eyebrow.className = "about-eyebrow";
    eyebrow.textContent = "КАЛЬКУЛЯТОР";
    const name = document.createElement("h3");
    name.textContent = "BigCalc";
    const version = document.createElement("span");
    version.className = "about-version";
    version.textContent = "Версия 1.0";
    hero.append(eyebrow, name, version);
    const sectionTitle = document.createElement("h3");
    sectionTitle.className = "settings-section-title";
    sectionTitle.textContent = "О BigCalc";
    const card = document.createElement("div");
    card.className = "about-card";
    card.textContent =
      "BigCalc вычисляет выражения с точными рациональными числами и проверенными десятичными цифрами. Результат можно уточнять по мере необходимости.";
    const link = document.createElement("a");
    link.className = "about-github";
    link.href = "https://github.com/dimailcreator/BigCalc";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Открыть GitHub";
    const repo = document.createElement("p");
    repo.className = "about-repo";
    repo.textContent = "github.com/dimailcreator/BigCalc";
    content.append(hero, sectionTitle, card, link, repo);
    this.root.append(top, content);
  }

  setOpen(open: boolean): void {
    if (this.#open === open) return;
    this.#open = open;
    this.root.dataset.open = String(open);
    this.root.inert = !open;
    this.root.setAttribute("aria-hidden", String(!open));
    if (open) this.#back.focus();
  }
}

function trapTab(event: KeyboardEvent, focusable: readonly HTMLButtonElement[]): void {
  if (event.key !== "Tab" || focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
