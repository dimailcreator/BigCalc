const DRAG_CANCEL_DISTANCE_PX = 12;

interface TrackedPointer {
  readonly id: number;
  readonly x: number;
  readonly y: number;
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

  acceptClick(detail: number): boolean {
    if (detail !== 0 && this.#suppressPointerClick) {
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
  activate: () => void,
  options: ButtonPressOptions = {}
): void {
  const press = new ButtonPressState();
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
    if (press.move(event.pointerId, event.clientX, event.clientY)) options.onPointerStop?.();
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
    options.onPointerStop?.();
    if (shouldActivate && options.activateOnPointerUp !== false) activate();
  });
  button.addEventListener("pointercancel", (event) => {
    stop(event.pointerId);
  });
  button.addEventListener("lostpointercapture", (event) => {
    stop(event.pointerId);
  });
  button.addEventListener("click", (event) => {
    if (!press.acceptClick(event.detail)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    activate();
  });
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
}
