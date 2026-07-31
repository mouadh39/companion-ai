/**
 * The emotional states Nexa models.
 *
 * A closed set, not free text. An open vocabulary would let the language model
 * invent a new emotion every turn, which makes trend analysis impossible and
 * turns "how has the user been this week?" into string clustering. Eight states
 * chosen for being *behaviourally distinct* — each one should change what the
 * companion does, or it does not deserve a member.
 *
 * `14_Emotion_Engine.md` is explicit that emotion informs conversation and
 * planning but never overrides a decision. Nothing here carries authority; it
 * is an input among several.
 */
export type EmotionType =
  | 'neutral'
  | 'happy'
  | 'excited'
  | 'frustrated'
  | 'stressed'
  | 'sad'
  | 'confused'
  | 'confident';

export const EMOTION_TYPES = [
  'neutral',
  'happy',
  'excited',
  'frustrated',
  'stressed',
  'sad',
  'confused',
  'confident',
] as const satisfies readonly EmotionType[];

/**
 * Whose emotion is being described.
 *
 * The same type serves both, and conflating them would be a serious modelling
 * error: the user's emotion is *observed* and uncertain, the companion's is
 * *held* and authoritative. They are stored together only because a turn needs
 * to reason about the gap between them.
 */
export type EmotionSubject = 'user' | 'companion';

export const EMOTION_SUBJECTS = ['user', 'companion'] as const satisfies readonly EmotionSubject[];

/**
 * How an emotional reading was arrived at.
 *
 * `19_Working_Memory.md` and the Emotion Engine both need to distinguish a
 * guess from a statement. When a user says "I'm fine" and the text signals
 * otherwise, which reading wins is a product decision — and it cannot even be
 * expressed unless the origin is recorded.
 */
export type EmotionOrigin = 'inferred_text' | 'inferred_voice' | 'user_stated' | 'decayed';

export const EMOTION_ORIGINS = [
  'inferred_text',
  'inferred_voice',
  'user_stated',
  'decayed',
] as const satisfies readonly EmotionOrigin[];
