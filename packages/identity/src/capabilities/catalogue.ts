import type { CapabilityStatement } from '@nexa/models';
import { needsAction, needsDevice, needsFaculty } from '@nexa/models';

/**
 * What the companion could do, and how much of it exists.
 *
 * `maturity` is set against the real state of the repository rather than the
 * roadmap. A companion describing planned faculties in the present tense is
 * lying about itself, and identity is the last place that should be permitted —
 * `honesty` is its highest-precedence value, and "what can you do?" is the
 * question where overclaiming is most tempting and most damaging.
 *
 * - `available` — built, wired, and exercised by tests.
 * - `partial` — the mechanism exists but something it depends on does not.
 * - `planned` — designed, not built.
 *
 * **This list is expected to change as engines ship, and that is not a
 * violation of identity being permanent.** What never changes is the commitment
 * to describe capability accurately; which capabilities exist is a fact about
 * the system, not a value. Updating a `maturity` is a factual correction and
 * does not require an identity version bump.
 *
 * ## What this file is *not*
 *
 * It is not the answer. It is the *claim*, and every entry is resolved against
 * live facts before anything is said aloud — see `@nexa/self`. A capability
 * marked `available` here still reports `unsupported` when the connected body
 * cannot perform it, and `currently_unavailable` when a device it needs is
 * unplugged. This file says what could exist; the Self Model says what does.
 *
 * `requires` is typed, which is the point of the rewrite. It previously held
 * strings like `'world_port'` that matched no symbol anywhere and were read by
 * nothing, so an entry could depend on a faculty that had never existed and
 * nothing would notice.
 */
export const CAPABILITIES: readonly CapabilityStatement[] = [
  {
    id: 'conversation',
    domain: 'conversation',
    maturity: 'available',
    summary: 'Holds a conversation, one turn at a time, and acts on what was said.',
    requires: [],
  },
  {
    id: 'explain_own_decisions',
    domain: 'explainability',
    maturity: 'available',
    summary:
      'Can say why it answered as it did, from a recorded decision with reason codes rather than a reconstruction.',
    requires: [],
  },
  {
    id: 'adapt_communication',
    domain: 'personality',
    maturity: 'available',
    summary:
      'Adjusts how it speaks — warmth, directness, detail, pace — to the person and the moment.',
    requires: [],
  },
  {
    id: 'working_memory',
    domain: 'memory',
    maturity: 'available',
    summary: 'Remembers the current conversation while it is happening.',
    requires: [],
  },
  {
    id: 'speak_aloud',
    domain: 'conversation',
    maturity: 'available',
    summary: 'Says its answers out loud rather than only printing them.',
    requires: [needsFaculty('speech_out'), needsDevice('speaker')],
  },
  {
    id: 'hear_speech',
    domain: 'perception',
    maturity: 'available',
    summary: 'Listens to spoken words and turns them into a turn.',
    requires: [needsFaculty('speech_in'), needsDevice('microphone')],
  },
  {
    id: 'read_emotional_signal',
    domain: 'perception',
    maturity: 'partial',
    summary:
      'Estimates how the user seems from what they wrote, and declines to act on a weak reading.',
    requires: [],
  },
  {
    id: 'propose_memory',
    domain: 'memory',
    maturity: 'partial',
    summary:
      'Notices things worth keeping and proposes them, though consolidation happens elsewhere.',
    requires: [],
  },
  {
    id: 'long_term_recall',
    domain: 'memory',
    maturity: 'available',
    summary: 'Recalls things from previous conversations, ranked by relevance.',
    requires: [needsFaculty('long_term_memory')],
  },
  {
    id: 'use_tools',
    domain: 'tools',
    maturity: 'partial',
    summary:
      'Can invoke tools when the model asks for them, within a bounded loop. No tools are registered yet.',
    requires: [needsFaculty('tools')],
  },
  {
    id: 'streaming_response',
    domain: 'conversation',
    maturity: 'available',
    summary: 'Delivers a response as it is produced rather than only when finished.',
    requires: [needsFaculty('streaming')],
  },

  // ── Body ────────────────────────────────────────────────────────────────
  // Each names the action it is realised by, so it resolves against both the
  // client's declaration and the body's own report. That is what makes
  // "can you wave?" answerable before anything is attempted, rather than only
  // discoverable by trying and being told it was skipped.
  {
    id: 'walk',
    domain: 'embodiment',
    maturity: 'available',
    summary: 'Walks to a place, or a measured distance in a direction.',
    requires: [needsFaculty('locomotion'), needsAction('move')],
  },
  {
    id: 'follow',
    domain: 'embodiment',
    maturity: 'available',
    summary: 'Keeps walking with someone until told to stop.',
    requires: [needsFaculty('locomotion'), needsAction('follow')],
  },
  {
    id: 'stop_moving',
    domain: 'embodiment',
    maturity: 'available',
    summary: 'Stops what its body is doing when asked.',
    requires: [needsAction('stop')],
  },
  {
    id: 'look_at',
    domain: 'embodiment',
    maturity: 'available',
    summary: 'Turns its head and eyes toward someone or something.',
    requires: [needsFaculty('attention'), needsAction('look')],
  },
  {
    id: 'gesture',
    domain: 'embodiment',
    maturity: 'available',
    summary: 'Performs a bodily gesture — a wave, a nod.',
    requires: [needsFaculty('gesture'), needsAction('gesture')],
  },
  {
    id: 'know_action_outcome',
    domain: 'embodiment',
    maturity: 'available',
    summary:
      'Knows whether a physical action actually succeeded, because the body reports back rather than the answer being assumed.',
    requires: [needsFaculty('locomotion')],
  },

  // ── Not built ───────────────────────────────────────────────────────────
  // `planned` resolves to `not_built`, which stays distinct from every other
  // "no". It is the one that could later become "not yet".
  {
    id: 'see',
    domain: 'perception',
    maturity: 'planned',
    summary: 'Seeing what is physically around it, and describing what it observes.',
    requires: [needsFaculty('vision'), needsDevice('camera')],
  },
  {
    id: 'world_awareness',
    domain: 'perception',
    maturity: 'planned',
    summary: 'Knowing what is physically around the user and referring to it.',
    requires: [needsFaculty('world_model')],
  },
  {
    id: 'multi_step_planning',
    domain: 'planning',
    maturity: 'planned',
    summary: 'Breaking a goal into steps and tracking progress across days.',
    requires: [needsFaculty('planning')],
  },
];
