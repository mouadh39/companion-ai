import type {
  ConversationTurn,
  ExpressionProfile,
  Goal,
  IdentityProfile,
  Observation,
  ObservationDimension,
  PerceptionOutcome,
  TaskPlan,
  RelationshipProfile,
  RetrievalOutcome,
  Timestamp,
} from '@nexa/models';
import type { GoalId, InsightId, MemoryId } from '@nexa/shared';

/**
 * The whole cognitive state, reduced once to the things a decision turns on.
 *
 * Every rule downstream reads this and nothing else. That indirection is not
 * ceremony — it is what stops the strategy rules from each reaching into
 * `PerceptionOutcome` and `RetrievalOutcome` in slightly different ways until
 * two rules disagree about whether the user asked a question. Assessed once,
 * read many times, and the assessment is itself explainable.
 *
 * ## Nothing here is a decision
 *
 * A `Situation` says *the intent is unclear*, not *therefore ask*. Keeping the
 * reading apart from the response to it is what lets the strategy table be
 * changed without touching how the world is understood, and lets the reading be
 * tested without asserting on a plan.
 */

/** How firmly something was seen, collapsed from perception's own stances. */
export interface Reading {
  readonly dimension: ObservationDimension;
  /** True only when the user made it plain. Inference never sets this. */
  readonly stated: boolean;
  readonly confidence: number;
  readonly magnitude: number;
}

export interface Situation {
  readonly at: Timestamp;

  // ── what was said ──────────────────────────────────────────────────────
  /** True when there is nothing to respond to. */
  readonly silent: boolean;
  /** The user asked something. */
  readonly asked: boolean;
  /** The user asked for help with something. */
  readonly askedForHelp: boolean;
  /** The user is working something out rather than requesting an answer. */
  readonly exploring: boolean;
  /** The user is trying to understand rather than to be told. */
  readonly learning: boolean;
  /** The user is ending the exchange. */
  readonly closing: boolean;
  /** The user corrected the companion. */
  readonly corrected: boolean;
  /** The user disagreed. */
  readonly disagreed: boolean;
  /** The subject changed. */
  readonly shifted: boolean;

  // ── how sure anyone is ─────────────────────────────────────────────────
  /**
   * How clearly the turn's purpose was read, 0–1.
   *
   * The single most consequential number in the engine: below the configured
   * floor, everything that asserts becomes inadmissible and the companion asks.
   */
  readonly clarity: number;
  /** The user hedged. Their claim is tentative, not the companion's reading. */
  readonly userHedged: boolean;
  /** Perception found readings that sit oddly together. */
  readonly conflicted: boolean;

  // ── how they seem ──────────────────────────────────────────────────────
  /** Emotional readings, strongest first. May be empty. */
  readonly feelings: readonly Reading[];
  /** The strongest emotional reading the user *stated*. Null when only inferred. */
  readonly statedFeeling: Reading | null;
  /** The strongest emotional reading of any kind. Null when none. */
  readonly strongestFeeling: Reading | null;
  /** A difficult feeling was read, stated or not. */
  readonly distressed: boolean;
  /** Urgency was read. */
  readonly urgent: boolean;

  // ── what is known ──────────────────────────────────────────────────────
  readonly groundedIn: readonly MemoryId[];
  readonly informedBy: readonly InsightId[];
  /** True when retrieval found something it considered squarely relevant. */
  readonly wellGrounded: boolean;
  /** True when retrieval ran but found nothing above its floor. */
  readonly ungrounded: boolean;
  /** True when nothing this plan rests on is better than an inference. */
  readonly onlyInference: boolean;

  // ── what they are trying to do ─────────────────────────────────────────
  readonly servingGoals: readonly GoalId[];
  /** A plan is already in progress. */
  readonly planInProgress: boolean;
  /** That plan has a step that cannot proceed. */
  readonly planBlocked: boolean;
  /** This is not the first turn. */
  readonly hasHistory: boolean;

  // ── who they are to each other ─────────────────────────────────────────
  /** How much may go unsaid, 0–1. Zero when there is no relationship yet. */
  readonly sharedUnderstanding: number;
  /** Boundaries the relationship has recorded. */
  readonly boundaries: readonly string[];
  /** An identity knowledge boundary this turn touches. Null when none. */
  readonly identityBoundary: string | null;
  /** What personality proposed, as a ceiling. Null when none was composed. */
  readonly proposed: ExpressionProfile | null;
}

