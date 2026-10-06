import "../../../src/app/styles/tokens.css";
import "../../../src/app/styles/base.css";
import { ExpressionEditor } from "../../../src/app/editor/ExpressionEditor.ts";
import { CalculatorKeyboard } from "../../../src/app/keyboard/CalculatorKeyboard.ts";

// Two real editors exercise routing without registering a production secondary module.
const submits = [];
const clears = [];
const targets = ["First", "Second"].map((name) => {
  const editor = new ExpressionEditor({
    suppressSoftwareKeyboard: true,
    onChange() {},
    onEnter() {
      target.submit();
    }
  });
  editor.input.setAttribute("aria-label", name);
  const target = {
    editor,
    clear(origin) {
      clears.push({ name, origin });
      editor.clear();
      if (origin === "pointer") editor.focus();
    },
    submit() {
      submits.push(name);
    }
  };
  return target;
});
let modes = { angleMode: "degrees", factorialMode: "integer" };
const changes = { angle: 0, factorial: 0 };
const actions = {
  toggleAngleMode() {
    changes.angle += 1;
    modes = { ...modes, angleMode: modes.angleMode === "degrees" ? "radians" : "degrees" };
    keyboard.setMathModes(modes);
  },
  toggleFactorialMode() {
    changes.factorial += 1;
    modes = { ...modes, factorialMode: modes.factorialMode === "integer" ? "gamma" : "integer" };
    keyboard.setMathModes(modes);
  }
};
const params = new globalThis.URLSearchParams(globalThis.location.search);
const keyboard = params.has("legacy")
  ? new CalculatorKeyboard(
      targets[0].editor,
      { ...actions, clear: targets[0].clear, equals: targets[0].submit },
      modes
    )
  : new CalculatorKeyboard(params.has("empty") ? null : targets[0], actions, modes);
globalThis.document.getElementById("app").append(
  ...targets.map((target) => {
    // Keep keyboard coordinates stable when a detached editor is hidden during a press.
    const track = globalThis.document.createElement("div");
    track.append(target.editor.root);
    return track;
  }),
  keyboard.root
);
globalThis.__keyboardTargetFixture = { keyboard, targets, submits, clears, changes };
