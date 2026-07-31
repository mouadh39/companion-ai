import type {
  Logger,
  LogLevel,
  MetricLabels,
  Metrics,
  Observability,
  Span,
  Tracer,
} from './contracts.js';

/**
 * Implementations that do nothing.
 *
 * The default, so observability is never a required dependency and a test never
 * has to stub three interfaces to construct a turn. Making it optional at the
 * call site instead would put a null check around every metric in the pipeline,
 * and one of them would eventually be forgotten.
 */
export const noopMetrics: Metrics = {
  increment: () => undefined,
  observe: () => undefined,
  gauge: () => undefined,
};

const noopSpan: Span = {
  setAttribute: () => undefined,
  recordError: () => undefined,
  end: () => undefined,
};

export const noopTracer: Tracer = {
  startSpan: () => noopSpan,
};

export const noopLogger: Logger = {
  log: () => undefined,
  child: () => noopLogger,
};

export const noopObservability: Observability = {
  metrics: noopMetrics,
  tracer: noopTracer,
  logger: noopLogger,
};

/** One recorded measurement, for assertions. */
export interface RecordedMetric {
  readonly kind: 'increment' | 'observe' | 'gauge';
  readonly name: string;
  readonly value: number;
  readonly labels: MetricLabels;
}

/**
 * Records instead of exporting.
 *
 * Lets a test assert that a turn reported its degradation without standing up a
 * metrics backend — the same affordance `RecordingEventBus` provides for events,
 * and for the same reason: the interesting assertion is usually "was this
 * reported?", not "did something consume it?".
 */
export class RecordingMetrics implements Metrics {
  readonly #recorded: RecordedMetric[] = [];

  get recorded(): readonly RecordedMetric[] {
    return this.#recorded;
  }

  increment(name: string, labels: MetricLabels = {}, by = 1): void {
    this.#recorded.push({ kind: 'increment', name, value: by, labels });
  }

  observe(name: string, value: number, labels: MetricLabels = {}): void {
    this.#recorded.push({ kind: 'observe', name, value, labels });
  }

  gauge(name: string, value: number, labels: MetricLabels = {}): void {
    this.#recorded.push({ kind: 'gauge', name, value, labels });
  }

  /** Every measurement recorded under a name, in order. */
  named(name: string): readonly RecordedMetric[] {
    return this.#recorded.filter((metric) => metric.name === name);
  }

  clear(): void {
    this.#recorded.length = 0;
  }
}

export interface RecordedLog {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** Records log lines, so a test can assert nothing private was emitted. */
export class RecordingLogger implements Logger {
  readonly #recorded: RecordedLog[];
  readonly #bound: Readonly<Record<string, unknown>>;

  constructor(
    recorded: RecordedLog[] = [],
    bound: Readonly<Record<string, unknown>> = {},
  ) {
    this.#recorded = recorded;
    this.#bound = bound;
  }

  get recorded(): readonly RecordedLog[] {
    return this.#recorded;
  }

  log(
    level: LogLevel,
    message: string,
    fields: Readonly<Record<string, unknown>> = {},
  ): void {
    this.#recorded.push({ level, message, fields: { ...this.#bound, ...fields } });
  }

  /** Shares the underlying buffer, so a child's lines land in the parent's log. */
  child(fields: Readonly<Record<string, unknown>>): Logger {
    return new RecordingLogger(this.#recorded, { ...this.#bound, ...fields });
  }
}
