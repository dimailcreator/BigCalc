import { CalculationTransportError } from "./CalculationClient.js";
import type { CalculationGateway } from "../calculator/LiveCalculatorController.js";
import type {
  CalcErrorDto,
  CalculationSettingsDto,
  RefinementResultDto
} from "./CalculationProtocol.js";
import {
  allocateCalculationRequestId,
  allocateCalculationSessionId
} from "./CalculationSession.js";
import type { CalculatorModuleServiceScope } from "../input/CalculatorInputs.js";

export type ModuleCalculationCreation =
  { readonly ok: true } | { readonly ok: false; readonly error: CalcErrorDto };
export interface ModuleCalculationSession {
  readonly source: string;
  readonly settings: CalculationSettingsDto;
  readonly ready: Promise<ModuleCalculationCreation>;
  refine(significantDigits: number): Promise<RefinementResultDto>;
  continue(): Promise<RefinementResultDto>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}
export interface ModuleCalculations {
  create(source: string, settings?: CalculationSettingsDto): ModuleCalculationSession;
}
export interface ModuleEvaluationSettings {
  read(): CalculationSettingsDto;
  subscribe(listener: (settings: CalculationSettingsDto) => void): () => void;
}

interface Owner {
  active: boolean;
  disposed: boolean;
  readonly sessions: Set<OwnedSession>;
  readonly listeners: Set<(settings: CalculationSettingsDto) => void>;
  readonly input: CalculatorModuleServiceScope | undefined;
}

/** App owns transport lifetime; owner scopes release only their own work. */
export class ModuleCalculationService {
  readonly #gateway: CalculationGateway;
  readonly #owners = new Set<Owner>();
  #settings: CalculationSettingsDto;
  #disposed = false;

  constructor(gateway: CalculationGateway, initialSettings: CalculationSettingsDto) {
    this.#gateway = gateway;
    this.#settings = settingsSnapshot(initialSettings);
  }

