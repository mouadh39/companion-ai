import { describe, expect, it } from 'vitest';
import {
  CapabilityConflictError,
  CapabilityCycleError,
  MissingCapabilityError,
  bootCapabilities,
  planInitOrder,
  silentLogger,
} from '@nexa/core';
import type {
  CapabilityContext,
  CapabilityInstance,
  CapabilityModule,
  CapabilityRegistration,
  PortKey,
  PortMap,
} from '@nexa/core';
import { FixedClock } from '@nexa/shared';

/**
 * The capability registry.
 *
 * Every failure it detects is a startup failure with a named cause. The
 * alternative is a null dereference on turn four hundred, which reads to a user
 * as the companion inexplicably losing a faculty — and to an operator as
 * nothing at all until someone reports it.
 */

const context: CapabilityContext = {
  events: { publish: async () => undefined, publishAll: async () => undefined },
  clock: new FixedClock(1_000),
  logger: silentLogger,
};

/** A stub port object; identity is all these tests care about. */
const stubPort = (): never => ({}) as never;

const moduleFor = (options: {
  id: string;
  provides?: readonly PortKey[];
  requires?: readonly PortKey[];
  onInit?: (provided: PortMap) => void;
  onStart?: () => void;
  onStop?: () => void;
  failInit?: boolean;
  omitProvided?: boolean;
}): CapabilityModule => ({
  id: options.id,
  version: '1.0.0',
  provides: options.provides ?? [],
  requires: options.requires ?? [],
  subscribes: [],
  init: async (_context, _config, provided): Promise<CapabilityInstance> => {
    options.onInit?.(provided);
    if (options.failInit === true) throw new Error(`${options.id} failed to initialise`);

    const ports: Record<string, unknown> = {};
    if (options.omitProvided !== true) {
      for (const key of options.provides ?? []) ports[key] = stubPort();
    }

    return {
      ports: ports,
      start: async () => {
        options.onStart?.();
      },
      stop: async () => {
        options.onStop?.();
      },
    };
  },
});

const reg = (module: CapabilityModule): CapabilityRegistration => ({ module });

describe('planInitOrder', () => {
  it('keeps independent capabilities in registration order', () => {
    const order = planInitOrder([
      reg(moduleFor({ id: 'a', provides: ['goals'] })),
      reg(moduleFor({ id: 'b', provides: ['tools'] })),
    ]);

    expect(order.map((r) => r.module.id)).toEqual(['a', 'b']);
  });

  it('initialises a provider before its consumer', () => {
    const order = planInitOrder([
      reg(moduleFor({ id: 'memory', provides: ['memoryRetrieval'], requires: ['goals'] })),
      reg(moduleFor({ id: 'goals', provides: ['goals'] })),
    ]);

    expect(order.map((r) => r.module.id)).toEqual(['goals', 'memory']);
  });

  it('resolves a transitive chain', () => {
    const order = planInitOrder([
      reg(moduleFor({ id: 'c', provides: ['tools'], requires: ['memoryRetrieval'] })),
      reg(moduleFor({ id: 'b', provides: ['memoryRetrieval'], requires: ['goals'] })),
      reg(moduleFor({ id: 'a', provides: ['goals'] })),
    ]);

    expect(order.map((r) => r.module.id)).toEqual(['a', 'b', 'c']);
  });

  it('rejects a cycle', () => {
    expect(() =>
      planInitOrder([
        reg(moduleFor({ id: 'a', provides: ['goals'], requires: ['tools'] })),
        reg(moduleFor({ id: 'b', provides: ['tools'], requires: ['goals'] })),
      ]),
    ).toThrow(CapabilityCycleError);
  });

  /**
   * The failure that would otherwise surface as a null port mid-turn — which is
   * to say, as the companion losing a faculty for reasons nobody can trace.
   */
  it('rejects a requirement nothing provides', () => {
    expect(() =>
      planInitOrder([reg(moduleFor({ id: 'a', requires: ['memoryRetrieval'] }))]),
    ).toThrow(MissingCapabilityError);
  });
});

