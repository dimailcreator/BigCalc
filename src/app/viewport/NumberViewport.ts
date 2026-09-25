import type { VerifiedNumberDto } from "../calculation/CalculationProtocol.js";
import { isValidInertia } from "../settings/NumberScrollInertia.js";
import { createNumberViewportModel } from "./NumberViewportModel.js";
import type { NumberViewportView } from "./NumberViewportModel.js";
import {
  dragDigitSteps,
  momentumDigitSteps,
  momentumProgress,
  MOMENTUM_DURATION_MS
} from "./NumberViewportMotion.js";

export interface NumberViewportOptions {
  readonly inertia: number;
  readonly onPrecisionDemand: (significantDigits: number) => void;
}

interface PointerSample {
  readonly x: number;
  readonly time: number;
}

interface ActiveDrag {
  readonly pointerId: number;
  readonly originX: number;
  readonly originStart: bigint;
  samples: PointerSample[];
}

export class NumberViewport {
  readonly root: HTMLOutputElement;
  readonly #content: HTMLSpanElement;
  readonly #probe: HTMLSpanElement;
  readonly #resizeObserver: ResizeObserver;
  readonly #onPrecisionDemand: (significantDigits: number) => void;
  #value: VerifiedNumberDto | null = null;
  #view: NumberViewportView | null = null;
  #logicalStart = 0n;
  #availableSlots = 18;
  #slotWidth = 16;
  #inertia: number;
  #lastDemand = 0;
  #drag: ActiveDrag | null = null;
  #wheelRemainder = 0;
  #momentumFrame: number | null = null;

