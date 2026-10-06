# ADR: Shared mathematical targets and module calculation services

## Status and scope

Accepted direction at Calculator Modules Stage 6, 2026-10-06, under the explicitly requested updated Units plan. Implementation and regression coverage belong to Stages 7–9. This ADR authorizes additive, backward-compatible application changes there; Stage 6 does not change runtime contracts. Core API 1.3.0, mathematical grammar, Worker DTOs and persistence schema are unchanged.

Normative product behavior: [UI_SPEC §§43.6/44.2](../../UI_SPEC.md), [DESIGN_SPEC §50](../../DESIGN_SPEC.md). This extends the [module ADR](ADR-APP-CALCULATOR-MODULE.md) and [Stage 26 compatibility rules](../APP_ARCHITECTURE_FREEZE.md), preserving their ownership model.

## Observed deficiencies

These observations describe the Stage 6 entry implementation. Stage 7 addresses item 1 through the replaceable keyboard target. Stage 8 adds scoped inputs and resolves the secondary layout constraint; Stage 9 adds calculation/settings services for item 2.

1. `CalculatorKeyboard` permanently captures a concrete `ExpressionEditor` and primary `clear`/`equals` callbacks. In `main.ts`, the callbacks reach the primary `LiveCalculatorController`; `ExpressionEditor.onEnter` is also bound at construction. Reusing this keyboard for another editor currently edits/submits the primary calculator.
2. `RegisteredCalculatorModule.createRuntime(repository)` receives only persistence; `CalculatorModule.createView(state)` has no mathematical input, evaluation settings or shared calculation service. A Core-backed module cannot create an isolated Worker session through the existing runtime contract.

The shared shell has a related constraint: `base.css` hides the keyboard for every non-primary screen, while `CalculatorModuleSurface` places secondary content across all tracks under TopBar (`grid-row: 2 / -1`). Merely showing the primary keyboard would overlap content. Visibility/layout must follow input capabilities, while History visibility continues to follow primary identity.

These are framework limitations, not defects in BMI: it has native inputs, local numeric logic and no mathematical target. Existing Host/navigation/persistence tests establish that old modules must remain compatible.

## Decision: one application keyboard, a replaceable target

Stage 7 separates global keyboard controls from target-owned editing actions. A conceptual target supplies an editor, clear action and submit action; primary BigCalc installs the initial target. The keyboard can set/clear its target, and safely ignores target-dependent actions when none exists. Angle/factorial modes and expand/collapse remain application-owned and keep their current primary behavior.

Target change first stops the old backspace repeat and invalidates any in-flight press generation. Delayed pointer-up/repeat cannot act on either the detached editor or the replacement target. Exactly-once press guarantees, smart insertion, focus/caret/selection behavior and expansion state survive replacement. Keyboard UI has one DOM instance and one layout. Physical Enter is routed by the active editor to the same submit action as shared `=`.

Stage 8 adds an application-owned input coordinator. Each module can register targets/native fields with an owner scope and dispose the registration. Conceptual operations are register, activate, suspend/deactivate and dispose; names/signatures remain implementation choices. Optional `inputKind: "math-expression" | "text"` metadata may be added to input field descriptors; absent metadata does not imply mathematical capability or change existing modules. Output descriptors do not need an input kind. Runtime registration, not metadata alone, grants an active editor target.

The coordinator selects at most one active math target. Native text focus clears keyboard routing/visibility, allows IME and cooperates with `NativeInputLayout`. Math activation blurs native text, suppresses IME using the existing editor option and enables the shared bottom keyboard track. Secondary content occupies only the remaining bounded scroll region. History remains hidden for every secondary screen regardless of keyboard visibility.

Overlay open, module deactivation, background and disposal suspend routing/hold and avoid focus in hidden editors. Overlay close restores only a still-registered, active module's target when compatible with current native focus. Closing Settings must not steal native Settings focus. App lifecycle owns resume policy and native IME/Back integration. Unregister/dispose is idempotent and releases listeners/references; module return may reactivate an existing registered editor, while restart reconstructs it from source. Runtime focus/selection/target never crosses persistence.

## Decision: scoped services over the existing transport

Stages 8–9 add an optional services context to module runtime/view creation, through `defineCalculatorModule`/Host. Conceptually:

```text
CalculatorModuleServices
  inputs          scoped input registration/activation
  settings        read-only current evaluation snapshot + subscription
  calculations    owner-scoped sessions over one CalculationClient
```

An optional trailing context parameter or equivalent optional factory preserves existing callers and hooks. Legacy modules keep receiving the same state/repository, with no required new callbacks or persistence fields. Scope binding uses registration/runtime identity generically, never a check for `units`. Host can bind/release service scopes through its existing lifecycle hooks; `NavigationController` continues to know only registrations and layer/module stack entries.

Stage 9 supplies the higher-level calculation service over the existing `CalculationClient` and Worker protocol (`create`, `refine`, `continue`, `cancel`, `dispose`). The application owns the single production browser Worker, error handling and transport lifetime. No secondary module constructs a Worker, imports Core in UI, terminates the shared client or accesses another owner's sessions. The Worker remains the only production Core consumer.

The service allocates globally unique session/request IDs across primary, History and secondary users. Primary's current controller-local `session-*` / `request-*` counters and History IDs must be audited; assigning a second counter to a module is insufficient. Use an application allocator/owner namespace for new sessions and adapt existing users only as necessary, preserving their semantics. Worker handles and backend types never become module persistence state.

