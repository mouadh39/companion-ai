import type { Brand } from '../types/brand.js';

/**
 * The bounded quantities the companion reasons with.
 *
 * All five are `number` at runtime and all five mean different things. They are
 * branded separately so the compiler rejects the substitution that reads
 * correctly and behaves wrongly — ranking by confidence instead of importance,
 * decaying priority instead of progress.
 *
 * Two ranges are in play, and the split is deliberate:
 *
 * - **Unit, 0…1** — `ConfidenceScore`, `ImportanceScore`, `Priority`, `Progress`.
 *   Magnitudes. Zero is the absence of the quantity.
 * - **Signed, -1…1** — `Valence`. A direction as well as a magnitude; zero is
 *   neutral, and the sign is the meaning.
 *
 * Every constructor here is total and pure. None reads a clock, allocates an
 * id, or performs I/O — `docs/architecture/05_Data_Flow.md` requires
 * deliberation to be replayable, and a value object that consults the
 * environment makes replay produce a different answer.
 */

/** How sure the companion is that something is true. 0 = no idea, 1 = certain. */
export type ConfidenceScore = Brand<number, 'ConfidenceScore'>;

/** How much a memory matters. Drives retention, retrieval weight, and reflection. */
export type ImportanceScore = Brand<number, 'ImportanceScore'>;

/** How urgently a goal wants attention relative to its siblings. */
export type Priority = Brand<number, 'Priority'>;

/** How far along a goal is. 1 does not imply completion — see `GoalStatus`. */
export type Progress = Brand<number, 'Progress'>;

/** Emotional charge, -1 (distressing) through 0 (neutral) to 1 (joyful). */
export type Valence = Brand<number, 'Valence'>;

const UNIT_MIN = 0;
const UNIT_MAX = 1;
const SIGNED_MIN = -1;
const SIGNED_MAX = 1;

const inRange = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max;

/**
 * Builds a checked constructor.
 *
 * Throwing is correct for these callers: every one passes a literal or a value
 * already derived inside the domain, so an out-of-range number is a programming
 * error, and the alternative — silently clamping — hides the bug at the exact
 * moment it is cheapest to find. Untrusted input has a different door; see
 * `parseUnit` and `parseValence`.
 */
const checked =
  <TBrand extends number>(label: string, min: number, max: number) =>
  (value: number): TBrand => {
    if (!inRange(value, min, max)) {
      throw new RangeError(`${label} must be a finite number in [${min}, ${max}]; received ${value}`);
    }
    return value as TBrand;
  };

export const confidence = checked<ConfidenceScore>('ConfidenceScore', UNIT_MIN, UNIT_MAX);
export const importance = checked<ImportanceScore>('ImportanceScore', UNIT_MIN, UNIT_MAX);
export const priority = checked<Priority>('Priority', UNIT_MIN, UNIT_MAX);
export const progress = checked<Progress>('Progress', UNIT_MIN, UNIT_MAX);
export const valence = checked<Valence>('Valence', SIGNED_MIN, SIGNED_MAX);

/**
 * Accepts a unit score from an untrusted source, returning `null` on rejection.
 *
 * The boundary case that matters is a language model asked to self-report a
 * confidence: it returns `1.2`, `"high"`, or `NaN` often enough that throwing
 * would turn a routine provider quirk into a failed turn. Callers substitute a
 * documented default instead.
 */
export const parseUnit = (value: unknown): number | null =>
  typeof value === 'number' && inRange(value, UNIT_MIN, UNIT_MAX) ? value : null;

export const parseValence = (value: unknown): Valence | null =>
  typeof value === 'number' && inRange(value, SIGNED_MIN, SIGNED_MAX)
    ? (value as Valence)
    : null;

/**
 * Constrains any number into 0…1.
 *
 * For values *computed* by the domain — a weighted retrieval score, a decayed
 * trust level — where drifting a hair outside the range is arithmetic, not a
 * mistake, and refusing it would be pedantry.
 */
export const clampUnit = (value: number): number =>
  Number.isFinite(value) ? Math.min(UNIT_MAX, Math.max(UNIT_MIN, value)) : UNIT_MIN;

/** Named priorities, so call sites read as intent rather than as magic numbers. */
export const PRIORITY = {
  trivial: 0.1 as Priority,
  low: 0.3 as Priority,
  normal: 0.5 as Priority,
  high: 0.75 as Priority,
  urgent: 0.95 as Priority,
} as const satisfies Readonly<Record<string, Priority>>;
