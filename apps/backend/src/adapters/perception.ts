import type { Clock } from '@nexa/shared';
import type { Perception, TextPercept } from '@nexa/models';
import { timestamp } from '@nexa/models';
import type { PerceptionPort, PortOptions } from '@nexa/core';
import { perceive, toPerception } from '@nexa/perception';
import type { TurnScratchpad } from './scratchpad.js';

/**
 * Perception, behind the port Core declares.
 *
 * Replaces `HeuristicPerception`, which held its own keyword tables in this file
 * and reported every emotional read at a confidence just below the actionable
 * floor. Those tables were a second, untested perception engine living in the
 * composition root; this delegates to the real one.
 *
 * ## Two shapes, and both are needed
 *
 * `perceive()` produces a `PerceptionOutcome` — twenty-nine dimensions, stances,
 * tensions, per-channel readings. Core's `PerceptionPort` returns a `Perception`
 * — text, ranked intents, one emotion, entities. This returns the projection and
 * records the full outcome on the scratchpad, because retrieval and planning
 * both need the richer one and neither of their ports carries it.
 *
 * Widening those ports would make Core aware of a capability package's
 * vocabulary. Projecting and sharing leaves Core exactly as Phase A froze it.
 *
 * ## What the port shape costs, stated rather than worked around
 *
 * `perceive(text, options)` carries the message and the turn id, and nothing
 * else — no `companionId`, so no way to load the conversation. `topic_shift` is
 * therefore unreachable through this wiring and is reported as `unknown` rather
 * than as absent, which is the honest outcome and exactly the distinction
 * perception's `UnknownDimension` exists to draw. Widening `PerceptionPort` is a
 * Core contract change; it is recorded as remaining work.
 */
export class PerceptionEngine implements PerceptionPort {
  readonly #clock: Clock;
  readonly #scratchpad: TurnScratchpad;

  constructor(deps: { readonly clock: Clock; readonly scratchpad: TurnScratchpad }) {
    this.#clock = deps.clock;
    this.#scratchpad = deps.scratchpad;
  }

  async perceive(text: string, options: PortOptions): Promise<Perception> {
    // The turn's one clock read for perception. Every engine downstream is given
    // this instant rather than taking its own, which is what makes a replayed
    // turn produce the same readings rather than merely similar ones.
    const at = timestamp(this.#clock.nowIso());
    const percept: TextPercept = { channel: 'text', at, text };

    const outcome = perceive({ percepts: [percept], at });

    // Opened here because perception is the first stage of the turn and the only
    // one guaranteed to run. Everything downstream reads what this wrote.
    this.#scratchpad.open(options.turnId, { at, message: text, perception: outcome });

    return toPerception(outcome, [percept]);
  }
}
