import type { Action } from '@nexa/actions';

/**
 * Where a turn delivers output as it becomes available.
 *
 * Streaming is expressed as a sink the caller supplies rather than by turning
 * `run()` into an `AsyncIterable`. That choice matters: an iterable return type
 * would force every non-streaming caller — tests, the worker, autonomous turns
 * — into an iteration protocol they have no use for, and would make the failure
 * type awkward to express. Here, `run()` still returns
 * `Result<TurnResult, TurnFailure>`, and streaming only changes *when* the
 * caller learns things.
 *
 * Both methods are optional so a caller can take tokens without actions, or
 * actions without tokens. Neither may throw: a sink is a delivery mechanism,
 * and a broken one must not fail a turn that has already produced a good answer.
 */
export interface TurnSink {
  /** Called as the provider produces text. Only when the model streams. */
  onToken?(chunk: string): void;
  /**
   * Called once per action that survived validation and capability filtering.
   *
   * After filtering rather than before, so a client is never handed an action
   * it cannot execute and then told to forget it.
   */
  onAction?(action: Action): void;
}

/** Invokes a sink method, swallowing anything it throws. */
export const deliver = (
  sink: TurnSink | undefined,
  invoke: (sink: TurnSink) => void,
): void => {
  if (sink === undefined) return;
  try {
    invoke(sink);
  } catch {
    // Intentionally swallowed. A caller's broken callback must not cost the
    // user an answer the companion has already produced.
  }
};
