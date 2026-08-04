import type {
  ConversationTurn,
  ExpressionProfile,
  PersonalityProfile,
  Perception,
  Relationship,
  SpeechTone,
  UserPreferences,
} from '@nexa/models';
import { MIN_ACTIONABLE_EMOTION_CONFIDENCE } from '@nexa/models';
import type { ExpressionDraft } from './draft.js';
import { explain, seal } from './draft.js';
import { applyBase } from './layers/base.js';
import { applyRelationship } from './layers/relationship.js';
import { applyConversationContext } from './layers/context.js';
import { applyPreferences } from './layers/preferences.js';

/**
 * Everything the engine reads.
 *
 * Grouped into one object rather than four parameters so that adding a fifth
 * input later is an additive change at every call site instead of a signature
 * break. Three of the four are nullable, and each null means the same thing:
 * that faculty is not composed in yet. A companion with no relationship record
 * is not a degraded companion — it is one meeting someone for the first time.
 */
export interface ExpressionRequest {
  /** Layer 1. The companion's own disposition. Required — there is no companion without it. */
  readonly personality: PersonalityProfile;
  /** Layer 2. Null on a first meeting. */
  readonly relationship?: Relationship | null;
  /** Layer 3. What the user is doing and how they seem. */
  readonly perception: Perception;
  /** Layer 3. Recent exchanges, for conversation depth. */
  readonly recentTurns?: readonly ConversationTurn[];
  /** Layer 4. Null when the user has stated nothing. */
  readonly preferences?: UserPreferences | null;
}

/**
 * Produces the expression profile for one turn.
 *
 * **Pure.** No I/O, no clock, no randomness, no model call — the same request
 * always yields the same profile. That is the same bet `deliberate()` makes,
 * and it buys the same three things: the layers are snapshot-testable without
 * stubbing anything, a profile can be reproduced offline from a logged request
 * when someone asks why the companion was curt, and nothing here can fail in a
 * way that costs the user their answer.
 *
 * ## The layers run in authority order, lowest first
 *
 * ```
 *   base traits  →  relationship  →  conversation context  →  stated preferences
 *   (disposition)   (earned)         (momentary)              (explicit)
 * ```
 *
 * Later layers move what earlier ones produced, so precedence is expressed by
 * position rather than by every layer knowing about the others. Two rules break
 * the gradient deliberately, and both break it toward restraint:
 *
 * - **Distress suppresses humour outright**, whatever the traits and the
 *   relationship say.
 * - **`allowProactiveSpeech: false` caps initiative**, whatever anything says.
 *
 * Both are floors rather than nudges because the failure they prevent is not
 * recoverable by the next turn.
 *
 * ## What it does not do
 *
 * It decides *how* to communicate, never *what* to say. No output here can
 * change a claim, suppress a fact, or alter a decision — deliberation has
 * already run and read none of this.
 */
export const composeExpression = (request: ExpressionRequest): ExpressionProfile => {
  const draft: ExpressionDraft = {
    curiosity: 0,
    humor: 0,
    emotionalExpression: 0,
    warmth: 0,
    formality: 0,
    directness: 0,
    energy: 0,
    detail: 0,
    initiative: 0,
    pacing: 0,
    boundaries: [],
    rationale: [],
  };

  const relationship = request.relationship ?? null;

  applyBase(draft, request.personality);
  applyRelationship(draft, relationship);
  applyConversationContext(draft, request.perception, request.recentTurns ?? []);
  // The inferred style is threaded through from the relationship because this
  // layer is the only one that can see both it and the stated preference, and
  // choosing between them requires both.
  applyPreferences(draft, request.preferences ?? null, relationship?.inferredStyle ?? null);

  const clamped = clampedDimensions(draft);
  if (clamped.length > 0) {
    explain(
      draft,
      'clamped',
      clamped,
      `At a bound: ${clamped.join(', ')}. Further adjustment had no effect.`,
    );
  }

  return seal(draft, resolveTone(draft, request.perception));
};

/**
 * Which continuous dimensions ended at a bound.
 *
 * Recorded because a dimension pinned at 0 is indistinguishable in the output
 * from one that was never pushed, and the difference matters when tuning: the
 * first says the rules are fighting each other, the second says nothing fired.
 */
const clampedDimensions = (draft: ExpressionDraft): ('humor' | 'curiosity' | 'warmth' | 'formality' | 'directness' | 'emotionalExpression' | 'energy')[] => {
  const names = [
    'humor',
    'curiosity',
    'warmth',
    'formality',
    'directness',
    'emotionalExpression',
    'energy',
  ] as const;

  return names.filter((name) => draft[name] === 0 || draft[name] === 1);
};

/**
 * Chooses the delivery tone.
 *
 * Resolved last, from the composed dimensions rather than from the traits,
 * because tone is the summary of everything the other layers decided. Deriving
 * it from the personality directly would let it contradict them — a profile
 * with humour suppressed to zero by distress should not still be `playful`.
 *
 * Ordered by precedence, most specific first. Emotional readings win over
 * disposition, because how the user is doing matters more than how the
 * companion usually sounds.
 */
const resolveTone = (draft: ExpressionDraft, perception: Perception): SpeechTone => {
  const signal = perception.emotion;
  const actionable =
    signal !== null && signal.confidence >= MIN_ACTIONABLE_EMOTION_CONFIDENCE
      ? signal.emotion
      : null;

  if (
    actionable === 'frustrated' ||
    actionable === 'stressed' ||
    actionable === 'sad' ||
    actionable === 'confused'
  ) {
    return 'concerned';
  }

  if (actionable === 'happy' || actionable === 'proud') return 'encouraging';

  // Playfulness has to be earned twice: the moment has to suit it *and* the
  // composed humour has to have survived every layer above.
  if (actionable === 'excited' && draft.humor >= 0.5) return 'playful';

  if (draft.warmth >= 0.7) return 'warm';
  return 'neutral';
};
