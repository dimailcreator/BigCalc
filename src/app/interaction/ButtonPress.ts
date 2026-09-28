const DRAG_CANCEL_DISTANCE_PX = 12;

interface TrackedPointer {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

interface PendingPointerClick {
  readonly press: ButtonPressState;
  readonly pointerType: string;
  readonly x: number;
  readonly y: number;
}

/** A pointer click may be retargeted to a newly opened overlay's scrim. */
class PointerClickCoordinator {
  #pending: PendingPointerClick | null = null;

  constructor(document: Document) {
    document.addEventListener(
      "pointerdown",
      () => {
        this.#pending?.press.beginKeyboardActivation();
        this.#pending = null;
      },
      { capture: true }
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          this.#pending?.press.beginKeyboardActivation();
          this.#pending = null;
        }
      },
      { capture: true }
    );
    document.addEventListener(
      "click",
      (event) => {
        const pending = this.#pending;
        if (pending === null) return;
        this.#pending = null;
        if (!this.#belongsToPointer(event, pending)) {
          pending.press.beginKeyboardActivation();
          return;
        }
        pending.press.acceptClick();
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      { capture: true }
    );
  }

  record(press: ButtonPressState, event: PointerEvent): void {
    this.#pending = {
      press,
      pointerType: event.pointerType,
      x: event.clientX,
      y: event.clientY
    };
  }

  #belongsToPointer(event: MouseEvent, pending: PendingPointerClick): boolean {
    if (event instanceof PointerEvent && event.pointerType === pending.pointerType) return true;
    const capabilities = (
      event as MouseEvent & {
        sourceCapabilities?: { firesTouchEvents?: boolean };
      }
    ).sourceCapabilities;
    if (pending.pointerType === "touch" && capabilities?.firesTouchEvents === true) return true;
    if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= 12) return true;
    // Older WebViews can dispatch a MouseEvent without pointer provenance.
    return event.detail > 0;
  }
}

const coordinators = new WeakMap<Document, PointerClickCoordinator>();

function coordinatorFor(document: Document): PointerClickCoordinator {
  let coordinator = coordinators.get(document);
  if (coordinator === undefined) {
    coordinator = new PointerClickCoordinator(document);
    coordinators.set(document, coordinator);
  }
  return coordinator;
}

/** One pointer press and its possible follow-up click; keyboard clicks remain independent. */
export class ButtonPressState {
  #pointer: TrackedPointer | null = null;
  #suppressPointerClick = false;

  tracks(id: number): boolean {
    return this.#pointer?.id === id;
  }

  begin(id: number, x: number, y: number): boolean {
    if (this.#pointer !== null) return false;
    this.#pointer = { id, x, y };
    this.#suppressPointerClick = false;
    return true;
  }

  move(id: number, x: number, y: number): boolean {
    const pointer = this.#pointer;
    if (pointer?.id !== id) return false;
    if (Math.hypot(x - pointer.x, y - pointer.y) <= DRAG_CANCEL_DISTANCE_PX) return false;
    this.#pointer = null;
    this.#suppressPointerClick = true;
    return true;
  }

  end(id: number, x: number, y: number, inside: boolean): boolean {
    if (this.move(id, x, y)) return false;
    if (!this.tracks(id)) return false;
    this.#pointer = null;
    this.#suppressPointerClick = true;
    return inside;
  }

  cancel(id: number): boolean {
    if (!this.tracks(id)) return false;
    this.#pointer = null;
    this.#suppressPointerClick = true;
    return true;
  }

  /** A key event identifies a new keyboard activation after any pointer press. */
  beginKeyboardActivation(): void {
    this.#suppressPointerClick = false;
  }

  acceptClick(): boolean {
    if (this.#suppressPointerClick) {
      this.#suppressPointerClick = false;
      return false;
    }
    return true;
  }
}

export interface ButtonPressOptions {
  /** Backspace starts its own repeat on pointerdown and does not activate on release. */
  readonly activateOnPointerUp?: boolean;
  readonly onPointerStart?: () => void;
  readonly onPointerStop?: () => void;
}

/** Bind a semantic button without relying on the browser to emit click after a touch hold. */
export function bindButtonPress(
  button: HTMLButtonElement,
  activate: (origin: "pointer" | "keyboard") => void,
  options: ButtonPressOptions = {}
): void {
  const press = new ButtonPressState();
  const coordinator = coordinatorFor(button.ownerDocument);
  button.classList.add("press-control");

  const stop = (id: number): void => {
    if (press.cancel(id)) options.onPointerStop?.();
  };
  button.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0 || button.disabled) return;
    if (!press.begin(event.pointerId, event.clientX, event.clientY)) return;
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic PointerEvent has no active browser pointer to capture.
    }
    options.onPointerStart?.();
  });
  button.addEventListener("pointermove", (event) => {
    if (press.move(event.pointerId, event.clientX, event.clientY)) {
      coordinator.record(press, event);
      options.onPointerStop?.();
    }
  });
  button.addEventListener("pointerup", (event) => {
    if (!press.tracks(event.pointerId)) return;
    const bounds = button.getBoundingClientRect();
    const inside =
      !button.disabled &&
      event.clientX >= bounds.left &&
      event.clientX <= bounds.right &&
      event.clientY >= bounds.top &&
      event.clientY <= bounds.bottom;
    const shouldActivate = press.end(event.pointerId, event.clientX, event.clientY, inside);
    coordinator.record(press, event);
    options.onPointerStop?.();
    if (shouldActivate && options.activateOnPointerUp !== false) activate("pointer");
  });
  button.addEventListener("pointercancel", (event) => {
    if (press.tracks(event.pointerId)) coordinator.record(press, event);
    stop(event.pointerId);
  });
  button.addEventListener("lostpointercapture", (event) => {
    if (press.tracks(event.pointerId)) coordinator.record(press, event);
    stop(event.pointerId);
  });
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      press.beginKeyboardActivation();
    }
  });
  button.addEventListener("click", (event) => {
    if (!press.acceptClick()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    activate("keyboard");
  });
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
}
