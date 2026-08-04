import type { ObservationDimension } from '@nexa/models';
import type { DimensionPolicy } from './dimensions.js';
import { DIMENSION_POLICIES } from './dimensions.js';
import type { SignalExtractor } from './registry.js';
import { textCommunicationExtractor } from './text/communication.js';
import { textConversationExtractor } from './text/conversation.js';
import { textEmotionExtractor } from './text/emotion.js';
import { textInteractionExtractor } from './text/interaction.js';

/**
 * Everything the engine's judgement depends on, in one value.
 *
 * Frozen at every level: two users' perceptions share this object inside one
 * process, and a mutable default table is a cross-tenant bug waiting to be
 * written.
 *
 * The extractor list is the part that matters. It is *data*, not a hard-coded
 * pipeline, which is what makes the multimodal requirement a configuration
 * change rather than a redesign — a deployment with a microphone passes the
 * default list plus a voice extractor, and nothing else in the engine is aware
 * that anything happened.
 */
export interface PerceptionConfig {
  /**
   * What is looked for, and through which channel.
   *
   * Order is preserved into the output, so a caller supplying its own list is
   * choosing the reporting order as well as the content. Two extractors may
   * claim the same dimension on different channels; both report, and neither
   * affects the other's confidence.
   */
  readonly extractors: readonly SignalExtractor[];

  readonly dimensions: Readonly<Record<ObservationDimension, DimensionPolicy>>;

  /**
   * How many references one message may yield.
   *
   * Bounded because a long message full of proper nouns would otherwise hand
   * retrieval fifty entities, each of which widens its candidate query. The cap
   * is where "perception is cheap" stops being an aspiration.
   */
  readonly maxReferences: number;

  /**
   * Whether to report dimensions that were looked for and not found.
   *
   * On by default. Silence is a real answer — the brief's third case — and a
   * caller that cannot tell "the message showed no frustration" from "nobody
   * checked" will eventually treat the second as the first.
   */
  readonly reportUnknown: boolean;
}

export const DEFAULT_EXTRACTORS: readonly SignalExtractor[] = Object.freeze([
  textConversationExtractor,
  textCommunicationExtractor,
  textEmotionExtractor,
  textInteractionExtractor,
]);

export const DEFAULT_CONFIG: PerceptionConfig = Object.freeze({
  extractors: DEFAULT_EXTRACTORS,
  dimensions: Object.freeze(DIMENSION_POLICIES),
  maxReferences: 10,
  reportUnknown: true,
});