describe('bootCapabilities', () => {
  it('collects every provided port into one map', async () => {
    const set = await bootCapabilities(
      [
        reg(moduleFor({ id: 'a', provides: ['goals'] })),
        reg(moduleFor({ id: 'b', provides: ['tools', 'identity'] })),
      ],
      context,
    );

    expect(Object.keys(set.ports).sort()).toEqual(['goals', 'identity', 'tools']);
    await set.shutdown();
  });

  it('hands a consumer the ports initialised before it', async () => {
    let seen: readonly string[] = [];

    const set = await bootCapabilities(
      [
        reg(
          moduleFor({
            id: 'memory',
            provides: ['memoryRetrieval'],
            requires: ['goals'],
            onInit: (provided) => {
              seen = Object.keys(provided);
            },
          }),
        ),
        reg(moduleFor({ id: 'goals', provides: ['goals'] })),
      ],
      context,
    );

    expect(seen).toEqual(['goals']);
    await set.shutdown();
  });

  /**
   * Started only once every port exists, because a capability's background work
   * may depend on one constructed after it.
   */
  it('starts everything only after everything is initialised', async () => {
    const events: string[] = [];

    const set = await bootCapabilities(
      [
        reg(
          moduleFor({
            id: 'a',
            provides: ['goals'],
            onInit: () => events.push('init-a'),
            onStart: () => events.push('start-a'),
          }),
        ),
        reg(
          moduleFor({
            id: 'b',
            provides: ['tools'],
            onInit: () => events.push('init-b'),
            onStart: () => events.push('start-b'),
          }),
        ),
      ],
      context,
    );

    expect(events).toEqual(['init-a', 'init-b', 'start-a', 'start-b']);
    await set.shutdown();
  });

  it('stops in reverse initialisation order', async () => {
    const stopped: string[] = [];

    const set = await bootCapabilities(
      [
        reg(moduleFor({ id: 'a', provides: ['goals'], onStop: () => stopped.push('a') })),
        reg(
          moduleFor({
            id: 'b',
            provides: ['memoryRetrieval'],
            requires: ['goals'],
            onStop: () => stopped.push('b'),
          }),
        ),
      ],
      context,
    );

    await set.shutdown();
    // 'b' depends on 'a', so stopping 'a' first would pull the floor out mid-drain.
    expect(stopped).toEqual(['b', 'a']);
  });

  it('rejects two capabilities claiming one port', async () => {
    await expect(
      bootCapabilities(
        [
          reg(moduleFor({ id: 'a', provides: ['goals'] })),
          reg(moduleFor({ id: 'b', provides: ['goals'] })),
        ],
        context,
      ),
    ).rejects.toThrow(CapabilityConflictError);
  });

  it('rejects a duplicate capability id', async () => {
    await expect(
      bootCapabilities(
        [reg(moduleFor({ id: 'a' })), reg(moduleFor({ id: 'a' }))],
        context,
      ),
    ).rejects.toThrow(CapabilityConflictError);
  });

  /** A declared port that never arrives leaves a hole nothing else can see. */
  it('rejects a capability that does not deliver what it declared', async () => {
    await expect(
      bootCapabilities(
        [reg(moduleFor({ id: 'a', provides: ['goals'], omitProvided: true }))],
        context,
      ),
    ).rejects.toThrow(MissingCapabilityError);
  });

  it('rolls back what it already started when one fails', async () => {
    const stopped: string[] = [];

    await expect(
      bootCapabilities(
        [
          reg(moduleFor({ id: 'a', provides: ['goals'], onStop: () => stopped.push('a') })),
          reg(moduleFor({ id: 'b', requires: ['goals'], failInit: true })),
        ],
        context,
      ),
    ).rejects.toThrow('b failed to initialise');

    // A half-booted process holding open connections is worse than one that
    // refused to start.
    expect(stopped).toEqual(['a']);
  });

  it('reports health per capability', async () => {
    const set = await bootCapabilities([reg(moduleFor({ id: 'a' }))], context);

    expect(await set.health()).toEqual({ a: { state: 'healthy', detail: null } });
    await set.shutdown();
  });

  it('collects declared subscriptions in one place', async () => {
    const set = await bootCapabilities(
      [
        {
          module: {
            ...moduleFor({ id: 'reflection' }),
            subscribes: ['nexa.turn.completed'],
          },
        },
      ],
      context,
    );

    expect(set.subscriptions).toEqual([
      { capabilityId: 'reflection', eventType: 'nexa.turn.completed' },
    ]);
    await set.shutdown();
  });

  /** A bad setting should refuse to start the process, not surface hours later. */
  it('fails the boot when configuration does not validate', async () => {
    const module: CapabilityModule<{ topK: number }> = {
      id: 'memory',
      version: '1.0.0',
      provides: [],
      requires: [],
      subscribes: [],
      parseConfig: (raw) => {
        const value = (raw as { topK?: unknown } | undefined)?.topK;
        if (typeof value !== 'number') throw new Error('topK must be a number');
        return { topK: value };
      },
      init: async () => ({ ports: {}, stop: async () => undefined }),
    };

    await expect(
      bootCapabilities([{ module, config: { topK: 'twelve' } }], context),
    ).rejects.toThrow('topK must be a number');
  });
});
