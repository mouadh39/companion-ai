import type { Clock, CompanionId, TurnId, UserId } from '@nexa/shared';
import type {
  CognitiveContext,
  ContextBudget,
  ContextSection,
  ConversationTurn,
  Perception,
  RetrievedMemory,
  SectionOmission,
} from '@nexa/models';
import { defaultBudget } from '@nexa/models';
import type { ContextPorts } from './ports.js';

/**
 * Assembles the single input to deliberation.
 *
 * This is the **only** stage of the turn permitted to perform I/O, and that
 * concentration is deliberate. It gives one place to enforce the token budget,
 * one place to parallelise, one place to apply timeouts — and it is what allows
 * the next stage to be a pure function.
 *
 * Every port is queried concurrently because they are independent, and every
 * one is individually timed out because a turn must degrade rather than fail:
 * a slow world model costs a context section, never the answer.
 */

export interface AssemblyRequest {
  readonly turnId: TurnId;
  readonly companionId: CompanionId;
  readonly userId: UserId;
  readonly perception: Perception;
}

export interface AssemblerOptions {
  /** Per-port ceiling. Exceeding it drops that section, never the turn. */
  readonly portTimeoutMs: number;
  /** Working-memory turns to consider before budgeting. */
  readonly workingMemoryLimit: number;
  /** Retrieved memories to request before budgeting. */
  readonly retrievalLimit: number;
  readonly totalTokenLimit: number;
}

export const defaultAssemblerOptions: AssemblerOptions = {
  portTimeoutMs: 150,
  workingMemoryLimit: 20,
  retrievalLimit: 12,
  totalTokenLimit: 12_000,
};

/**
 * Resolves a port call, or yields an omission reason instead of rejecting.
 *
 * The timeout is per-port rather than per-assembly so one slow dependency
 * cannot consume the whole budget and starve the ports queried alongside it.
 */
const withTimeout = async <T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<{ ok: true; value: T } | { ok: false; reason: 'port_timeout' | 'port_error' }> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('timeout'));
      }, timeoutMs);
    });
    const value = await Promise.race([work, timeout]);
    return { ok: true, value };
  } catch (error) {
    const timedOut = error instanceof Error && error.message === 'timeout';
    return { ok: false, reason: timedOut ? 'port_timeout' : 'port_error' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // A rejected port promise that nobody awaits becomes an unhandled rejection
    // and, under Node's default policy, takes the process down.
    void work.catch(() => undefined);
  }
};

export class ContextAssembler {
  readonly #ports: ContextPorts;
  readonly #clock: Clock;
  readonly #options: AssemblerOptions;

  constructor(ports: ContextPorts, clock: Clock, options = defaultAssemblerOptions) {
    this.#ports = ports;
    this.#clock = clock;
    this.#options = options;
  }

