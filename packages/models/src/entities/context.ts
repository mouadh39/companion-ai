import type { CompanionId, TurnId, UserId } from '@nexa/shared';
import type { PersonalityProfile } from './identity.js';
import type { IdentityProfile } from './identity-profile.js';
import type { ExpressionProfile } from './expression.js';
import type { Perception } from './perception.js';
import type { RetrievedMemory } from './memory.js';
import type { Goal } from './goal.js';
import type { Tool } from './tool.js';
import type { EmotionState } from './emotion.js';
import type { Relationship } from './relationship.js';
import type { WorldSnapshot } from './world-snapshot.js';
import type { BodyState } from './action-outcome.js';
import type { SelfState } from './self.js';
import type { TaskPlan } from './plan.js';
import type { DecisionHint } from './decision.js';
import type { ClientCapabilities } from './client-capabilities.js';
import type { MessageRole } from '../enums/conversation.js';
import type { Timestamp } from '../value-objects/timestamp.js';

/**
 * The named regions of a prompt. Every one competes for the same token budget.
 */
export type ContextSection =
  | 'identity'
  | 'personality'
  | 'working_memory'
  | 'retrieved_memories'
  | 'goals'
  | 'relationship'
  | 'emotion'
  | 'world'
  | 'body'
  | 'self'
  | 'tools';

export const CONTEXT_SECTIONS = [
  'identity',
  'personality',
  'working_memory',
  'retrieved_memories',
  'goals',
  'relationship',
  'emotion',
  'world',
  'body',
  'self',
  'tools',
] as const satisfies readonly ContextSection[];

/**
 * Why a section is missing from the assembled context.
 *
 * Recorded rather than inferred. The difference between "the world model had
 * nothing to say" and "the world model timed out" changes what the companion
 * should do, and a null section cannot tell you which happened.
 */
export type OmissionReason =
  | 'budget_exceeded'
  | 'port_timeout'
  | 'port_error'
  /**
   * The turn was already out of time before this port was reached.
   *
   * Distinct from `port_timeout` on purpose. That one indicts the port; this
   * one indicts everything that ran before it. Collapsing the two sends you
   * optimising a dependency that was never slow.
   */
  | 'not_attempted'
  | 'empty';

export const OMISSION_REASONS = [
  'budget_exceeded',
  'port_timeout',
  'port_error',
  'not_attempted',
  'empty',
] as const satisfies readonly OmissionReason[];

export interface SectionOmission {
  readonly section: ContextSection;
  readonly reason: OmissionReason;
}

/**
 * The token budget for one turn.
 *
 * This exists in the model, not as a post-processing step, and that placement
 * is the point. Assembled naively, a full context is 10–30k tokens per turn —
 * simultaneously the largest cost line and the largest latency contributor at
 * scale. Retrofitting a budget once nine engines all write into the prompt
 * means touching all nine; building it in now costs a struct field.
 *
 * `spent` and `omissions` are outputs of assembly, not inputs. They travel with
 * the context so a thin answer is explainable after the fact.
 */
export interface ContextBudget {
  /** Hard ceiling for the whole context, excluding the model's own response. */
  readonly totalLimit: number;
  /** Per-section ceilings. Sections fill in priority order until exhausted. */
  readonly sectionLimits: Readonly<Partial<Record<ContextSection, number>>>;
  /** Estimated tokens actually consumed, per section. */
  readonly spent: Readonly<Partial<Record<ContextSection, number>>>;
  /** Everything that did not make it in, and why. */
  readonly omissions: readonly SectionOmission[];
}

/**
 * True when a section the companion *should* have had was lost.
 *
 * `empty` is excluded, and that exclusion is what makes this signal worth
 * emitting. A companion with no active goals, no relevant memories, or no tools
 * is not a degraded companion — it is a companion in a situation where those
 * sections have nothing to say. Counting those, every turn is degraded, the
 * ratio sits at ~100%, and the one metric that tracks quality in a system built
 * to fail quietly tracks nothing at all.
 *
 * What remains — `port_timeout`, `port_error`, `budget_exceeded`,
 * `not_attempted` — are all cases where something existed and did not arrive.
 * The full list, `empty` entries included, stays on `omissions` for anyone who
 * needs it.
 */
export const isDegraded = (budget: ContextBudget): boolean =>
  budget.omissions.some((omission) => omission.reason !== 'empty');

export const totalSpent = (budget: ContextBudget): number =>
  Object.values(budget.spent).reduce<number>((sum, n) => sum + (n ?? 0), 0);

/**
 * Default allocation.
 *
 * Retrieved memories get the largest share because they are what makes the
 * companion a companion rather than a chatbot — and because they are the only
 * section that grows without bound as a relationship ages, so they are the one
 * that most needs a ceiling.
 */
export const defaultBudget = (totalLimit = 12_000): ContextBudget => ({
  totalLimit,
  sectionLimits: {
    identity: 300,
    personality: 400,
    working_memory: 3_000,
    retrieved_memories: 5_000,
    goals: 800,
    relationship: 600,
    emotion: 300,
    world: 800,
    // Small on purpose. The body section is a fixed schema plus at most five
    // one-line outcomes; anything larger means something is rendering state
    // that belongs on the client.
    body: 500,
    // The self section renders a fixed capability list plus a handful of
    // one-line reasons. Anything larger means it has started restating
    // something another section already owns.
    self: 700,
    tools: 800,
  },
  spent: {},
  omissions: [],
});

