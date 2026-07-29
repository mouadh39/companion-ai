import type { CompanionId } from '@nexa/shared';
import type {
  ConversationTurn,
  Identity,
  MemoryCandidate,
  PersonalityProfile,
  RetrievedMemory,
} from '@nexa/models';
import { defaultPersonality } from '@nexa/models';
import type {
  GoalPort,
  IdentityPort,
  MemoryRetrievalPort,
  MemoryWritePort,
  PersonalityPort,
  ToolRegistryPort,
  WorkingMemoryPort,
} from '@nexa/core';

/**
 * Milestone 1 adapters.
 *
 * Every one implements a real port with a shallow body. They live in the
 * composition root rather than in a package because that is what they are:
 * temporary wiring, not a capability. As each becomes real it graduates into
 * its own package (`@nexa/memory`, `@nexa/goals`, …) and the only thing that
 * changes is one line of composition.
 *
 * The point of the vertical slice is that the *seams* are load-bearing now.
 * An interface designed against imagined callers is wrong in ways that only
 * appear when a real caller arrives.
 */

export class StaticIdentity implements IdentityPort {
  readonly #identity: Identity;

  constructor(identity?: Partial<Identity>) {
    this.#identity = {
      name: 'Nexa',
      coreValues: ['honesty', 'respect', 'curiosity', 'reliability'],
      selfDescription:
        'You are a companion who shares the user\'s real environment. You remember what you have been through together, you are direct without being cold, and you would rather say you do not know than invent an answer.',
      version: 1,
      ...identity,
    };
  }

  async load(): Promise<Identity> {
    return this.#identity;
  }
}

/**
 * Personality held in memory, per companion.
 *
 * Persisted in a later milestone. The `revision` counter already exists so that
 * when evolution arrives, drift is auditable from the first write rather than
 * retrofitted onto an untracked history.
 */
export class InMemoryPersonality implements PersonalityPort {
  readonly #profiles = new Map<string, PersonalityProfile>();

  async load(companionId: CompanionId): Promise<PersonalityProfile> {
    const existing = this.#profiles.get(companionId);
    if (existing !== undefined) return existing;

    const created = defaultPersonality();
    this.#profiles.set(companionId, created);
    return created;
  }
}

/**
 * Session-scoped conversation history.
 *
 * Bounded, and bounded deliberately: working memory is not the system of
 * record, so growing it without limit would trade a real constraint for an
 * imagined one. Anything worth keeping is promoted to long-term memory
 * asynchronously.
 */
export class InMemoryWorkingMemory implements WorkingMemoryPort {
  readonly #turns = new Map<string, ConversationTurn[]>();
  readonly #maxTurns: number;

  constructor(maxTurns = 50) {
    this.#maxTurns = maxTurns;
  }

  async recent(
    companionId: CompanionId,
    limit: number,
  ): Promise<readonly ConversationTurn[]> {
    const turns = this.#turns.get(companionId) ?? [];
    return turns.slice(-limit);
  }

  async append(companionId: CompanionId, turn: ConversationTurn): Promise<void> {
    const turns = this.#turns.get(companionId) ?? [];
    turns.push(turn);

    if (turns.length > this.#maxTurns) {
      turns.splice(0, turns.length - this.#maxTurns);
    }

    this.#turns.set(companionId, turns);
  }
}

/**
 * Retrieval that returns nothing.
 *
 * Honest rather than convenient: with no store behind it, any result would be
 * fabricated, and a fabricated memory is the one failure mode
 * `18_Memory_Architecture.md` singles out as most damaging to trust.
 *
 * Returning empty exercises the real path — assembly records the section as
 * omitted, deliberation sees no supporting memory, and the prompt says so.
 */
export class EmptyMemoryRetrieval implements MemoryRetrievalPort {
  async retrieve(): Promise<readonly RetrievedMemory[]> {
    return [];
  }
}

/** Records proposed memories so the slice is observable end to end. */
export class RecordingMemoryWrite implements MemoryWritePort {
  readonly #proposed: Array<{ companionId: CompanionId; candidate: MemoryCandidate }> = [];

  get proposed(): ReadonlyArray<{
    readonly companionId: CompanionId;
    readonly candidate: MemoryCandidate;
  }> {
    return this.#proposed;
  }

  async propose(companionId: CompanionId, candidate: MemoryCandidate): Promise<void> {
    this.#proposed.push({ companionId, candidate });
  }
}

export class NoGoals implements GoalPort {
  async active(): Promise<readonly string[]> {
    return [];
  }
}

export class NoTools implements ToolRegistryPort {
  async available(): Promise<readonly string[]> {
    return [];
  }
}
