import type { ConversationTurn, IntentKind, Perception, UserEmotion } from '@nexa/models';
import { MIN_ACTIONABLE_EMOTION_CONFIDENCE, primaryIntent } from '@nexa/models';
import type { ExpressionDraft } from '../draft.js';
import { explain, nudge, step } from '../draft.js';

/**
 * Layer 3 — the moment.
 *
 * What the user is trying to do right now, and how they seem while doing it.
 * This layer moves the most and persists the least: nothing it decides is
 * written anywhere, so a single frustrated message changes one turn and not the
 * companion.
 *
 * ## Weak emotional signals are ignored, not softened
 *
 * Below `MIN_ACTIONABLE_EMOTION_CONFIDENCE` the reading does not influence the
 * profile at all. Scaling the adjustment by confidence would seem gentler and
 * is worse: it means every low-confidence guess still moves the output a
 * little, so the companion is permanently, slightly wrong about how everyone
 * feels. `10_Decision_Engine.md` requires weak signals to be ignored, and this
 * is the same threshold the decision path uses.
 *
 * ## Humour has a floor-breaking rule
 *
 * Distress suppresses humour hard, regardless of traits or relationship. This
 * is the one place a lower layer is deliberately overridden rather than nudged:
 * `13_Personality_Engine.md` is explicit that the companion must never force
 * jokes, and a playful companion joking at someone who just said they are
 * struggling is the single most damaging thing this engine could produce.
 */
export const applyConversationContext = (
  draft: ExpressionDraft,
  perception: Perception,
  recentTurns: readonly ConversationTurn[],
): void => {
  applyIntent(draft, primaryIntent(perception));

  const signal = perception.emotion;
  if (signal !== null && signal.confidence >= MIN_ACTIONABLE_EMOTION_CONFIDENCE) {
    applyEmotion(draft, signal.emotion, signal.intensity);
  }

  // A conversation already under way is a different setting from a first
  // message. Small, and capped, so a long session does not slide into
  // over-familiarity that the relationship has not earned.
  if (recentTurns.length >= 6) {
    nudge(draft, 'formality', -0.05);
    explain(
      draft,
      'intent_shape',
      ['formality'],
      `Conversation ${String(recentTurns.length)} turns in: slightly less formal.`,
    );
  }
};

/** What the user is trying to do shapes how the answer should be delivered. */
const applyIntent = (draft: ExpressionDraft, intent: IntentKind): void => {
  switch (intent) {
    case 'emotional_support': {
      nudge(draft, 'warmth', 0.2);
      nudge(draft, 'emotionalExpression', 0.25);
      // Curiosity is suppressed rather than raised. Someone seeking support is
      // not asking to be interviewed, and a companion that responds to distress
      // with questions reads as deflecting.
      nudge(draft, 'curiosity', -0.3);
      nudge(draft, 'humor', -0.25);
      explain(
        draft,
        'intent_shape',
        ['warmth', 'emotionalExpression', 'curiosity', 'humor'],
        'Support sought: warmer, present, not inquisitive.',
      );
      return;
    }
    case 'correction': {
      // Being corrected is not the moment to be charming. Fix it plainly.
      nudge(draft, 'directness', 0.25);
      nudge(draft, 'humor', -0.3);
      step(draft, 'detail', -1);
      explain(
        draft,
        'user_correction',
        ['directness', 'humor', 'detail'],
        'Correction issued: plainer and shorter.',
      );
      return;
    }
    case 'question': {
      nudge(draft, 'directness', 0.1);
      explain(draft, 'intent_shape', ['directness'], 'Question asked: answer it.');
      return;
    }
    case 'request': {
      nudge(draft, 'directness', 0.15);
      step(draft, 'detail', -1);
      explain(
        draft,
        'intent_shape',
        ['directness', 'detail'],
        'Action requested: confirm briefly rather than explain.',
      );
      return;
    }
    case 'planning': {
      step(draft, 'detail', 1);
      nudge(draft, 'directness', 0.1);
      explain(
        draft,
        'intent_shape',
        ['detail', 'directness'],
        'Planning: structure is worth the words.',
      );
      return;
    }
    case 'casual': {
      nudge(draft, 'humor', 0.1);
      nudge(draft, 'formality', -0.1);
      step(draft, 'detail', -1);
      explain(
        draft,
        'intent_shape',
        ['humor', 'formality', 'detail'],
        'Casual exchange: lighter and shorter.',
      );
      return;
    }
    case 'unknown': {
      // Not knowing what was meant is the one case where asking is the right
      // move, so curiosity rises rather than falls.
      nudge(draft, 'curiosity', 0.15);
      explain(
        draft,
        'intent_shape',
        ['curiosity'],
        'Intent unclear: a clarifying question is appropriate.',
      );
      return;
    }
    case 'statement': {
      explain(draft, 'intent_shape', [], 'Statement: no shaping required.');
      return;
    }
  }
};

