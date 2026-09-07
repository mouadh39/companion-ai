import type { CompanionId, UserId } from '@nexa/shared';
import type { ConversationTurn, Goal, PersonalityProfile, Tool } from '@nexa/models';
import { defaultPersonality } from '@nexa/models';
import type {
  GoalPort,
  PersonalityPort,
  ToolRegistryPort,
  WorkingMemoryPort,
} from '@nexa/core';

/**
 * The stores and the two capabilities that have no engine yet.
 *
 * What used to live here was placeholder *cognition* — retrieval that returned
 * nothing, a memory writer that appended to an array. Those are gone: Phase 1B
 * replaced each with the engine that was built for it, and this file kept only
 * the things that were never intelligence in the first place.
 *
 * `InMemoryPersonality` and `InMemoryWorkingMemory` are stores. `NoGoals` and
 * `NoTools` are honest absences: no goals engine and no tool registry exist yet,
 * and returning empty exercises the real path rather than fabricating one.
 */

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

  /**
   * The isolation boundary, in one place.
   *
   * Keyed on the pair rather than on the companion, because two people talking
   * to the same companion are having two conversations. Keying on the companion
   * alone put one user's turns into another user's prompt.
   *
   * Length-prefixed rather than joined on a bare separator: ids arrive from
   * clients through `trustExternalId` and are not guaranteed to exclude any
   * character, so `a:b` + `c` and `a` + `b:c` would otherwise land in one
   * bucket -- the exact leak this key exists to prevent.
   */
  static #key(companionId: CompanionId, userId: UserId): string {
    return `${companionId.length}:${companionId}:${userId}`;
  }

  async recent(
    companionId: CompanionId,
    userId: UserId,
    limit: number,
  ): Promise<readonly ConversationTurn[]> {
    const turns = this.#turns.get(InMemoryWorkingMemory.#key(companionId, userId)) ?? [];
    return turns.slice(-limit);
  }

  async append(
    companionId: CompanionId,
    userId: UserId,
    turn: ConversationTurn,
  ): Promise<void> {
    const key = InMemoryWorkingMemory.#key(companionId, userId);
    const turns = this.#turns.get(key) ?? [];
    turns.push(turn);

    if (turns.length > this.#maxTurns) {
      turns.splice(0, turns.length - this.#maxTurns);
    }

    this.#turns.set(key, turns);
  }
}

export class NoGoals implements GoalPort {
  async active(): Promise<readonly Goal[]> {
    return [];
  }
}

export class NoTools implements ToolRegistryPort {
  async available(): Promise<readonly Tool[]> {
    return [];
  }
}
