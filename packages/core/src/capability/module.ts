import type { Clock } from '@nexa/shared';
import type { EventPublisher, DomainEventType } from '@nexa/events';
import type { ContextPorts, MemoryWritePort, PerceptionPort, ToolExecutionPort } from '../ports.js';

/**
 * The ports a capability may provide.
 *
 * Named keys rather than a class registry, because the composition root has to
 * hand `CognitiveTurn` a concrete object and the compiler should be the thing
 * that checks it is complete.
 */
export interface PortMap extends Partial<ContextPorts> {
  readonly perception?: PerceptionPort;
  readonly memoryWrite?: MemoryWritePort;
  readonly toolExecution?: ToolExecutionPort;
}

export type PortKey = keyof PortMap;

/** What a capability is given at construction. */
export interface CapabilityContext {
  /**
   * Publish only.
   *
   * A capability declares what it subscribes to; it does not wire handlers
   * imperatively. Otherwise the subscription graph exists only at runtime, and
   * "who reacts to this event?" becomes a question you answer by grepping.
   */
  readonly events: EventPublisher;
  readonly clock: Clock;
  readonly logger: CapabilityLogger;
}

/** Minimal structured logging, so a capability needs no logging dependency. */
export interface CapabilityLogger {
  debug(message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export type HealthState = 'healthy' | 'degraded' | 'unavailable';

export interface HealthStatus {
  readonly state: HealthState;
  readonly detail: string | null;
}

export const healthy: HealthStatus = { state: 'healthy', detail: null };

/** A capability, running. */
export interface CapabilityInstance {
  /** What this capability contributes. Merged into the root's `PortMap`. */
  readonly ports: PortMap;
  /**
   * Begins background work — pollers, consumers, warm-up.
   *
   * Separate from `init` because a capability may need every port in the system
   * to exist before it can start, and construction cannot depend on things
   * constructed after it.
   */
  start?(): Promise<void>;
  /** Drains and releases. Called in reverse dependency order. */
  stop(): Promise<void>;
  health?(): Promise<HealthStatus>;
}

/**
 * Validates configuration at boot.
 *
 * A plain function rather than a schema-library type, so `@nexa/core` gains no
 * validation dependency and a capability may use whichever one it likes.
 * Throwing is the contract — a bad `MEMORY_TOP_K` should refuse to start the
 * process, not surface as strange retrieval three hours later.
 */
export type ConfigParser<TConfig> = (raw: unknown) => TConfig;

/**
 * A registrable capability.
 *
 * This is a plugin *descriptor*, not a plugin *loader*, and the distinction is
 * deliberate. Filesystem scanning and dynamic `import()` would buy registration
 * and discovery at the cost of the property both halves of this codebase
 * enforce: the composition root is the single place that names a concrete
 * implementation. Dynamic discovery makes the dependency graph unknowable
 * statically, turns a typo in a config file into a runtime crash instead of a
 * compile error, and defeats tree-shaking.
 *
 * Because a capability's whole surface is a `PortMap` plus a set of event
 * subscriptions, an out-of-process capability is simply one whose ports are RPC
 * clients. Core does not change for that.
 */
export interface CapabilityModule<TConfig = unknown> {
  readonly id: string;
  readonly version: string;
  /** Ports it satisfies. Checked against what it actually returns at boot. */
  readonly provides: readonly PortKey[];
  /** Ports it needs from others. Drives initialisation order. */
  readonly requires: readonly PortKey[];
  /** Events it reacts to. Declared, so the graph is readable without running it. */
  readonly subscribes: readonly DomainEventType[];
  readonly parseConfig?: ConfigParser<TConfig>;

  init(
    context: CapabilityContext,
    config: TConfig,
    provided: PortMap,
  ): Promise<CapabilityInstance>;
}

/**
 * Any module, for the heterogeneous list the registry holds.
 *
 * Declared structurally rather than as `CapabilityModule<never>` because
 * `TConfig` appears both as a return type (`parseConfig`) and a parameter type
 * (`init`), which makes the generic invariant — no single instantiation accepts
 * every module. Widening the two positions independently is what lets the
 * registry hold modules with unrelated config types, and `never` on the `init`
 * parameter is sound because method parameters are bivariant and the registry
 * only ever passes back what that module's own `parseConfig` produced.
 */
export interface AnyCapabilityModule {
  readonly id: string;
  readonly version: string;
  readonly provides: readonly PortKey[];
  readonly requires: readonly PortKey[];
  readonly subscribes: readonly DomainEventType[];
  readonly parseConfig?: ((raw: unknown) => unknown) | undefined;
  init(
    context: CapabilityContext,
    config: never,
    provided: PortMap,
  ): Promise<CapabilityInstance>;
}

/** Discards everything. The default when a root supplies no logger. */
export const silentLogger: CapabilityLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
