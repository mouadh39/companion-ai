import type {
  DetailLevel,
  ExpressionDimension,
  ExpressionProfile,
  ExpressionReason,
  ExpressionReasonCode,
  InitiativeLevel,
  Pacing,
  SpeechTone,
} from '@nexa/models';
import {
  DETAIL_LEVELS,
  DETAIL_RANK,
  INITIATIVE_LEVELS,
  INITIATIVE_RANK,
  PACINGS,
  PACING_RANK,
} from '@nexa/models';

/**
 * The working shape each layer adjusts.
 *
 * Mutable, internal, and never exported past `composeExpression` — the public
 * API is a pure function returning a frozen `ExpressionProfile`. A builder
 * rather than four successive immutable copies for the same reason
 * `TurnRecordBuilder` is one: the layers are a fixed pipeline that runs once
 * per turn, and copying the whole profile at each stage would allocate four
 * objects to produce one.
 *
 * The stepped dimensions are held as their ranks during composition. That is
 * what makes them *composable*: "one step less detail" is arithmetic, while
 * `'moderate' → 'brief'` would need a lookup table at every call site, and the
 * table is where an off-by-one becomes a companion that answers in monosyllables.
 */
export interface ExpressionDraft {
  curiosity: number;
  humor: number;
  emotionalExpression: number;
  warmth: number;
  formality: number;
  directness: number;
  energy: number;

  /** Rank within `DETAIL_LEVELS`. */
  detail: number;
  /** Rank within `INITIATIVE_LEVELS`. */
  initiative: number;
  /** Rank within `PACINGS`. */
  pacing: number;

  boundaries: string[];
  rationale: ExpressionReason[];
}

/** The continuous dimensions, as a type so `nudge` cannot be aimed at a stepped one. */
export type ContinuousDimension =
  | 'curiosity'
  | 'humor'
  | 'emotionalExpression'
  | 'warmth'
  | 'formality'
  | 'directness'
  | 'energy';

/** The stepped dimensions. */
export type SteppedDimension = 'detail' | 'initiative' | 'pacing';

const STEP_BOUNDS = {
  detail: DETAIL_LEVELS.length - 1,
  initiative: INITIATIVE_LEVELS.length - 1,
  pacing: PACINGS.length - 1,
} as const satisfies Readonly<Record<SteppedDimension, number>>;

/**
 * Records a reason on the draft.
 *
 * Every layer calls this rather than pushing directly, so a reason can never be
 * recorded without naming the dimensions it moved — which is the only thing
 * that makes the rationale answer "which layer last touched `humor`?".
 */
export const explain = (
  draft: ExpressionDraft,
  code: ExpressionReasonCode,
  affects: readonly ExpressionDimension[],
  detail: string,
): void => {
  draft.rationale.push({ code, affects, detail });
};

/**
 * Moves a continuous dimension, clamped to 0–1.
 *
 * Returns the value actually applied, which differs from `delta` when the
 * dimension was already at a bound. Layers ignore it; `composeExpression` uses
 * it to record a `clamped` reason, because a trait that stopped moving is
 * indistinguishable in the output from one that was never pushed.
 */
export const nudge = (
  draft: ExpressionDraft,
  dimension: ContinuousDimension,
  delta: number,
): number => {
  const before = draft[dimension];
  const after = Math.min(1, Math.max(0, before + delta));
  draft[dimension] = after;
  return after - before;
};

/** Moves a stepped dimension by whole steps, clamped to its vocabulary. */
export const step = (
  draft: ExpressionDraft,
  dimension: SteppedDimension,
  steps: number,
): number => {
  const before = draft[dimension];
  const after = Math.min(STEP_BOUNDS[dimension], Math.max(0, before + steps));
  draft[dimension] = after;
  return after - before;
};

/**
 * Lowers a stepped dimension to a ceiling, never raising it.
 *
 * Separate from `step` because a cap is not an adjustment: it is a constraint
 * that must hold regardless of what earlier layers did. `allowProactiveSpeech`
 * being off has to survive an enthusiastic set of traits, and expressing that
 * as a negative delta would let a later layer undo it.
 */
export const capAt = (
  draft: ExpressionDraft,
  dimension: SteppedDimension,
  ceiling: number,
): boolean => {
  if (draft[dimension] <= ceiling) return false;
  draft[dimension] = ceiling;
  return true;
};

/** True when every continuous dimension is at neither bound. */
const rankOf = <T extends string>(
  values: readonly T[],
  rank: number,
  fallback: T,
): T => values[rank] ?? fallback;

/**
 * Freezes the draft into the profile.
 *
 * Rounds the continuous dimensions to three decimals. Successive floating-point
 * deltas accumulate representation error — four layers each adding 0.1 lands on
 * 0.4000000000000001 — and that noise reaches snapshot tests and logs where it
 * reads as a real difference between two identical runs.
 */
export const seal = (draft: ExpressionDraft, tone: SpeechTone): ExpressionProfile => {
  const round = (value: number): number => Math.round(value * 1_000) / 1_000;

  return {
    tone,
    detail: rankOf<DetailLevel>(DETAIL_LEVELS, draft.detail, 'moderate'),
    initiative: rankOf<InitiativeLevel>(INITIATIVE_LEVELS, draft.initiative, 'follow'),
    pacing: rankOf<Pacing>(PACINGS, draft.pacing, 'measured'),

    curiosity: round(draft.curiosity),
    humor: round(draft.humor),
    emotionalExpression: round(draft.emotionalExpression),
    warmth: round(draft.warmth),
    formality: round(draft.formality),
    directness: round(draft.directness),
    energy: round(draft.energy),

    boundaries: [...draft.boundaries],
    rationale: [...draft.rationale],
  };
};

export { DETAIL_RANK, INITIATIVE_RANK, PACING_RANK };
