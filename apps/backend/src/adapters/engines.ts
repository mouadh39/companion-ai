import type { ExpressionProfile, IdentityProfile } from '@nexa/models';
import type { ExpressionPort, ExpressionRequest, IdentityPort } from '@nexa/core';
import { currentIdentity } from '@nexa/identity';
import { composeExpression } from '@nexa/personality';

/**
 * The two Phase 2 engines, behind the ports Core declares.
 *
 * These adapters are the entire integration. `@nexa/core` names neither
 * `@nexa/identity` nor `@nexa/personality`, and neither of those knows a turn
 * exists — they meet here, which is the only place in the system permitted to
 * know both sides.
 *
 * Both are thin on purpose. An adapter that did real work would be a capability
 * hiding in the composition root, where it has no tests of its own and no README
 * saying what it is.
 */

/**
 * Serves the canonical identity.
 *
 * Replaces `StaticIdentity`, which held Nexa's name, values and
 * self-description as string literals in this file. Those literals were a
 * second definition of who the companion is, kept in step with `@nexa/identity`
 * only by whoever remembered to. Now there is one.
 *
 * `companionId` is ignored because identity is currently global. The port still
 * takes it, which is what leaves room for a deployment whose companions differ
 * without changing Core.
 */
export class IdentityEngine implements IdentityPort {
  async load(): Promise<IdentityProfile> {
    return currentIdentity();
  }
}

/**
 * Composes how the companion should communicate this turn.
 *
 * `composeExpression` is pure and synchronous; the port is async because every
 * port is. That uniformity is what puts this call under the same `callPort`
 * budgeting, cancellation and recording as everything else, and it means an
 * implementation that later needs to read something is not a signature change.
 *
 * `preferences` is not passed. No port supplies the user record yet, and
 * `composeExpression` treats an absent one as "not stated" rather than
 * substituting defaults — which is correct, because asserting the user prefers
 * the defaults is a claim nothing here has established.
 */
export class PersonalityExpression implements ExpressionPort {
  async compose(request: ExpressionRequest): Promise<ExpressionProfile> {
    return composeExpression({
      personality: request.personality,
      perception: request.perception,
      relationship: request.relationship,
      recentTurns: request.recentTurns,
    });
  }
}