export interface SituationInputs {
  readonly at: Timestamp;
  readonly perception: PerceptionOutcome;
  readonly retrieval: RetrievalOutcome | null;
  readonly conversation: readonly ConversationTurn[];
  readonly goals: readonly Goal[];
  readonly relationship: RelationshipProfile | null;
  readonly expression: ExpressionProfile | null;
  readonly identity: IdentityProfile | null;
  readonly plan: TaskPlan | null;
  readonly minObservationConfidence: number;
  readonly relevantRetrievalScore: number;
}

/** Emotional dimensions that call for care rather than briskness. */
export const DIFFICULT_FEELINGS: readonly ObservationDimension[] = [
  'frustration',
  'sadness',
  'anxiety',
  'fatigue',
  'confusion',
];

const readingOf = (observation: Observation): Reading => ({
  dimension: observation.dimension,
  // Perception's own stance, carried through without softening. The distinction
  // between what someone said and what was guessed about them is the one thing
  // that must survive every layer, because everything careful downstream is
  // built on it.
  stated: observation.stance === 'observed',
  confidence: observation.confidence,
  magnitude: observation.magnitude,
});

const strongestOn = (
  outcome: PerceptionOutcome,
  dimension: ObservationDimension,
  floor: number,
): Observation | null => {
  let best: Observation | null = null;

  for (const observation of outcome.observations) {
    if (observation.dimension !== dimension) continue;
    if (observation.confidence < floor) continue;
    if (best === null || observation.confidence > best.confidence) best = observation;
  }

  return best;
};

const present = (
  outcome: PerceptionOutcome,
  dimension: ObservationDimension,
  floor: number,
): boolean => strongestOn(outcome, dimension, floor) !== null;

/**
 * How clearly the turn's purpose was read.
 *
 * Built from what perception actually found rather than asserted. A message that
 * asks a question plainly is clear; one that names no purpose at all is not; and
 * one whose readings contradict each other is *less* clear than one with none,
 * which is why conflict subtracts rather than being ignored.
 *
 * The hedging of the *user* is deliberately excluded. "I guess it might be the
 * cache" is a tentative claim clearly made — the companion knows exactly what is
 * being said, and treating the user's caution as the companion's confusion would
 * make the most careful speakers the hardest to help.
 */
const clarityOf = (outcome: PerceptionOutcome, floor: number): number => {
  const purposeful: readonly ObservationDimension[] = [
    'question',
    'help_request',
    'learning',
    'planning',
    'brainstorming',
    'reflection',
    'correction',
    'agreement',
    'disagreement',
    'greeting',
    'farewell',
    'casual',
  ];

  let best = 0;
  for (const dimension of purposeful) {
    const observation = strongestOn(outcome, dimension, floor);
    if (observation !== null && observation.confidence > best) best = observation.confidence;
  }

  // A *stated* feeling is a clear purpose. "I am so frustrated and I'm thinking
  // of giving up" asks for nothing and is entirely legible — reading it as
  // unclear, and so demanding clarification, would interrogate someone at
  // exactly the moment they were being most direct.
  //
  // Only stated ones count. An inferred mood clarifies nothing: it is the
  // companion's guess, and a guess about someone cannot make their purpose
  // plainer.
  for (const observation of outcome.observations) {
    if (observation.family !== 'emotion') continue;
    if (observation.stance !== 'observed') continue;
    if (observation.confidence > best) best = observation.confidence;
  }

  // A tension costs clarity. Two readings that disagree about what the turn is
  // doing mean the companion has *less* idea than one clean reading would give,
  // and scoring it as the max of the two would report the opposite.
  const penalty = Math.min(0.3, 0.15 * outcome.tensions.length);
  return round(Math.max(0, best - penalty));
};

