import type { EventDurability, EventSource } from '../interfaces/envelope.js';
import { ALL_EVENT_DEFINITIONS, type DomainEventType } from '../events/index.js';
import { DuplicateEventTypeError, UnknownEventTypeError } from '../errors/index.js';

/**
 * What the registry knows about one event type.
 *
 * The static half of an event, separated from its payload type so it can be
 * inspected at runtime. TypeScript types are erased at build time, and a
 * replayer reading a two-year-old log row needs to resolve the row's shape
 * without importing the code that wrote it.
 */
export interface EventDefinition {
  readonly type: string;
  readonly version: number;
  readonly source: EventSource;
  readonly durability: EventDurability;
}

/**
 * The runtime catalogue.
 *
 * Three jobs, none of which the type system can do on its own:
 *
 * 1. **Persistence routing.** The event log writer asks whether a type is
 *    `persistent` before writing. Without this it would need a hard-coded list
 *    that silently falls behind the catalogue.
 * 2. **Replay.** Reading historical events means resolving a type string to its
 *    version and owner with no compile-time knowledge of it.
 * 3. **Startup validation.** Duplicate registration is caught here rather than
 *    surfacing as corruption months later, when two payload shapes have been
 *    sharing one wire format.
 *
 * Deliberately not a service locator. It answers questions about event
 * *definitions*; it does not resolve handlers, construct events, or dispatch.
 */
export class EventRegistry {
  readonly #definitions = new Map<string, EventDefinition>();

  /**
   * Adds a definition.
   *
   * Throws on a duplicate type. Registration happens once at startup, so
   * failing loudly costs a restart and catches a class of bug that is otherwise
   * invisible until a log is replayed.
   */
  register(definition: EventDefinition): void {
    if (this.#definitions.has(definition.type)) {
      throw new DuplicateEventTypeError(definition.type);
    }
    this.#definitions.set(definition.type, definition);
  }

  /** Looks up a definition, or throws when the type is unknown. */
  get(type: string): EventDefinition {
    const definition = this.#definitions.get(type);
    if (definition === undefined) throw new UnknownEventTypeError(type);
    return definition;
  }

  /**
   * Looks up a definition, returning null when unknown.
   *
   * The variant a consumer should use on the delivery path. A handler must
   * tolerate events written by newer code — refusing to process one because the
   * registry has not heard of it is how a rolling deploy becomes an outage.
   */
  find(type: string): EventDefinition | null {
    return this.#definitions.get(type) ?? null;
  }

  has(type: string): boolean {
    return this.#definitions.has(type);
  }

  /** True when the type should be written to the event log. Unknown types are not. */
  isPersistent(type: string): boolean {
    return this.#definitions.get(type)?.durability === 'persistent';
  }

  all(): readonly EventDefinition[] {
    return [...this.#definitions.values()];
  }

  bySource(source: EventSource): readonly EventDefinition[] {
    return this.all().filter((definition) => definition.source === source);
  }

  get size(): number {
    return this.#definitions.size;
  }
}

/**
 * A registry populated from the whole catalogue.
 *
 * Built fresh per call rather than exported as a singleton. A shared mutable
 * registry is a cross-test coupling waiting to happen, and the composition root
 * is the right place to decide how long one lives.
 */
export const createEventRegistry = (): EventRegistry => {
  const registry = new EventRegistry();
  for (const definition of ALL_EVENT_DEFINITIONS) {
    registry.register({
      type: definition.type,
      version: definition.version,
      source: definition.source,
      durability: definition.durability,
    });
  }
  return registry;
};

/** Every type string in the catalogue. Useful for allow-lists and assertions. */
export const ALL_EVENT_TYPES: readonly DomainEventType[] = ALL_EVENT_DEFINITIONS.map(
  (definition) => definition.type,
);
