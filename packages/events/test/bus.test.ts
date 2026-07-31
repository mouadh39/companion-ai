import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FixedClock, trustExternalId } from '@nexa/shared';
import type { CompanionId, TurnId, UserId } from '@nexa/shared';
import {
  ALL_EVENT_TYPES,
  InProcessEventBus,
  PRIORITY,
  RecordingEventBus,
  allowOnly,
  composeMiddleware,
  createEventRegistry,
  every,
  forCompanion,
  memoryStored,
  not,
  objectDetected,
  oncePerEvent,
  persistentOnly,
  turnCompleted,
  turnStarted,
  type EventBusLifecycle,
  type EventCorrelation,
  type EventMiddleware,
} from '@nexa/events';
import { confidence, importance } from '@nexa/models';

/**
 * The bus is infrastructure, so these tests are about its guarantees rather
 * than about any one event: isolation, non-blocking dispatch, and the exact
 * scope of the features whose scope is easy to overstate — `once` and priority.
 */

const companionA = trustExternalId<CompanionId>('companion-a');
const companionB = trustExternalId<CompanionId>('companion-b');
const user = trustExternalId<UserId>('user-1');
const turn = trustExternalId<TurnId>('turn-1');

const correlation: EventCorrelation = {
  companionId: companionA,
  userId: user,
  turnId: turn,
  causedBy: null,
};

const started = () => turnStarted(correlation, { source: 'user', intent: 'question' });

/**
 * Yields to the event loop so unawaited handlers can run.
 *
 * Necessary precisely *because* the bus does not await handlers — the property
 * these tests exist to protect. A test that could assert immediately after
 * `publish` would be testing a bus that blocks its publisher.
 */
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const makeBus = (options: {
  readonly onError?: (error: unknown) => void;
  readonly middleware?: readonly EventMiddleware[];
  readonly lifecycle?: EventBusLifecycle;
} = {}) =>
  new InProcessEventBus(
    new FixedClock(new Date('2026-07-30T12:00:00.000Z')),
    (error) => options.onError?.(error),
    {
      ...(options.middleware ? { middleware: options.middleware } : {}),
      ...(options.lifecycle ? { lifecycle: options.lifecycle } : {}),
    },
  );