/**
 * Whether this turn touches a subject identity constrains.
 *
 * Two sources, and neither is planning reading the raw message. Retrieval
 * already flags identity boundaries on the items it surfaced — that is the
 * authoritative signal, because it was computed against the actual content of
 * what became active. Perception's references are the weaker fallback for a
 * boundary the user named without anything being retrieved about it.
 *
 * Planning deliberately does **not** get the message text to keyword-match
 * against. Deciding what a message is about is perception's job, and a planner
 * that ran its own matcher would be a second, quietly divergent reader of the
 * same sentence.
 */
const boundaryTouched = (
  identity: IdentityProfile | null,
  outcome: PerceptionOutcome,
  retrieval: RetrievalOutcome | null,
): string | null => {
  if (identity === null) return null;

  const constrained = identity.knowledgeBoundaries.filter(
    (boundary) => boundary.stance !== 'answers_with_caveat',
  );
  if (constrained.length === 0) return null;

  const flagged = new Set((retrieval?.items ?? []).flatMap((item) => item.boundaries));
  const fromRetrieval = constrained.find((boundary) => flagged.has(boundary.id));
  if (fromRetrieval !== undefined) return fromRetrieval.id;

  const named = outcome.references.map((reference) => reference.text.toLowerCase()).join(' ');
  if (named.length === 0) return null;

  for (const boundary of constrained) {
    const words = boundary.domain
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 3);
    if (words.some((word) => named.includes(word))) return boundary.id;
  }

  return null;
};

export const assess = (inputs: SituationInputs): Situation => {
  const { perception, retrieval } = inputs;
  const floor = inputs.minObservationConfidence;

  const feelings = perception.observations
    .filter((observation) => observation.family === 'emotion' && observation.confidence >= floor)
    .map(readingOf)
    .sort((a, b) => b.confidence - a.confidence || a.dimension.localeCompare(b.dimension));

  const stated = feelings.find((reading) => reading.stated) ?? null;
  const strongest = feelings[0] ?? null;

  const items = retrieval?.items ?? [];
  const groundedIn = items
    .filter((item) => item.source === 'memory')
    .map((item) => (item.source === 'memory' ? item.memory.id : ('' as MemoryId)));
  const informedBy = items
    .filter((item) => item.source === 'insight')
    .map((item) => (item.source === 'insight' ? item.insight.id : ('' as InsightId)));

  const silent = perception.observations.length === 0;

  return {
    at: inputs.at,

    silent,
    asked: present(perception, 'question', floor),
    askedForHelp: present(perception, 'help_request', floor),
    exploring:
      present(perception, 'brainstorming', floor) || present(perception, 'reflection', floor),
    learning: present(perception, 'learning', floor),
    closing: present(perception, 'farewell', floor),
    corrected: present(perception, 'correction', floor),
    disagreed: present(perception, 'disagreement', floor),
    shifted: present(perception, 'topic_shift', floor),

    clarity: silent ? 0 : clarityOf(perception, floor),
    userHedged:
      present(perception, 'uncertainty', floor) || present(perception, 'hesitation', floor),
    conflicted: perception.tensions.length > 0,

    feelings,
    statedFeeling: stated,
    strongestFeeling: strongest,
    distressed: feelings.some((reading) => DIFFICULT_FEELINGS.includes(reading.dimension)),
    urgent: present(perception, 'urgency', floor),

    groundedIn,
    informedBy,
    wellGrounded: items.some((item) => item.score >= inputs.relevantRetrievalScore),
    ungrounded: retrieval !== null && items.length === 0,
    // Nothing but the companion's own conclusions. Anything said from here has
    // to be hedged, because an insight is a guess about a person however
    // confident it looks.
    onlyInference: items.length > 0 && items.every((item) => item.source === 'insight'),

    servingGoals: inputs.goals.map((goal) => goal.id),
    planInProgress: inputs.plan !== null && inputs.plan.steps.length > 0,
    planBlocked: (inputs.plan?.steps ?? []).some((step) => step.status === 'blocked'),
    hasHistory: inputs.conversation.length > 0,

    sharedUnderstanding: inputs.relationship?.sharedUnderstanding ?? 0,
    boundaries: inputs.relationship?.boundaries ?? [],
    identityBoundary: boundaryTouched(inputs.identity, perception, retrieval),
    proposed: inputs.expression,
  };
};

const round = (value: number): number => Math.round(value * 1_000) / 1_000;
