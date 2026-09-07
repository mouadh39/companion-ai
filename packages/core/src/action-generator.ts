import type {
  ActionFailureReason,
  ActionOutcome,
  ActionType,
  BodyState,
  CapabilityResolution,
  CapabilityReason,
  CapabilityStatus,
  SelfState,
  CognitiveContext,
  Decision,
  IdentityProfile,
  InitiativeLevel,
} from '@nexa/models';
import {
  MAX_RECENT_OUTCOMES,
  capabilitiesLackingSkills,
  isDegraded,
  isEmbodiedAction,
  speaksAloud,
  usableSkills,
} from '@nexa/models';
import type { PortOptions } from './execution/index.js';
import type { GenerationOutcome, ToolLoopLimits } from './generation/index.js';
import {
  defaultToolLoopLimits,
  deliver,
  renderActionSchema,
  runToolLoop,
} from './generation/index.js';
import type { TurnSink } from './generation/index.js';
import type { LanguageModelPort, ModelMessage, ToolExecutionPort } from './ports.js';

/**
 * Turns a decision into concrete actions.
 *
 * This is the only stage that produces language, and the only one that calls a
 * model provider. Everything upstream reasons in structured terms; everything
 * downstream ships actions to a client.
 */

/**
 * Builds the system prompt from the assembled context.
 *
 * Never one giant static prompt. Each section is contributed by the part of the
 * system that owns it, in a fixed order — identity first, volatile context last
 * — because prompt caching is a prefix match: the stable prefix must physically
 * precede anything that changes per turn, or nothing caches.
 *
 * Sections that were dropped during assembly are simply absent, and the
 * companion is told when that happened rather than left to fill the gap.
 */
export const buildSystemPrompt = (context: CognitiveContext): string => {
  const parts: string[] = [];
  const embodied = context.clientCapabilities?.actions.includes('move') ?? false;

  parts.push(identitySection(context.identity, embodied));
  parts.push(expressionSection(context));

  if (context.goals.length > 0) {
    parts.push(
      `Active goals you are helping with:\n${context.goals
        .map((goal) => `- ${goal.description}`)
        .join('\n')}`,
    );
  }

  if (context.retrievedMemories.length > 0) {
    const lines = context.retrievedMemories.map(
      (retrieved) =>
        `- [${retrieved.memory.type}, relevance ${retrieved.score.toFixed(2)}] ${retrieved.memory.content}`,
    );
    parts.push(
      [
        'Relevant things you remember about this person. Draw on them naturally; do not recite them:',
        ...lines,
      ].join('\n'),
    );
  }

  if (context.availableTools.length > 0) {
    parts.push(
      `Tools available to you: ${context.availableTools.map((tool) => tool.name).join(', ')}.`,
    );
  }

  // Told, not hidden. A companion that knows its context is incomplete can say
  // so; one that does not will confabulate over the gap.
  if (isDegraded(context.budget)) {
    const dropped = context.budget.omissions
      .filter((omission) => omission.reason !== 'empty')
      .map((omission) => omission.section);
    if (dropped.length > 0) {
      parts.push(
        `Some context was unavailable this turn (${dropped.join(', ')}). If it would have mattered, say so plainly rather than guessing.`,
      );
    }
  }

  // Placed after memory and tools but before the delivery rules: it is context
  // about the companion rather than a constraint on the wording, and the
  // spoken-delivery block below must stay last so it governs the final shape.
  const self = selfSection(context);
  if (self !== null) parts.push(self);

  parts.push(
    [
      'Respond as yourself, in plain prose. Do not narrate your reasoning or describe what you are about to do.',
      'Keep responses focused and brief. Lead with the substance.',
    ].join('\n'),
  );

  // Last, and only when it applies. This shapes the *form* of the answer, not
  // its content or its character, and it is stated after the personality dials
  // deliberately: a listener's patience is a constraint of the medium, and the
  // medium does not negotiate with traits.
  if (speaksAloud(context.clientCapabilities)) parts.push(SPOKEN_DELIVERY);

  return parts.join('\n\n');
};

