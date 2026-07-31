/**
 * Observability seams.
 *
 * Interfaces Core owns, adapted at the composition root. The property worth
 * protecting is that the pipeline reports *the record it actually built*, so a
 * new stage becomes visible the moment it is timed rather than when someone
 * remembers to instrument it.
 */
export type {
  Metrics,
  MetricLabels,
  Span,
  Tracer,
  Logger,
  LogLevel,
  Observability,
} from './contracts.js';

export type { RecordedMetric, RecordedLog } from './noop.js';
export {
  noopMetrics,
  noopTracer,
  noopLogger,
  noopObservability,
  RecordingMetrics,
  RecordingLogger,
} from './noop.js';

export { TURN_METRICS, reportTurn } from './turn-metrics.js';
