import type {
  IdentityProfile,
  PlanConstraint,
  PlanReason,
  UncertaintyHandling,
} from '@nexa/models';
import { confidence as asConfidence } from '@nexa/models';
import type { Situation } from './situation.js';

/**
 * What the turn must honour, derived before any strategy is considered.
 *
 * The ordering is the design. A constraint that were merely one input among many
 * could be outvoted by a strong preference for answering — and the entire reason
 * these exist is that some things must not be traded off against helpfulness.
 * So they are derived first, from the situation alone, and then bind every
 * strategy that follows.
 *
 * ## Identity is the source, where identity has an opinion
 *
 * Two of these come straight from `IdentityProfile` rather than from a table
 * here: an autonomy principle whose `onConflict` is `ask` produces
 * `require_clarification_before_acting`, and the uncertainty stance for the
 * band the plan lands in produces `disclose_uncertainty` and
 * `defer_to_user_judgement`. That is the right ownership. Identity is the layer
 * that does not drift, and "say when you are unsure" is precisely the sort of
 * promise that should not be re-decided by whoever last tuned a planner.
 */

export interface DerivedConstraints {
  readonly constraints: readonly PlanConstraint[];
  readonly uncertainty: UncertaintyHandling;
  readonly reasons: readonly PlanReason[];
}

/**
 * The identity band a confidence falls into, and what identity says to do there.
 *
 * Read from `IdentityProfile.uncertainty` rather than from a threshold in this
 * package. The bands are already declared, already ordered, and already carry
 * `disclose` and `defer` — duplicating them here would be a second source of
 * truth for how honest the companion is about what it does not know.
 */
export const stanceFor = (
  identity: IdentityProfile | null,
  confidence: number,
): UncertaintyHandling => {
  const fallback: UncertaintyHandling = {
    confidence: asConfidence(confidence),
    // With no identity supplied the honest default is the careful one. A
    // companion missing its own definition should not become *more* assertive
    // for the lack of it.
    disclose: confidence < 0.7,
    defer: confidence < 0.5,
    band: 'unknown',
  };

  if (identity === null || identity.uncertainty.length === 0) return fallback;

  // The highest band whose floor the confidence clears. Sorted descending so the
  // first match is the tightest one that applies, whatever order the profile
  // happens to declare them in.
  const bands = [...identity.uncertainty].sort((a, b) => b.atLeast - a.atLeast);
  const band = bands.find((stance) => confidence >= stance.atLeast) ?? bands[bands.length - 1];
  if (band === undefined) return fallback;

  return {
    confidence: asConfidence(confidence),
    disclose: band.disclose,
    defer: band.defer,
    band: band.band,
  };
};

/**
 * How sure the plan is that it read the situation correctly.
 *
 * Deliberately *not* the same as how sure the companion is of any answer it
 * might give — this is confidence in the reading, and the two come apart. The
 * clearest possible question about something the companion knows nothing about
 * is read perfectly and answered badly, and only the second is a reason to
 * hedge the content.
 *
 * Grounding lowers it because a plan resting on nothing retrieved is a plan
 * about a conversation the companion cannot support; conflict lowers it because
 * contradictory readings mean the reading itself is in doubt.
 */
export const planConfidence = (situation: Situation): number => {
  let value = situation.clarity;

  if (situation.conflicted) value -= 0.15;
  if (situation.ungrounded) value -= 0.1;
  if (situation.onlyInference) value -= 0.1;
  if (situation.silent) value = 0;

  return round(Math.max(0, Math.min(1, value)));
};

