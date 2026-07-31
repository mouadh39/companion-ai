/**
 * Observability, as interfaces Core owns.
 *
 * No OpenTelemetry import, no Prometheus client, no logger library. The same
 * dependency rule that keeps Core free of `@nexa/memory` keeps it free of a
 * vendor SDK: the composition root adapts these to whatever is deployed, and
 * swapping the backend is a change to that file rather than to the pipeline.
 *
 * Every method here must be safe to call and must never throw. Observability
 * that can fail a turn is worse than no observability — the turn has already
 * produced a good answer by the time most of these fire.
 */

/** Label sets must stay low-cardinality. Never label by user or companion. */
export type MetricLabels = Readonly<Record<string, string>>;

export interface Metrics {
  /** A monotonically increasing count. */
  increment(name: string, labels?: MetricLabels, by?: number): void;
  /** A distribution — durations, sizes, token counts. */
  observe(name: string, value: number, labels?: MetricLabels): void;
  /** A point-in-time value. */
  gauge(name: string, value: number, labels?: MetricLabels): void;
}

export interface Span {
  /** Structured annotation. Values must be primitives, never payloads. */
  setAttribute(key: string, value: string | number | boolean): void;
  /** Marks the span failed. Does not end it. */
  recordError(error: Error): void;
  end(): void;
}

export interface Tracer {
  startSpan(name: string, attributes?: Readonly<Record<string, string | number | boolean>>): Span;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured logging.
 *
 * Fields rather than interpolated strings, because every log line from a turn
 * carries `turnId`, `companionId` and `userId`, and those are what make a
 * production incident traceable to one exchange.
 *
 * **Content never appears at info.** The user's messages and the companion's
 * memories are the user's private life; they belong at debug, behind a flag
 * that is off in production.
 */
export interface Logger {
  log(level: LogLevel, message: string, fields?: Readonly<Record<string, unknown>>): void;
  child(fields: Readonly<Record<string, unknown>>): Logger;
}

/** Everything the turn reports to. Grouped so wiring is one object. */
export interface Observability {
  readonly metrics: Metrics;
  readonly tracer: Tracer;
  readonly logger: Logger;
}
