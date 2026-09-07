import type { Clock, CompanionId, TurnId, UserId } from '@nexa/shared';
import type {
  ClientCapabilities,
  CognitiveContext,
  ContextBudget,
  ContextSection,
  ConversationTurn,
  DecisionHint,
  EmotionState,
  ExpressionProfile,
  Goal,
  IdentityProfile,
  OmissionReason,
  Perception,
  PersonalityProfile,
  TaskPlan,
  PortOutcome,
  Relationship,
  RetrievedMemory,
  SectionOmission,
  Tool,
  WorldSnapshot,
  BodyState,
  SelfState,
} from '@nexa/models';
import { defaultBudget, timestamp } from '@nexa/models';
import type { PortCall, PortOptions } from './execution/index.js';
import { omissionReasonFor, toRecord } from './execution/index.js';
import type { AnyContribution, ContributionWaves, ContributorKey } from './context/index.js';
import { contributorKey, planWaves, runContributions } from './context/index.js';
import { ContextUnavailableError, TurnAbortedError } from './errors.js';
import type { ContextPorts } from './ports.js';

/**
 * Assembles the single input to deliberation.
 *
 * This is the **only** stage of the turn permitted to perform I/O, and that
 * concentration is deliberate. It gives one place to enforce the token budget,
 * one place to schedule, one place to apply deadlines — and it is what allows
 * the next stage to be a pure function.
 *
 * Contributions are declared with their dependencies and sorted into waves, so
 * everything independent runs concurrently and only genuine dependents wait.
 * The previous shape — fetch goals alone, then everything else in one block —
 * encoded the goals→retrieval edge in the *order of two statements*, which is
 * fine for one edge and a trap at six: a contributor added to the wrong phase
 * reads an empty dependency and nothing fails.
 *
 * Every contributor is budgeted individually and degrades on its own, because a
 * turn must degrade rather than fail: a slow world model costs a context
 * section, never the answer.
 */

export interface AssemblyRequest {
  readonly turnId: TurnId;
  readonly companionId: CompanionId;
  readonly userId: UserId;
  readonly perception: Perception;
  /**
   * What the connected client declared it can execute, or null.
   *
   * Passed straight onto the context rather than fetched by a contributor:
   * this is a fact handed in with the request, not something any port knows,
   * so it costs nothing to carry and never appears in `budget.omissions`.
   */
  readonly clientCapabilities: ClientCapabilities | null;
  /** The turn's remaining budget and cancellation signal. */
  readonly options: PortOptions;
}

export interface AssemblerOptions {
  /**
   * Ceiling for the whole assembly stage.
   *
   * Subdivided from the turn's deadline, so it shortens automatically when
   * earlier stages ran long. This is the ceiling that did not exist before:
   * with only a per-port timeout, assembly could spend it once per port and
   * still return nothing.
   */
  readonly assemblyBudgetMs: number;
  /** Per-contributor ceiling. Exceeding it drops that section, never the turn. */
  readonly portTimeoutMs: number;
  /**
   * Ceiling for the decision advisor specifically.
   *
   * Larger than the rest because the advisor may be a model call, and smaller
   * than it would like because a hint that arrives late is worth nothing — the
   * turn proceeds on its rules and the answer is no worse for it.
   */
  readonly advisorTimeoutMs: number;
  /** Working-memory turns to consider before budgeting. */
  readonly workingMemoryLimit: number;
  /** Retrieved memories to request before budgeting. */
  readonly retrievalLimit: number;
  /** World objects to request before budgeting. */
  readonly worldObjectLimit: number;
  readonly totalTokenLimit: number;
}

export const defaultAssemblerOptions: AssemblerOptions = {
  assemblyBudgetMs: 400,
  portTimeoutMs: 150,
  advisorTimeoutMs: 300,
  workingMemoryLimit: 20,
  retrievalLimit: 12,
  worldObjectLimit: 16,
  totalTokenLimit: 12_000,
};