/**
 * How to answer when the words will be heard rather than read.
 *
 * Written as facts about the situation rather than as a word limit, because a
 * limit gets obeyed by truncation — the model says the same essay and stops
 * mid-sentence — whereas a reason gets obeyed by composition. The distinction
 * showed up in practice: asked to teach Russian, the companion returned a
 * 33-row markdown alphabet table, which is a fine answer to read and roughly
 * three minutes of someone reciting pipe characters to listen to.
 *
 * Nothing here touches personality. Warmth, humour and curiosity are set by the
 * expression layer above and are as available in four sentences as in forty;
 * what this removes is the reference-document shape, not the character writing
 * it.
 */
const SPOKEN_DELIVERY = [
  'This answer will be spoken aloud, not read. Write for the ear.',
  '- Talk the way a person talks: usually one to four sentences. Say the useful thing first.',
  '- No markdown, tables, charts, headings, bullet lists or numbered lists. They cannot be heard — they are read out as punctuation.',
  '- Do not deliver exhaustive or textbook-length explanations unless the person actually asked for one.',
  "- When the honest answer is genuinely large, give the shape of it in a few sentences and offer to go deeper. \"There are thirty-three letters — want me to walk through them a few at a time?\" is a better answer than all thirty-three.",
  'Being brief is not being curt. Stay yourself.',
].join('\n');

/**
 * Who the companion is, from the canonical profile.
 *
 * Rendered from structure rather than from a stored paragraph. The values carry
 * their precedence because that is the part a model most needs and most often
 * gets wrong — told only that it values honesty *and* kindness, it resolves the
 * conflict toward whichever it read last.
 *
 * Permanent limitations are stated and temporary ones are not. A companion
 * hedging about what it cannot do *yet* invites the user to argue with it; the
 * permanent ones are the honest boundary that will still be true tomorrow.
 *
 * `embodied` is the one exception to "permanent means every turn": the
 * catalogue's `no_physical_action` limitation is true for a voice- or
 * text-only session and false for a client that has declared it can execute
 * `move`. The catalogue itself is not touched — it stays correct for every
 * client that has not said otherwise — this only decides what gets rendered
 * for the one that has. What that client may actually do is stated by
 * {@link selfSection} rather than here, so the boundary and the action schema
 * are rendered from one source instead of two that can disagree.
 */
const NO_PHYSICAL_ACTION_LIMITATION_ID = 'no_physical_action';

const identitySection = (identity: IdentityProfile, embodied: boolean): string => {
  const values = identity.values
    .slice()
    .sort((a, b) => a.precedence - b.precedence)
    .map((value) => `${String(value.precedence)}. ${value.label} — ${value.statement}`);

  const permanent = identity.limitations
    .filter((limitation) => limitation.permanent)
    .filter((limitation) => !(embodied && limitation.id === NO_PHYSICAL_ACTION_LIMITATION_ID))
    .map((limitation) => `- ${limitation.summary}`);

  const lines = [
    `You are ${identity.name}. ${identity.role}.`,
    identity.mission,
    '',
    'Your values, numbered by precedence. When two conflict, the lower number wins:',
    ...values,
    '',
    'Things that are true about you and do not change:',
    ...permanent,
  ];

  return lines.join('\n');
};

