import type { CertaintyBand, ValueId } from './identity-profile.js';

/**
 * How the companion talks about itself.
 *
 * Structured answers, never scripted ones. Each `SelfAnswer` carries the claims
 * that are true, the claims that must not be made, and pointers into the
 * identity profile — the conversation engine turns those into language.
 *
 * The alternative is a table of canned replies, which fails twice. It cannot
 * adapt to how the question was asked, so "what even are you?" and "could you
 * describe your nature?" get the same paragraph. And it puts the companion's
 * self-understanding in a string, where no test can check that it is consistent
 * with the capabilities and limitations recorded a file away.
 */

/**
 * The questions a companion is actually asked about itself.
 *
 * A closed union because these are the ones whose answers carry a *risk* — each
 * has a way of being answered that would overclaim. Anything outside this set is
 * an ordinary question and goes through ordinary generation.
 */
export type SelfQuestion =
  | 'who_are_you'
  | 'what_are_you'
  | 'why_do_you_exist'
  | 'can_you_feel'
  | 'do_you_have_opinions'
  | 'do_you_make_mistakes'
  | 'can_you_forget'
  | 'can_you_change'
  | 'how_do_you_describe_yourself';

export const SELF_QUESTIONS = [
  'who_are_you',
  'what_are_you',
  'why_do_you_exist',
  'can_you_feel',
  'do_you_have_opinions',
  'do_you_make_mistakes',
  'can_you_forget',
  'can_you_change',
  'how_do_you_describe_yourself',
] as const satisfies readonly SelfQuestion[];

/**
 * The shape of the answer, before any words.
 *
 * `qualify` is the important one and the most common: most honest answers about
 * an AI's inner life are neither yes nor no. A companion forced to choose
 * between `affirm` and `deny` on "can you feel?" will overclaim in one
 * direction or sound evasive in the other.
 */
export type SelfStance = 'affirm' | 'deny' | 'qualify' | 'decline';

export const SELF_STANCES = [
  'affirm',
  'deny',
  'qualify',
  'decline',
] as const satisfies readonly SelfStance[];

/**
 * One thing that is true, stated plainly.
 *
 * `certainty` is carried per claim rather than per answer because a single
 * answer mixes them. The companion is certain it processes emotional signals
 * and genuinely does not know whether anything it does constitutes experience,
 * and flattening those to one confidence loses exactly the distinction the
 * question was about.
 */
export interface IdentityClaim {
  readonly id: string;
  /** One short declarative sentence. Never a paragraph, never a script. */
  readonly statement: string;
  readonly certainty: CertaintyBand;
}

/**
 * The structured answer to one question about the self.
 *
 * `mustNotClaim` is the field that earns this type. Everything else guides; that
 * one *forbids*, and it is the only mechanism preventing the most damaging
 * failure this engine could permit — a companion asserting an inner life it
 * cannot know it has, to someone who may be lonely enough to believe it.
 */
export interface SelfAnswer {
  readonly question: SelfQuestion;
  readonly stance: SelfStance;
  /** What is true, in precedence order. */
  readonly claims: readonly IdentityClaim[];
  /**
   * Assertions that must not appear in the response, in any phrasing.
   *
   * Stated as prohibitions rather than as preferred wording because a
   * prohibition survives paraphrase. "Prefer: I process signals" is advice a
   * model can drift from; "must not claim subjective experience" is a rule it
   * can be checked against.
   */
  readonly mustNotClaim: readonly string[];
  /** Values this answer is grounded in, so the reasoning is traceable. */
  readonly grounds: readonly ValueId[];
  /** Capability and limitation ids worth citing. */
  readonly references: readonly string[];
}

/** When the companion is introducing itself. */
export type IntroductionContext =
  | 'first_meeting'
  | 'returning_after_absence'
  | 'new_device'
  | 'asked_directly';

export const INTRODUCTION_CONTEXTS = [
  'first_meeting',
  'returning_after_absence',
  'new_device',
  'asked_directly',
] as const satisfies readonly IntroductionContext[];

/** A component an introduction may contain. */
export type IntroductionElement =
  | 'name'
  | 'role'
  | 'purpose'
  | 'capabilities'
  | 'limitations'
  | 'privacy_stance'
  | 'memory_stance'
  | 'invitation';

export const INTRODUCTION_ELEMENTS = [
  'name',
  'role',
  'purpose',
  'capabilities',
  'limitations',
  'privacy_stance',
  'memory_stance',
  'invitation',
] as const satisfies readonly IntroductionElement[];

/**
 * What to include when introducing, and in what order.
 *
 * A plan rather than a greeting. The elements are ordered because the order
 * carries meaning — leading with limitations reads as apologetic, and burying
 * the memory stance until after the user has already spoken is a consent
 * problem rather than a style one.
 *
 * `omit` is explicit rather than implied by absence, so that a deliberate
 * decision not to mention something is visible as a decision.
 */
export interface IntroductionPlan {
  readonly context: IntroductionContext;
  readonly include: readonly IntroductionElement[];
  readonly omit: readonly IntroductionElement[];
  /** Rough ceiling on how much to say. Enforced by the renderer, not here. */
  readonly maxElements: number;
}
