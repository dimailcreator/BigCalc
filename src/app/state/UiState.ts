export interface UiState {
  readonly historyOpen: boolean;
  readonly keyboardExpanded: boolean;
  readonly timeoutDialogOpen: boolean;
}

export const DEFAULT_UI_STATE: UiState = Object.freeze({
  historyOpen: false,
  keyboardExpanded: false,
  timeoutDialogOpen: false
});