/**
 * Who the companion is right now, what it can presently do, and what became of
 * the last thing it tried.
 *
 * Replaces the body-only section this grew out of. That one described the rig
 * and nothing else, so a capability the *backend* lacked — recall with no store
 * bound, vision nobody has built — was invisible to the model, and the only
 * component able to answer "can you see?" was the one with no way to know.
 *
 * Rendered from `SelfState`, which is derived from four authorities and
 * writable by none of them. Nothing here restates a fact another section owns:
 * the frozen identity block above still carries values, mission and permanent
 * limitations, and this carries only what is *currently* true.
 *
 * ## Why the states are not collapsed
 *
 * Six kinds of "no" are rendered as six different sentences, because they call
 * for six different things to be said. Flattening them produces a companion
 * that answers "I can't" to a missing camera, an unbuilt feature and a rig
 * without a clip — and, most damagingly, makes *"I cannot do that"*
 * indistinguishable from *"I do not know how to do that yet"*.
 *
 * ## Ordering
 *
 * Facts first, then the action schema, then — outside this function — the
 * spoken-delivery rules, which must stay last so they govern the final shape.
 * The outcomes are rendered in the past tense as received facts, because they
 * are the only sanctioned basis for a claim about what physically happened.
 */
const selfSection = (context: CognitiveContext): string | null => {
  const declared = context.clientCapabilities?.actions ?? [];
  const self = context.self;

  // The schema offers what this body can actually perform, not what the
  // protocol can express. Before any skill has been declared it falls back to
  // the full vocabulary, which is the pre-registry behaviour and the only
  // honest default when nothing has said otherwise.
  const gestures =
    self === null
      ? undefined
      : gestureSkills(self);

  const schema = renderActionSchema(
    declared.filter(isEmbodiedAction),
    ...(gestures === undefined ? [] : [gestures]),
  );

  // Nothing to say: no self model composed and no body to describe.
  if (self === null) {
    if (schema === null) return null;

    // A body that can be driven but never reports. The companion is told that
    // rather than left to assume its instructions landed.
    return [
      schema,
      '',
      'You cannot currently tell whether these actions succeed. Do not claim any physical action worked.',
    ].join('\n');
  }

  const parts: string[] = [
    'What is currently true about you. These are system facts, not guesses, and they are the only thing you may base a claim about yourself on.',
  ];

  parts.push(...capabilityLines(self));

  const body = self.body;
  if (body !== null) {
    parts.push('', ...bodyLines(body));
  }

  // Devices and skills are rendered only when something has actually reported
  // them. Nothing reports either yet, so these stay silent rather than
  // printing an empty heading on every turn.
  if (self.devices.length > 0) {
    parts.push(
      '',
      `Connected: ${self.devices
        .map((device) => `${device.label} (${device.status})`)
        .join(' · ')}`,
    );
  }

  parts.push(...skillLines(self));

  if (schema !== null) parts.push('', schema);

  return parts.join('\n');
};

/**
 * The capability list, grouped by what the companion should say about it.
 *
 * Grouped rather than listed per-capability because the grouping *is* the
 * message: every entry under one heading warrants the same kind of sentence,
 * and a flat list of `id: status` invites the model to invent its own mapping
 * from status to phrasing — differently each turn.
 *
 * Sub-grouped by reason so the explanation is written once rather than after
 * every id. Rendering it per capability made the section three times longer
 * than its budget and read as chanting: *"walk (nothing has told you either
 * way), follow (nothing has told you either way), …"*.
 *
 * Empty groups are omitted. A heading with nothing under it spends tokens to
 * say nothing, on every turn, forever.
 */
const capabilityLines = (self: SelfState): readonly string[] => {
  const lines: string[] = [];

  const group = (status: CapabilityStatus, heading: string, detail: boolean): void => {
    const matching = self.capabilities.filter((capability) => capability.status === status);
    if (matching.length === 0) return;

    if (!detail) {
      lines.push(`${heading} ${matching.map((capability) => label(capability.id)).join(', ')}`);
      return;
    }

    // Distinct reasons, in first-appearance order, so the rendering stays
    // stable turn to turn and keeps its place in the cacheable prefix.
    const reasons: (CapabilityReason | null)[] = [];
    for (const capability of matching) {
      if (!reasons.includes(capability.reason)) reasons.push(capability.reason);
    }

    for (const reason of reasons) {
      const named = matching
        .filter((capability) => capability.reason === reason)
        .map((capability) => label(capability.id))
        .join(', ');

      lines.push(`${headingFor(heading, reason)} ${named} — ${reasonPhrase(reason)}`);
    }
  };

  group('available', 'You can currently:', false);
  group('degraded', 'Partly working, mention the limitation if it matters:', true);
  group('currently_unavailable', 'Not right now:', true);
  group('unsupported', 'This body or client cannot:', true);
  group('unavailable', 'Does not exist yet:', true);
  group('unknown', 'You do not know whether you can:', true);

  return lines;
};

