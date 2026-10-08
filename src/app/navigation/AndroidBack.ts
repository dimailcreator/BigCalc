import type { NavigationLayer } from "./NavigationController.js";

interface BackNavigation {
  readonly topLayer: NavigationLayer | null;
  back(): boolean;
}

interface BackInputs {
  dismissMathKeyboard(): boolean;
}

/** Native IME Back is consumed by Android before this application callback. */
export function handleAndroidBack(
  navigation: BackNavigation,
  inputs: BackInputs,
  exit: () => void,
  primaryActive: boolean
): void {
  if (navigation.topLayer !== null) {
    navigation.back();
    return;
  }
  if (!primaryActive && inputs.dismissMathKeyboard()) return;
  if (!navigation.back()) exit();
}