describe('publish', () => {
  it('stamps id and occurredAt rather than trusting the caller', async () => {
    const bus = makeBus();
    const seen: { id: string; occurredAt: string }[] = [];

    bus.subscribe('nexa.turn.started', async (event) => {
      seen.push({ id: event.id, occurredAt: event.occurredAt });
    });

    await bus.publish(started());
    await flush();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.occurredAt).toBe('2026-07-30T12:00:00.000Z');
    expect(seen[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('carries source and durability from the event definition', async () => {
    const bus = makeBus();
    const seen: { source: string; durability: string }[] = [];

    bus.subscribe('nexa.perception.object.detected', async (event) => {
      seen.push({ source: event.source, durability: event.durability });
    });

    await bus.publish(
      objectDetected(correlation, {
        objectType: 'furniture',
        label: 'desk',
        confidence: confidence(0.8),
        trackingId: 't-1',
      }),
    );
    await flush();

    expect(seen[0]).toEqual({ source: 'vision', durability: 'ephemeral' });
  });

  it('does not block on handlers', async () => {
    const bus = makeBus();
    let handlerFinished = false;

    bus.subscribe('nexa.turn.started', async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      handlerFinished = true;
    });

    await bus.publish(started());

    // The publisher has resolved; the handler has not. This is the single most
    // important property of the bus — a slow listener must never extend a turn.
    expect(handlerFinished).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(handlerFinished).toBe(true);
  });

  it('publishAll delivers every event in the batch', async () => {
    const bus = makeBus();
    const types: string[] = [];

    bus.subscribe('nexa.turn.started', async (e) => void types.push(e.type));
    bus.subscribe('nexa.turn.completed', async (e) => void types.push(e.type));

    await bus.publishAll([
      started(),
      turnCompleted(correlation, { actionCount: 1, durationMs: 12, degraded: false }),
    ]);
    await flush();

    expect(types).toEqual(['nexa.turn.started', 'nexa.turn.completed']);
  });

  it('is a no-op when nothing is listening', async () => {
    const bus = makeBus();
    await expect(bus.publish(started())).resolves.toBeUndefined();
  });
});

describe('subscribe', () => {
  it('delivers to every subscriber of a type', async () => {
    const bus = makeBus();
    const calls: string[] = [];

    bus.subscribe('nexa.turn.started', async () => void calls.push('a'));
    bus.subscribe('nexa.turn.started', async () => void calls.push('b'));
    bus.subscribe('nexa.turn.started', async () => void calls.push('c'));

    await bus.publish(started());
    await flush();

    expect(calls.sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not deliver to subscribers of other types', async () => {
    const bus = makeBus();
    const other = vi.fn(async () => {});

    bus.subscribe('nexa.turn.completed', other);
    await bus.publish(started());
    await flush();

    expect(other).not.toHaveBeenCalled();
  });

  it('narrows the payload from the type string alone', async () => {
    const bus = makeBus();
    let observed: number | null = null;

    bus.subscribe('nexa.turn.completed', async (event) => {
      // No cast: `actionCount` is inferred. If this needed one, the catalogue
      // union would be wrong.
      observed = event.payload.actionCount;
    });

    await bus.publish(
      turnCompleted(correlation, { actionCount: 3, durationMs: 5, degraded: true }),
    );
    await flush();

    expect(observed).toBe(3);
  });
});

describe('unsubscribe', () => {
  it('stops delivery via the returned function', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => {});

    const off = bus.subscribe('nexa.turn.started', handler);
    await bus.publish(started());
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);

    off();
    await bus.publish(started());
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stops delivery via the explicit method', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => {});

    bus.subscribe('nexa.turn.started', handler);
    expect(bus.unsubscribe('nexa.turn.started', handler)).toBe(true);

    await bus.publish(started());
    await flush();
    expect(handler).not.toHaveBeenCalled();
  });

  it('reports false when the handler was not registered', () => {
    const bus = makeBus();
    expect(bus.unsubscribe('nexa.turn.started', async () => {})).toBe(false);
  });

  it('leaves sibling subscriptions intact', async () => {
    const bus = makeBus();
    const removed = vi.fn(async () => {});
    const kept = vi.fn(async () => {});

    bus.subscribe('nexa.turn.started', removed);
    bus.subscribe('nexa.turn.started', kept);
    bus.unsubscribe('nexa.turn.started', removed);

    await bus.publish(started());
    await flush();

    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });
});

describe('once', () => {
  it('fires exactly one time', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => {});

    bus.once('nexa.turn.started', handler);

    await bus.publish(started());
    await bus.publish(started());
    await bus.publish(started());
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('only counts a delivery that passes its filter', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => {});

    bus.once('nexa.turn.started', handler, { filter: forCompanion(companionB) });

    // Declined — must not consume the single shot.
    await bus.publish(started());
    await flush();
    expect(handler).not.toHaveBeenCalled();

    await bus.publish(
      turnStarted(
        { ...correlation, companionId: companionB },
        { source: 'user', intent: null },
      ),
    );
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled before it fires', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => {});

    const off = bus.once('nexa.turn.started', handler);
    off();

    await bus.publish(started());
    await flush();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not disturb sibling subscribers when it detaches mid-dispatch', async () => {
    const bus = makeBus();
    const calls: string[] = [];

    // The `once` is registered first, so removing it during the fan-out would
    // shift the array under the loop and skip whoever follows.
    bus.once('nexa.turn.started', async () => void calls.push('once'));
    bus.subscribe('nexa.turn.started', async () => void calls.push('durable'));

    await bus.publish(started());
    await flush();

    expect(calls.sort()).toEqual(['durable', 'once']);
  });
});

describe('async handlers', () => {
  it('awaits genuinely asynchronous work', async () => {
    const bus = makeBus();
    const order: string[] = [];

    bus.subscribe('nexa.turn.started', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('slow');
    });
    bus.subscribe('nexa.turn.started', async () => void order.push('fast'));

    await bus.publish(started());
    await new Promise((resolve) => setTimeout(resolve, 40));

    // Both ran; the slow one finished last. Handlers are concurrent, so
    // completion order follows the work, never the registration order.
    expect(order).toEqual(['fast', 'slow']);
  });

  it('runs handlers concurrently rather than in sequence', async () => {
    const bus = makeBus();
    const finishedAt: number[] = [];
    const startedAt = Date.now();

    for (let i = 0; i < 3; i++) {
      bus.subscribe('nexa.turn.started', async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        finishedAt.push(Date.now() - startedAt);
      });
    }

    await bus.publish(started());
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(finishedAt).toHaveLength(3);
    // Each handler's own elapsed time is what distinguishes the two models.
    // Concurrent: all finish near 25ms. Sequential: 25, 50, 75.
    expect(Math.max(...finishedAt)).toBeLessThan(70);
  });
});