/**
 * A single exchange within the current session.
 *
 * Working memory holds these; it is bounded, ephemeral, and never the system of
 * record. Anything worth keeping is promoted to long-term memory asynchronously.
 *
 * Deliberately not a `Message`: this is the compact projection deliberation
 * reads, without ids, tokens or tool payloads. Working memory is rebuilt every
 * turn, so its shape is optimised for being cheap rather than for being complete.
 */
export interface ConversationTurn {
  readonly role: Extract<MessageRole, 'user' | 'companion'>;
  readonly content: string;
  readonly at: Timestamp;
}

/**
 * Everything the companion knows at the moment of deciding — and the *only*
 * input to deliberation.
 *
 * Immutable and fully serialisable by construction. That is what allows any
 * production decision to be replayed offline from its logged context, which is
 * what turns "decisions should be explainable" from an aspiration into a
 * mechanism.
 *
 * Sections that are absent are absent for a recorded reason; see `budget`.
 */
export interface CognitiveContext {
  readonly turnId: TurnId;
  readonly companionId: CompanionId;
  readonly userId: UserId;
  /** Sampled once, at the start of the turn. Deliberation never reads a clock. */
  readonly at: Timestamp;

  readonly perception: Perception;
  /**
   * The canonical self-definition, in full.
   *
   * The whole profile rather than a four-field summary, because the prompt is
   * built from its values, commitments and limitations — and a summary would
   * have to grow whatever the prompt needed next until it was a second, drifting
   * definition of who the companion is.
   *
   * It is a frozen singleton, so carrying it costs one reference. `version` is
   * what a replay resolves against.
   */
  readonly identity: IdentityProfile;
  readonly personality: PersonalityProfile;

  /**
   * How to communicate this turn, composed from personality, relationship and
   * the moment.
   *
   * Null when no expression capability is composed in — which is *not* a
   * degradation, for the same reason an absent world model is not. Generation
   * falls back to reading the raw traits, which is what it did before the
   * personality engine existed.
   *
   * Present on the context rather than computed inside generation so that the
   * composition is *recorded*. A replayed turn re-reads this value instead of
   * recomposing it, which is what keeps the answer reproducible when the
   * engine's rules are later tuned.
   */
  readonly expression: ExpressionProfile | null;
  readonly workingMemory: readonly ConversationTurn[];
  readonly retrievedMemories: readonly RetrievedMemory[];

  /**
   * Populated by capability packages in later milestones. Empty in Milestone 1,
   * but present in the shape so adding them changes an implementation rather
   * than this contract.
   *
   * Now typed against the real entities rather than `string[]`. Deliberation
   * needs a goal's priority and status to weigh it; a name alone forces the
   * reasoning to be reconstructed from text, which is exactly the confabulation
   * the structured domain exists to avoid.
   */
  readonly goals: readonly Goal[];
  readonly availableTools: readonly Tool[];

  /**
   * What the connected client has declared it can execute, or null when it
   * declared nothing.
   *
   * Carried through from the turn request rather than assembled — this is not
   * a capability the companion has, it is a fact about who is asking, so no
   * port fetches it and no omission is ever recorded for it. Generation reads
   * it to decide what to tell the model is physically possible this turn.
   *
   * Deliberately the opposite default from validation's "undeclared means
   * unrestricted": a client that says nothing gets every *action type*
   * (validation has no reason to withhold one), but the model is never told it
   * has a body unless a client has actually said so. Claiming a physical
   * presence that is not there is worse than staying silent about one that is.
   */
  readonly clientCapabilities: ClientCapabilities | null;
  /** The companion's read of the user's state, or null when nothing was inferred. */
  readonly emotion: EmotionState | null;
  /** Null until a relationship record exists — the very first turn with a user. */
  readonly relationship: Relationship | null;

  /**
   * What the companion believes is around the user, sampled once.
   *
   * Null when no world capability is composed in — which is *not* a
   * degradation. A companion with no world model is not missing something it
   * had; it simply has no such faculty. Recording an omission for it would mark
   * every turn degraded until every engine ships, and destroy the one metric
   * that tracks quality in a system designed to degrade quietly.
   */
  readonly world: WorldSnapshot | null;

  /**
   * What the companion's body is doing, as the *client* last reported it.
   *
   * Null when no embodiment capability is composed in — not a degradation, for
   * the same reason an absent world model is not. A companion with no body has
   * nothing to report about one.
   *
   * The authoritative answer, and the only one generation may base a claim
   * about a physical result on. The language model asked for the movement; it
   * has no access to whether the movement happened, and treating its confidence
   * as evidence is how a companion comes to say "done" about something it never
   * did. This field is the evidence.
   */
  readonly body: BodyState | null;

  /**
   * What the companion can truthfully say about itself right now.
   *
   * Identity, resolved capabilities and body state as one derived value. Null
   * when no self model is composed in — not a degradation, for the same reason
   * an absent world model is not.
   *
   * Derived rather than fetched: every input was already assembled by an
   * earlier wave, so this costs a pure join rather than a round trip, and a
   * replayed turn reproduces it exactly. Nothing downstream may write to it —
   * a companion that could edit its own description would have a description
   * that means nothing.
   */
  readonly self: SelfState | null;

  /**
   * The plan in progress, as of the last planning pass.
   *
   * May be one turn stale by design: planning runs in the worker, never on the
   * conversational path. Null when nothing is being planned or no planning
   * capability is composed in.
   */
  readonly plan: TaskPlan | null;

  /**
   * An advisory opinion formed during assembly, for deliberation to consult.
   *
   * Present here rather than obtained inside `deliberate()` so that the model
   * call — if the advisor is one — happens on the I/O stage where every other
   * call happens, and the decision stays a pure function of a recorded value.
   */
  readonly hint: DecisionHint | null;

  readonly budget: ContextBudget;
}