An owner can create multiple independent sessions (for example conversion result and optional factor). Each session has at most one pending refinement; independent sessions share transport without sharing handles. Per-session settings are immutable snapshots. Service cleanup cancels/disposes only that scope's sessions; soft timeout preserves the resumable handle, whereas source/settings replacement, module deactivation and module disposal release stale sessions. Late create/refinement responses after release are ignored and any created handle is disposed. Stale owner/source/request generations never update the active UI.

Current evaluation settings are `angleMode`, `factorialMode`, `maxCalculationTimeMs`; the generic read/subscribe service covers changes from both Settings and keyboard controls. Read is immutable and subscription cleanup belongs to the module scope. Settings change triggers a new mathematical session; theme/palette/inertia/displaySize do not. Sharing the Worker does not promise simultaneous CPU execution; independent result routing/cancellation/continuation must be demonstrated with the existing cooperative runtime before changing scheduling.

Existing History entries and structured `Ans` reference snapshots retain their original expression/settings. The current-settings service must not rewrite or recompute those historical meanings under new settings; adaptation of primary/History transport IDs preserves this frozen reference behavior.

Mathematical errors remain `CalcErrorDto`, unit syntax/dimension/affine errors remain module-local, and `CalculationTransportError` remains a transport/application failure. Application session disposal calls transport `dispose` (which may cancel); no `dispose` is added to the frozen Core `CalculationHandle`. App teardown terminates the Worker only after module/controller/History cleanup.

## Units use of the generic boundary

Units later owns its three source strings, local unit parser/dimensional algebra/compiler and live controller. It registers one mathematical editor and two native text inputs, receives current settings and scoped calculations, and renders a `VerifiedNumberDto` in `NumberViewport`. Scale/offset expressions compile as exact ordinary mathematical source; unit names and parser AST never enter Core. Units rejects `Ans` before compilation, has no History and never adopts displayed digits as source.

BMI continues to omit math capability and shared calculation use. Synthetic secondary modules exercise services in Stages 8–9 before Units production code. Production Units registration is Stage 14, not part of this ADR implementation sequence.

## Rejected alternatives

- A second keyboard or module-defined layout duplicates UI ownership and interaction guarantees.
- Exposing the primary controller/editor to all modules lets secondary edits overwrite primary expression, history or resumable session.
- Direct module Core imports or a Worker per module bypass the frozen transport/lifecycle boundary.
- Module-ID branches in AppShell, navigation, Host or Surface hide generic deficiencies and do not establish a reusable module contract.
- Serializing sessions/targets/compiled source as module state conflates source, derived calculation and UI state.

## Required verification before implementation closure

Stage 7 implementation uses `CalculatorKeyboardTarget`, `setTarget`/`clearTarget` and keyboard disposal, retaining the legacy constructor overload. Global actions are stored separately from target clear/submit. Invalidated pointer state retains release/click provenance without retaining the detached editor; repeat stops before replacement. Primary Enter and `=` share the target submit action. Coverage and final gates are tracked in [Stage 7 verification](../SHARED_KEYBOARD_STAGE7_VERIFICATION.md).

Stage 8 implements optional `CalculatorModuleServices.inputs`, trailing runtime/view context and input-only `inputKind` metadata. `CalculatorModuleInputs.registerMath/registerText` returns activate/deactivate/dispose registrations; math registration `submit()` gates physical Enter to the current target. Host owns service scope creation/activation/deactivation/disposal and construction-failure cleanup. Coordinator selection is per owner, suspends routing/hold across overlays/background/navigation and rejects delayed DOM edits from inactive, hidden or unselected math fields. Native text retains IME behavior; secondary tracks follow math capability, with one application keyboard and primary-only History. `NativeInputLayout` remains unchanged and preserves chrome through actual viewport restoration. Legacy BMI omits the service and remains native-only. Tests use a synthetic secondary, never production Units registration. Coverage and final gates are tracked in [Stage 8 verification](../MODULE_INPUT_STAGE8_VERIFICATION.md); calculation/current-settings services remain Stage 9 work.

Stage 7: primary behavior plus synthetic target replacement/clear, all insertion families, exactly-once pointer events, active backspace hold switch, physical Enter/AC/`=`, focus and expansion, global modes, Android primary IME suppression.

Stage 8: synthetic math/text secondary, both layouts without overlap, overlays/Back/Forward/background/switch/dispose, legacy registration/persistence behavior, primary-only History and BMI native IME/scroll/chrome geometry. No Units production registration.

Stage 9 implements `ModuleCalculationService` over the existing client/protocol, optional `services.calculations/settings`, and a shared application-realm allocator used by primary, History and modules. Session `ready/refine/continue/cancel/dispose` keeps mathematical DTOs separate from transport rejections, preserves paused handles and rejects duplicate/stale work. Settings read/subscribe is immutable; update invalidates old sessions before notification, without reacting to appearance/inertia. Host activates the owner before module hooks and releases its work before deactivation/disposal. Primary startup accepts its saved settings immediately; historical replay retains original settings. Worker lifetime remains App-owned; no new Core/Worker/persistence contract or Units registration is introduced. [Stage 9 verification](../MODULE_CALCULATION_STAGE9_VERIFICATION.md) records two-owner/primary/History ID isolation, late-response cleanup, settings/unsubscribe, actual Worker concurrency/continuation, persistence and existing regressions. Stage 6 remains the historical direction decision.