/**
 * The assembled context plus the calls that produced it.
 *
 * The calls travel separately rather than on the context, because they are a
 * measurement of assembly and the context must hold only what may legitimately
 * change the decision. They go straight into the turn record.
 */
export interface AssemblyOutcome {
  readonly context: CognitiveContext;
  readonly portCalls: readonly PortCall<unknown>[];
}

/**
 * The standard contributor keys.
 *
 * Exported so a capability package can declare a dependency on one without
 * importing the assembler that happens to build it — which is what will let
 * Planning declare `dependsOn: [GOALS, WORLD]` from its own package.
 */
export const IDENTITY = contributorKey<IdentityProfile>('identity', 'identity');
export const PERSONALITY = contributorKey<PersonalityProfile>('personality', 'personality');
export const GOALS = contributorKey<readonly Goal[]>('goals', 'goals');
export const WORKING_MEMORY = contributorKey<readonly ConversationTurn[]>(
  'working_memory',
  'working_memory',
);
export const RETRIEVED_MEMORIES = contributorKey<readonly RetrievedMemory[]>(
  'retrieved_memories',
  'retrieved_memories',
);
export const TOOLS = contributorKey<readonly Tool[]>('tools', 'tools');
export const WORLD = contributorKey<WorldSnapshot>('world', 'world');
export const BODY = contributorKey<BodyState>('body', 'body');
export const SELF = contributorKey<SelfState>('self', 'self');
export const EMOTION = contributorKey<EmotionState | null>('emotion', 'emotion');
export const RELATIONSHIP = contributorKey<Relationship | null>(
  'relationship',
  'relationship',
);
/**
 * The plan is read into the `goals` section's budget rather than its own.
 *
 * A plan is the decomposition of a goal, and giving it an independent
 * allocation would let the two compete — a companion could end up citing the
 * steps of a goal that itself got dropped.
 */
export const PLAN = contributorKey<TaskPlan | null>('plan', 'goals');
/**
 * The advisor consumes the rest of the context, so it necessarily runs last.
 *
 * Keyed to `identity` for budgeting because a hint is a handful of tokens and
 * does not warrant a section of its own — and unlike every other contributor,
 * its output shapes the *decision* rather than the prompt.
 */
export const DECISION_HINT = contributorKey<DecisionHint | null>(
  'decision_hint',
  'identity',
);
/**
 * How to communicate this turn.
 *
 * Budgeted against `personality`, because it is that section resolved for the
 * moment rather than an additional one — and giving it an allocation of its own
 * would let the traits and their resolution compete for room in the prompt.
 *
 * Depends on personality and working memory, so it lands in a later wave by
 * construction rather than by being remembered to go last.
 */
export const EXPRESSION = contributorKey<ExpressionProfile>('expression', 'personality');

export class ContextAssembler {
  readonly #ports: ContextPorts;
  readonly #clock: Clock;
  readonly #options: AssemblerOptions;
  readonly #waves: ContributionWaves;

  constructor(ports: ContextPorts, clock: Clock, options = defaultAssemblerOptions) {
    this.#ports = ports;
    this.#clock = clock;
    this.#options = options;
    // Planned once, at construction. A cycle or a missing dependency is a boot
    // failure with a named cause rather than a turn that quietly reads nothing.
    this.#waves = planWaves(this.#contributions());
  }

  /** The declared graph, for diagnostics and tests. */
  get waves(): ContributionWaves {
    return this.#waves;
  }

  #contributions(): readonly AnyContribution[] {
    const budgetMs = this.#options.portTimeoutMs;
    const ports = this.#ports;

    // Composed conditionally: a capability that is not wired in contributes
    // nothing rather than contributing a failure. Adding one later is a change
    // to the composition root, never to this method's shape.
    const optional: AnyContribution[] = [];

    const world = ports.world;
    if (world !== undefined) {
      optional.push({
        key: WORLD,
        dependsOn: [],
        required: false,
        budgetMs,
        contribute: (view, options) =>
          world.snapshot(
            {
              companionId: view.companionId,
              entities: view.perception.entities,
              maxObjects: this.#options.worldObjectLimit,
            },
            options,
          ),
      });
    }

