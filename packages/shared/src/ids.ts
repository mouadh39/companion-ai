import { randomUUID } from 'node:crypto';

/**
 * Branded identifier types.
 *
 * A `CompanionId` and a `UserId` are both strings at runtime, and without
 * branding the compiler will happily let you pass one where the other belongs.
 * That mistake is silent, and in a system whose entire privacy story rests on
 * "every record is scoped to a user", it is the wrong mistake to leave
 * undetectable. The brand costs nothing at runtime and makes the swap a
 * compile error.
 */
declare const brand: unique symbol;

type Branded<T, TBrand extends string> = T & { readonly [brand]: TBrand };

export type CompanionId = Branded<string, 'CompanionId'>;
export type UserId = Branded<string, 'UserId'>;
export type TurnId = Branded<string, 'TurnId'>;
export type EventId = Branded<string, 'EventId'>;
export type MemoryId = Branded<string, 'MemoryId'>;
export type DecisionId = Branded<string, 'DecisionId'>;
export type ActionId = Branded<string, 'ActionId'>;
export type GoalId = Branded<string, 'GoalId'>;

/**
 * UUID v7 — time-ordered, so identifiers sort chronologically.
 *
 * This is what makes the event log naturally ordered and range-scannable
 * without a separate index on the timestamp, and it is why every id in Nexa is
 * generated here rather than by each caller reaching for `randomUUID`.
 *
 * Node's `randomUUID` is v4 (no time component), so v7 is assembled directly:
 * 48 bits of Unix milliseconds, 4 bits of version, then randomness.
 */
export const uuidv7 = (): string => {
  const timestamp = Date.now();
  const bytes = new Uint8Array(16);

  bytes[0] = (timestamp / 0x10000000000) & 0xff;
  bytes[1] = (timestamp / 0x100000000) & 0xff;
  bytes[2] = (timestamp / 0x1000000) & 0xff;
  bytes[3] = (timestamp / 0x10000) & 0xff;
  bytes[4] = (timestamp / 0x100) & 0xff;
  bytes[5] = timestamp & 0xff;

  // Reuse the platform CSPRNG for the random half rather than Math.random.
  const random = randomUUID().replace(/-/g, '');
  for (let i = 6; i < 16; i++) {
    bytes[i] = Number.parseInt(random.slice((i - 6) * 2, (i - 6) * 2 + 2), 16);
  }

  // Version 7 in the high nibble of byte 6; RFC 4122 variant in byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
};

export const newTurnId = (): TurnId => uuidv7() as TurnId;
export const newEventId = (): EventId => uuidv7() as EventId;
export const newMemoryId = (): MemoryId => uuidv7() as MemoryId;
export const newDecisionId = (): DecisionId => uuidv7() as DecisionId;
export const newActionId = (): ActionId => uuidv7() as ActionId;
export const newGoalId = (): GoalId => uuidv7() as GoalId;

/**
 * Adopts an externally supplied identifier.
 *
 * Named to be conspicuous at the call site: this is the one place a brand is
 * asserted rather than earned, and it belongs only at a system boundary where
 * the value has already been validated.
 */
export const trustExternalId = <T extends string>(value: string): T => value as T;
