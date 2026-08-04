import type {
  ConversationTurn,
  Goal,
  ObservationDimension,
  PerceptionOutcome,
  RelationshipProfile,
  RetrievalClass,
  Timestamp,
} from '@nexa/models';
import { terms } from './text.js';

/**
 * What the turn is *asking about*, distilled once.
 *
 * Every candidate is measured against this, so deriving it once rather than
 * per-candidate is not only cheaper — it is what makes the measurement
 * consistent. A query recomputed inside the scoring loop is a query that can
 * drift between the first candidate and the thousandth.
 *
 * Three sources, weighted differently and kept apart:
 *
 * - **The message** is what was actually said. Strongest.
 * - **The recent conversation** is what is being talked about. It catches the
 *   turn that says only "why?" — a message with no content words of its own,
 *   where the topic lives entirely in what came before.
 * - **Active goals** are what the user is trying to do, which is not always what
 *   they just said and is often why a memory matters.
 */
export interface RetrievalQuery {
  readonly at: Timestamp;
  /** Content-word stems of the current message. May be empty. */
  readonly messageTerms: readonly string[];
  /** Content-word stems of the recent conversation, excluding the message's own. */
  readonly topicTerms: readonly string[];
  /**
   * One term set per active goal, with its priority.
   *
   * Kept apart rather than pooled into one vocabulary, and the difference is not
   * cosmetic. Pooled, a user with six goals has a term set so broad that almost
   * anything covers a little of it and nothing covers much — every candidate
   * scores a weak, indistinguishable goal relevance. Per-goal, a memory that
   * squarely serves one goal scores full marks for that goal, which is what the
   * signal is meant to mean.
   */
  readonly goalTermSets: readonly GoalTerms[];
  /** The union of the above, for reporting. Never used for scoring. */
  readonly goalTerms: readonly string[];
  /** Things the message named. Matched as whole phrases. */
  readonly entities: readonly string[];
  /**
   * The strongest supportive emotional reading, or null when there was none.
   *
   * A perception *dimension* rather than a `UserEmotion`, because retrieval now
   * reads `PerceptionOutcome` directly instead of the narrowed shape Core
   * consumes. The finer vocabulary arrives intact; nothing is collapsed on the
   * way in and then guessed at again here.
   */
  readonly emotion: ObservationDimension | null;
  /** How strongly, 0–1. Zero when there is no reading. */
  readonly emotionalIntensity: number;
  /**
   * Whether the user *said* how they feel, as against it having been inferred.
   *
   * Perception draws this line and everything careful downstream is built on it.
   * Carrying it here keeps it available throughout retrieval — a consumer
   * reading `RetrievalItem.signals.emotional_fit` can now tell an anchor earned
   * by something the user stated from one earned by a guess about them, which
   * the narrowed contract had already flattened away by this point.
   */
  readonly emotionStated: boolean;
  /** Null when there is no relationship yet — the very first turn. */
  readonly relationship: RelationshipProfile | null;
}

/**
 * How far back the conversation is read for topic terms.
 *
 * Bounded because working memory is not: a long session would otherwise make the
 * topic broader every turn until it matched everything, which is the same
 * failure as having no relevance floor arrived at slowly.
 */
export const TOPIC_WINDOW_TURNS = 6;

export interface GoalTerms {
  readonly goalId: string;
  readonly terms: readonly string[];
  /** 0–1, straight from the goal. High-priority goals pull harder. */
  readonly priority: number;
}

/**
 * Emotional states that make the companion's own understanding relevant.
 *
 * A narrow list on purpose. When someone says they are frustrated, what the
 * companion has concluded about how they work — and what it is to them — becomes
 * material in a way it is not when they are asking where their keys are. When
 * someone is calm and curious, that same material is a digression.
 *
 * `emotional_fit` is an anchoring signal, so this list decides what a message
 * with no topical content can still legitimately pull in. It is kept to the
 * states where the answer is unambiguous rather than to every state that exists.
 */
export const SUPPORTIVE_DIMENSIONS: readonly ObservationDimension[] = [
  'frustration',
  'anxiety',
  'sadness',
  'fatigue',
  'confusion',
];

/**
 * Classes the companion's read of the moment makes relevant on its own.
 *
 * The mechanism behind "I'm feeling frustrated" retrieving the overworking
 * reflection and the communication preference: neither shares a word with the
 * message, and both are exactly what should surface. Without an emotional
 * anchor, a message with no nouns retrieves nothing at all — which is the
 * failure mode of a purely topical engine and the reason this signal exists.
 *
 * It is narrow by construction: four classes, gated on a supportive emotion
 * being read with real confidence, and scored below a solid lexical match so it
 * can never outrank something that is actually on topic.
 *
 * **`preference` is deliberately absent, and `communication` is not.** How
 * someone wants to be spoken to is exactly what a difficult moment makes
 * relevant; what they enjoy doing is exactly what it does not. Folding the two
 * into one class — as an earlier draft of this engine did — makes "I'm feeling
 * frustrated" retrieve the user's taste in board games, which is the failure the
 * brief names outright.
 */
