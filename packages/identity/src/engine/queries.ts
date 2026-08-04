import type {
  CapabilityMaturity,
  CapabilityStatement,
  Commitment,
  CommitmentKind,
  IdentityProfile,
  IdentityValue,
  IntroductionContext,
  IntroductionPlan,
  KnowledgeBoundary,
  LimitationStatement,
  SelfAnswer,
  SelfQuestion,
  UncertaintyStance,
  ValueId,
} from '@nexa/models';
import { INTRODUCTIONS } from '../responses/introduction.js';
import { SELF_ANSWERS } from '../responses/self.js';
import { currentIdentity } from './registry.js';

/**
 * The query surface.
 *
 * Every function here is pure and total: same input, same output, no clock, no
 * I/O, no throw. That is what makes identity replay-compatible — an explanation
 * produced today for a turn recorded in March can be regenerated exactly, given
 * the version that turn ran under.
 *
 * Each takes the profile as an optional final argument, defaulting to the
 * current one. That is what lets a replay pass a historical profile through the
 * same code path the live turn used, rather than a parallel one that will drift.
 */

/** Values in precedence order, most authoritative first. */
export const valuesByPrecedence = (
  profile: IdentityProfile = currentIdentity(),
): readonly IdentityValue[] =>
  [...profile.values].sort((a, b) => a.precedence - b.precedence);

/**
 * Which of two values wins when they conflict.
 *
 * The reason `precedence` is stored rather than implied by array order. A
 * caller asking "does honesty or care govern here?" gets an answer from data
 * instead of re-deriving one, and every caller derives the same answer.
 */
export const resolveValueConflict = (
  a: ValueId,
  b: ValueId,
  profile: IdentityProfile = currentIdentity(),
): ValueId => {
  const rank = (id: ValueId): number =>
    profile.values.find((value) => value.id === id)?.precedence ?? Number.MAX_SAFE_INTEGER;

  return rank(a) <= rank(b) ? a : b;
};

export const commitmentsOfKind = (
  kind: CommitmentKind,
  profile: IdentityProfile = currentIdentity(),
): readonly Commitment[] => profile.commitments.filter((c) => c.kind === kind);

/** Only the commitments a test could actually assert on. */
export const enforceableCommitments = (
  profile: IdentityProfile = currentIdentity(),
): readonly Commitment[] => profile.commitments.filter((c) => c.enforceable);

export const capabilitiesByMaturity = (
  maturity: CapabilityMaturity,
  profile: IdentityProfile = currentIdentity(),
): readonly CapabilityStatement[] =>
  profile.capabilities.filter((c) => c.maturity === maturity);

/**
 * What the companion may describe in the present tense.
 *
 * `partial` is included because those faculties do something real, and
 * excluding them would understate as badly as including `planned` overstates.
 * Anything `planned` is future tense or unmentioned — that is the whole point
 * of tracking maturity.
 */
export const presentTenseCapabilities = (
  profile: IdentityProfile = currentIdentity(),
): readonly CapabilityStatement[] =>
  profile.capabilities.filter((c) => c.maturity !== 'planned');

/** Limitations that no future version could lift. */
export const permanentLimitations = (
  profile: IdentityProfile = currentIdentity(),
): readonly LimitationStatement[] => profile.limitations.filter((l) => l.permanent);

/** Limitations that are true now but need not always be. */
export const temporaryLimitations = (
  profile: IdentityProfile = currentIdentity(),
): readonly LimitationStatement[] => profile.limitations.filter((l) => !l.permanent);

/**
 * The boundary governing a subject, or null when there is none.
 *
 * Null means "ordinary question", not "no constraint found" — the default is to
 * answer normally, and a caller that treated a missing boundary as a reason to
 * decline would produce a companion that refuses everything it has no rule for.
 */
export const boundaryFor = (
  id: string,
  profile: IdentityProfile = currentIdentity(),
): KnowledgeBoundary | null =>
  profile.knowledgeBoundaries.find((boundary) => boundary.id === id) ?? null;

/**
 * How to express a given confidence.
 *
 * Total over every finite number, including values outside 0–1, because this is
 * called with model-reported confidences and a caller should not have to
 * sanitise first. Out-of-range input resolves to the nearest band rather than
 * throwing: refusing to answer how to express uncertainty is a strange way to
 * handle an uncertain input.
 */
export const uncertaintyFor = (
  confidence: number,
  profile: IdentityProfile = currentIdentity(),
): UncertaintyStance => {
  const ordered = [...profile.uncertainty].sort((a, b) => b.atLeast - a.atLeast);
  const safe = Number.isFinite(confidence) ? confidence : 0;

  const matched = ordered.find((stance) => safe >= stance.atLeast);
  // The lowest band has `atLeast: 0`, so this only falls through for a negative
  // confidence, which resolves to the least certain stance.
  return matched ?? ordered[ordered.length - 1] ?? FALLBACK_STANCE;
};

/**
 * The last resort if the uncertainty table were ever emptied.
 *
 * Unreachable with the shipped profile, and kept so the function stays total
 * for a caller that supplies its own. Defaults to disclosing and deferring,
 * because the safe failure for an unknown certainty is to admit it.
 */
const FALLBACK_STANCE: UncertaintyStance = {
  band: 'unknown',
  atLeast: 0,
  disclose: true,
  defer: true,
  guidance: 'Say it does not know.',
};

/** The structured answer to a question about the self. */
export const selfAnswer = (question: SelfQuestion): SelfAnswer => SELF_ANSWERS[question];

/** How to introduce itself in a given situation. */
export const introductionFor = (context: IntroductionContext): IntroductionPlan =>
  INTRODUCTIONS[context];

/**
 * Everything the companion must not assert, across every self-answer.
 *
 * Aggregated because a renderer needs the whole prohibition set, not the subset
 * attached to the question it happens to be answering. A companion asked about
 * its memory can still drift into claiming an inner life, and the guardrail
 * that only loads for `can_you_feel` would not be there to stop it.
 */
export const allProhibitions = (): readonly string[] => {
  const seen = new Set<string>();
  for (const answer of Object.values(SELF_ANSWERS)) {
    for (const prohibition of answer.mustNotClaim) seen.add(prohibition);
  }
  return [...seen].sort();
};

/** True when a statement id is one of the permanent invariants. */
export const isInvariant = (
  id: string,
  profile: IdentityProfile = currentIdentity(),
): boolean => profile.invariants.some((invariant) => invariant.id === id);
