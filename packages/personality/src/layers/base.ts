import type { PersonalityProfile } from '@nexa/models';
import { DETAIL_RANK, INITIATIVE_RANK, PACING_RANK } from '@nexa/models';
import type { ExpressionDraft } from '../draft.js';
import { explain } from '../draft.js';

/**
 * Layer 1 — the companion's own disposition, before anyone else is considered.
 *
 * This is the only layer that *sets* rather than adjusts. Everything after it
 * moves what this produced, which is what makes the ordering meaningful: the
 * companion has a baseline personality, and the user, the relationship and the
 * moment bend it rather than define it. A pipeline that started from a neutral
 * profile and derived everything from context would produce a companion with no
 * character of its own — a mirror, which is precisely what
 * `13_Personality_Engine.md` rules out.
 *
 * ## Why some dimensions are derived rather than read
 *
 * Six dimensions map straight from a trait of the same name. Three do not,
 * because they are *behaviours* rather than dispositions and no single trait
 * determines them:
 *
 * - **`emotionalExpression`** comes from `empathy`. Empathy is the capacity to
 *   register what someone feels; expression is what the companion does with it.
 *   They correlate strongly enough that a separate trait would be two names for
 *   one number.
 * - **`detail`** balances `patience` and `creativity` against `directness`. A
 *   patient, creative companion elaborates; a direct one gets to the point.
 * - **`initiative`** requires both `curiosity` and `confidence`. Curiosity
 *   without confidence produces a companion that wonders and says nothing;
 *   confidence without curiosity produces one with nothing to offer.
 */
export const applyBase = (
  draft: ExpressionDraft,
  personality: PersonalityProfile,
): void => {
  const { traits, adaptive } = personality;

  draft.curiosity = traits.curiosity;
  draft.humor = traits.humor;
  draft.warmth = traits.warmth;
  draft.formality = traits.formality;
  draft.directness = traits.directness;
  draft.emotionalExpression = traits.empathy;
  draft.energy = adaptive.energy;

  // Elaboration is willingness minus impatience with one's own words. Both
  // halves matter: a companion high in patience and directness both explains
  // carefully and stops when it is done.
  const elaboration = (traits.patience + traits.creativity) / 2 - traits.directness * 0.3;
  // `thorough` is deliberately hard to reach from traits alone. It is the top
  // of the scale, and a companion that starts there has no room to elaborate
  // when someone actually asks it to — the `detailed` preference would become a
  // no-op, which is worse than the verbosity it was meant to grant.
  draft.detail =
    elaboration >= 0.7
      ? DETAIL_RANK.thorough
      : elaboration >= 0.4
        ? DETAIL_RANK.moderate
        : DETAIL_RANK.brief;

  // `lead` is unreachable here by design. No combination of traits may make the
  // companion drive the exchange — that is gated on the user's stated
  // permission, applied two layers later.
  const drive = Math.min(traits.curiosity, traits.confidence);
  draft.initiative = drive >= 0.6 ? INITIATIVE_RANK.offer : INITIATIVE_RANK.follow;

  draft.pacing =
    adaptive.energy < 0.35
      ? PACING_RANK.slow
      : adaptive.energy > 0.7
        ? PACING_RANK.brisk
        : PACING_RANK.measured;

  explain(
    draft,
    'base_traits',
    [
      'curiosity',
      'humor',
      'warmth',
      'formality',
      'directness',
      'emotionalExpression',
      'energy',
      'detail',
      'initiative',
      'pacing',
    ],
    `Baseline from personality revision ${String(personality.revision)}.`,
  );

  // Focus and engagement are momentary and belong to the same layer as energy,
  // but they modulate rather than set — so they are applied as adjustments on
  // top of the baseline this method just established.
  if (adaptive.focus < 0.4) {
    draft.detail = Math.max(0, draft.detail - 1);
    explain(
      draft,
      'adaptive_state',
      ['detail'],
      'Low focus: less elaboration, to stay followable.',
    );
  }

  if (adaptive.engagement >= 0.7) {
    draft.curiosity = Math.min(1, draft.curiosity + 0.05);
    explain(
      draft,
      'adaptive_state',
      ['curiosity'],
      'High engagement: marginally more curious.',
    );
  }
};
