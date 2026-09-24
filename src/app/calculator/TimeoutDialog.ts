export interface TimeoutDialogActions {
  readonly onContinue: () => void;
  readonly onFreeze: () => void;
}

export class TimeoutDialog {
  readonly root: HTMLDivElement;
  readonly #background: HTMLElement;
  readonly #continueButton: HTMLButtonElement;
  readonly #freezeButton: HTMLButtonElement;
  #previousFocus: HTMLElement | null = null;
  #open = false;

  constructor(background: HTMLElement, actions: TimeoutDialogActions) {
    this.#background = background;
    this.root = document.createElement("div");
    this.root.className = "timeout-overlay";
    this.root.hidden = true;

    const dialog = document.createElement("section");
    dialog.className = "timeout-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "timeout-dialog-title");
    dialog.setAttribute("aria-describedby", "timeout-dialog-body");

    const title = document.createElement("h2");
    title.id = "timeout-dialog-title";
    title.textContent = "Вычисление занимает слишком много времени";

    const body = document.createElement("p");
    body.id = "timeout-dialog-body";
    body.textContent =
      "Вычисление можно продолжить с сохранённого состояния. Уже полученные цифры сохранятся.";

    const actionsRoot = document.createElement("div");
    actionsRoot.className = "timeout-dialog-actions";
    this.#freezeButton = document.createElement("button");
    this.#freezeButton.type = "button";
    this.#freezeButton.className = "timeout-dialog-freeze";
    this.#freezeButton.textContent = "Отменить";
    this.#freezeButton.addEventListener("click", actions.onFreeze);

    this.#continueButton = document.createElement("button");
    this.#continueButton.type = "button";
    this.#continueButton.className = "timeout-dialog-continue";
    this.#continueButton.textContent = "Продолжить";
    this.#continueButton.addEventListener("click", actions.onContinue);

    actionsRoot.append(this.#freezeButton, this.#continueButton);
    dialog.append(title, body, actionsRoot);
    this.root.append(dialog);
    this.root.addEventListener("keydown", (event) => {
      this.#onKeyDown(event);
    });
  }

  setOpen(open: boolean): void {
    if (open === this.#open) return;
    this.#open = open;
    if (open) {
      this.#previousFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.#background.inert = true;
      this.root.hidden = false;
      this.#continueButton.focus();
      return;
    }

    this.root.hidden = true;
    this.#background.inert = false;
    if (this.#previousFocus?.isConnected) this.#previousFocus.focus();
    this.#previousFocus = null;
  }

  #onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      return;
    }
    if (event.key !== "Tab") return;
    if (event.shiftKey && document.activeElement === this.#freezeButton) {
      event.preventDefault();
      this.#continueButton.focus();
    } else if (!event.shiftKey && document.activeElement === this.#continueButton) {
      event.preventDefault();
      this.#freezeButton.focus();
    }
  }
}
