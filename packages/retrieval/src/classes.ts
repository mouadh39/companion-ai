import type {
  Durability,
  Insight,
  InsightKind,
  Memory,
  RelevanceSignals,
  RetrievalClass,
  SignalName,
} from '@nexa/models';

/**
 * What each class of knowledge is worth, and what makes it relevant.
 *
 * One table, and it is the whole of the ranking policy. Everything the engine
 * believes about how a preference differs from a passing note is here, as data,
 * rather than distributed through the code as conditionals — which is what lets
 * a reader answer "why did the habit outrank the milestone?" by reading two rows
 * instead of tracing a function.
 *
 * The asymmetry across classes is the design:
 *
 * - A `recent_event` halves in relevance every week and leans on recency for a
 *   quarter of its score. That is correct: what happened on Tuesday matters this
 *   week and is noise next year.
 * - An `identity` fact halves every decade and scores nothing for being new.
 *   Someone's profession does not become less true for being old news.
 * - A `reflection` weights confidence and stability heavily, because it is the
 *   only class the companion produced itself, and a conclusion it keeps revising
 *   is one it should be slower to raise.
 */
export interface ClassPolicy {
  readonly retrievalClass: RetrievalClass;
  readonly durability: Durability;

  /**
   * Days for the recency signal to halve.
   *
   * Exponential rather than linear so nothing ever reaches zero and drops out of
   * consideration purely for being old. A ten-year-old milestone should rank
   * below a fresh one and should still be reachable when the user brings it up,
   * which linear decay to zero would prevent.
   */
  readonly halfLifeDays: number;

  /**
   * How much each dimension counts, for this class.
   *
   * Sums to 1 across every class, and no single entry may exceed
   * `MAX_SINGLE_WEIGHT`. Both are enforced by test rather than by convention:
   * the first keeps scores comparable *between* classes, and the second is the
   * mechanical form of "do not rely on a single score" — no dimension can ever
   * be more than about a quarter of the answer.
   */
  readonly weights: Readonly<Partial<Record<SignalName, number>>>;

  /** Default ceiling on how many of this class one retrieval may carry. */
  readonly defaultCap: number;
}

/**
 * The ceiling on any one dimension's influence.
 *
 * A weight table is exactly where "multi-dimensional ranking" quietly becomes
 * "cosine similarity with decoration": someone tunes semantic up to 0.8 to fix a
 * bad result and the other eleven signals become rounding error. Capping the
 * weight makes that a test failure rather than a gradual drift nobody notices.
 */
export const MAX_SINGLE_WEIGHT = 0.35;

