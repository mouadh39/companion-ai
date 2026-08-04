import type { ForgetDecision, Memory, Timestamp } from '@nexa/models';
import { decayedImportance } from './scoring.js';
import { policyFor } from './subjects.js';

/**
 * Whether a memory should leave circulation, and why.
 *
 * Forgetting is **not deletion**. `18_Memory_Architecture.md` makes memory the
 * user's property, so nothing here removes anything — a `ForgetDecision` says a
 * memory should stop being retrieved, and only `user_deleted` is ever meant to
 * erase. `superseded` and `merged` in particular keep the original readable so
 * history stays intact.
 *
 * Pure and clock-free: `at` is supplied, so the same memory at the same moment
 * always yields the same decision and a forgetting pass can be replayed.
 */

/**
 * Below this decayed importance, a memory is no longer worth retrieving.
 *
 * Deliberately low. The cost of keeping something marginal is clutter; the cost
 * of dropping something the user cared about is a companion that forgot
 * something they told it. Those are not symmetrical, and the threshold reflects
 * that.
 */
export const DECAY_FLOOR = 0.15;

export const forgetCheck = (memory: Memory, at: Timestamp): ForgetDecision | null => {
  const policy = policyFor(memory.subject);

  // Expiry first: it is a policy decision made at formation, not a judgement
  // made now, so it does not need the arithmetic below.
  if (memory.expiresAt !== null && Date.parse(at) >= Date.parse(memory.expiresAt)) {
    return {
      memoryId: memory.id,
      reason: 'expired',
      detail: `Retention for '${memory.subject}' ended at ${memory.expiresAt}.`,
    };
  }

  // Subjects with no TTL never decay out. Permanence that quietly erodes is not
  // permanence, and a milestone slipping under a floor would be forgetting by
  // accident rather than by policy.
  if (policy.ttlDays === null) return null;

  const elapsed = elapsedDays(memory.lastReinforcedAt ?? memory.createdAt, at);
  const current = decayedImportance(memory, policy, elapsed);

  if (current < DECAY_FLOOR) {
    return {
      memoryId: memory.id,
      reason: 'decayed',
      detail: `Importance fell to ${current.toFixed(2)} after ${Math.floor(elapsed)} days without reinforcement.`,
    };
  }

  return null;
};

/**
 * Everything in a set that should be forgotten.
 *
 * Order-preserving, so a replayed pass produces the same list in the same
 * order — which matters when the caller emits an event per decision.
 */
export const forgetPass = (
  memories: readonly Memory[],
  at: Timestamp,
): readonly ForgetDecision[] =>
  memories
    .map((memory) => forgetCheck(memory, at))
    .filter((decision): decision is ForgetDecision => decision !== null);

/**
 * Days elapsed, measured from the last reinforcement rather than from creation.
 *
 * That choice is what makes reinforcement mean something. Measured from
 * creation, a memory recalled every week would still decay on the same schedule
 * as one never mentioned again, and the counter would be decorative.
 */
const elapsedDays = (from: string, to: string): number => {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, (end - start) / 86_400_000);
};