/** How the user seems shapes tone, pace and how much is said. */
const applyEmotion = (
  draft: ExpressionDraft,
  emotion: UserEmotion,
  intensity: number,
): void => {
  const scaled = (base: number): number => base * (0.5 + intensity / 2);

  switch (emotion) {
    case 'frustrated':
    case 'stressed': {
      nudge(draft, 'warmth', scaled(0.2));
      nudge(draft, 'emotionalExpression', scaled(0.15));
      nudge(draft, 'humor', -1);
      step(draft, 'pacing', -1);
      step(draft, 'detail', -1);
      explain(
        draft,
        'user_distress',
        ['warmth', 'emotionalExpression', 'humor', 'pacing', 'detail'],
        `User seems ${emotion}: warmer, slower, no humour.`,
      );
      return;
    }
    case 'sad': {
      nudge(draft, 'warmth', scaled(0.3));
      nudge(draft, 'emotionalExpression', scaled(0.25));
      nudge(draft, 'humor', -1);
      nudge(draft, 'curiosity', -0.2);
      step(draft, 'pacing', -1);
      explain(
        draft,
        'user_distress',
        ['warmth', 'emotionalExpression', 'humor', 'curiosity', 'pacing'],
        'User seems sad: warmth up, humour off, unhurried.',
      );
      return;
    }
    case 'confused': {
      step(draft, 'detail', 1);
      nudge(draft, 'directness', 0.2);
      step(draft, 'pacing', -1);
      explain(
        draft,
        'user_distress',
        ['detail', 'directness', 'pacing'],
        'User seems confused: clearer, slower, more explanation.',
      );
      return;
    }
    case 'tired': {
      step(draft, 'detail', -1);
      step(draft, 'pacing', -1);
      nudge(draft, 'energy', -0.2);
      nudge(draft, 'humor', -0.15);
      explain(
        draft,
        'user_distress',
        ['detail', 'pacing', 'energy', 'humor'],
        'User seems tired: shorter and calmer.',
      );
      return;
    }
    case 'happy':
    case 'proud': {
      nudge(draft, 'humor', scaled(0.15));
      nudge(draft, 'emotionalExpression', scaled(0.2));
      nudge(draft, 'warmth', scaled(0.1));
      explain(
        draft,
        'user_positive',
        ['humor', 'emotionalExpression', 'warmth'],
        `User seems ${emotion}: match it.`,
      );
      return;
    }
    case 'excited': {
      nudge(draft, 'humor', scaled(0.2));
      nudge(draft, 'energy', scaled(0.25));
      step(draft, 'pacing', 1);
      explain(
        draft,
        'user_positive',
        ['humor', 'energy', 'pacing'],
        'User seems excited: livelier and quicker.',
      );
      return;
    }
    case 'curious': {
      nudge(draft, 'curiosity', scaled(0.2));
      step(draft, 'detail', 1);
      explain(
        draft,
        'user_positive',
        ['curiosity', 'detail'],
        'User seems curious: meet it with substance.',
      );
      return;
    }
    case 'focused': {
      nudge(draft, 'directness', scaled(0.15));
      nudge(draft, 'humor', -0.1);
      explain(
        draft,
        'intent_shape',
        ['directness', 'humor'],
        'User seems focused: do not derail them.',
      );
      return;
    }
    case 'calm': {
      explain(draft, 'intent_shape', [], 'User seems calm: no adjustment.');
      return;
    }
  }
};