    const embodiment = ports.embodiment;
    if (embodiment !== undefined) {
      optional.push({
        key: BODY,
        dependsOn: [],
        required: false,
        budgetMs,
        contribute: (view, options) => embodiment.state(view.companionId, options),
      });
    }

    const emotion = ports.emotion;
    if (emotion !== undefined) {
      optional.push({
        key: EMOTION,
        dependsOn: [],
        required: false,
        budgetMs,
        contribute: (view, options) =>
          emotion.current(view.companionId, view.userId, options),
      });
    }

    const relationship = ports.relationship;
    if (relationship !== undefined) {
      optional.push({
        key: RELATIONSHIP,
        dependsOn: [],
        required: false,
        budgetMs,
        contribute: (view, options) =>
          relationship.current(view.companionId, view.userId, options),
      });
    }

    const plan = ports.plan;
    if (plan !== undefined) {
      optional.push({
        key: PLAN,
        dependsOn: [],
        required: false,
        budgetMs,
        contribute: (view, options) => plan.current(view.companionId, options),
      });
    }

    const expression = ports.expression;
    if (expression !== undefined) {
      optional.push({
        key: EXPRESSION,
        // Personality is the disposition it resolves; working memory is the
        // conversation depth it reads. Relationship is added only when that
        // capability is composed, so the graph never declares an edge to a
        // contributor that will not run.
        dependsOn: [
          PERSONALITY,
          WORKING_MEMORY,
          ...(relationship !== undefined ? [RELATIONSHIP] : []),
        ],
        required: false,
        budgetMs,
        contribute: (view, options) => {
          const personality = view.get(PERSONALITY);
          // Personality is a required contributor, so a missing value here means
          // assembly is already failing and this contribution is moot. Throwing
          // records it as a port error rather than composing an expression from
          // a disposition that does not exist.
          if (personality === undefined) {
            throw new ContextUnavailableError('personality', 'not_attempted', []);
          }

          return expression.compose(
            {
              personality,
              perception: view.perception,
              relationship: view.get(RELATIONSHIP) ?? null,
              recentTurns: view.get(WORKING_MEMORY) ?? [],
            },
            options,
          );
        },
      });
    }

    const advisor = ports.decisionAdvisor;
    if (advisor !== undefined) {
      optional.push({
        key: DECISION_HINT,
        // Consumes the rest of the context, so it lands in the final wave by
        // construction rather than by being remembered to go last.
        dependsOn: [
          GOALS,
          WORKING_MEMORY,
          RETRIEVED_MEMORIES,
          ...(emotion !== undefined ? [EMOTION] : []),
          ...(world !== undefined ? [WORLD] : []),
        ],
        required: false,
        budgetMs: this.#options.advisorTimeoutMs,
        contribute: (view, options) =>
          advisor.advise(
            {
              perception: view.perception,
              workingMemory: view.get(WORKING_MEMORY) ?? [],
              retrievedMemories: view.get(RETRIEVED_MEMORIES) ?? [],
              goals: view.get(GOALS) ?? [],
              emotion: view.get(EMOTION) ?? null,
              world: view.get(WORLD) ?? null,
            },
            options,
          ),
      });
    }

    const selfModel = ports.selfModel;
    if (selfModel !== undefined) {
      optional.push({
        key: SELF,
        // Identity is required, so it is always present; the body is optional
        // and may legitimately be missing. Declaring both edges is what puts
        // this in a wave after them rather than relying on registration order.
        dependsOn: [IDENTITY, ...(ports.embodiment !== undefined ? [BODY] : [])],
        required: false,
        // Small on purpose: the reference implementation performs no I/O. A
        // self model that needed a full port budget would be one that had
        // started fetching rather than joining.
        budgetMs,
        contribute: async (view, options) => {
          const identity = view.get(IDENTITY);
          if (identity === undefined) {
            // Unreachable while identity is required — a missing one fails the
            // turn before this wave runs — but resolving a self with no
            // identity would produce a companion describing nobody.
            throw new Error('The self model ran without an identity.');
          }

          return selfModel.resolve(
            {
              companionId: view.companionId,
              identity,
              body: view.get(BODY) ?? null,
              clientCapabilities: view.clientCapabilities,
            },
            options,
          );
        },
      });
    }

