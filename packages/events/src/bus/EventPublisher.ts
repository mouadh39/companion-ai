import type { AnyEventDraft } from '../events/index.js';

/**
 * The write half of the bus.
 *
 * Exists so a package that only emits facts depends only on the ability to emit
 * them. `@nexa/core` publishes and never subscribes; typing it against this
 * makes subscribing from the turn a compile error rather than a code-review
 * catch — and subscribing from inside the turn is precisely how an event chain
 * starts becoming control flow.
 *
 * This is interface segregation applied where it pays: the narrow dependency is
 * also the one that is trivial to fake in a test.
 */
export interface EventPublisher {
  /**
   * Emits one event.
   *
   * Resolves once the event is **accepted for delivery**, never once handlers
   * have finished. A publisher that awaited its handlers would put every
   * listener on the critical path of the turn that emitted them, which is the
   * one thing `06_Event_System.md` says events must never do.
   */
  publish(draft: AnyEventDraft): Promise<void>;

  /**
   * Emits several events atomically — all accepted, or none.
   *
   * Atomicity matters at the transport boundary: a turn that emits
   * `decision.made` and `action.generated` must not land the first and lose the
   * second, because a consumer reading the log would see a decision that
   * produced nothing and have no way to know why.
   */
  publishAll(drafts: readonly AnyEventDraft[]): Promise<void>;
}