  createScope(input?: CalculatorModuleServiceScope): CalculatorModuleServiceScope {
    if (this.#disposed) throw released();
    const owner: Owner = {
      active: false,
      disposed: false,
      sessions: new Set(),
      listeners: new Set(),
      input
    };
    this.#owners.add(owner);
    const calculations: ModuleCalculations = {
      create: (source, settings = this.#settings) => {
        if (owner.disposed || !owner.active || this.#disposed) throw released();
        const session = new OwnedSession(this.#gateway, source, settingsSnapshot(settings), () =>
          owner.sessions.delete(session)
        );
        owner.sessions.add(session);
        return session;
      }
    };
    return {
      services: {
        ...input?.services,
        calculations,
        settings: {
          read: () => this.#settings,
          subscribe: (listener) => {
            if (owner.disposed || this.#disposed) throw released();
            owner.listeners.add(listener);
            return () => {
              owner.listeners.delete(listener);
            };
          }
        }
      },
      activate: () => {
        if (owner.disposed) return;
        owner.active = true;
        input?.activate();
      },
      deactivate: () => {
        owner.active = false;
        input?.deactivate();
        this.#releaseSessions(owner);
      },
      dispose: () => {
        if (owner.disposed) return;
        owner.active = false;
        owner.disposed = true;
        input?.dispose();
        this.#releaseSessions(owner);
        owner.listeners.clear();
        this.#owners.delete(owner);
      }
    };
  }

  updateSettings(settings: CalculationSettingsDto): void {
    if (this.#disposed) return;
    const next = settingsSnapshot(settings);
    if (
      next.angleMode === this.#settings.angleMode &&
      next.factorialMode === this.#settings.factorialMode &&
      next.maxCalculationTimeMs === this.#settings.maxCalculationTimeMs
    )
      return;
    this.#settings = next;
    // Invalidate every owner's old sessions before any listener can create replacement work.
    for (const owner of this.#owners) this.#releaseSessions(owner);
    for (const owner of this.#owners) {
      for (const listener of [...owner.listeners]) {
        if (!owner.disposed && owner.listeners.has(listener)) listener(next);
      }
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const owner of this.#owners) {
      owner.active = false;
      owner.disposed = true;
      owner.input?.dispose();
      this.#releaseSessions(owner);
      owner.listeners.clear();
    }
    this.#owners.clear();
  }

  #releaseSessions(owner: Owner): void {
    for (const session of owner.sessions) void session.dispose().catch(() => undefined);
  }
}

class OwnedSession implements ModuleCalculationSession {
  readonly source: string;
  readonly settings: CalculationSettingsDto;
  readonly ready: Promise<ModuleCalculationCreation>;
  readonly #gateway: CalculationGateway;
  readonly #sessionId = allocateCalculationSessionId();
  readonly #onDispose: () => void;
  #pending = false;
  #closed = false;
  #created = false;
  #cancelPromise: Promise<void> | null = null;
  #disposePromise: Promise<void> | null = null;

  constructor(
    gateway: CalculationGateway,
    source: string,
    settings: CalculationSettingsDto,
    onDispose: () => void
  ) {
    this.#gateway = gateway;
    this.source = source;
    this.settings = settings;
    this.#onDispose = onDispose;
    this.ready = gateway
      .create(this.#sessionId, source, settings)
      .then(async (created) => {
        this.#created = created.type === "created";
        if (this.#closed) {
          // A delayed create can outlive the first release acknowledgement in a transport.
          // Wait for that release, then dispose the newly acknowledged handle as well.
          await this.#disposePromise?.catch(() => undefined);
          if (this.#created) await gateway.dispose(this.#sessionId);
          throw released();
        }
        return created.type === "created"
          ? { ok: true as const }
          : { ok: false as const, error: created.error };
      })
      .catch((error: unknown) => {
        throw transportError(error);
      });
    // Scopes can disappear before a consumer awaits ready. Retain the rejecting public promise.
    void this.ready.catch(() => undefined);
  }

  refine(significantDigits: number): Promise<RefinementResultDto> {
    if (!Number.isSafeInteger(significantDigits) || significantDigits <= 0)
      return Promise.reject(
        new CalculationTransportError(
          "ProtocolViolation",
          "significantDigits must be a positive safe integer"
        )
      );
    return this.#run(() =>
      this.#gateway.refine(this.#sessionId, allocateCalculationRequestId(), significantDigits)
    );
  }
  continue(): Promise<RefinementResultDto> {
    return this.#run(() => this.#gateway.continue(this.#sessionId, allocateCalculationRequestId()));
  }
  cancel(): Promise<void> {
    if (this.#disposePromise !== null) return this.#disposePromise;
    this.#closed = true;
    this.#cancelPromise ??= this.#gateway.cancel(this.#sessionId).catch((error: unknown) => {
      throw transportError(error);
    });
    return this.#cancelPromise;
  }
  dispose(): Promise<void> {
    if (this.#disposePromise !== null) return this.#disposePromise;
    this.#closed = true;
    this.#onDispose();
    this.#disposePromise = this.#gateway.dispose(this.#sessionId).catch((error: unknown) => {
      throw transportError(error);
    });
    return this.#disposePromise;
  }
  async #run(run: () => Promise<RefinementResultDto>): Promise<RefinementResultDto> {
    if (this.#closed) throw released();
    if (this.#pending)
      throw new CalculationTransportError(
        "DuplicatePendingOperation",
        "This session already has pending refinement"
      );
    this.#pending = true;
    try {
      const created = await this.ready;
      this.#assertOpen();
      if (!created.ok) return { status: "failed", error: created.error };
      const result = await run();
      this.#assertOpen();
      return result;
    } catch (error: unknown) {
      throw transportError(error);
    } finally {
      this.#pending = false;
    }
  }
  #assertOpen(): void {
    if (this.#closed) throw released();
  }
}

function released(): CalculationTransportError {
  return new CalculationTransportError(
    "SessionDisposed",
    "Calculation owner or session is inactive, cancelled or disposed"
  );
}
function transportError(error: unknown): CalculationTransportError {
  return error instanceof CalculationTransportError
    ? error
    : new CalculationTransportError(
        "ProtocolViolation",
        error instanceof Error ? error.message : "Calculation transport failed"
      );
}
function settingsSnapshot(settings: CalculationSettingsDto): CalculationSettingsDto {
  if (
    !["degrees", "radians"].includes(settings.angleMode) ||
    !["integer", "gamma"].includes(settings.factorialMode) ||
    !Number.isFinite(settings.maxCalculationTimeMs) ||
    settings.maxCalculationTimeMs < 0
  )
    throw new TypeError("Invalid evaluation settings");
  return Object.freeze({
    angleMode: settings.angleMode,
    factorialMode: settings.factorialMode,
    maxCalculationTimeMs: settings.maxCalculationTimeMs
  });
}