  constructor(options: NumberViewportOptions) {
    if (!isValidInertia(options.inertia)) throw new RangeError("Inertia must be positive");
    this.#inertia = options.inertia;
    this.#onPrecisionDemand = options.onPrecisionDemand;
    this.root = document.createElement("output");
    this.root.className = "result-output number-viewport";
    this.root.setAttribute("aria-label", "Результат");
    this.root.setAttribute("aria-live", "polite");
    this.root.tabIndex = 0;
    this.#content = document.createElement("span");
    this.#content.className = "number-viewport-content";
    this.#probe = document.createElement("span");
    this.#probe.className = "number-viewport-probe";
    this.#probe.setAttribute("aria-hidden", "true");
    this.root.append(this.#content, this.#probe);
    this.#resizeObserver = new ResizeObserver(() => {
      this.#onResize();
    });
    this.#resizeObserver.observe(this.root);
    this.root.addEventListener("pointerdown", (event) => {
      this.#onPointerDown(event);
    });
    this.root.addEventListener("pointermove", (event) => {
      this.#onPointerMove(event);
    });
    this.root.addEventListener("pointerup", (event) => {
      this.#onPointerUp(event);
    });
    this.root.addEventListener("pointercancel", () => {
      this.#cancelDrag();
    });
    this.root.addEventListener("lostpointercapture", () => {
      this.#cancelDrag();
    });
    this.root.addEventListener(
      "wheel",
      (event) => {
        this.#onWheel(event);
      },
      { passive: false }
    );
    this.root.addEventListener("keydown", (event) => {
      this.#onKeyDown(event);
    });
  }

  get availableSlots(): number {
    this.#measure();
    return this.#availableSlots;
  }

  get logicalStart(): bigint {
    return this.#logicalStart;
  }

  setInertia(value: number): void {
    if (!isValidInertia(value)) throw new RangeError("Inertia must be positive");
    this.#inertia = value;
  }

  setValue(value: VerifiedNumberDto | null): void {
    if (value === null) {
      this.#value = null;
      this.#view = null;
      this.#logicalStart = 0n;
      this.#lastDemand = 0;
      this.#drag = null;
      this.#wheelRemainder = 0;
      this.#stopMomentum();
      this.#content.replaceChildren();
      delete this.root.dataset.representation;
      delete this.root.dataset.logicalStart;
      return;
    }
    if (this.#value === null) {
      this.#logicalStart = createNumberViewportModel({
        value,
        availableSlots: this.#availableSlots
      }).logicalStart;
    }
    this.#value = value;
    this.#render();
  }

  showError(message: string): void {
    this.setValue(null);
    this.#content.textContent = message;
  }

  dispose(): void {
    this.#stopMomentum();
    this.#resizeObserver.disconnect();
  }

  #onResize(): void {
    if (this.#measure()) this.#render();
  }

  #measure(): boolean {
    const width = this.#probe.getBoundingClientRect().width;
    const available = this.root.clientWidth;
    if (width <= 0 || available <= 0) return false;
    const slots = Math.max(1, Math.min(256, Math.floor(available / width)));
    const changed = slots !== this.#availableSlots || Math.abs(width - this.#slotWidth) > 0.01;
    this.#availableSlots = slots;
    this.#slotWidth = width;
    return changed;
  }

  #render(): void {
    if (this.#value === null) return;
    const view = createNumberViewportModel({
      value: this.#value,
      availableSlots: this.#availableSlots,
      logicalStart: this.#logicalStart
    });
    this.#view = view;
    this.#logicalStart = view.logicalStart;
    this.root.dataset.representation = view.representation;
    this.root.dataset.logicalStart = view.logicalStart.toString();
    if (view.representation === "displayError") {
      this.#content.textContent = view.text;
    } else {
      const fragment = document.createDocumentFragment();
      for (const slot of view.slots) {
        const element = document.createElement("span");
        element.className = `number-slot number-slot-${slot.kind}`;
        element.textContent = slot.text;
        fragment.append(element);
      }
      this.#content.replaceChildren(fragment);
    }
    const demand = view.precisionDemand;
    if (demand !== null && demand > this.#lastDemand) {
      this.#lastDemand = demand;
      this.#onPrecisionDemand(demand);
    }
  }

  #moveTo(position: bigint): void {
    if (this.#value === null || position === this.#logicalStart) return;
    this.#logicalStart = position;
    this.#render();
  }

  #onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.#view === null) return;
    if (!this.#view.canScrollLeft && !this.#view.canScrollRight) return;
    this.#stopMomentum();
    this.#drag = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originStart: this.#logicalStart,
      samples: [{ x: event.clientX, time: event.timeStamp }]
    };
    this.root.focus({ preventScroll: true });
    this.root.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  #onPointerMove(event: PointerEvent): void {
    const drag = this.#drag;
    if (drag?.pointerId !== event.pointerId) return;
    drag.samples.push({ x: event.clientX, time: event.timeStamp });
    drag.samples = drag.samples.filter((sample) => event.timeStamp - sample.time <= 120);
    const steps = dragDigitSteps(drag.originX - event.clientX, this.#slotWidth, this.#inertia);
    this.#moveTo(drag.originStart + BigInt(steps));
  }

  #onPointerUp(event: PointerEvent): void {
    const drag = this.#drag;
    if (drag?.pointerId !== event.pointerId) return;
    this.#onPointerMove(event);
    const oldest = drag.samples[0];
    const newest = drag.samples.at(-1);
    this.#drag = null;
    if (oldest === undefined || newest === undefined) return;
    const duration = newest.time - oldest.time;
    if (duration <= 0) return;
    const velocity = (newest.x - oldest.x) / duration;
    const steps = momentumDigitSteps(
      velocity,
      this.#slotWidth,
      this.#inertia,
      this.#availableSlots
    );
    this.#startMomentum(steps);
  }

  #cancelDrag(): void {
    this.#drag = null;
  }

  #startMomentum(steps: number): void {
    if (steps === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.#moveTo(this.#logicalStart + BigInt(steps));
      return;
    }
    const start = this.#logicalStart;
    const startedAt = performance.now();
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / MOMENTUM_DURATION_MS);
      const eased = momentumProgress(now - startedAt);
      this.#moveTo(start + BigInt(Math.round(steps * eased)));
      if (progress < 1) this.#momentumFrame = requestAnimationFrame(tick);
      else this.#momentumFrame = null;
    };
    this.#momentumFrame = requestAnimationFrame(tick);
  }

  #stopMomentum(): void {
    if (this.#momentumFrame !== null) cancelAnimationFrame(this.#momentumFrame);
    this.#momentumFrame = null;
  }

  #onWheel(event: WheelEvent): void {
    if (this.#view === null) return;
    const amount = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (!Number.isFinite(amount) || amount === 0) return;
    const scale =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? this.root.clientWidth
          : 1;
    const total = this.#wheelRemainder + ((amount * scale) / this.#slotWidth) * this.#inertia;
    this.#wheelRemainder = Math.max(
      -Number.MAX_SAFE_INTEGER,
      Math.min(Number.MAX_SAFE_INTEGER, total)
    );
    const steps = Math.trunc(this.#wheelRemainder);
    if (steps === 0) return;
    this.#wheelRemainder -= steps;
    this.#stopMomentum();
    const before = this.#logicalStart;
    this.#moveTo(this.#logicalStart + BigInt(steps));
    if (this.#logicalStart === before) this.#wheelRemainder = 0;
    event.preventDefault();
  }

  #onKeyDown(event: KeyboardEvent): void {
    if (this.#view === null) return;
    let steps = 0;
    switch (event.key) {
      case "ArrowLeft":
        steps = -1;
        break;
      case "ArrowRight":
        steps = 1;
        break;
      case "PageUp":
        steps = -Math.max(1, this.#availableSlots - 2);
        break;
      case "PageDown":
        steps = Math.max(1, this.#availableSlots - 2);
        break;
      case "Home":
        if (this.#value !== null) {
          const initial = createNumberViewportModel({
            value: this.#value,
            availableSlots: this.#availableSlots
          });
          this.#moveTo(initial.logicalStart);
        }
        event.preventDefault();
        return;
      default:
        return;
    }
    this.#stopMomentum();
    this.#moveTo(this.#logicalStart + BigInt(steps));
    event.preventDefault();
  }
}
