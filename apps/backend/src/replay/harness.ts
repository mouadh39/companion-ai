import { FixedClock, isOk } from '@nexa/shared';
import type { ConversationPlan, PerceptionOutcome, RetrievalOutcome } from '@nexa/models';
import { ScriptedLanguageModel } from '@nexa/providers';
import type { AppConfig } from '../config.js';
import { compose, type Application, type CompositionOverrides } from '../composition.js';
import { countingIds } from '../adapters/stores.js';

/**
 * Replaying a conversation and comparing what the architecture concluded.
 *
 * The Phase A review asked for this and gave the reason: every engine is pure,
 * so a harness that re-runs recorded input and diffs the output is unusually
 * cheap to build and is the only responsible way to tune the ~40 thresholds
 * scattered across nine engines. Hand-tuning them against production traffic
 * without one is how a system becomes superstitious.
 *
 * ## What it proves, and what it cannot
 *
 * It proves that the *cognitive* outputs — perception, retrieval, planning,
 * formation, insights, relationship stage — are a deterministic function of the
 * conversation. It deliberately does **not** assert on generated language: the
 * model is the one component that was never claimed to be deterministic, so the
 * harness runs a scripted one and compares everything upstream of it.
 *
 * ## Why it needs no new machinery
 *
 * Nothing here reaches inside an engine. Time comes from a `FixedClock`,
 * identifiers from a counting `IdSource`, language from `ScriptedLanguageModel`
 * — all three are seams that already existed, because every engine already
 * refuses to read a clock, mint an id, or call a model. The harness is the
 * payoff for those constraints rather than a new capability.
 *
 * It is deliberately free of Unity, HTTP and Fastify: it drives `CognitiveTurn`
 * directly, so a recorded conversation can be replayed anywhere the packages
 * build.
 */

/** One user message, as it was said. */
export interface RecordedTurn {
  readonly text: string;
  /** Milliseconds after the conversation's start. Replaces a wall clock. */
  readonly atOffsetMs?: number;
}

/** A conversation, as it happened. The unit the harness replays. */
export interface RecordedConversation {
  readonly companionId: string;
  readonly userId: string;
  /** Where the fixed clock starts. Every engine reads its instant from here. */
  readonly startedAt: string;
  readonly turns: readonly RecordedTurn[];
}

/**
 * What one replayed turn concluded.
 *
 * Cognitive artefacts only. The response text is excluded on purpose — see the
 * note above about what determinism was ever claimed for.
 */
export interface ReplayedTurn {
  readonly text: string;
  readonly perception: PerceptionOutcome | null;
  readonly retrieval: RetrievalOutcome | null;
  readonly plan: ConversationPlan | null;
  readonly decisionKind: string;
  readonly decisionConfidence: number;
  readonly hintUsed: boolean;
  readonly degraded: boolean;
}

/** Everything a replay produced, including the state it left behind. */
export interface ReplayResult {
  readonly turns: readonly ReplayedTurn[];
  readonly memoryCount: number;
  readonly insightStatements: readonly string[];
  readonly relationshipStage: string;
  readonly formationOutcomes: readonly string[];
  readonly consolidationPasses: number;
}

export interface ReplayOptions {
  /** Substitutes anything the default composition would supply. */
  readonly overrides?: Omit<CompositionOverrides, 'clock' | 'ids'>;
  readonly config?: Partial<AppConfig>;
}

const baseConfig: AppConfig = {
  port: 0,
  host: '127.0.0.1',
  provider: 'scripted',
  modelId: 'scripted',
  anthropicApiKey: null,
  logLevel: 'silent',
} as unknown as AppConfig;

/**
 * Replays a conversation through the real architecture.
 *
 * Composes a fresh application per run, so two replays share no state whatever.
 * A harness that reused stores would be measuring the second run against a
 * world the first one had already changed — which is exactly the class of bug it
 * exists to catch.
 */
