import type {
  FormationDecision,
  FormationReason,
  Memory,
  MemoryDraft,
  MemoryProposal,
  MemoryType,
  Timestamp,
  UserPreferences,
} from '@nexa/models';
import { confidence as asConfidence, importance as asImportance, timestamp, valence } from '@nexa/models';
import { classify } from './classify.js';
import { confidenceFor, importanceFor, retentionDays } from './scoring.js';
import { policyFor } from './subjects.js';
import { relatednessTo } from './similarity.js';

/**
 * Everything formation reads.
 *
 * `existing` is **supplied by the caller**, never looked up. This engine does
 * no retrieval — deciding what to remember and finding what is already
 * remembered are different jobs, and fusing them would make formation
 * impossible to test without a store. The caller fetches whatever candidates it
 * can and passes them in; formation decides.
 *
 * `at` is supplied for the same reason it is everywhere else: no clock, so the
 * same inputs always yield the same decision.
 */
export interface FormationRequest {
  readonly proposal: MemoryProposal;
  /** Memories that might already cover this. May be empty. */
  readonly existing: readonly Memory[];
  readonly at: Timestamp;
  /** Null when unknown. Absent preferences are not permission. */
  readonly preferences: UserPreferences | null;
  /** Overrides the subject's default encoding. */
  readonly type?: MemoryType;
}

/**
 * Decides whether a proposal becomes a memory, and what kind of write it is.
 *
 * Pure and total: no I/O, no clock, no randomness, no throw. The same request
 * always produces the same decision, which is what makes a formation history
 * replayable — re-running a user's proposals reconstructs exactly the store
 * they have, and "why do you think that about me?" is answerable from the
 * reasons rather than from a guess.
 *
 * The order below is a series of gates, cheapest and most absolute first:
 *
 * 1. **Permission.** Before anything else.
 * 2. **Substance.** Nothing to remember.
 * 3. **Classification and scoring.**
 * 4. **What already exists** — duplicate, conflict, or genuinely new.
 * 5. **Thresholds.**
 *
 * Permission leads because it is the one gate that is not a judgement. The
 * others weigh; this one forbids.
 */
