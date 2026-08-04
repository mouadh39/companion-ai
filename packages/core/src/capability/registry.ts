import type { DomainEventType } from '@nexa/events';
import {
  CapabilityCycleError,
  CapabilityConflictError,
  MissingCapabilityError,
} from '../errors.js';
import type {
  AnyCapabilityModule,
  CapabilityContext,
  CapabilityInstance,
  HealthStatus,
  PortKey,
  PortMap,
} from './module.js';

/** A module paired with the raw configuration it should be given. */
export interface CapabilityRegistration {
  readonly module: AnyCapabilityModule;
  readonly config?: unknown;
}

/** What a booted system exposes to the composition root. */
export interface CapabilitySet {
  readonly ports: PortMap;
  /** Declared subscriptions, so the root can wire them to the bus in one place. */
  readonly subscriptions: readonly {
    readonly capabilityId: string;
    readonly eventType: DomainEventType;
  }[];
  health(): Promise<Readonly<Record<string, HealthStatus>>>;
  /** Stops every capability in reverse initialisation order. */
  shutdown(): Promise<void>;
}

/**
 * Boots capabilities in dependency order.
 *
 * Every failure mode here is a **startup failure with a named cause**: a cycle,
 * a missing provider, two modules claiming one port, or a module that did not
 * return what it promised. All four are otherwise discovered as a null
 * dereference on turn four hundred, which reads to a user as the companion
 * inexplicably losing a faculty.
 *
 * Core never resolves from this. The registry produces a `PortMap`, the
 * composition root reads it, and `CognitiveTurn` receives an explicit
 * dependency object — the same concession made for Unity's `ServiceRegistry`,
 * where a locator is acceptable only because exactly one layer resolves from it.
 */
export const bootCapabilities = async (
  registrations: readonly CapabilityRegistration[],
  context: CapabilityContext,
): Promise<CapabilitySet> => {
  assertNoDuplicateIds(registrations);
  assertNoConflictingPorts(registrations);

  const order = planInitOrder(registrations);

  const ports: Record<string, unknown> = {};
  const started: { id: string; instance: CapabilityInstance }[] = [];
  const subscriptions: { capabilityId: string; eventType: DomainEventType }[] = [];

  const rollback = async (): Promise<void> => {
    for (const entry of [...started].reverse()) {
      await entry.instance.stop().catch(() => undefined);
    }
  };

  try {
    for (const registration of order) {
      const { module } = registration;
      const config =
        module.parseConfig === undefined
          ? (registration.config as never)
          : (module.parseConfig(registration.config) as never);

      const instance = await module.init(context, config, ports);

      // A module that declared a port and did not return it would otherwise
      // leave a hole that only shows up when something reaches through it.
      for (const key of module.provides) {
        if (instance.ports[key] === undefined) {
          throw new MissingCapabilityError(
            key,
            `declared by '${module.id}' but not returned from init`,
          );
        }
        ports[key] = instance.ports[key];
      }

      started.push({ id: module.id, instance });
      for (const eventType of module.subscribes) {
        subscriptions.push({ capabilityId: module.id, eventType });
      }
    }

    // Started only once every port exists, because a capability's background
    // work may depend on one constructed after it.
    for (const entry of started) {
      await entry.instance.start?.();
    }
  } catch (cause) {
    await rollback();
    throw cause;
  }

  return {
    ports: ports,
    subscriptions,

    async health(): Promise<Readonly<Record<string, HealthStatus>>> {
      const report: Record<string, HealthStatus> = {};
      for (const entry of started) {
        report[entry.id] = (await entry.instance.health?.().catch(() => null)) ?? {
          state: 'healthy',
          detail: null,
        };
      }
      return report;
    },

    async shutdown(): Promise<void> {
      // Reverse order: a capability may depend on one initialised before it,
      // and stopping that one first would pull the floor out mid-drain.
      for (const entry of [...started].reverse()) {
        await entry.instance.stop();
      }
    },
  };
};

/**
 * Sorts registrations so every module runs after the ones it requires.
 *
 * Kahn by levels rather than a depth-first walk, because a level boundary is
 * where a cycle becomes visible: a pass that frees nothing means everything
 * remaining is waiting on something remaining.
 */
export const planInitOrder = (
  registrations: readonly CapabilityRegistration[],
): readonly CapabilityRegistration[] => {
  const providers = new Map<PortKey, string>();
  for (const { module } of registrations) {
    for (const key of module.provides) providers.set(key, module.id);
  }

  for (const { module } of registrations) {
    for (const key of module.requires) {
      if (!providers.has(key)) {
        throw new MissingCapabilityError(
          key,
          `required by '${module.id}' but no registered capability provides it`,
        );
      }
    }
  }

  const ordered: CapabilityRegistration[] = [];
  const satisfied = new Set<PortKey>();
  let remaining = [...registrations];

  while (remaining.length > 0) {
    const ready = remaining.filter(({ module }) =>
      module.requires.every((key) => satisfied.has(key)),
    );

    if (ready.length === 0) {
      throw new CapabilityCycleError(remaining.map(({ module }) => module.id));
    }

    for (const registration of ready) {
      ordered.push(registration);
      for (const key of registration.module.provides) satisfied.add(key);
    }

    const done = new Set(ready.map(({ module }) => module.id));
    remaining = remaining.filter(({ module }) => !done.has(module.id));
  }

  return ordered;
};

const assertNoDuplicateIds = (registrations: readonly CapabilityRegistration[]): void => {
  const seen = new Set<string>();
  for (const { module } of registrations) {
    if (seen.has(module.id)) {
      throw new CapabilityConflictError(
        module.id,
        `is registered twice; capability ids must be unique`,
      );
    }
    seen.add(module.id);
  }
};

/**
 * Two capabilities claiming one port is ambiguous, not a preference.
 *
 * Whichever won would depend on registration order, which is exactly the kind
 * of dependency nobody writes down and everybody eventually trips over.
 */
const assertNoConflictingPorts = (
  registrations: readonly CapabilityRegistration[],
): void => {
  const claimed = new Map<PortKey, string>();
  for (const { module } of registrations) {
    for (const key of module.provides) {
      const existing = claimed.get(key);
      if (existing !== undefined) {
        throw new CapabilityConflictError(
          key,
          `is provided by both '${existing}' and '${module.id}'`,
        );
      }
      claimed.set(key, module.id);
    }
  }
};