    return [
      ...optional,
      {
        key: IDENTITY,
        dependsOn: [],
        required: true,
        budgetMs,
        contribute: (view, options) => this.#ports.identity.load(view.companionId, options),
      },
      {
        key: PERSONALITY,
        dependsOn: [],
        required: true,
        budgetMs,
        contribute: (view, options) =>
          this.#ports.personality.load(view.companionId, options),
      },
      {
        key: GOALS,
        dependsOn: [],
        required: false,
        budgetMs,
        contribute: (view, options) => this.#ports.goals.active(view.companionId, options),
      },
      {
        key: WORKING_MEMORY,
        dependsOn: [],
        required: false,
        budgetMs,
        contribute: (view, options) =>
          this.#ports.workingMemory.recent(
            view.companionId,
            view.userId,
            this.#options.workingMemoryLimit,
            options,
          ),
      },
      {
        key: TOOLS,
        dependsOn: [],
        required: false,
        budgetMs,
        contribute: (view, options) => this.#ports.tools.available(view.companionId, options),
      },
      {
        key: RETRIEVED_MEMORIES,
        // The one real edge today: a memory's relevance depends on what the
        // companion is currently trying to do. Declared rather than encoded in
        // statement order, so the next engine that needs goals does not have to
        // discover this by reading the scheduler.
        dependsOn: [GOALS],
        required: false,
        budgetMs,
        contribute: (view, options) =>
          this.#ports.memoryRetrieval.retrieve(
            {
              companionId: view.companionId,
              userId: view.userId,
              perception: view.perception,
              // Absent goals narrow retrieval rather than failing it. The
              // outcome is readable via `view.outcomeOf(GOALS)` for a
              // contributor that needs to behave differently when the
              // dependency timed out rather than was simply empty.
              goals: view.get(GOALS) ?? [],
              maxResults: this.#options.retrievalLimit,
            },
            options,
          ),
      },
    ] satisfies readonly AnyContribution[];
  }

  async assemble(request: AssemblyRequest): Promise<AssemblyOutcome> {
    const { companionId, userId, turnId, perception, clientCapabilities } = request;

    // The stage budget is carved from what the turn has left rather than being
    // a constant, so a slow perception stage shortens assembly instead of
    // silently pushing the whole turn past the caller's deadline.
    const scoped: PortOptions = {
      signal: request.options.signal,
      deadline: request.options.deadline.subdivide(this.#options.assemblyBudgetMs),
      turnId,
    };

    const run = await runContributions(
      this.#waves,
      { turnId, companionId, userId, perception, clientCapabilities },
      scoped,
    );

    // Cancellation is not degradation. If the caller has gone, there is no
    // thinner answer worth assembling, so this ends the turn rather than
    // recording an omission nobody will read.
    if (run.aborted) throw new TurnAbortedError('context_assembly');

    // Identity and personality are the two sections without which the companion
    // is not itself, so a failure there is fatal to the turn rather than
    // degradable. Everything else is optional by construction.
    if (run.failure !== null) {
      throw new ContextUnavailableError(
        run.failure.id,
        run.failure.outcome,
        run.calls.map(toRecord),
      );
    }

    const identity = run.values.get(IDENTITY.id) as IdentityProfile;
    const personality = run.values.get(PERSONALITY.id) as PersonalityProfile;
    const goals = (run.values.get(GOALS.id) as readonly Goal[] | undefined) ?? [];
    const workingTurns =
      (run.values.get(WORKING_MEMORY.id) as readonly ConversationTurn[] | undefined) ?? [];
    const memories =
      (run.values.get(RETRIEVED_MEMORIES.id) as readonly RetrievedMemory[] | undefined) ?? [];
    const availableTools = (run.values.get(TOOLS.id) as readonly Tool[] | undefined) ?? [];
    const world = (run.values.get(WORLD.id) as WorldSnapshot | undefined) ?? null;
    const body = (run.values.get(BODY.id) as BodyState | undefined) ?? null;
    const self = (run.values.get(SELF.id) as SelfState | undefined) ?? null;
    const emotion = (run.values.get(EMOTION.id) as EmotionState | null | undefined) ?? null;
    const relationship =
      (run.values.get(RELATIONSHIP.id) as Relationship | null | undefined) ?? null;
    const plan = (run.values.get(PLAN.id) as TaskPlan | null | undefined) ?? null;
    const hint = (run.values.get(DECISION_HINT.id) as DecisionHint | null | undefined) ?? null;
    const expression =
      (run.values.get(EXPRESSION.id) as ExpressionProfile | undefined) ?? null;

    const omissions: SectionOmission[] = [];
    const spent: Partial<Record<ContextSection, number>> = {};

    const budgetTemplate = defaultBudget(this.#options.totalTokenLimit);
    const limitFor = (section: ContextSection): number =>
      budgetTemplate.sectionLimits[section] ?? 0;

    // Estimated over the text that actually reaches the prompt — the profile's
    // headline fields and its value statements — not the whole record. Most of
    // an `IdentityProfile` (uncertainty bands, boundary reasons, invariants)
    // informs behaviour without ever being rendered.
    spent.identity = this.#estimate(
      [
        identity.name,
        identity.role,
        identity.mission,
        ...identity.values.map((value) => value.statement),
      ].join(' '),
    );
    spent.personality = 60; // Fixed-shape numeric block; not text-dependent.

    const failureOf = (key: ContributorKey<unknown>): OmissionReason | null =>
      reasonFor(run.outcomes.get(key.id));

    const goalsFailure = failureOf(GOALS);
    if (goalsFailure !== null) {
      omissions.push({ section: 'goals', reason: goalsFailure });
    } else if (goals.length === 0) {
      omissions.push({ section: 'goals', reason: 'empty' });
    } else {
      // Estimated over the text that actually reaches the prompt. Joining the
      // objects themselves yields "[object Object]" — a constant 15 characters
      // regardless of the real content, which would make the budget wrong in
      // whichever direction the goals happened to be longer or shorter.
      spent.goals = this.#estimate(goals.map((goal) => goal.description).join('\n'));
    }

    const workingMemory = this.#fitWorkingMemory(
      workingTurns,
      limitFor('working_memory'),
      spent,
      omissions,
      failureOf(WORKING_MEMORY),
    );

    const retrievedMemories = this.#fitMemories(
      memories,
      limitFor('retrieved_memories'),
      spent,
      omissions,
      failureOf(RETRIEVED_MEMORIES),
    );

    // The optional sections report an omission only when a *composed* capability
    // failed. `run.outcomes` has no entry at all for a port that was never wired
    // in, and `attempted` is what keeps those two cases apart — absent capability
    // is not degradation.
    const attempted = (key: ContributorKey<unknown>): boolean =>
      run.outcomes.has(key.id);

    if (attempted(WORLD)) {
      const failure = failureOf(WORLD);
      if (failure !== null) {
        omissions.push({ section: 'world', reason: failure });
      } else if (world === null || world.objects.length === 0) {
        omissions.push({ section: 'world', reason: 'empty' });
      } else {
        spent.world = this.#estimate(world.objects.map((object) => object.label).join('\n'));
      }
    }

    if (attempted(BODY)) {
      const failure = failureOf(BODY);
      if (failure !== null) {
        omissions.push({ section: 'body', reason: failure });
      } else if (body === null) {
        omissions.push({ section: 'body', reason: 'empty' });
      } else {
        // Estimated from the outcomes alone. The schema half of the section is
        // rendered from the client's declaration rather than from this value,
        // so charging it here would bill the body for tokens it did not cause.
        spent.body = this.#estimate(
          body.recentOutcomes.map((outcome) => outcome.detail ?? outcome.status).join('\n'),
        );
      }
    }

    if (attempted(SELF)) {
      const failure = failureOf(SELF);
      if (failure !== null) {
        omissions.push({ section: 'self', reason: failure });
      } else if (self === null) {
        omissions.push({ section: 'self', reason: 'empty' });
      } else {
        // Estimated from the resolutions alone. The identity half is billed to
        // the identity section, which already carries it.
        spent.self = this.#estimate(
          self.capabilities.map((capability) => capability.summary).join('\n'),
        );
      }
    }

    if (attempted(EMOTION)) {
      const failure = failureOf(EMOTION);
      if (failure !== null) {
        omissions.push({ section: 'emotion', reason: failure });
      } else if (emotion === null) {
        omissions.push({ section: 'emotion', reason: 'empty' });
      } else {
        spent.emotion = 40; // Fixed-shape reading; not text-dependent.
      }
    }

    if (attempted(RELATIONSHIP)) {
      const failure = failureOf(RELATIONSHIP);
      if (failure !== null) {
        omissions.push({ section: 'relationship', reason: failure });
      } else if (relationship === null) {
        omissions.push({ section: 'relationship', reason: 'empty' });
      } else {
        spent.relationship = 80;
      }
    }

    if (attempted(PLAN)) {
      const failure = failureOf(PLAN);
      if (failure !== null) {
        omissions.push({ section: 'goals', reason: failure });
      } else if (plan !== null) {
        // Added to the goals allocation rather than replacing it: a plan and the
        // goal it serves both reach the prompt.
        spent.goals =
          (spent.goals ?? 0) +
          this.#estimate(plan.steps.map((step) => step.description).join('\n'));
      }
    }

    const toolsFailure = failureOf(TOOLS);
    if (toolsFailure !== null) {
      omissions.push({ section: 'tools', reason: toolsFailure });
    } else if (availableTools.length === 0) {
      omissions.push({ section: 'tools', reason: 'empty' });
    } else {
      // Names, because names are what the prompt lists. See the note on goals.
      spent.tools = this.#estimate(availableTools.map((tool) => tool.name).join('\n'));
    }

    const budget: ContextBudget = {
      totalLimit: budgetTemplate.totalLimit,
      sectionLimits: budgetTemplate.sectionLimits,
      spent,
      omissions,
    };

    const context: CognitiveContext = {
      turnId,
      companionId,
      userId,
      at: timestamp(this.#clock.nowIso()),
      perception,
      identity,
      personality,
      workingMemory,
      retrievedMemories,
      goals,
      availableTools,
      clientCapabilities,
      // Null when the capability is not composed in, which the port calls in the
      // turn record distinguish from "composed in and returned nothing".
      emotion,
      relationship,
      world,
      body,
      self,
      plan,
      hint,
      // Null when no expression capability is composed in. Not a degradation:
      // generation reads the raw traits instead, exactly as it did before the
      // personality engine existed.
      expression,
      budget,
    };

    return { context, portCalls: run.calls };
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
    failure: OmissionReason | null,
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
    failure: OmissionReason | null,
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

/**
 * The omission reason for an outcome, or null when it succeeded.
 *
 * The `aborted` branch is unreachable — `assemble` ends the turn on an aborted
 * run before reaching here — but the mapping is kept total rather than cast
 * away, so a future caller that skips that check gets a defined answer instead
 * of a crash.
 */
const reasonFor = (outcome: PortOutcome | undefined): OmissionReason | null => {
  if (outcome === undefined) return 'not_attempted';
  if (outcome === 'ok') return null;
  if (outcome === 'aborted') return 'port_error';
  return omissionReasonFor(outcome);
};