export const decide = (request: FormationRequest): FormationDecision => {
  const reasons: FormationReason[] = [];
  const { proposal, existing, at, preferences } = request;

  // ── 1. permission ──────────────────────────────────────────────────────
  // Checked first and never overridden — not by an explicit request, not by
  // importance. A user who has switched memory formation off has said the one
  // thing that outranks everything this engine could conclude.
  if (preferences !== null && !preferences.allowMemoryFormation) {
    return {
      outcome: 'reject',
      reason: 'formation_disabled',
      reasons: [
        {
          code: 'below_threshold',
          detail: 'The user has memory formation switched off.',
        },
      ],
    };
  }

  // ── 2. substance ───────────────────────────────────────────────────────
  const content = proposal.content.trim();
  if (content.length === 0) {
    return {
      outcome: 'reject',
      reason: 'empty_content',
      reasons: [{ code: 'below_threshold', detail: 'Nothing to remember.' }],
    };
  }

  // ── 3. classify and score ──────────────────────────────────────────────
  const subject = classify(proposal);
  const policy = policyFor(subject);
  reasons.push({
    code: 'subject_classified',
    detail: `Classified as '${subject}'${proposal.subject === undefined ? '' : ' (supplied by caller)'}.`,
  });

  if (proposal.statedExplicitly) {
    reasons.push({
      code: 'explicitly_requested',
      detail: 'The user asked for this to be remembered.',
    });
  }

  const scoredImportance = importanceFor(proposal, policy);
  const scoredConfidence = confidenceFor(proposal);
  reasons.push({
    code: 'importance_scored',
    detail: `Importance ${scoredImportance.toFixed(2)} against a floor of ${policy.importanceFloor.toFixed(2)}.`,
  });
  reasons.push({
    code: 'confidence_from_source',
    detail: `Confidence ${scoredConfidence.toFixed(2)} from source '${proposal.source}'.`,
  });

  // ── 4. what already exists ─────────────────────────────────────────────
  for (const memory of existing) {
    const relation = relatednessTo(proposal, subject, memory);

    if (relation === 'duplicate') {
      // Already known. Reinforce rather than store a second copy — that is what
      // makes repetition strengthen a belief instead of cluttering the store.
      reasons.push({
        code: 'duplicate_detected',
        detail: `Restates memory ${memory.id}.`,
      });

      // Unless the new one is materially better sourced, in which case it
      // supersedes: the user saying plainly what the companion had merely
      // inferred should replace the inference, not merely reinforce it.
      if (scoredConfidence > memory.confidence + 0.15 && policy.supersedable) {
        reasons.push({
          code: 'supersedes_older',
          detail: `Better sourced than ${memory.id} (${scoredConfidence.toFixed(2)} vs ${memory.confidence.toFixed(2)}).`,
        });
        return {
          outcome: 'supersede',
          targetId: memory.id,
          draft: draftOf(content, subject, request, policy, scoredImportance, scoredConfidence),
          reasons,
        };
      }

      reasons.push({
        code: 'reinforces_existing',
        detail: 'Confidence and expiry extended rather than storing a second copy.',
      });
      return {
        outcome: 'reinforce',
        targetId: memory.id,
        reinforcement: {
          // Deliberately small. Saying a thing twice is evidence; saying it
          // twenty times should not manufacture certainty the source cannot
          // support.
          confidenceDelta: round(Math.min(0.05, 1 - memory.confidence)),
          importanceDelta: round(Math.min(0.03, 1 - memory.importance)),
          expiresAt: extendedExpiry(memory, at, policy.reinforcementExtensionDays),
          reinforcedAt: at,
        },
        reasons,
      };
    }

    if (relation === 'conflict') {
      reasons.push({
        code: 'conflict_detected',
        detail: `Contradicts memory ${memory.id}.`,
      });

      if (!policy.supersedable) {
        // A milestone cannot be superseded — a thing that happened does not
        // stop having happened. Both are kept and the disagreement is left
        // visible for reflection to resolve.
        reasons.push({
          code: 'supersedes_older',
          detail: `Subject '${subject}' is not supersedable; both are kept.`,
        });
        break;
      }

      reasons.push({
        code: 'supersedes_older',
        detail: `Replaces ${memory.id}, which is kept readable and marked superseded.`,
      });
      return {
        outcome: 'supersede',
        targetId: memory.id,
        draft: draftOf(content, subject, request, policy, scoredImportance, scoredConfidence),
        reasons,
      };
    }
  }

  // ── 5. thresholds ──────────────────────────────────────────────────────
  // Applied last so that a proposal below the floor still produces the reasons
  // explaining what it was judged as. A rejection with no explanation is one
  // nobody can tune.
  if (scoredConfidence < policy.confidenceFloor) {
    reasons.push({
      code: 'below_threshold',
      detail: `Confidence ${scoredConfidence.toFixed(2)} is under '${subject}' floor ${policy.confidenceFloor.toFixed(2)}.`,
    });
    return { outcome: 'reject', reason: 'below_confidence_floor', reasons };
  }

  if (scoredImportance < policy.importanceFloor) {
    reasons.push({
      code: 'below_threshold',
      detail: `Importance ${scoredImportance.toFixed(2)} is under '${subject}' floor ${policy.importanceFloor.toFixed(2)}.`,
    });
    return { outcome: 'reject', reason: 'below_importance_floor', reasons };
  }

  return {
    outcome: 'store',
    draft: draftOf(content, subject, request, policy, scoredImportance, scoredConfidence),
    reasons,
  };
};

/** Builds the draft, applying retention. */
const draftOf = (
  content: string,
  subject: MemoryDraft['subject'],
  request: FormationRequest,
  policy: ReturnType<typeof policyFor>,
  scoredImportance: number,
  scoredConfidence: number,
): MemoryDraft => {
  const userLimit = request.preferences?.memoryRetentionDays ?? null;
  const days = retentionDays(policy, userLimit);

  return {
    type: request.type ?? policy.defaultType,
    subject,
    content,
    source: request.proposal.source,
    tags: [...request.proposal.tags],
    createdAt: request.at,
    importance: asImportance(scoredImportance),
    confidence: asConfidence(scoredConfidence),
    // Neutral. Emotional charge is the emotion engine's to supply, and
    // inventing one here would be this engine classifying feelings.
    valence: valence(0),
    expiresAt: days === null ? null : addDays(request.at, days),
    relatedTo: [],
    metadata: {},
  };
};

/**
 * Pushes an expiry out from the moment of reinforcement.
 *
 * Takes the *later* of the current expiry and the extension, so reinforcement
 * can only ever lengthen a life. Setting it to `at + extension` unconditionally
 * looks equivalent and is not: a memory formed yesterday with a two-year TTL,
 * reinforced today with a one-year extension, would have its expiry pulled a
 * year closer. Being mentioned again would shorten how long it is kept, which
 * is precisely backwards.
 */
const extendedExpiry = (
  memory: Memory,
  at: Timestamp,
  extensionDays: number,
): Timestamp | null => {
  if (memory.expiresAt === null || extensionDays === 0) return memory.expiresAt;

  const extended = addDays(at, extensionDays);
  return Date.parse(extended) > Date.parse(memory.expiresAt) ? extended : memory.expiresAt;
};

const addDays = (at: Timestamp, days: number): Timestamp =>
  timestamp(new Date(Date.parse(at) + days * 86_400_000).toISOString());

const round = (value: number): number => Math.round(value * 1_000) / 1_000;