export const deriveConstraints = (
  situation: Situation,
  identity: IdentityProfile | null,
  clarityFloor: number,
): DerivedConstraints => {
  const constraints = new Set<PlanConstraint>();
  const reasons: PlanReason[] = [];

  const confidence = planConfidence(situation);
  const uncertainty = stanceFor(identity, confidence);

  const add = (constraint: PlanConstraint, detail: string): void => {
    if (constraints.has(constraint)) return;
    constraints.add(constraint);
    reasons.push({ code: 'safety_constraint', detail: `${constraint}: ${detail}` });
  };

  // ── identity's own stance on not knowing ───────────────────────────────
  if (uncertainty.disclose) {
    reasons.push({
      code: 'identity_uncertainty_stance',
      detail: `Confidence ${confidence.toFixed(2)} falls in the '${uncertainty.band}' band, which discloses.`,
    });
    add('disclose_uncertainty', 'Identity requires saying so at this band.');
  }
  if (uncertainty.defer) {
    add('defer_to_user_judgement', 'Identity defers to the user at this band.');
  }

  // ── identity's autonomy principles ─────────────────────────────────────
  for (const principle of identity?.autonomy ?? []) {
    if (principle.onConflict === 'ask') {
      add(
        'require_clarification_before_acting',
        `Autonomy principle '${principle.id}' resolves conflict by asking.`,
      );
    }
    if (principle.onConflict === 'decline') {
      add('no_irreversible_suggestions', `Autonomy principle '${principle.id}' declines.`);
    }
  }

  // ── the reading itself ─────────────────────────────────────────────────
  if (situation.clarity < clarityFloor && !situation.silent) {
    add(
      'require_clarification_before_acting',
      `Clarity ${situation.clarity.toFixed(2)} is under the ${clarityFloor.toFixed(2)} floor.`,
    );
  }
  if (situation.conflicted) {
    add('require_clarification_before_acting', 'Perception found readings that disagree.');
  }

  // ── what the plan rests on ─────────────────────────────────────────────
  if (situation.onlyInference) {
    reasons.push({
      code: 'inference_hedged',
      detail: 'Everything retrieved was an insight; nothing was something the user said.',
    });
    add(
      'do_not_assert_from_inference',
      'The only support is inferred, and an inference must be voiced as a guess.',
    );
    add('avoid_overclaiming', 'Nothing retrieved is firmer than a conclusion.');
  }
  if (situation.ungrounded) {
    add('avoid_overclaiming', 'Retrieval ran and found nothing relevant to lean on.');
  }

  // ── how they seem ──────────────────────────────────────────────────────
  if (situation.distressed) {
    add('slow_down', 'A difficult feeling was read.');
    // Unsolicited advice to someone having a hard time is the commonest way a
    // companion makes things worse while trying to help. Wanting to be useful is
    // not the same as being asked.
    if (!situation.askedForHelp) {
      add('no_advice_unless_asked', 'Distress was read and no help was asked for.');
    }
  }
  if (
    situation.strongestFeeling !== null &&
    !situation.strongestFeeling.stated &&
    situation.statedFeeling === null
  ) {
    reasons.push({
      code: 'emotion_possible_only',
      detail: `'${situation.strongestFeeling.dimension}' was inferred, not stated.`,
    });
    add('avoid_overclaiming', 'The emotional reading is an inference about a person.');
  }
  if (situation.urgent) {
    add('simplify', 'Urgency was read; fewer moving parts.');
  }

  // ── boundaries ─────────────────────────────────────────────────────────
  if (situation.identityBoundary !== null) {
    reasons.push({
      code: 'identity_boundary',
      detail: `Touches identity boundary '${situation.identityBoundary}'.`,
    });
    add('respect_stated_boundary', `Identity constrains '${situation.identityBoundary}'.`);
    add('defer_to_user_judgement', 'A constrained subject is the user’s call, not the companion’s.');
  }
  if (situation.boundaries.length > 0) {
    add(
      'respect_stated_boundary',
      `The relationship records ${situation.boundaries.length} boundary(ies).`,
    );
  }

  // ── being told you were wrong ──────────────────────────────────────────
  if (situation.corrected) {
    // Being corrected is evidence the companion's reading was wrong. Continuing
    // to assert after that is how a companion loses the trust the correction was
    // an opportunity to keep.
    add('avoid_overclaiming', 'The user corrected the companion this turn.');
    add('defer_to_user_judgement', 'The user knows something the companion did not.');
  }

  return {
    // Sorted so two runs of the same situation produce the same list, whatever
    // order the rules above happened to fire in.
    constraints: [...constraints].sort(),
    uncertainty,
    reasons,
  };
};

const round = (value: number): number => Math.round(value * 1_000) / 1_000;
