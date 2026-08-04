/**
 * `@nexa/personality` — how the companion communicates, never what it says.
 *
 * Layer 2 and Layer 3 of `13_Personality_Engine.md`. Layer 1 — core identity
 * and values — belongs to `Identity` in `@nexa/models` and is deliberately not
 * touched here: identity must survive every personality drift, so the system
 * that adjusts personality must not be able to reach it.
 *
 * The engine composes four inputs into one `ExpressionProfile` per turn:
 *
 * ```
 *   base traits  →  relationship  →  conversation context  →  stated preferences
 *   (disposition)   (earned)         (momentary)              (explicit)
 * ```
 *
 * `composeExpression` is pure. Loading the stored `PersonalityProfile` is
 * `PersonalityPort`'s job and stays in the composition root, which keeps this
 * package free of I/O and therefore testable without stubbing anything.
 *
 * The vocabulary — `ExpressionProfile`, `DetailLevel`, `InitiativeLevel`,
 * `Pacing` and the reason codes — lives in `@nexa/models`, not here. It has to:
 * `@nexa/core` may never import a capability package, so anything Core or a
 * sibling engine reads must sit in the layer beneath both.
 */

export type { ExpressionRequest } from './compose.js';
export { composeExpression } from './compose.js';

// The layers are exported individually so a caller can compose a partial
// profile — a background reflection pass has no live perception to apply, and
// forcing one to be invented would make the profile a fiction.
export { applyBase } from './layers/base.js';
export { applyRelationship, applyStyle } from './layers/relationship.js';
export { applyConversationContext } from './layers/context.js';
export { applyPreferences } from './layers/preferences.js';

export type {
  ExpressionDraft,
  ContinuousDimension,
  SteppedDimension,
} from './draft.js';
export { explain, nudge, step, capAt, seal } from './draft.js';
