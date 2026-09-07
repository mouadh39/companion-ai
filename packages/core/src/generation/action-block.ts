import { newActionId, type ActionId, type DecisionId } from '@nexa/shared';
import type {
  Action,
  ActionType,
  DiagnosticCode,
  DiagnosticSeverity,
  DistanceUnit,
  GestureKind,
  LookTarget,
  MoveMode,
  StopScope,
} from '@nexa/models';
import {
  DISTANCE_UNITS,
  GESTURE_KINDS,
  LOOK_TARGETS,
  MOVE_DIRECTIONS,
  MOVE_MODES,
  STOP_SCOPES,
} from '@nexa/models';

/**
 * How the model asks for a body.
 *
 * The channel that replaces `[[MOVE:user]]`. That marker was a prompt string
 * and a regular expression that had to be kept in step by hand, it could name
 * three targets and carry no parameters, and "go back two steps" was not
 * expressible in it at any length.
 *
 * ## Why a text block rather than tool calls
 *
 * A tool call is the semantically cleaner channel and is deliberately not used
 * here. `ToolExecutionPort` is unbound in production — the composition root
 * wires `NoTools` — so a tool-based signal would be inert today. More
 * importantly, tool use is a *provider capability*: `ModelCapabilities.toolUse`
 * exists precisely because a small local model may not have it, and routing the
 * body through tools would make embodiment silently unavailable on exactly the
 * providers this project intends to support. A fenced block rides the one
 * channel every provider has, which is its own completion text.
 *
 * ## Why it degrades instead of failing
 *
 * Malformed JSON costs the actions and keeps the prose. The alternative — a
 * failed turn — trades a companion that answered but did not move for one that
 * did neither, which is worse in every case. The drop is recorded as
 * `action_block_malformed` so a model that has started emitting bad JSON on
 * every turn is visible rather than merely quiet.
 *
 * ## The one thing this must never do
 *
 * Nothing here may invent an action the model did not ask for, and nothing here
 * may repair one into a different action than the one written. A field that
 * cannot be read is dropped and reported. Coercing `"backwards"` into
 * `backward` would be this parser deciding what the companion meant, which is
 * the same failure as a body that substitutes a wave for a shrug.
 */

/** A diagnostic raised while reading the block. */
export interface ActionBlockDiagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly detail: string;
}

export interface ActionBlockResult {
  /** The completion with the block removed, ready to become a `SpeakAction`. */
  readonly prose: string;
  readonly actions: readonly Action[];
  readonly diagnostics: readonly ActionBlockDiagnostic[];
}

/**
 * The fence the model is told to use.
 *
 * A named language tag rather than bare ``` so that an ordinary code sample in
 * an answer — which a companion asked about programming will produce — is never
 * mistaken for an instruction to move. The tag is checked, not merely the
 * fence.
 */
const BLOCK_PATTERN = /```nexa\s*\r?\n([\s\S]*?)```/;

/**
 * Reads the action block out of a completion.
 *
 * `allowed` is the client's declared action list. Actions outside it are
 * dropped *here* rather than at validation, because the two drops mean
 * different things: validation dropping an unsupported action is the backend
 * catching a mismatch, while this is the model asking for something it was
 * explicitly told it could not have. Reporting them separately is what makes a
 * prompt that has drifted from the client's capabilities diagnosable.
 */
export const readActionBlock = (
  text: string,
  decisionId: DecisionId,
  allowed: readonly ActionType[],
  mint: () => ActionId = newActionId,
): ActionBlockResult => {
  const match = BLOCK_PATTERN.exec(text);
  if (match?.[1] === undefined) {
    return { prose: text.trim(), actions: [], diagnostics: [] };
  }

  const prose = text.replace(match[0], '').trim();
  const diagnostics: ActionBlockDiagnostic[] = [];

  const entries = parseEntries(match[1], diagnostics);
  const actions: Action[] = [];

  for (const entry of entries) {
    const type = entry['type'];
    if (typeof type !== 'string') {
      diagnostics.push(malformed('An action in the block has no `type`.'));
      continue;
    }

    if (!(allowed as readonly string[]).includes(type)) {
      diagnostics.push({
        code: 'action_unsupported_by_client',
        severity: 'warning',
        detail: `The model asked for '${type}', which this client did not declare.`,
      });
      continue;
    }

    const action = readAction(type, entry, mint(), decisionId, diagnostics);
    if (action !== null) actions.push(action);
  }

  return { prose, actions, diagnostics };
};

