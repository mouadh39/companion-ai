import type { DetailLevel, InitiativeLevel, Pacing, Strategy } from '@nexa/models';
import type { StrategyPolicy } from './strategies.js';
import { STRATEGY_POLICIES } from './strategies.js';

/**
 * Everything the engine's judgement depends on, in one value.
 *
 * Frozen at every level: two users' plans share this object inside one process,
 * and a mutable default table is a cross-tenant bug waiting to be written.
 */
export interface PlanningConfig {
  readonly strategies: Readonly<Record<Strategy, StrategyPolicy>>;

  /**
   * Below this clarity, the turn must establish something before acting.
   *
   * The most consequential number in the engine. Too high and the companion
   * interrogates people who asked perfectly ordinary questions; too low and it
   * answers questions nobody asked. It gates a *constraint* rather than a score,
   * so crossing it does not merely disfavour answering — it forbids it.
   */
  readonly clarityFloor: number;

  /** Below this confidence, an observation is not read into the situation at all. */
  readonly minObservationConfidence: number;

  /** At or above this retrieval score, something counts as squarely relevant. */
  readonly relevantRetrievalScore: number;

  /**
   * The most initiative any plan may take, whatever expression proposed.
   *
   * A ceiling on the ceiling. Expression already caps initiative at what the
   * relationship has earned; this caps it again at what a *planner* should ever
   * assume, which is less. A companion is a companion because it does not
   * decide it is time to lead.
   */
  readonly maxInitiative: InitiativeLevel;

  /** How many secondary objectives a plan may carry. */
  readonly maxSecondaryObjectives: number;
}

export const DEFAULT_CONFIG: PlanningConfig = Object.freeze({
  strategies: Object.freeze(STRATEGY_POLICIES),
  clarityFloor: 0.45,
  minObservationConfidence: 0.35,
  relevantRetrievalScore: 0.45,
  maxInitiative: 'offer',
  maxSecondaryObjectives: 3,
});

export const INITIATIVE_RANKS: Readonly<Record<InitiativeLevel, number>> = {
  follow: 0,
  offer: 1,
  lead: 2,
};

export const DETAIL_RANKS: Readonly<Record<DetailLevel, number>> = {
  minimal: 0,
  brief: 1,
  moderate: 2,
  thorough: 3,
};

export const PACING_RANKS: Readonly<Record<Pacing, number>> = {
  slow: 0,
  measured: 1,
  brisk: 2,
};
