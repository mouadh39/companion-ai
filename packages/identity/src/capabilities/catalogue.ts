import type { CapabilityStatement } from '@nexa/models';

/**
 * What the companion can actually do, and how much of it exists.
 *
 * `maturity` is the field that keeps this honest, and it is set against the
 * real state of the repository rather than the roadmap. A companion describing
 * planned faculties in the present tense is lying about itself, and identity is
 * the last place that should be permitted — `honesty` is its highest-precedence
 * value, and "what can you do?" is the question where overclaiming is most
 * tempting and most damaging.
 *
 * - `available` — built, wired, and exercised by tests.
 * - `partial` — the mechanism exists but something it depends on does not, so
 *   the user-visible behaviour is incomplete.
 * - `planned` — designed, not built. The companion must speak of these in the
 *   future tense or not at all.
 *
 * **This list is expected to change as engines ship, and that is not a
 * violation of identity being permanent.** What never changes is the commitment
 * to describe capability accurately; which capabilities exist is a fact about
 * the system, not a value. Updating a `maturity` is a factual correction and
 * does not require an identity version bump.
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
    id: 'read_emotional_signal',
    domain: 'perception',
    maturity: 'partial',
    summary:
      'Estimates how the user seems from what they wrote, and declines to act on a weak reading.',
    requires: ['perception'],
  },
  {
    id: 'propose_memory',
    domain: 'memory',
    maturity: 'partial',
    summary:
      'Notices things worth keeping and proposes them, though consolidation happens elsewhere.',
    requires: ['memory_write_port'],
  },
  {
    id: 'use_tools',
    domain: 'tools',
    maturity: 'partial',
    summary:
      'Can invoke tools when the model asks for them, within a bounded loop. No tools are registered yet.',
    requires: ['tool_registry_port', 'tool_execution_port'],
  },
  {
    id: 'long_term_recall',
    domain: 'memory',
    maturity: 'planned',
    summary: 'Recalling things from previous conversations, ranked by relevance.',
    requires: ['memory_retrieval_port'],
  },
  {
    id: 'world_awareness',
    domain: 'perception',
    maturity: 'planned',
    summary: 'Knowing what is physically around the user and referring to it.',
    requires: ['world_port'],
  },
  {
    id: 'multi_step_planning',
    domain: 'planning',
    maturity: 'planned',
    summary: 'Breaking a goal into steps and tracking progress across days.',
    requires: ['plan_read_port'],
  },
  {
    id: 'streaming_response',
    domain: 'conversation',
    maturity: 'available',
    summary: 'Delivers a response as it is produced rather than only when finished.',
    requires: ['streaming_provider'],
  },
];