export const CLASS_POLICIES: Readonly<Record<RetrievalClass, ClassPolicy>> = {
  /**
   * Who the user is. Effectively timeless, so recency is nearly weightless and
   * confidence matters — an identity fact the companion is unsure of is one it
   * should be slow to build a sentence on.
   */
  identity: {
    retrievalClass: 'identity',
    durability: 'durable',
    halfLifeDays: 3_650,
    weights: {
      semantic: 0.2,
      lexical: 0.25,
      entity: 0.2,
      importance: 0.1,
      confidence: 0.15,
      recency: 0.05,
      reinforcement: 0.05,
    },
    defaultCap: 3,
  },

  /**
   * How they like things done. Reinforcement counts for more here than
   * anywhere: a preference stated five times is a preference, and one stated
   * once in passing is a remark.
   */
  preference: {
    retrievalClass: 'preference',
    durability: 'durable',
    halfLifeDays: 730,
    weights: {
      semantic: 0.2,
      lexical: 0.22,
      entity: 0.13,
      goal_relevance: 0.05,
      importance: 0.1,
      confidence: 0.15,
      reinforcement: 0.1,
      recency: 0.05,
    },
    defaultCap: 4,
  },

  /**
   * How they want to be talked to.
   *
   * Only ever insight-derived: reflection is where a conclusion about how
   * someone likes to be addressed actually gets drawn. A memory that says
   * "please keep it short" stays a `preference`, because separating the two from
   * raw text would need a classifier this engine has no business running.
   */
  communication: {
    retrievalClass: 'communication',
    durability: 'durable',
    halfLifeDays: 730,
    weights: {
      semantic: 0.16,
      lexical: 0.2,
      entity: 0.08,
      emotional_fit: 0.08,
      confidence: 0.2,
      stability: 0.18,
      recency: 0.1,
    },
    defaultCap: 2,
  },

  /** Something they are working toward. Goal relevance carries the most weight. */
  goal: {
    retrievalClass: 'goal',
    durability: 'durable',
    halfLifeDays: 180,
    weights: {
      semantic: 0.18,
      lexical: 0.18,
      entity: 0.1,
      goal_relevance: 0.25,
      recency: 0.1,
      importance: 0.1,
      confidence: 0.09,
    },
    defaultCap: 4,
  },

  /** An ongoing endeavour. Like a goal, but longer-lived and more topical. */
  project: {
    retrievalClass: 'project',
    durability: 'durable',
    halfLifeDays: 365,
    weights: {
      semantic: 0.18,
      lexical: 0.18,
      entity: 0.12,
      goal_relevance: 0.2,
      recency: 0.12,
      importance: 0.1,
      confidence: 0.1,
    },
    defaultCap: 4,
  },

  /** A recurring behaviour. Stability is what separates one from a coincidence. */
  habit: {
    retrievalClass: 'habit',
    durability: 'durable',
    halfLifeDays: 365,
    weights: {
      semantic: 0.18,
      lexical: 0.2,
      entity: 0.1,
      topic_continuity: 0.07,
      stability: 0.2,
      confidence: 0.15,
      recency: 0.1,
    },
    defaultCap: 2,
  },

  /** A habit with temporal regularity. Priced identically, deliberately. */
  routine: {
    retrievalClass: 'routine',
    durability: 'durable',
    halfLifeDays: 365,
    weights: {
      semantic: 0.18,
      lexical: 0.2,
      entity: 0.1,
      topic_continuity: 0.07,
      stability: 0.2,
      confidence: 0.15,
      recency: 0.1,
    },
    defaultCap: 2,
  },

  /**
   * Something that happened and mattered. The one class where importance is
   * weighted like an anchor's equal — these are the shared history, and a
   * milestone that surfaces at all should be one that counted.
   */
  milestone: {
    retrievalClass: 'milestone',
    durability: 'durable',
    halfLifeDays: 1_825,
    weights: {
      semantic: 0.2,
      lexical: 0.22,
      entity: 0.15,
      importance: 0.2,
      confidence: 0.13,
      recency: 0.05,
      reinforcement: 0.05,
    },
    defaultCap: 3,
  },

  /** People in their life, and what the companion is to them. */
  relationship: {
    retrievalClass: 'relationship',
    durability: 'durable',
    halfLifeDays: 730,
    weights: {
      semantic: 0.15,
      lexical: 0.18,
      entity: 0.12,
      relationship_fit: 0.25,
      emotional_fit: 0.1,
      confidence: 0.1,
      recency: 0.1,
    },
    defaultCap: 3,
  },

  /** Something that happened lately. Halves in a week, and should. */
  recent_event: {
    retrievalClass: 'recent_event',
    durability: 'temporary',
    halfLifeDays: 7,
    weights: {
      semantic: 0.18,
      lexical: 0.2,
      entity: 0.12,
      topic_continuity: 0.15,
      recency: 0.25,
      importance: 0.1,
    },
    defaultCap: 4,
  },

  /**
   * An understanding the companion arrived at rather than was told.
   *
   * Confidence and stability together are 40% of the score — more than any
   * other class gives its qualifiers. That is the retrieval-side expression of
   * reflection's own rule: a conclusion drawn from a handful of remarks is never
   * certain, so one the companion is unsure of or keeps revising should have to
   * be more obviously relevant to be worth raising.
   */
  reflection: {
    retrievalClass: 'reflection',
    durability: 'durable',
    halfLifeDays: 365,
    weights: {
      semantic: 0.18,
      lexical: 0.18,
      entity: 0.08,
      emotional_fit: 0.06,
      confidence: 0.2,
      stability: 0.2,
      recency: 0.1,
    },
    defaultCap: 3,
  },

  /** Context for right now. Halves in two days, capped tightly. */
  temporary: {
    retrievalClass: 'temporary',
    durability: 'temporary',
    halfLifeDays: 2,
    weights: {
      semantic: 0.16,
      lexical: 0.2,
      entity: 0.12,
      topic_continuity: 0.17,
      recency: 0.25,
      importance: 0.1,
    },
    defaultCap: 3,
  },
};

export const policyFor = (retrievalClass: RetrievalClass): ClassPolicy =>
  CLASS_POLICIES[retrievalClass];

/**
 * What a memory is, for retrieval's purposes.
 *
 * `MemorySubject` answers "how long should this live?" and is nearly the same
 * question, so it carries most of the mapping. The one place the two diverge is
 * `temporary`: a *semantic* temporary memory is a fact with a short shelf life
 * ("the parcel arrives Tuesday"), while an *episodic* one is a thing that
 * happened ("we debugged the shader"). They decay at very different rates and
 * answer different questions, so retrieval splits what retention did not need to.
 */
export const classOfMemory = (memory: Memory): RetrievalClass => {
  if (memory.subject === 'temporary') {
    return memory.type === 'episodic' ? 'recent_event' : 'temporary';
  }
  return memory.subject;
};

/**
 * What an insight is about, as distinct from what produced it.
 *
 * A habit the user stated and a habit the companion concluded are the same thing
 * to a caller budgeting how many habits to carry, so they share a class. Where
 * it came from is never lost — `item.source` says `insight`, and the payload
 * carries the kind, the evidence and the confidence.
 *
 * The kinds that fall through to `reflection` are the ones with no memory-side
 * counterpart: nothing in `MemorySubject` corresponds to a value, a struggle or
 * a present condition, and inventing classes for them would create budget
 * categories no caller has any basis to size.
 */
export const classOfInsight = (kind: InsightKind): RetrievalClass => {
  const mapped: Readonly<Partial<Record<InsightKind, RetrievalClass>>> = {
    habit: 'habit',
    routine: 'routine',
    goal: 'goal',
    preference: 'preference',
    interest: 'preference',
    communication: 'communication',
    learning_style: 'communication',
  };
  return mapped[kind] ?? 'reflection';
};

/** Whether an insight is in a state that may be surfaced at all. */
export const insightIsLive = (insight: Insight): boolean =>
  insight.status === 'active' || insight.status === 'contested';

/** Zero on every dimension. The starting point every candidate is measured from. */
export const NO_SIGNALS: RelevanceSignals = Object.freeze({
  semantic: 0,
  lexical: 0,
  entity: 0,
  goal_relevance: 0,
  topic_continuity: 0,
  emotional_fit: 0,
  recency: 0,
  reinforcement: 0,
  importance: 0,
  confidence: 0,
  stability: 0,
  relationship_fit: 0,
});
