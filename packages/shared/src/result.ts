/**
 * An operation that can fail, with the failure in the type rather than thrown.
 *
 * Nexa uses `Result` for *expected* failures — a provider declining, a port
 * timing out, validation rejecting an action. Exceptions remain for genuinely
 * exceptional conditions: programmer error, and unrecoverable state.
 *
 * The reason this matters more here than in an average service: the cognitive
 * turn is required to degrade rather than fail (see `docs/architecture/05_Data_Flow.md`).
 * A thrown exception unwinds the whole pipeline; a `Result` forces every caller
 * to decide, at the call site, whether this particular failure should thin the
 * answer or end the turn.
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } => result.ok;

export const isErr = <T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } => !result.ok;

/** Maps the success value, leaving a failure untouched. */
export const map = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> => (result.ok ? ok(fn(result.value)) : result);

/** Chains an operation that can itself fail. */
export const flatMap = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> => (result.ok ? fn(result.value) : result);

/** Extracts the value, substituting a fallback on failure. */
export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback;

/**
 * Runs a throwing function and captures any exception as a failure.
 *
 * Used at the boundary with third-party code that throws — SDKs, JSON parsing —
 * so that everything inside Nexa can reason in terms of `Result`.
 */
export const attempt = <T>(fn: () => T): Result<T, Error> => {
  try {
    return ok(fn());
  } catch (cause) {
    return err(cause instanceof Error ? cause : new Error(String(cause)));
  }
};

/** Async counterpart of {@link attempt}. */
export const attemptAsync = async <T>(
  fn: () => Promise<T>,
): Promise<Result<T, Error>> => {
  try {
    return ok(await fn());
  } catch (cause) {
    return err(cause instanceof Error ? cause : new Error(String(cause)));
  }
};
