/**
 * The lifecycle of a voice session.
 *
 * Modelled as explicit states because voice is the one modality where the user
 * can *see* the companion getting it wrong. `listening` and `speaking` drive a
 * visible indicator, and `39_Voice_System.md` requires the two never to be
 * simultaneously true — a companion that talks over someone is worse than one
 * that is slow.
 *
 * `interrupted` is a first-class outcome, not an error. Being cut off
 * mid-sentence is normal conversational behaviour and the companion should
 * record it as such, because how often it happens says something about whether
 * it talks too much.
 */
export type VoiceSessionState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'ended';

export const VOICE_SESSION_STATES = [
  'idle',
  'listening',
  'transcribing',
  'thinking',
  'speaking',
  'interrupted',
  'ended',
] as const satisfies readonly VoiceSessionState[];

/** States in which the microphone is live. Drives the client's recording indicator. */
export const isCapturing = (state: VoiceSessionState): boolean =>
  state === 'listening' || state === 'transcribing';

/** Terminal states. A session in one of these is never resumed; a new one is opened. */
export const isVoiceSessionOver = (state: VoiceSessionState): boolean => state === 'ended';

/**
 * How the session ended.
 *
 * Separated from the state so that "ended" carries a reason. Distinguishing a
 * user hanging up from a network drop matters: one is a preference signal, the
 * other is a reliability metric, and a single `ended` state conflates them
 * permanently in the event log.
 */
export type VoiceEndReason =
  | 'user_ended'
  | 'silence_timeout'
  | 'network_lost'
  | 'client_closed'
  | 'error';

export const VOICE_END_REASONS = [
  'user_ended',
  'silence_timeout',
  'network_lost',
  'client_closed',
  'error',
] as const satisfies readonly VoiceEndReason[];

/**
 * Where audio is captured and rendered.
 *
 * The companion adapts to it: a headset supports natural back-and-forth, a
 * phone speaker in a room does not, and `40_AR_Interaction.md` expects response
 * length to reflect that. This is the client telling the core about a physical
 * constraint, which is the one direction that coupling is legitimate.
 */
export type AudioRoute = 'headset' | 'speaker' | 'handset' | 'unknown';

export const AUDIO_ROUTES = [
  'headset',
  'speaker',
  'handset',
  'unknown',
] as const satisfies readonly AudioRoute[];
