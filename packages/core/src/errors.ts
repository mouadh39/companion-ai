import { NexaError } from '@nexa/shared';
import type { PortCallRecord } from '@nexa/models';

/**
 * The turn was cancelled before it could produce an answer.
 *
 * Distinct from every other failure in the pipeline because it is not a
 * failure of the system: nobody is waiting for the result any more. A client
 * closed the app, a connection dropped, the caller's deadline elapsed. It is
 * raised rather than degraded because there is no thinner answer worth
 * assembling for an audience that has left.
 */
export class TurnAbortedError extends NexaError {
  constructor(stage: string, cause?: unknown) {
    super('turn_aborted', `The turn was cancelled during ${stage}.`, {
      ...(cause !== undefined ? { cause } : {}),
      context: { stage },
    });
  }
}

/**
 * Two context contributors depend on each other, directly or transitively.
 *
 * A construction-time failure rather than a runtime one, deliberately. No
 * ordering satisfies a cycle, so the alternative to failing loudly at boot is
 * a contributor that silently reads an empty dependency for as long as the
 * process runs — and that reads as the companion simply not knowing something.
 */
export class ContributorCycleError extends NexaError {
  constructor(involved: readonly string[]) {
    super(
      'contributor_cycle',
      `Context contributors form a dependency cycle: ${involved.join(' → ')}.`,
      { context: { involved: [...involved] } },
    );
  }
}

/** Capabilities require each other in a loop; no initialisation order exists. */
export class CapabilityCycleError extends NexaError {
  constructor(involved: readonly string[]) {
    super(
      'capability_cycle',
      `Capabilities form a dependency cycle: ${involved.join(' → ')}.`,
      { context: { involved: [...involved] } },
    );
  }
}

/**
 * Two capabilities claim the same port, or one id is registered twice.
 *
 * Ambiguity rather than preference: whichever won would depend on registration
 * order, which is the kind of dependency nobody writes down.
 */
export class CapabilityConflictError extends NexaError {
  constructor(subject: string, detail: string) {
    super('capability_conflict', `'${subject}' ${detail}.`, {
      context: { subject, detail },
    });
  }
}

/** A required port has no provider, or a provider did not deliver what it declared. */
export class MissingCapabilityError extends NexaError {
  constructor(port: string, detail: string) {
    super('missing_capability', `Port '${port}' ${detail}.`, {
      context: { port, detail },
    });
  }
}

/** A contributor declared a dependency on something that was never registered. */
export class UnknownContributorError extends NexaError {
  constructor(id: string, detail: string) {
    super('unknown_contributor', `Context contributor '${id}' ${detail}.`, {
      context: { id, detail },
    });
  }
}

/**
 * A section the companion cannot be itself without was unavailable.
 *
 * Identity and personality are the only two context sections whose absence is
 * fatal rather than degradable. Everything else in `CognitiveContext` is
 * optional by construction — a turn without the world model is a turn that
 * knows less, but a turn without an identity is not this companion's turn.
 */
export class ContextUnavailableError extends NexaError {
  /**
   * The calls made before the failure.
   *
   * Carried on the error so they survive into the turn record. A turn that
   * failed is precisely the one whose port timings you need, and throwing them
   * away at the moment of failure is how a system ends up unable to explain its
   * own outages.
   */
  readonly portCalls: readonly PortCallRecord[];

  constructor(section: string, reason: string, portCalls: readonly PortCallRecord[] = []) {
    super(
      'context_unavailable',
      `Required context section '${section}' is unavailable (${reason}); cannot assemble context.`,
      { context: { section, reason } },
    );
    this.portCalls = portCalls;
  }
}
