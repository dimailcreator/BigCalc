import { describe, expect, it } from "vitest";
import { NavigationController } from "../../../src/app/navigation/NavigationController.js";
import type { NavigationHistoryPort } from "../../../src/app/navigation/NavigationController.js";

class MemoryHistory implements NavigationHistoryPort {
  readonly states: unknown[] = [null];
  index = 0;
  get state(): unknown {
    return this.states[this.index];
  }
  pushState(data: unknown): void {
    this.states.splice(this.index + 1);
    this.states.push(data);
    this.index += 1;
  }
  replaceState(data: unknown): void {
    this.states[this.index] = data;
  }
  back(): void {
    if (this.index > 0) this.index -= 1;
  }
  forward(): void {
    if (this.index < this.states.length - 1) this.index += 1;
  }
}

describe("application navigation stack", () => {
  it("closes only the top layer and replaces the overflow with its destination", () => {
    const history = new MemoryHistory();
    const changes: number[] = [];
    const navigation = new NavigationController({
      history,
      modules: [{ id: "bigcalc", title: "BigCalc" }],
      onChange(entries) {
        changes.push(entries.length);
      }
    });
    navigation.openLayer("history");
    navigation.openLayer("overflow");
    navigation.replaceTopLayer("settings");
    expect(navigation.entries.map((entry) => entry.id)).toEqual(["bigcalc", "history", "settings"]);
    expect(navigation.back()).toBe(true);
    navigation.handlePopState(history.state);
    expect(navigation.topLayer).toBe("history");
    expect(navigation.back()).toBe(true);
    navigation.handlePopState(history.state);
    expect(navigation.topLayer).toBeNull();
    expect(navigation.back()).toBe(false);
    expect(changes).toEqual([2, 3, 3, 2, 1]);
  });

  it("returns to the actual previous module and runs deactivation before activation", () => {
    const history = new MemoryHistory();
    const events: string[] = [];
    const navigation = new NavigationController({
      history,
      modules: [
        {
          id: "bigcalc",
          title: "BigCalc",
          onDeactivate() {
            events.push("save bigcalc");
          },
          onActivate() {
            events.push("resume bigcalc");
          }
        },
        {
          id: "second",
          title: "Second",
          onDeactivate() {
            events.push("save second");
          },
          onActivate() {
            events.push("resume second");
          }
        }
      ],
      onChange(entries) {
        events.push(`route ${String(entries.length)}`);
      }
    });
    navigation.openLayer("drawer");
    navigation.selectModule("second");
    expect(navigation.activeModuleId).toBe("second");
    expect(events).toEqual(["route 2", "save bigcalc", "resume second", "route 2"]);
    navigation.openLayer("about");
    navigation.back();
    navigation.handlePopState(history.state);
    expect(navigation.activeModuleId).toBe("second");
    navigation.back();
    navigation.handlePopState(history.state);
    expect(navigation.activeModuleId).toBe("bigcalc");
    expect(events).toEqual([
      "route 2",
      "save bigcalc",
      "resume second",
      "route 2",
      "route 3",
      "route 2",
      "save second",
      "resume bigcalc",
      "route 1"
    ]);
  });

  it("does not restore an expired timeout dialog on browser Forward", () => {
    const history = new MemoryHistory();
    let timeoutLive = true;
    const changes: number[] = [];
    const navigation = new NavigationController({
      history,
      modules: [{ id: "bigcalc", title: "BigCalc" }],
      canRestoreLayer(layer) {
        return layer !== "timeout" || timeoutLive;
      },
      onChange(entries) {
        changes.push(entries.length);
      }
    });
    navigation.openLayer("timeout");
    navigation.back();
    navigation.handlePopState(history.state);
    timeoutLive = false;
    history.forward();
    navigation.handlePopState(history.state);
    expect(navigation.topLayer).toBeNull();
    expect(changes).toEqual([2, 1]);
  });
});
