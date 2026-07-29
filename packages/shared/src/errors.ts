/**
 * Base class for every error Nexa raises deliberately.
 *
 * Carries a stable `code` because operational tooling needs to aggregate
 * failures, and a human-readable message is not aggregatable. `context` holds
 * structured detail for logs — never a secret, never a raw prompt.
 */
export class NexaError extends Error {
  readonly code: string;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    options?: { cause?: unknown; context?: Record<string, unknown> },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.context = Object.freeze({ ...options?.context });
  }
}

/** A value violated a domain invariant. Never the user's fault; always a bug or bad input at a boundary. */
export class ValidationError extends NexaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('validation_failed', message, context ? { context } : undefined);
  }
}

/** A required piece of configuration is missing or malformed. Raised at startup, never mid-turn. */
export class ConfigurationError extends NexaError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('configuration_invalid', message, context ? { context } : undefined);
  }
}

/**
 * A port did not answer within its budget.
 *
 * Context assembly treats this as a reason to proceed with less context rather
 * than to fail the turn — see `docs/architecture/05_Data_Flow.md`.
 */
export class PortTimeoutError extends NexaError {
  constructor(port: string, timeoutMs: number) {
    super('port_timeout', `Port '${port}' did not respond within ${timeoutMs}ms.`, {
      context: { port, timeoutMs },
    });
  }
}

/** A model provider failed or declined. Distinguishes retryable from terminal. */
export class ProviderError extends NexaError {
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { provider: string; retryable: boolean; cause?: unknown },
  ) {
    super('provider_failed', message, {
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      context: { provider: options.provider, retryable: options.retryable },
    });
    this.retryable = options.retryable;
  }
}