export const replay = async (
  conversation: RecordedConversation,
  options: ReplayOptions = {},
): Promise<ReplayResult> => {
  const clock = new FixedClock(Date.parse(conversation.startedAt));

  const app: Application = compose(
    { ...baseConfig, ...options.config },
    {
      languageModel: new ScriptedLanguageModel(),
      ...options.overrides,
      clock,
      // Counting identifiers, so even the stored ids are reproducible. Ids are
      // storage identity rather than cognition, but a harness whose output
      // differed run to run in *any* field is one nobody diffs twice.
      ids: countingIds('replay'),
    },
  );

  const replayed: ReplayedTurn[] = [];
  let previousOffset = 0;

  try {
    for (const recorded of conversation.turns) {
      const offset = recorded.atOffsetMs ?? previousOffset;
      if (offset > previousOffset) clock.advance(offset - previousOffset);
      previousOffset = offset;

      const outcome = await app.turn.run({
        companionId: conversation.companionId as never,
        userId: conversation.userId as never,
        text: recorded.text,
        source: 'user',
      });

      // Read before the bus releases it. The scratchpad is closed by
      // consolidation, which runs on a completed turn.
      const turnId = isOk(outcome) ? outcome.value.turnId : outcome.error.turnId;
      const facts = app.cognition.scratchpad.read(turnId);

      replayed.push({
        text: recorded.text,
        perception: facts?.perception ?? null,
        retrieval: facts?.retrieval ?? null,
        plan: facts?.plan ?? null,
        decisionKind: isOk(outcome) ? outcome.value.decision.kind : 'failed',
        decisionConfidence: isOk(outcome) ? outcome.value.decision.confidence : 0,
        hintUsed: facts?.plan != null,
        degraded: isOk(outcome) ? outcome.value.degraded : true,
      });

      // Let the bus deliver `turn.completed` before the next turn starts, so
      // reflection and relationship progression are part of what is replayed
      // rather than a race against it.
      await settle();
    }

    return {
      turns: replayed,
      memoryCount: (
        await app.cognition.memories.all(
          conversation.companionId as never,
          conversation.userId as never,
        )
      ).length,
      insightStatements: (
        await app.cognition.insights.all(
          conversation.companionId as never,
          conversation.userId as never,
        )
      ).map((insight) => insight.statement),
      relationshipStage: (
        await app.cognition.relationships.current(
          conversation.companionId as never,
          conversation.userId as never,
          conversation.startedAt as never,
        )
      ).type,
      formationOutcomes: app.cognition.formation.decisions.map((entry) => entry.outcome),
      consolidationPasses: app.cognition.consolidation.passes.length,
    };
  } finally {
    await app.shutdown();
  }
};

/**
 * What differs between two replays.
 *
 * Field paths rather than a boolean, because "they differ" is not a finding.
 * When a tuning change moves one threshold, the useful output is which turn and
 * which artefact moved — and a diff that says only `false` sends someone to read
 * two JSON blobs by eye.
 */
export const diff = (left: ReplayResult, right: ReplayResult): readonly string[] => {
  const differences: string[] = [];

  const compare = (path: string, a: unknown, b: unknown): void => {
    if (JSON.stringify(a) !== JSON.stringify(b)) differences.push(path);
  };

  if (left.turns.length !== right.turns.length) {
    differences.push(`turns.length: ${left.turns.length} vs ${right.turns.length}`);
  }

  const shared = Math.min(left.turns.length, right.turns.length);
  for (let index = 0; index < shared; index++) {
    const a = left.turns[index];
    const b = right.turns[index];
    if (a === undefined || b === undefined) continue;

    compare(`turns[${index}].perception`, a.perception, b.perception);
    compare(`turns[${index}].retrieval`, a.retrieval, b.retrieval);
    compare(`turns[${index}].plan`, a.plan, b.plan);
    compare(`turns[${index}].decisionKind`, a.decisionKind, b.decisionKind);
    compare(`turns[${index}].decisionConfidence`, a.decisionConfidence, b.decisionConfidence);
    compare(`turns[${index}].degraded`, a.degraded, b.degraded);
  }

  compare('memoryCount', left.memoryCount, right.memoryCount);
  compare('insightStatements', left.insightStatements, right.insightStatements);
  compare('relationshipStage', left.relationshipStage, right.relationshipStage);
  compare('formationOutcomes', left.formationOutcomes, right.formationOutcomes);

  return differences;
};

/**
 * Lets the in-process bus drain.
 *
 * The bus deliberately does not await handlers — publishers must never block on
 * them — so a replay that moved straight to the next turn would be racing
 * consolidation. Two macrotask hops is enough for a synchronous handler
 * scheduled off a resolved promise, which is what `InProcessEventBus` does.
 */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
