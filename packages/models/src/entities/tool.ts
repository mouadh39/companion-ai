import type { ActionId, ToolId } from '@nexa/shared';
import type { ToolEffect, ToolInvocationStatus, ToolType } from '../enums/tool.js';
import type { Duration, Timestamp } from '../value-objects/timestamp.js';
import type { JsonObject, JsonValue } from '../types/json.js';

/**
 * A capability the companion may invoke.
 *
 * Described rather than implemented. `03_Companion_Core.md` requires new tools
 * to be addable without changing the core, which is only true if the core
 * knows a tool by its *description* — name, effect, parameters — and never by
 * its type. Everything here is data an operator registers; nothing is code.
 */
export interface Tool {
  /** The registry name, e.g. `calendar.createEvent`. Stable and referenced by the model. */
  readonly id: ToolId;
  readonly type: ToolType;
  /** Human-readable name, shown to the user when confirming an invocation. */
  readonly name: string;
  /**
   * What the tool does, written for the model to read.
   *
   * This text lands in the prompt and is the entire basis on which a tool gets
   * selected. It is a functional part of the system, not documentation — a
   * vague description here produces a companion that reaches for the wrong tool.
   */
  readonly description: string;
  /**
   * What invoking it does to the world.
   *
   * Determines retry safety and whether confirmation is required. The most
   * consequential field on the type: Nexa's event delivery is at-least-once, so
   * "is this safe to run twice?" must be answerable from data.
   */
  readonly effect: ToolEffect;
  /** JSON Schema for the arguments. Validated at the registry, not in the union. */
  readonly parameters: JsonObject;
  /** False when registered but unavailable — missing credentials, or disabled by the user. */
  readonly enabled: boolean;
  /**
   * How long one invocation may take before it is abandoned.
   *
   * Per-tool rather than global because a calendar write and a web search have
   * genuinely different latencies, and one timeout for both is either too tight
   * for the slow one or too generous for the fast one.
   */
  readonly timeout: Duration;
}

/**
 * One attempt to use a tool.
 *
 * Recorded whether it succeeded or not. Failures and denials are the more
 * valuable records: a denial is a fact about the user's boundaries that should
 * change future behaviour, and a pattern of failures is how a broken
 * integration becomes visible before the user reports it.
 */
export interface ToolInvocation {
  readonly toolId: ToolId;
  /** The action that requested it. The audit link back to the decision. */
  readonly actionId: ActionId;
  readonly arguments: JsonObject;
  readonly status: ToolInvocationStatus;
  /** Null unless `status` is `succeeded`. */
  readonly result: JsonValue | null;
  /** Populated for every non-successful status. Never both this and `result`. */
  readonly error: string | null;
  readonly startedAt: Timestamp;
  readonly duration: Duration;
}
