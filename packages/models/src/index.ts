/**
 * `@nexa/models` — the domain vocabulary.
 *
 * Data and its invariants only. Nothing here performs I/O, reads a clock, or
 * knows how it will be stored: these types are shared by the API process, the
 * worker, and every capability package, so a dependency added here is a
 * dependency added everywhere.
 *
 * The package depends on exactly one thing — `@nexa/shared`, for branded
 * identifiers — and it depends on nothing above it. `@nexa/events`,
 * `@nexa/core`, `@nexa/actions` and every future capability import *from* here;
 * an import in the other direction would be a cycle and is the one rule in this
 * package that must never be relaxed.
 *
 * Organisation:
 *
 * - `types/`         — type-level utilities. The JSON lattice, the brand primitive.
 * - `value-objects/` — quantities and small immutable values, with their invariants.
 * - `enums/`         — closed vocabularies as string-literal unions.
 * - `entities/`      — the things the domain is about.
 * - `interfaces/`    — structural contracts. Shapes, never behaviour.
 *
 * Every symbol is re-exported flat from this entry point. Consumers import from
 * `@nexa/models`, never from a subpath, which is what allows the internal
 * layout to change without a coordinated release.
 */

export * from './types/index.js';
export * from './value-objects/index.js';
export * from './enums/index.js';
export * from './entities/index.js';
export * from './interfaces/index.js';
