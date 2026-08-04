import type { Memory, MemoryProposal, MemorySource } from '@nexa/models';
import type { SubjectPolicy } from './subjects.js';

/**
 * How sure the companion is, from where the memory came.
 *
 * Provenance is the only confidence signal available without a model, and it is
 * a good one. `18_Memory_Architecture.md` already establishes the ordering:
 * `user_stated` outranks `reflection` when two memories conflict, and these
 * numbers are that rule made arithmetic.
 */
const SOURCE_CONFIDENCE: Readonly<Record<MemorySource, number>> = {
  /** The user said it about themselves. As good as it gets. */
  user_stated: 0.9,
  /** Said in passing rather than asserted. Usually true, occasionally a joke. */
  conversation: 0.7,
  /** The companion saw it. Reliable about events, weaker about meaning. */
  observation: 0.65,
  /**
   * The companion worked it out.
   *
   * Lowest on purpose. A conclusion drawn from other memories inherits all
   * their errors and adds its own, and a companion confidently asserting its
   * own inferences back to the user is the failure mode reflection most risks.
   */
  reflection: 0.5,
};

/** Confidence before any adjustment. */
export const confidenceFor = (proposal: MemoryProposal): number => {
  const base = SOURCE_CONFIDENCE[proposal.source];
  // Being asked to remember something is itself evidence it is true.
  return round(Math.min(1, proposal.statedExplicitly ? base + 0.1 : base));
};

/**
 * How much a memory matters.
 *
 * Starts at the subject's base and moves on signals that are actually
 * available. Salience is a *hint* from the turn and is weighted least, because
 * it is the least reliable input here — a message can feel significant and
 * carry nothing worth keeping.
 *
 * An explicit request is the exception and lifts importance sharply. The user
 * saying "remember this" is not a signal to weigh against others; it is the
 * answer.
 */
export const importanceFor = (
  proposal: MemoryProposal,
  policy: SubjectPolicy,
): number => {
  let score = policy.baseImportance;

  if (proposal.statedExplicitly) score += 0.2;
  // Centred on 0.5 so a low-salience turn pulls down as well as a high one
  // pushes up, and a neutral one does nothing.
  score += (proposal.salience - 0.5) * 0.2;

  return round(Math.min(1, Math.max(0, score)));
};

/**
 * Importance after time has passed, without reinforcement.
 *
 * Decay is **per subject**, via the retention policy, rather than one global
 * rate. A temporary note losing half its weight in a week is correct; an
 * identity fact doing the same is not, and a single rate cannot serve both.
 *
 * Subjects with no TTL do not decay at all. Permanence that quietly erodes is
 * not permanence, and a milestone slowly fading below the retrieval floor would
 * be forgetting by accident rather than by policy.
 */
export const decayedImportance = (
  memory: Memory,
  policy: SubjectPolicy,
  elapsedDays: number,
): number => {
  if (policy.ttlDays === null) return memory.importance;
  if (elapsedDays <= 0) return memory.importance;

  // Linear across the subject's own lifetime: a memory at its TTL has lost
  // half its weight. Reinforcement pushes the TTL out, so a memory that keeps
  // proving relevant never reaches that point.
  const fraction = Math.min(1, elapsedDays / policy.ttlDays);
  return round(memory.importance * (1 - fraction * 0.5));
};

/**
 * Days a memory should live, honouring the user's own ceiling.
 *
 * `UserPreferences.memoryRetentionDays` wins whenever it is shorter, including
 * over subjects that would otherwise never expire. Memory is the user's
 * property; a retention setting that identity facts could ignore would be a
 * setting that does not mean what it says.
 */
export const retentionDays = (
  policy: SubjectPolicy,
  userLimitDays: number | null,
): number | null => {
  if (userLimitDays === null) return policy.ttlDays;
  if (policy.ttlDays === null) return userLimitDays;
  return Math.min(policy.ttlDays, userLimitDays);
};

const round = (value: number): number => Math.round(value * 1_000) / 1_000;

export { SOURCE_CONFIDENCE };
