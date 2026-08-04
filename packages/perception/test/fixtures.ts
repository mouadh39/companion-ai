import type {
  ConversationTurn,
  Observation,
  ObservationDimension,
  PerceptionOutcome,
  TextPercept,
  Timestamp,
} from '@nexa/models';
import { initialCounters, timestamp } from '@nexa/models';
import type { RelationshipProfile } from '@nexa/models';
import { perceive } from '@nexa/perception';
import type { PerceptionRequest } from '@nexa/perception';

export const NOW = '2026-08-01T12:00:00.000Z';

export const at = (minutes = 0): Timestamp =>
  timestamp(new Date(Date.parse(NOW) + minutes * 60_000).toISOString());

export const said = (text: string, minutes = 0): TextPercept => ({
  channel: 'text',
  at: at(minutes),
  text,
});

export const turnOf = (
  role: ConversationTurn['role'],
  content: string,
  minutes = 0,
): ConversationTurn => ({ role, content, at: at(minutes) });

/** The common case: one message, no history. */
export const read = (
  text: string,
  overrides: Partial<PerceptionRequest> = {},
): PerceptionOutcome =>
  perceive({ percepts: [said(text)], at: at(0), ...overrides });

export const relationshipOf = (
  overrides: Partial<RelationshipProfile> = {},
): RelationshipProfile => ({
  stage: 'familiar',
  dimensions: { trust: 0.7, familiarity: 0.7, warmth: 0.6, reliance: 0.5 },
  initiative: 'offer',
  personalization: 'moderate',
  cadence: 'regular',
  sharedUnderstanding: 0.6,
  collaboration: { ...initialCounters(), requestsHandled: 12 },
  inferredStyle: null,
  boundaries: [],
  nextStage: 'close',
  progress: 0.4,
  blockers: [],
  rationale: [],
  ...overrides,
});

export const on = (
  outcome: PerceptionOutcome,
  dimension: ObservationDimension,
): Observation | undefined =>
  outcome.observations.find((observation) => observation.dimension === dimension);

export const allOn = (
  outcome: PerceptionOutcome,
  dimension: ObservationDimension,
): readonly Observation[] =>
  outcome.observations.filter((observation) => observation.dimension === dimension);

export const dimensionsIn = (outcome: PerceptionOutcome): readonly ObservationDimension[] =>
  outcome.observations.map((observation) => observation.dimension);

export const unknownFor = (outcome: PerceptionOutcome, dimension: ObservationDimension) =>
  outcome.unknown.find((entry) => entry.dimension === dimension);
