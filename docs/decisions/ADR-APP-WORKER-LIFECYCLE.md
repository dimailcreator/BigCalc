# ADR: Worker transport and calculation lifecycle

## Status

Accepted at Stage 26; records the Worker boundary implemented and hardened in Stages 3–24.

## Decision

The UI sends serializable `create` or `create-structured`, `refine`, `continue`, `cancel`, and `dispose` commands. `CalculationProtocol.ts` defines the DTOs. `CalculationClient` tracks pending operations by session and request ID, validates responses, and rejects transport failures separately from typed mathematical results. The Worker runtime validates commands and owns a map from session IDs to opaque Core handles. Only the Worker imports the public Core entrypoint in production App code.

Each new expression or mathematical setting starts a new session. A stale response cannot update the current calculator state. A soft timeout preserves the handle and permits `continue`; a user freeze also keeps that session resumable. `dispose` removes the Worker record and may cancel its Core handle. It is an application command, not a `CalculationHandle.dispose()` method. Worker crash, invalid protocol, and execution failure remain transport errors, never synthetic `CalcError` values.

## Why and consequences

This keeps heavy refinement off the UI thread and Core independent of Web Worker and DOM APIs. The protocol is a coupled boundary: new commands or result fields require DTO validation, client/runtime handling, and regression tests together. Worker IDs and handles never enter persistence.

Evidence: `src/app/calculation/`, `src/app/worker/`, `src/app/calculator/LiveCalculatorController.ts`, and their corresponding unit and browser lifecycle tests.