describe('error isolation', () => {
  it('a throwing handler does not fail the publisher', async () => {
    const errors: unknown[] = [];
    const bus = makeBus({ onError: (error) => void errors.push(error) });

    bus.subscribe('nexa.turn.started', async () => {
      throw new Error('handler exploded');
    });

    await expect(bus.publish(started())).resolves.toBeUndefined();
    await flush();
    expect(errors).toHaveLength(1);
  });

  it('a throwing handler does not prevent the others from running', async () => {
    const bus = makeBus({ onError: () => {} });
    const survivor = vi.fn(async () => {});

    bus.subscribe('nexa.turn.started', async () => {
      throw new Error('first fails');
    });
    bus.subscribe('nexa.turn.started', survivor);

    await bus.publish(started());
    await flush();

    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it('reports the event id and type with the failure', async () => {
    const contexts: { eventId: string; eventType: string }[] = [];
    const bus = new InProcessEventBus(
      new FixedClock(new Date('2026-07-30T12:00:00.000Z')),
      (_error, context) => void contexts.push(context),
    );

    bus.subscribe('nexa.turn.started', async () => {
      throw new Error('boom');
    });

    await bus.publish(started());
    await flush();

    expect(contexts[0]?.eventType).toBe('nexa.turn.started');
    expect(contexts[0]?.eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a handler that never settles does not stall the bus', async () => {
    const errors: unknown[] = [];
    const bus = new InProcessEventBus(
      new FixedClock(new Date('2026-07-30T12:00:00.000Z')),
      (error) => void errors.push(error),
      { handlerTimeoutMs: 20 },
    );

    bus.subscribe('nexa.turn.started', () => new Promise<void>(() => {}));

    await bus.publish(started());
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toContain('exceeded 20ms');
  });
});

describe('event filtering', () => {
  it('declines events the filter rejects', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => {});

    bus.subscribe('nexa.turn.started', handler, { filter: forCompanion(companionB) });

    await bus.publish(started());
    await flush();
    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers events the filter accepts', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => {});

    bus.subscribe('nexa.turn.started', handler, { filter: forCompanion(companionA) });

    await bus.publish(started());
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('composes filters', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => {});

    bus.subscribe('nexa.turn.started', handler, {
      filter: every(forCompanion(companionA), not(forCompanion(companionB))),
    });

    await bus.publish(started());
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reports a decline as dropped rather than as silence', async () => {
    const dropped: string[] = [];
    const bus = makeBus({
      lifecycle: { onDropped: (_event, reason) => void dropped.push(reason) },
    });

    bus.subscribe('nexa.turn.started', async () => {}, {
      filter: forCompanion(companionB),
    });

    await bus.publish(started());
    await flush();

    expect(dropped).toEqual(['filtered']);
  });
});

describe('priority', () => {
  it('starts higher-priority handlers first', async () => {
    const bus = makeBus();
    const order: string[] = [];

    bus.subscribe('nexa.turn.started', async () => void order.push('low'), {
      priority: PRIORITY.low,
    });
    bus.subscribe('nexa.turn.started', async () => void order.push('monitor'), {
      priority: PRIORITY.monitor,
    });
    bus.subscribe('nexa.turn.started', async () => void order.push('normal'), {
      priority: PRIORITY.normal,
    });

    await bus.publish(started());
    await flush();

    expect(order).toEqual(['monitor', 'normal', 'low']);
  });

  it('keeps equal priorities in registration order', async () => {
    const bus = makeBus();
    const order: string[] = [];

    bus.subscribe('nexa.turn.started', async () => void order.push('first'));
    bus.subscribe('nexa.turn.started', async () => void order.push('second'));

    await bus.publish(started());
    await flush();

    expect(order).toEqual(['first', 'second']);
  });

  it('orders invocation only — not completion', async () => {
    const bus = makeBus();
    const completed: string[] = [];

    bus.subscribe(
      'nexa.turn.started',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        completed.push('high');
      },
      { priority: PRIORITY.high },
    );
    bus.subscribe('nexa.turn.started', async () => void completed.push('low'), {
      priority: PRIORITY.low,
    });

    await bus.publish(started());
    await new Promise((resolve) => setTimeout(resolve, 60));

    // The documented caveat, pinned by a test so nobody comes to rely on the
    // stronger guarantee: handlers are not awaited, so a high-priority slow
    // handler finishes after a low-priority fast one.
    expect(completed).toEqual(['low', 'high']);
  });
});