export const EMOTIONALLY_RELEVANT_CLASSES: readonly RetrievalClass[] = [
  'reflection',
  'communication',
  'relationship',
  'recent_event',
];

export interface QueryInputs {
  readonly at: Timestamp;
  /**
   * What perception noticed, in full.
   *
   * The rich outcome rather than the narrowed `Perception` Core consumes. Both
   * shapes still exist and both are correct for their reader — but retrieval is
   * a sibling of perception rather than a consumer of Core's projection of it,
   * and reading the projection meant the observed/possible distinction was
   * already flattened before it arrived.
   */
  readonly perception: PerceptionOutcome;
  /**
   * The message as written.
   *
   * Supplied alongside the outcome rather than taken from it, because
   * `PerceptionOutcome` deliberately holds observations and not the utterance —
   * perception reports what it noticed, not what it was given. Lexical matching
   * needs the words, so the caller passes them.
   */
  readonly message: string;
  readonly conversation: readonly ConversationTurn[];
  readonly goals: readonly Goal[];
  readonly relationship: RelationshipProfile | null;
}

/**
 * The strongest supportive emotional reading in an outcome, or null.
 *
 * "Strongest" is by confidence, tie-broken by dimension name so the choice is
 * reproducible. Perception reports every feeling it read and refuses to pick a
 * primary one; retrieval needs a single anchor strength, so the choice is made
 * here — visibly, at the point of use, rather than by a projection upstream that
 * would make the same choice for every consumer.
 */
const supportiveReading = (
  outcome: PerceptionOutcome,
): { readonly dimension: ObservationDimension; readonly intensity: number; readonly stated: boolean } | null => {
  let best: { dimension: ObservationDimension; intensity: number; stated: boolean; confidence: number } | null = null;

  for (const observation of outcome.observations) {
    if (!SUPPORTIVE_DIMENSIONS.includes(observation.dimension)) continue;

    // Magnitude and confidence multiply rather than either alone. A strong
    // reading perception is unsure of should not move retrieval as much as a
    // moderate one it is certain about, and taking magnitude by itself is how a
    // guess about someone's mood becomes a decision about what they are told.
    const candidate = {
      dimension: observation.dimension,
      intensity: observation.magnitude * observation.confidence,
      stated: observation.stance === 'observed',
      confidence: observation.confidence,
    };

    if (
      best === null ||
      candidate.confidence > best.confidence ||
      (candidate.confidence === best.confidence &&
        candidate.dimension.localeCompare(best.dimension) < 0)
    ) {
      best = candidate;
    }
  }

  return best === null
    ? null
    : { dimension: best.dimension, intensity: best.intensity, stated: best.stated };
};

/**
 * Distils the turn into the thing candidates are measured against.
 *
 * Pure and total. An empty message, no conversation and no goals produce a query
 * with no terms — which anchors nothing and retrieves nothing, and is the
 * correct answer rather than a failure.
 */
export const deriveQuery = (inputs: QueryInputs): RetrievalQuery => {
  const messageTerms = terms(inputs.message);
  const own = new Set(messageTerms);

  // The message's own terms are removed from the topic set so the two signals
  // stay independent. Left in, every message would score full topic continuity
  // with itself, and a dimension that is always maximal is a constant wearing a
  // signal's name.
  const recent = inputs.conversation.slice(-TOPIC_WINDOW_TURNS);
  const topicTerms = terms(recent.map((turn) => turn.content).join(' ')).filter(
    (term) => !own.has(term),
  );

  const goalTermSets = inputs.goals.map((goal) => ({
    goalId: goal.id,
    terms: terms(goal.description),
    priority: goal.priority,
  }));
  const goalTerms = [...new Set(goalTermSets.flatMap((set) => set.terms))];

  const reading = supportiveReading(inputs.perception);

  return {
    at: inputs.at,
    messageTerms,
    topicTerms,
    goalTermSets,
    goalTerms,
    entities: inputs.perception.references.map((reference) => reference.text),
    emotion: reading?.dimension ?? null,
    emotionalIntensity: reading?.intensity ?? 0,
    emotionStated: reading?.stated ?? false,
    relationship: inputs.relationship,
  };
};

/**
 * Whether the moment licenses the emotional anchor at all.
 *
 * Gated on intensity, not on stance. An inferred feeling still opens the anchor,
 * exactly as it did before this engine read the richer contract — perception has
 * already capped what an inference may claim, so a merely possible reading
 * arrives with a lower confidence and therefore a lower intensity. Adding a
 * second gate here would penalise it twice for the same uncertainty. The stance
 * travels on the query for consumers that want it.
 */
export const isSupportive = (query: RetrievalQuery, floor: number): boolean =>
  query.emotion !== null && query.emotionalIntensity >= floor;
