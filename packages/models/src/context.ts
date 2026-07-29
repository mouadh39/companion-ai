import type { CompanionId, TurnId, UserId } from '@nexa/shared';
import type { Identity, PersonalityProfile } from './identity.js';
import type { Perception } from './perception.js';
import type { RetrievedMemory } from './memory.js';

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
  | 'tools';

/**
 * Why a section is missing from the assembled context.
 *
 * Recorded rather than inferred. The difference between "the world model had
 * nothing to say" and "the world model timed out" changes what the companion
 * should do, and a null section cannot tell you which happened.
 */
export type OmissionReason = 'budget_exceeded' | 'port_timeout' | 'port_error' | 'empty';

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

/** True when any section was dropped for any reason — the `degraded` signal. */
export const isDegraded = (budget: ContextBudget): boolean =>
  budget.omissions.length > 0;

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
 */
export interface ConversationTurn {
  readonly role: 'user' | 'companion';
  readonly content: string;
  readonly at: string;
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
  readonly at: string;

  readonly perception: Perception;
  readonly identity: Identity;
  readonly personality: PersonalityProfile;
  readonly workingMemory: readonly ConversationTurn[];
  readonly retrievedMemories: readonly RetrievedMemory[];

  /**
   * Populated by capability packages in later milestones. Empty in Milestone 1,
   * but present in the shape so adding them changes an implementation rather
   * than this contract.
   */
  readonly goals: readonly string[];
  readonly availableTools: readonly string[];

  readonly budget: ContextBudget;
}
