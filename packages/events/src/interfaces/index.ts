/**
 * The envelope contract.
 *
 * Everything that crosses the bus has this shape. `docs/specifications/Event_API.md`
 * is the normative version; this is its executable form.
 */
export type {
  EventEnvelope,
  EventCorrelation,
  EventDraft,
  EventSource,
  EventDurability,
  EventDefinitionOptions,
  EventFactory,
} from './envelope.js';
export { defineEvent, EVENT_SOURCES } from './envelope.js';
