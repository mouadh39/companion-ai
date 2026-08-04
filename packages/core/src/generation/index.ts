/**
 * Stage 5 — the only stage that produces language, and the only one that calls
 * a model provider.
 *
 * Everything upstream reasons in structured terms; everything downstream ships
 * actions to a client. The agentic loop lives *here* and nowhere else: bounded
 * three ways, inside a deterministic skeleton, so the capability is available
 * where it pays without costing the auditability that holds everywhere else.
 */
export type {
  GenerationDiagnostic,
  GenerationOutcome,
  ToolLoopLimits,
  ToolLoopDependencies,
  ToolLoopRequest,
} from './tool-loop.js';
export { runToolLoop, defaultToolLoopLimits, toneFor } from './tool-loop.js';

export type { TurnSink } from './sink.js';
export { deliver } from './sink.js';
