/**
 * The branding mechanism for domain scalars.
 *
 * A confidence, an importance and a priority are all `number` at runtime, and
 * without a brand the compiler will let you pass any one where another belongs.
 * That substitution is silent, plausible, and produces a companion that ranks
 * memories by how sure it is rather than by how much they matter — a bug that
 * looks like bad behaviour rather than like a type error.
 *
 * The brand is a phantom: it exists only in the type system and costs nothing
 * at runtime. `@nexa/shared` brands *identifiers* the same way for the same
 * reason; this is the equivalent for domain quantities, kept here because the
 * quantities are domain knowledge and `shared` is deliberately domain-free.
 */
declare const brand: unique symbol;

export type Brand<TValue, TBrand extends string> = TValue & {
  readonly [brand]: TBrand;
};