/**
 * Reads the block body as either `{"actions": [...]}` or a bare array.
 *
 * Both are accepted because both are what models actually emit, and refusing
 * one of them buys nothing — the shape carries no information the wrapper adds.
 * Anything else is reported and yields no actions.
 */
const parseEntries = (
  body: string,
  diagnostics: ActionBlockDiagnostic[],
): readonly Record<string, unknown>[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    diagnostics.push(
      malformed(
        `The action block was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return [];
  }

  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed['actions'])
      ? parsed['actions']
      : null;

  if (list === null) {
    diagnostics.push(malformed('The action block held neither an array nor an `actions` array.'));
    return [];
  }

  return list.filter(isRecord);
};

const readAction = (
  type: string,
  entry: Record<string, unknown>,
  id: ActionId,
  decisionId: DecisionId,
  diagnostics: ActionBlockDiagnostic[],
): Action | null => {
  switch (type) {
    case 'move': {
      const target = readTarget(entry['target']);
      const direction = readMember(entry['direction'], MOVE_DIRECTIONS);
      const { distance, unit } = readDistance(entry);

      // Reported rather than defaulted. A move with neither would be rejected
      // by `validateAction` a moment later anyway, but saying so here names the
      // *model's* mistake instead of the action's.
      if (target === null && direction === null) {
        diagnostics.push(malformed('A move named neither a target nor a direction.'));
        return null;
      }

      return {
        id,
        type: 'move',
        decisionId,
        target,
        direction,
        distance,
        distanceUnit: unit,
        mode: readMember(entry['mode'], MOVE_MODES) ?? ('walk' satisfies MoveMode),
      };
    }

    case 'follow': {
      const target = readTarget(entry['target']);
      if (target === null) {
        diagnostics.push(malformed('A follow named no target.'));
        return null;
      }

      return {
        id,
        type: 'follow',
        decisionId,
        target,
        distance: readPositiveNumber(entry['distance']),
        mode: readMember(entry['mode'], MOVE_MODES) ?? ('walk' satisfies MoveMode),
      };
    }

    case 'stop':
      return {
        id,
        type: 'stop',
        decisionId,
        // `all` is the safe default: a bare "stop" from a person means
        // everything, and a companion that kept following after being told to
        // stop would be the more alarming failure.
        scope: readMember(entry['scope'], STOP_SCOPES) ?? ('all' satisfies StopScope),
      };

    case 'gesture': {
      const gesture = readMember(entry['gesture'], GESTURE_KINDS);
      if (gesture === null) {
        diagnostics.push(
          malformed(`A gesture named '${String(entry['gesture'])}', which is not a known gesture.`),
        );
        return null;
      }
      return { id, type: 'gesture', decisionId, gesture: gesture satisfies GestureKind };
    }

    case 'look': {
      const target = readMember(entry['target'], LOOK_TARGETS);
      if (target === null) {
        diagnostics.push(
          malformed(`A look named '${String(entry['target'])}', which is not a known look target.`),
        );
        return null;
      }
      return { id, type: 'look', decisionId, target: target satisfies LookTarget };
    }

    default:
      // `speak`, `remember` and `call_tool` are reachable here only if a client
      // declared them, and none may be requested through this channel: prose is
      // already the speak action, memory is the backend's own, and a tool call
      // belongs to the provider's tool protocol where it can be authorised and
      // audited. Letting the block mint them would be a second, unaudited way
      // to write memory and invoke capabilities.
      diagnostics.push(
        malformed(`'${type}' cannot be requested through the action block.`),
      );
      return null;
  }
};

/**
 * Reads a target, which is a role or any name the client might recognise.
 *
 * Unknown names pass through deliberately: the backend cannot enumerate what is
 * in the user's room, and a name this client cannot locate returns as a
 * `skipped` outcome naming the target. That feedback is what makes an open
 * vocabulary honest rather than a guess — see `ActionOutcome`.
 */
const readTarget = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

/**
 * Reads a distance and its unit as a pair.
 *
 * A distance with no unit defaults to `steps` rather than being dropped,
 * because that is the unit a person speaks in — "go back two" means two steps,
 * never two metres — and dropping it would silently turn a bounded movement
 * into an unbounded one. The reverse, a unit with no number, yields nothing:
 * there is no sensible magnitude to invent.
 */
const readDistance = (
  entry: Record<string, unknown>,
): { distance: number | null; unit: DistanceUnit | null } => {
  const distance = readPositiveNumber(entry['distance']);
  if (distance === null) return { distance: null, unit: null };

  return {
    distance,
    unit: readMember(entry['distanceUnit'], DISTANCE_UNITS) ?? ('steps' satisfies DistanceUnit),
  };
};

const readPositiveNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

/** Narrows a value to a member of a closed vocabulary, or null. */
const readMember = <TMember extends string>(
  value: unknown,
  members: readonly TMember[],
): TMember | null =>
  typeof value === 'string' && (members as readonly string[]).includes(value)
    ? (value as TMember)
    : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const malformed = (detail: string): ActionBlockDiagnostic => ({
  code: 'action_block_malformed',
  severity: 'warning',
  detail,
});

/**
 * The schema the model is shown, rendered from the same vocabularies the parser
 * reads.
 *
 * Generated rather than written out, because the failure this replaces was
 * exactly a hand-maintained prompt drifting from a hand-maintained parser. A
 * gesture added to `GESTURE_KINDS` now appears in the prompt with no second
 * edit, and one removed disappears from it — the two cannot disagree.
 *
 * Only the action types the client actually declared are described. A voice
 * client is never told that walking exists, which is the same rule
 * `identitySection` follows for the body as a whole: never describe a faculty
 * this session does not have.
 */
export const renderActionSchema = (
  allowed: readonly ActionType[],
  gestures: readonly string[] = GESTURE_KINDS,
): string | null => {
  const can = (type: ActionType): boolean => allowed.includes(type);
  const lines: string[] = [];

  if (can('move')) {
    lines.push(
      '- `{"type":"move", "target":<name>, "direction":<direction>, "distance":<number>, "distanceUnit":"steps"|"metres", "mode":"walk"|"run"}`',
      `    Every field is optional, but give at least one of \`target\` or \`direction\`.`,
      `    \`target\`: "user", "away", "ahead", or the name of something in the room — "table", "door". Use the name the person used.`,
      `    \`direction\`: ${MOVE_DIRECTIONS.join(', ')}. "toward" and "away_from" also need a \`target\`.`,
      '    "come here" → `{"type":"move","target":"user"}`',
      '    "go back two steps" → `{"type":"move","direction":"backward","distance":2,"distanceUnit":"steps"}`',
      '    "move closer" → `{"type":"move","target":"user","direction":"toward"}`',
      '    "go to the table" → `{"type":"move","target":"table"}`',
    );
  }

  if (can('follow')) {
    lines.push(
      '- `{"type":"follow", "target":<name>, "distance":<metres>, "mode":"walk"|"run"}`',
      '    Starts following and keeps going until a stop. Do not repeat it to keep following.',
      '    "follow me" → `{"type":"follow","target":"user"}`',
    );
  }

  if (can('stop')) {
    lines.push(
      `- \`{"type":"stop", "scope":${STOP_SCOPES.map((scope) => `"${scope}"`).join('|')}}\``,
      '    "stop" / "wait" → `{"type":"stop","scope":"all"}`',
      '    "stop following me" → `{"type":"stop","scope":"follow"}`',
    );
  }

  if (can('look')) {
    lines.push(
      `- \`{"type":"look", "target":${LOOK_TARGETS.map((target) => `"${target}"`).join('|')}}\``,
    );
  }

  // Narrowed to what this body actually has, when it has said. The protocol
  // knows five gestures; a rig with one wave clip can perform one of them, and
  // offering the other four is how the companion comes to say it can nod. An
  // empty list means the body declared no gesture at all, so the whole line is
  // withheld rather than rendered with nothing to choose from.
  if (can('gesture') && gestures.length > 0) {
    lines.push(
      `- \`{"type":"gesture", "gesture":${gestures.map((kind) => `"${kind}"`).join('|')}}\``,
    );
  }

  if (lines.length === 0) return null;

  return [
    'You have a body in this session, and these are the only things you can do with it:',
    ...lines,
    '',
    'To act, end your reply with a fenced block tagged `nexa` containing the actions, in order:',
    '',
    '```nexa',
    '{"actions":[{"type":"move","target":"user"}]}',
    '```',
    '',
    'Rules:',
    '- Write your spoken reply as normal prose first. The block goes last and is never read aloud.',
    '- Only include the block when the person actually asked you to do something physical. Most turns have no block.',
    '- Say what you are about to do, not that you have done it. You will be told afterwards whether it worked, and only then may you speak about the result.',
    '- Never claim you moved, looked, or gestured in the same reply that requests it.',
  ].join('\n');
};