/**
 * The heading for one group, which sometimes depends on the reason.
 *
 * One status can carry reasons that warrant genuinely different sentences.
 * `unavailable` covers both "nobody has built this" and "this exists but was
 * not wired into this deployment", and printing "Does not exist yet" over the
 * second is false — the thing exists, it is simply not here. Left collapsed,
 * the section rendered that heading twice with opposite meanings, which is the
 * exact flattening the six states exist to prevent.
 */
const headingFor = (statusHeading: string, reason: CapabilityReason | null): string => {
  if (reason === 'not_composed') return 'Not part of this setup:';
  return statusHeading;
};

/** `long_term_recall` reads as prose without a second table to maintain. */
const label = (id: string): string => id.replace(/_/gu, ' ');

/**
 * Why a capability is not simply available, in words the model can reuse.
 *
 * Written so the four distinctions survive being paraphrased: not knowing, not
 * being able, not being able *right now*, and not having the skill are four
 * different admissions and a listener should be able to tell which they got.
 */
const reasonPhrase = (reason: CapabilityReason | null): string => {
  switch (reason) {
    case 'not_built':
      return 'nobody has built this yet, so say so plainly rather than implying it might work';
    case 'partially_built':
      return 'only partly built, so it may be incomplete';
    case 'not_composed':
      return 'not wired into this deployment, so it is unavailable to you here';
    case 'unhealthy':
      return 'currently failing; it may work again shortly';
    case 'device_missing':
      return 'the hardware it needs is not connected';
    case 'device_denied':
      return 'permission to use the hardware was refused';
    case 'client_cannot_render':
      return 'this session cannot carry it out';
    case 'body_cannot_perform':
      return 'you do not have the skill for it yet';
    case 'no_report':
      return 'nothing has told you either way, so do not guess';
    case null:
      return 'available';
  }
};



/**
 * The gesture names this body has usable skills for.
 *
 * Returns undefined when the body has declared no skills at all, which is
 * distinct from declaring none that work: the first means "nothing has said",
 * and the schema keeps its full vocabulary rather than being narrowed to
 * nothing on a body that simply has not reported yet.
 */
const gestureSkills = (self: SelfState): readonly string[] | undefined => {
  const declared = self.skills.filter((skill) => skill.satisfies === 'gesture');
  if (declared.length === 0) return undefined;

  return usableSkills(self)
    .filter((skill) => skill.satisfies === 'gesture')
    .map((skill) => skill.parameter ?? skill.id);
};

/**
 * What the companion actually knows how to do, as distinct from what it is
 * capable of.
 *
 * A capability is a faculty; a skill is one way of exercising it. The gap
 * between them is a real thing a person can run into — a rig with hands and no
 * wave animation — and without this the companion answers "I can gesture" and
 * then offers a wave nothing can play.
 *
 * Only available skills are named. An unavailable one is not something the
 * companion knows how to do, and listing it with a caveat invites it to be
 * offered anyway.
 */
const skillLines = (self: SelfState): readonly string[] => {
  const lines: string[] = [];

  const usable = usableSkills(self);
  if (usable.length > 0) {
    lines.push('', `You know how to: ${usable.map((skill) => skill.name).join(', ')}`);
  }

  // The case the distinction exists for: the faculty is there, something was
  // declared to realise it, and none of it is usable.
  const stranded = capabilitiesLackingSkills(self, capabilityAction);
  if (stranded.length > 0) {
    lines.push(
      `You have the ${stranded
        .map((capability) => label(capability.id))
        .join(' and ')} faculty but no way to perform it yet — say you do not know how, rather than that you cannot.`,
    );
  }

  return lines;
};