describe('middleware', () => {
  it('wraps dispatch, outermost first', async () => {
    const order: string[] = [];
    const outer: EventMiddleware = async (_e, next) => {
      order.push('outer:in');
      await next();
      order.push('outer:out');
    };
    const inner: EventMiddleware = async (_e, next) => {
      order.push('inner:in');
      await next();
      order.push('inner:out');
    };

    const bus = makeBus({ middleware: [outer, inner] });
    bus.subscribe('nexa.turn.started', async () => void order.push('handler'));

    await bus.publish(started());
    await flush();

    expect(order).toEqual(['outer:in', 'inner:in', 'handler', 'inner:out', 'outer:out']);
  });

  it('vetoes dispatch when next() is not called', async () => {
    const veto: EventMiddleware = async () => {};
    const bus = makeBus({ middleware: [veto] });
    const handler = vi.fn(async () => {});

    bus.subscribe('nexa.turn.started', handler);
    await bus.publish(started());
    await flush();

    expect(handler).not.toHaveBeenCalled();
  });

  it('allowOnly passes listed types and blocks the rest', async () => {
    const bus = makeBus({ middleware: [allowOnly(['nexa.turn.completed'])] });
    const onStarted = vi.fn(async () => {});
    const onCompleted = vi.fn(async () => {});

    bus.subscribe('nexa.turn.started', onStarted);
    bus.subscribe('nexa.turn.completed', onCompleted);

    await bus.publishAll([
      started(),
      turnCompleted(correlation, { actionCount: 0, durationMs: 1, degraded: false }),
    ]);
    await flush();

    expect(onStarted).not.toHaveBeenCalled();
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('persistentOnly blocks ephemeral events', async () => {
    const bus = makeBus({ middleware: [persistentOnly] });
    const onEphemeral = vi.fn(async () => {});
    const onDurable = vi.fn(async () => {});

    bus.subscribe('nexa.perception.object.detected', onEphemeral);
    bus.subscribe('nexa.memory.stored', onDurable);

    await bus.publishAll([
      objectDetected(correlation, {
        objectType: 'device',
        label: 'lamp',
        confidence: confidence(0.7),
        trackingId: 't-2',
      }),
      memoryStored(correlation, {
        memoryId: trustExternalId('mem-1'),
        memoryType: 'episodic',
        importance: importance(0.6),
        source: 'conversation',
      }),
    ]);
    await flush();

    expect(onEphemeral).not.toHaveBeenCalled();
    expect(onDurable).toHaveBeenCalledTimes(1);
  });

  it('rejects a middleware that calls next() twice', async () => {
    const doubled: EventMiddleware = async (_e, next) => {
      await next();
      await next();
    };

    // Guarded rather than documented: double-dispatch is intermittent and
    // extremely hard to trace back from the symptom.
    await expect(composeMiddleware([doubled])(started() as never, async () => {})).rejects.toThrow(
      /more than once/,
    );
  });
});

describe('lifecycle hooks', () => {
  it('reports publication, success and no-subscriber drops', async () => {
    const events: string[] = [];
    const bus = makeBus({
      lifecycle: {
        onPublished: () => void events.push('published'),
        onHandlerSucceeded: () => void events.push('succeeded'),
        onDropped: (_e, reason) => void events.push(`dropped:${reason}`),
      },
    });

    await bus.publish(started());
    await flush();
    expect(events).toEqual(['published', 'dropped:no_subscribers']);

    events.length = 0;
    bus.subscribe('nexa.turn.started', async () => {});
    await bus.publish(started());
    await flush();
    expect(events).toEqual(['published', 'succeeded']);
  });

  it('reports handler failure with a duration', async () => {
    const failures: { name: string; hasDuration: boolean }[] = [];
    const bus = makeBus({
      onError: () => {},
      lifecycle: {
        onHandlerFailed: (_e, context) =>
          void failures.push({
            name: context.handlerName,
            hasDuration: typeof context.durationMs === 'number',
          }),
      },
    });

    bus.subscribe(
      'nexa.turn.started',
      async () => {
        throw new Error('nope');
      },
      { name: 'memory-writer' },
    );

    await bus.publish(started());
    await flush();

    expect(failures).toEqual([{ name: 'memory-writer', hasDuration: true }]);
  });

  it('a throwing hook does not break dispatch', async () => {
    const bus = makeBus({
      lifecycle: {
        onPublished: () => {
          throw new Error('broken metric');
        },
      },
    });
    const handler = vi.fn(async () => {});

    bus.subscribe('nexa.turn.started', handler);
    await expect(bus.publish(started())).resolves.toBeUndefined();
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('idempotency', () => {
  it('oncePerEvent suppresses a redelivered event id', async () => {
    const bus = makeBus();
    const inner = vi.fn(async () => {});

    bus.subscribe('nexa.turn.started', oncePerEvent(inner));

    const draft = started();
    await bus.publish(draft);
    await flush();
    expect(inner).toHaveBeenCalledTimes(1);

    // Distinct publishes get distinct ids, so both are genuinely new events.
    await bus.publish(draft);
    await flush();
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it('suppresses the same event delivered twice', async () => {
    const inner = vi.fn(async () => {});
    const guarded = oncePerEvent(inner);
    const event = { id: 'evt-1' } as never;

    await guarded(event);
    await guarded(event);
    await guarded(event);

    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('evicts oldest keys rather than growing without bound', async () => {
    const inner = vi.fn(async () => {});
    const guarded = oncePerEvent(inner, { capacity: 2 });

    await guarded({ id: 'a' });
    await guarded({ id: 'b' });
    await guarded({ id: 'c' });
    // 'a' has been evicted, so it is no longer recognised as a repeat.
    await guarded({ id: 'a' });

    expect(inner).toHaveBeenCalledTimes(4);
  });
});

describe('registry', () => {
  let registry: ReturnType<typeof createEventRegistry>;
  beforeEach(() => {
    registry = createEventRegistry();
  });

  it('holds every catalogued event', () => {
    expect(registry.size).toBe(ALL_EVENT_TYPES.length);
    expect(registry.size).toBeGreaterThan(30);
  });

  it('resolves a definition by type', () => {
    expect(registry.get('nexa.memory.stored')).toEqual({
      type: 'nexa.memory.stored',
      version: 1,
      source: 'memory',
      durability: 'persistent',
    });
  });

  it('classifies perception as ephemeral and cognition as persistent', () => {
    expect(registry.isPersistent('nexa.perception.object.detected')).toBe(false);
    expect(registry.isPersistent('nexa.decision.made')).toBe(true);
  });

  it('returns null for an unknown type rather than throwing', () => {
    // A consumer must tolerate events written by newer code.
    expect(registry.find('nexa.future.invented')).toBeNull();
  });

  it('throws on a duplicate registration', () => {
    expect(() =>
      registry.register({
        type: 'nexa.memory.stored',
        version: 1,
        source: 'memory',
        durability: 'persistent',
      }),
    ).toThrow(/already registered/);
  });

  it('has no duplicate type strings in the catalogue', () => {
    expect(new Set(ALL_EVENT_TYPES).size).toBe(ALL_EVENT_TYPES.length);
  });

  it('namespaces every type under nexa.', () => {
    for (const type of ALL_EVENT_TYPES) {
      expect(type).toMatch(/^nexa\.[a-z]+(\.[a-z_]+)+$/);
    }
  });
});

describe('RecordingEventBus', () => {
  it('records drafts without dispatching', async () => {
    const bus = new RecordingEventBus();
    await bus.publish(started());
    await bus.publish(
      turnCompleted(correlation, { actionCount: 2, durationMs: 8, degraded: false }),
    );

    expect(bus.typesEmitted()).toEqual(['nexa.turn.started', 'nexa.turn.completed']);
    expect(bus.ofType('nexa.turn.completed')[0]?.payload.actionCount).toBe(2);
  });

  it('clears between assertions', async () => {
    const bus = new RecordingEventBus();
    await bus.publish(started());
    bus.clear();
    expect(bus.recorded).toHaveLength(0);
  });
});
