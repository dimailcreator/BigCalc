import { expect, test } from "@playwright/test";

test("a registered calculator screen mounts and switches without changing the app shell", async ({
  page
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const [{ defineCalculatorModule }, { CalculatorModuleHost }, { CalculatorModuleSurface }] =
      await Promise.all([
        import("/src/app/modules/CalculatorModule.ts"),
        import("/src/app/modules/CalculatorModuleHost.ts"),
        import("/src/app/modules/CalculatorModuleSurface.ts")
      ]);
    const primary = defineCalculatorModule({
      id: "primary",
      title: "Primary",
      createState: () => null
    });
    const secondary = defineCalculatorModule({
      id: "test",
      title: "Test calculator",
      fields: [
        { id: "input", role: "input", label: "Input", description: "Test input" },
        { id: "output", role: "output", label: "Output" }
      ],
      createState: () => ({ input: "" }),
      createView() {
        const root = globalThis.document.createElement("section");
        root.textContent = "Test calculator screen";
        return { root };
      }
    });
    const repository = { load: () => null, save: () => true };
    const host = new CalculatorModuleHost([primary, secondary], repository);
    const shell = globalThis.document.createElement("main");
    shell.className = "calculator-shell";
    const primaryDisplay = globalThis.document.createElement("section");
    primaryDisplay.className = "main-display";
    shell.append(primaryDisplay);
    globalThis.document.body.append(shell);
    const surface = new CalculatorModuleSurface(shell, host);
    const testScreen = host.screens[0].root;
    const initiallyHidden = testScreen.hidden;
    host.navigationModules[0].onDeactivate();
    host.navigationModules[1].onActivate();
    surface.setActive(host.activeId);
    const switched = {
      primaryHidden: globalThis.getComputedStyle(primaryDisplay).display === "none",
      testVisible: globalThis.getComputedStyle(testScreen).display !== "none",
      moduleId: shell.dataset.activeModule,
      primaryActive: shell.dataset.primaryActive,
      fieldRoles: secondary.fields.map((field) => field.role)
    };
    host.dispose();
    shell.remove();
    return { initiallyHidden, switched };
  });
  expect(result).toEqual({
    initiallyHidden: true,
    switched: {
      primaryHidden: true,
      testVisible: true,
      moduleId: "test",
      primaryActive: "false",
      fieldRoles: ["input", "output"]
    }
  });
});