/**
 * Which action a capability is realised by, for the ones skills attach to.
 *
 * Null for capabilities no skill describes — conversation and memory are not
 * things a rig has clips for, and asking whether they have skills would invent
 * a gap that does not exist.
 */
const capabilityAction = (capability: CapabilityResolution): ActionType | null => {
  switch (capability.id) {
    case 'gesture':
      return 'gesture';
    case 'look_at':
      return 'look';
    case 'walk':
      return 'move';
    case 'follow':
      return 'follow';
    default:
      return null;
  }
};

/**
 * What the body is doing, and what it last reported.
 *
 * Unchanged in substance from the section this replaces — the Phase 5
 * guarantee is reused rather than restated. `SelfState.body` *is* the
 * `BodyState` the action-result loop recorded, so there is still exactly one
 * answer to whether a movement happened.
 */
const bodyLines = (body: BodyState): readonly string[] => {
  const lines: string[] = [];

  if (body.stale) {
    lines.push(
      'Your body has not reported in a while, so you do not currently know what it is doing. Say so if it matters.',
    );
  } else {
    lines.push(`Right now you are: ${activityPhrase(body)}.`);
  }

  const reportable = body.recentOutcomes.slice(0, MAX_RECENT_OUTCOMES);
  if (reportable.length > 0) {
    lines.push(
      '',
      'What your body reported about what you last tried. These are facts, not guesses — they are the only thing you may base a claim about a physical result on:',
      ...reportable.map(outcomeLine),
    );
  }

  return lines;
};

const activityPhrase = (body: BodyState): string => {
  const following = body.following === null ? '' : ` (following ${body.following})`;

  switch (body.activity) {
    case 'idle':
      return `standing still${following}`;
    case 'walking':
      return 'walking';
    case 'following':
      return `following ${body.following ?? 'someone'}`;
    case 'gesturing':
      return 'making a gesture';
    case 'looking':
      return 'turning to look at something';
    case 'speaking':
      return 'speaking';
    case 'unknown':
      return 'not sure what your body is doing';
  }
};

/**
 * One outcome, phrased so the model cannot read a failure as a success.
 *
 * The reason is spelled out rather than passed through as a code, because the
 * distinction the companion most needs to convey — blocked versus unreachable —
 * is exactly the one a bare enum name would flatten into "it did not work".
 */
const outcomeLine = (outcome: ActionOutcome): string => {
  const what = describeAction(outcome);

  if (outcome.status === 'completed') {
    return `- Your ${what} finished successfully.`;
  }

  const because = outcome.reason === null ? '' : ` — ${failurePhrase(outcome.reason)}`;
  const detail = outcome.detail === null ? '' : ` (${outcome.detail})`;

  switch (outcome.status) {
    case 'failed':
      return `- Your ${what} FAILED${because}${detail}. You did not do it.`;
    case 'skipped':
      return `- Your ${what} could NOT be attempted${because}${detail}. You did not do it.`;
    case 'timed_out':
      return `- Your ${what} never finished and was given up on${detail}. You do not know whether any of it happened.`;
    case 'cancelled':
      return `- Your ${what} was stopped before it finished${detail}.`;
  }
};

/**
 * Names the action an outcome describes, as specifically as it can.
 *
 * `gesture (wave)` rather than `gesture`, when the client said which. The type
 * alone loses the thing the person asked about: told only that "a gesture
 * finished", a companion asked *"did that wave work?"* cannot connect the two,
 * and was observed saying it had not waved while holding the successful
 * outcome.
 *
 * Falls back to the bare type when no parameter was sent, which is every client
 * predating the field and every action that has no meaningful variant.
 */
const describeAction = (outcome: ActionOutcome): string =>
  outcome.parameter === null
    ? outcome.actionType
    : `${outcome.actionType} (${outcome.parameter})`;

