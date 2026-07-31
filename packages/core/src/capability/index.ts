/**
 * The plugin system — a descriptor and an explicit registry, not a loader.
 *
 * Future engines register themselves as `CapabilityModule`s and Core never
 * names one. What Core does *not* do is discover them: no filesystem scan, no
 * dynamic import. That would buy registration and discovery at the cost of the
 * one property both halves of this codebase enforce — the composition root is
 * the single place a concrete implementation is named — and would make the
 * dependency graph unknowable statically.
 */
export type {
  PortMap,
  PortKey,
  CapabilityContext,
  CapabilityLogger,
  CapabilityInstance,
  CapabilityModule,
  AnyCapabilityModule,
  ConfigParser,
  HealthState,
  HealthStatus,
} from './module.js';
export { healthy, silentLogger } from './module.js';

export type { CapabilityRegistration, CapabilitySet } from './registry.js';
export { bootCapabilities, planInitOrder } from './registry.js';
