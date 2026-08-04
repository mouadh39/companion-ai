import type { CommunicationStyle, UserPreferences } from '@nexa/models';
import { INITIATIVE_RANK } from '@nexa/models';
import type { ExpressionDraft } from '../draft.js';
import { capAt, explain } from '../draft.js';
import { applyStyle } from './relationship.js';

/**
 * Layer 4 — what the user actually said they want.
 *
 * Applied last because it is the only layer whose contents the user typed
 * themselves. Everything before it is the companion's belief: its own
 * disposition, what it thinks the relationship has become, how it reads the
 * moment. Beliefs can be wrong, and a companion that overrules an explicit
 * setting with its own guess is one the user cannot configure.
 *
 * That ordering is the entire reason this is a separate layer rather than
 * merged into the relationship one. `Relationship.inferredStyle` and
 * `UserPreferences.communicationStyle` hold the same kind of value from
 * different sources, and the source is what decides which wins.
 *
 * Stated styles are applied at full strength, inferred ones at half, so when
 * both are present the stated value moves the dimension further and lands on
 * top without needing to detect and unwind the earlier adjustment.
 */
export const applyPreferences = (
  draft: ExpressionDraft,
  preferences: UserPreferences | null,
  inferredStyle: CommunicationStyle | null = null,
): void => {
  // Exactly one style is applied, never both. They govern the same dimensions,
  // so applying the guess and then the stated value would leave the guess
  // partly present in the result — the stated preference would get the last
  // word without actually overriding. Choosing between them here, where both
  // are visible, is what makes "stated outranks inferred" total rather than
  // a matter of which layer happened to run second.
  const stated = preferences?.communicationStyle ?? null;

  if (stated !== null) {
    applyStyle(draft, stated, 1, 'stated_preference');
  } else if (inferredStyle !== null) {
    // Half strength. The companion believes this rather than having been told
    // it, and a belief should shape the delivery without committing to it as
    // hard as an instruction.
    applyStyle(draft, inferredStyle, 0.5, 'inferred_style');
  }

  if (preferences === null) return;

  // A hard ceiling rather than a nudge. Traits, reliance and an eager mood can
  // all push initiative upward, and every one of them must lose to this — an AR
  // companion that starts conversations uninvited is the failure mode users
  // abandon the product over.
  //
  // Capped at `offer`, not `follow`. The permission governs speaking without
  // being addressed; within a turn the user has already addressed the
  // companion, so it may still volunteer something useful. What it may not do
  // is drive.
  if (!preferences.allowProactiveSpeech) {
    const capped = capAt(draft, 'initiative', INITIATIVE_RANK.offer);
    if (capped) {
      explain(
        draft,
        'proactive_speech_disallowed',
        ['initiative'],
        'Proactive speech is switched off: may offer, never lead.',
      );
    }
  }
};