const failurePhrase = (reason: ActionFailureReason): string => {
  switch (reason) {
    case 'blocked':
      return 'something was in the way';
    case 'unreachable':
      return 'there is no route there from where you are';
    case 'unresolved_target':
      return 'you do not know where that is';
    case 'unsupported':
      return 'your body has no way to do that';
    case 'interrupted':
      return 'something else took over';
    case 'subsystem_error':
      return 'part of your body failed';
    case 'unknown':
      return 'the reason was not reported';
  }
};

/**
 * How to communicate this turn.
 *
 * Reads the composed `ExpressionProfile` when one is present and falls back to
 * the raw traits when it is not, so a deployment without the personality engine
 * behaves exactly as it did before that engine existed.
 *
 * The composed form is strictly better as a prompt. `warmth 0.90, humor 0.45`
 * asks a model to invent a mapping from numbers to behaviour, and it invents a
 * different one each turn; `Warmth: high. Humour: hold back.` is the mapping,
 * already resolved by rules that can be tested.
 */
const expressionSection = (context: CognitiveContext): string => {
  const guard =
    'These shape how you communicate. They never change what is true, and they never override a safety consideration.';

  const expression = context.expression;
  if (expression === null) {
    const traits = Object.entries(context.personality.traits)
      .map(([name, value]) => `${name} ${value.toFixed(2)}`)
      .join(', ');

    return ['Your personality, as normalised traits from 0 to 1:', traits, guard].join('\n');
  }

  const lines = [
    `Tone: ${expression.tone}.`,
    `Detail: ${expression.detail}.`,
    `Pace: ${expression.pacing}.`,
    `Initiative: ${initiativeGuidance(expression.initiative)}`,
    `Warmth: ${band(expression.warmth)}.`,
    `Directness: ${band(expression.directness)}.`,
    `Formality: ${band(expression.formality)}.`,
    `Humour: ${humourGuidance(expression.humor)}`,
    `Curiosity: ${curiosityGuidance(expression.curiosity)}`,
    `Emotional expression: ${band(expression.emotionalExpression)}.`,
  ];

  // Boundaries are appended last and stated as an absolute. They are the one
  // part of this section that restricts rather than shapes, and burying them
  // among the stylistic dials is how a model comes to treat them as one.
  if (expression.boundaries.length > 0) {
    lines.push(
      '',
      `Do not raise these subjects unless the user does first: ${expression.boundaries.join('; ')}.`,
    );
  }

  return ['How to communicate on this turn:', ...lines, '', guard].join('\n');
};

const band = (value: number): string =>
  value >= 0.75 ? 'high' : value >= 0.45 ? 'moderate' : value >= 0.2 ? 'low' : 'minimal';

const initiativeGuidance = (level: InitiativeLevel): string => {
  switch (level) {
    case 'follow':
      return 'Answer what was asked. Do not steer.';
    case 'offer':
      return 'Answer, and offer something useful if it is genuinely relevant.';
    case 'lead':
      return 'Take the lead on where this goes.';
  }
};

/**
 * Humour at zero is an instruction, not a low setting.
 *
 * The engine drives it to zero under distress, and that decision has to survive
 * being rendered. "Humour: minimal" reads as a dial a model may nudge; "Do not
 * attempt humour" does not.
 */
const humourGuidance = (value: number): string => {
  if (value === 0) return 'Do not attempt humour at all.';
  if (value < 0.25) return 'Hold back. Only if it is clearly welcome.';
  if (value < 0.6) return 'Light, where it fits naturally.';
  return 'Welcome. This person enjoys it.';
};

const curiosityGuidance = (value: number): string => {
  if (value < 0.2) return 'Do not ask questions this turn.';
  if (value < 0.5) return 'Ask only if you genuinely cannot proceed without knowing.';
  return 'A question is welcome if it would genuinely help.';
};