  async assemble(request: AssemblyRequest): Promise<CognitiveContext> {
    const { companionId, userId, turnId, perception } = request;
    const { portTimeoutMs } = this.#options;

    const goalsResult = await withTimeout(
      this.#ports.goals.active(companionId),
      portTimeoutMs,
    );
    const goals = goalsResult.ok ? goalsResult.value : [];

    // Queried together because they are independent of one another. Retrieval
    // is the slowest of these (vector search) and therefore sets the floor for
    // assembly latency, which is why the parallelism matters.
    const [identityResult, personalityResult, workingResult, memoriesResult, toolsResult] =
      await Promise.all([
        withTimeout(this.#ports.identity.load(companionId), portTimeoutMs),
        withTimeout(this.#ports.personality.load(companionId), portTimeoutMs),
        withTimeout(
          this.#ports.workingMemory.recent(companionId, this.#options.workingMemoryLimit),
          portTimeoutMs,
        ),
        withTimeout(
          this.#ports.memoryRetrieval.retrieve({
            companionId,
            userId,
            perception,
            goals,
            maxResults: this.#options.retrievalLimit,
          }),
          portTimeoutMs,
        ),
        withTimeout(this.#ports.tools.available(companionId), portTimeoutMs),
      ]);

    const omissions: SectionOmission[] = [];
    const spent: Partial<Record<ContextSection, number>> = {};

    // Identity and personality are the two sections without which the companion
    // is not itself, so a failure here is fatal to the turn rather than
    // degradable. Everything else is optional by construction.
    if (!identityResult.ok) {
      throw new Error(`Identity is unavailable (${identityResult.reason}); cannot assemble context.`);
    }
    if (!personalityResult.ok) {
      throw new Error(
        `Personality is unavailable (${personalityResult.reason}); cannot assemble context.`,
      );
    }

    const identity = identityResult.value;
    const personality = personalityResult.value;

    const budgetTemplate = defaultBudget(this.#options.totalTokenLimit);
    const limitFor = (section: ContextSection): number =>
      budgetTemplate.sectionLimits[section] ?? 0;

    spent.identity = this.#estimate(identity.selfDescription + identity.coreValues.join(' '));
    spent.personality = 60; // Fixed-shape numeric block; not text-dependent.

    if (!goalsResult.ok) {
      omissions.push({ section: 'goals', reason: goalsResult.reason });
    } else if (goals.length === 0) {
      omissions.push({ section: 'goals', reason: 'empty' });
    } else {
      spent.goals = this.#estimate(goals.join('\n'));
    }

    const workingMemory = this.#fitWorkingMemory(
      workingResult.ok ? workingResult.value : [],
      limitFor('working_memory'),
      spent,
      omissions,
      workingResult.ok ? null : workingResult.reason,
    );

    const retrievedMemories = this.#fitMemories(
      memoriesResult.ok ? memoriesResult.value : [],
      limitFor('retrieved_memories'),
      spent,
      omissions,
      memoriesResult.ok ? null : memoriesResult.reason,
    );

    const availableTools = toolsResult.ok ? toolsResult.value : [];
    if (!toolsResult.ok) {
      omissions.push({ section: 'tools', reason: toolsResult.reason });
    } else if (availableTools.length === 0) {
      omissions.push({ section: 'tools', reason: 'empty' });
    } else {
      spent.tools = this.#estimate(availableTools.join('\n'));
    }

    const budget: ContextBudget = {
      totalLimit: budgetTemplate.totalLimit,
      sectionLimits: budgetTemplate.sectionLimits,
      spent,
      omissions,
    };

    return {
      turnId,
      companionId,
      userId,
      at: this.#clock.nowIso(),
      perception,
      identity,
      personality,
      workingMemory,
      retrievedMemories,
      goals,
      availableTools,
      budget,
    };
  }

  #estimate(text: string): number {
    return this.#ports.tokens.estimate(text);
  }

  /**
   * Keeps the most recent turns that fit.
   *
   * Newest-first because in a conversation the last exchange is almost always
   * the most load-bearing; truncating from the old end preserves coherence,
   * truncating from the new end destroys it.
   */
  #fitWorkingMemory(
    turns: readonly ConversationTurn[],
    limit: number,
    spent: Partial<Record<ContextSection, number>>,
    omissions: SectionOmission[],
    failure: 'port_timeout' | 'port_error' | null,
  ): readonly ConversationTurn[] {
    if (failure !== null) {
      omissions.push({ section: 'working_memory', reason: failure });
      return [];
    }
    if (turns.length === 0) {
      omissions.push({ section: 'working_memory', reason: 'empty' });
      return [];
    }

    const kept: ConversationTurn[] = [];
    let used = 0;

    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (turn === undefined) continue;
      const cost = this.#estimate(turn.content);
      if (used + cost > limit) {
        omissions.push({ section: 'working_memory', reason: 'budget_exceeded' });
        break;
      }
      used += cost;
      kept.unshift(turn);
    }

    spent.working_memory = used;
    return kept;
  }

  /**
   * Keeps the highest-scoring memories that fit.
   *
   * Retrieval has already ranked them, so this walks in order and stops — it
   * never re-ranks. Two independent rankings of the same set is how a system
   * ends up unable to explain why a memory surfaced.
   */
  #fitMemories(
    memories: readonly RetrievedMemory[],
    limit: number,
    spent: Partial<Record<ContextSection, number>>,
    omissions: SectionOmission[],
    failure: 'port_timeout' | 'port_error' | null,
  ): readonly RetrievedMemory[] {
    if (failure !== null) {
      omissions.push({ section: 'retrieved_memories', reason: failure });
      return [];
    }
    if (memories.length === 0) {
      omissions.push({ section: 'retrieved_memories', reason: 'empty' });
      return [];
    }

    const kept: RetrievedMemory[] = [];
    let used = 0;

    for (const retrieved of memories) {
      const cost = this.#estimate(retrieved.memory.content);
      if (used + cost > limit) {
        omissions.push({ section: 'retrieved_memories', reason: 'budget_exceeded' });
        break;
      }
      used += cost;
      kept.push(retrieved);
    }

    spent.retrieved_memories = used;
    return kept;
  }
}
