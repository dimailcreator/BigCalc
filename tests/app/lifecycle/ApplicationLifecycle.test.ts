import { describe, expect, it } from "vitest";
import { ApplicationLifecycle } from "../../../src/app/lifecycle/ApplicationLifecycle.js";

describe("Android application lifecycle", () => {
  it("flushes on each background transition without ending a live calculation", () => {
    const events: string[] = [];
    const lifecycle = new ApplicationLifecycle(
      () => events.push("flush"),
      () => events.push("dispose")
    );

    lifecycle.background();
    lifecycle.background();
    expect(events).toEqual(["flush", "flush"]);

    lifecycle.pageHide();
    lifecycle.pageHide();
    lifecycle.background();
    expect(events).toEqual(["flush", "flush", "flush", "dispose"]);
  });

  it("ends the runtime even when final storage flush fails", () => {
    const events: string[] = [];
    const lifecycle = new ApplicationLifecycle(
      () => {
        throw new Error("Storage unavailable");
      },
      () => events.push("dispose")
    );

    expect(() => {
      lifecycle.pageHide();
    }).toThrow("Storage unavailable");
    expect(events).toEqual(["dispose"]);
  });
});