/** Maps working memory to provider messages, oldest first. */
export const buildMessages = (context: CognitiveContext): readonly ModelMessage[] => {
  const history: ModelMessage[] = context.workingMemory.map((turn) =>
    turn.role === 'user'
      ? { role: 'user', content: turn.content }
      : // Replayed history carries no tool calls: working memory is the compact
        // projection of what was *said*, not a transcript of how it was reached.
        { role: 'assistant', content: turn.content, toolCalls: [] },
  );

  history.push({ role: 'user', content: context.perception.text });
  return history;
};

/** Instruction appended for decisions whose realisation needs steering. */
const decisionInstruction = (decision: Decision): string | null => {
  switch (decision.kind) {
    case 'ask_clarifying_question':
      return 'You do not have enough to answer well. Ask one specific clarifying question, and nothing else.';
    case 'acknowledge':
      return 'Acknowledge briefly and naturally. Do not expand into an answer that was not asked for.';
    case 'remember':
      return 'Confirm briefly that you have understood and will remember this.';
    case 'answer':
    case 'call_tool':
    case 'defer':
    case 'stay_silent':
      return null;
  }
};

export interface ActionGeneratorDependencies {
  readonly model: LanguageModelPort;
  /** Absent means tools are never offered, whatever the registry lists. */
  readonly toolExecution?: ToolExecutionPort;
  readonly limits?: ToolLoopLimits;
}

export class ActionGenerator {
  readonly #model: LanguageModelPort;
  readonly #toolExecution: ToolExecutionPort | undefined;
  readonly #limits: ToolLoopLimits;

  constructor(dependencies: ActionGeneratorDependencies | LanguageModelPort) {
    // A bare port is still accepted because most call sites have nothing to say
    // about tools or limits, and forcing them to wrap it in an object would be
    // ceremony with no information in it.
    const resolved: ActionGeneratorDependencies =
      'complete' in dependencies ? { model: dependencies } : dependencies;

    this.#model = resolved.model;
    this.#toolExecution = resolved.toolExecution;
    this.#limits = resolved.limits ?? defaultToolLoopLimits;
  }

  async generate(
    context: CognitiveContext,
    decision: Decision,
    options: PortOptions,
    sink?: TurnSink,
  ): Promise<GenerationOutcome> {
    // Silence needs no provider call. Spending a round trip to generate text
    // that is then discarded would be the wrong shape entirely.
    if (decision.kind === 'stay_silent') {
      return {
        actions: [],
        modelCalls: [],
        diagnostics: [],
        toolCallCount: 0,
        failure: null,
      };
    }

    const instruction = decisionInstruction(decision);
    const system =
      instruction === null
        ? buildSystemPrompt(context)
        : `${buildSystemPrompt(context)}\n\n${instruction}`;

    // Wrapped rather than passed through, so a caller's throwing callback
    // cannot fail a turn that has already produced a good answer.
    const onToken =
      sink?.onToken === undefined
        ? null
        : (chunk: string): void => {
            deliver(sink, (target) => target.onToken?.(chunk));
          };

    // A spoken turn gets the shorter ceiling. `Math.min` rather than a
    // substitution: the voice figure is a cap, not a target, so a deployment
    // that lowered the global ceiling keeps its lower number.
    const limits = speaksAloud(context.clientCapabilities)
      ? {
          ...this.#limits,
          maxOutputTokens: Math.min(this.#limits.maxOutputTokens, this.#limits.voiceMaxOutputTokens),
        }
      : this.#limits;

    return runToolLoop(
      {
        model: this.#model,
        ...(this.#toolExecution !== undefined ? { tools: this.#toolExecution } : {}),
        limits,
      },
      {
        companionId: context.companionId,
        context,
        decision,
        system,
        messages: buildMessages(context),
        // Tool selection is the model's, not Core's. Pre-selecting here and
        // then asking the model would be two reasoning systems disagreeing at
        // the cost of a round trip.
        availableTools: context.availableTools,
        onToken,
      },
      options,
    );
  }
}
