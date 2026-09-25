export interface SwipePoint {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly time: number;
}

/** Tracks one gesture and always returns to idle after release or cancellation. */
export class HistorySwipeGesture {
  #start: SwipePoint | null = null;
  #latest: SwipePoint | null = null;

  get tracking(): boolean {
    return this.#start !== null;
  }

  begin(point: SwipePoint): void {
    this.#start = point;
    this.#latest = point;
  }

  move(point: SwipePoint): void {
    if (this.#start?.pointerId === point.pointerId) this.#latest = point;
  }

  finish(point: SwipePoint): boolean {
    this.move(point);
    return this.#resolve(point.pointerId);
  }

  cancel(pointerId: number): boolean {
    return this.#resolve(pointerId);
  }

  reset(): void {
    this.#start = null;
    this.#latest = null;
  }

  #resolve(pointerId: number): boolean {
    const start = this.#start;
    const latest = this.#latest;
    if (start?.pointerId !== pointerId || latest === null) return false;
    this.reset();
    const dx = latest.x - start.x;
    const dy = latest.y - start.y;
    const elapsed = Math.max(1, latest.time - start.time);
    return dy > 0 && dy > Math.abs(dx) * 1.35 && (dy > 54 || (dy > 25 && dy / elapsed > 0.65));
  }
}
