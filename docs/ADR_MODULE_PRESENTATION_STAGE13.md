# Module presentation and source-preserving editor input — Stage 13

Accepted within Calculator Modules Stage 13, under the plan's additive boundary rule.

UI_SPEC §43.6.6 requires the existing shared timeout interaction and NumberViewport
inertia. Stage 9 exposes only evaluation settings and sessions. Creating a module
dialog or reading shell/settings internals would bypass application ownership.

Add an optional, owner-scoped presentation service: read/subscribe to inertia,
and publish/clear timeout actions. The application routes the existing single
TimeoutDialog/navigation layer to its active owner. Deactivation/disposal clears
that owner's interaction and subscriptions; inactive owners cannot publish it.
It carries no mathematical settings, result, history, navigation or Worker access.
Existing modules remain valid without the optional service.

UI_SPEC §43.6.1 requires typed/pasted Ans to be rejected rather than silently
filtered. ExpressionEditor's default clipboard parser removes unsupported words.
Add an optional text-to-token callback used by all user text event paths. Its
default is unchanged; Units uses its existing source reconstruction helper.
ExpressionModel remains responsible for selection and atomic tokens; Core remains
the only mathematical parser. No displayed result is used as calculation input.

No Core/Worker/persistence DTO, mathematical semantics, keyboard layout or installed
module list changes. Generic service ownership and actual browser event paths
receive regression coverage. Stage 14 installation remains a separate task.
