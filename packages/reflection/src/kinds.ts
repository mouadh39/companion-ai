import type { InsightCertainty, InsightKind } from '@nexa/models';

/**
 * What each kind of understanding must be earned with, and how it may be said.
 *
 * This table is where "prefer missing an insight over inventing one" stops being
 * a slogan. Every candidate pattern is measured against the policy for its kind,
 * and one that cannot clear the gates produces nothing — not a low-confidence
 * insight, not a draft for later. Nothing.
 *
 * The asymmetry across kinds is the design:
 *
 * - A `preference` is cheap to be wrong about and easy to correct, so two
 *   distinct remarks will do.
 * - A `value` is a claim about who someone is. It needs four distinct memories,
 *   three distinct things they were about, and a month of calendar time — and it
 *   still tops out well short of certainty.
 * - A `condition` is a claim about how someone is *right now*. It is capped at
 *   0.50 and expires in a week, and its phrasing is hedged at every band, so
 *   there is no path through this engine by which "they mentioned being tired"
 *   becomes "they are burnt out".
 *
 * ## No ceiling is 1
 *
 * `CERTAINTY_CEILING` bounds every kind. Reflection concludes; it does not
 * observe. A conclusion drawn from remarks about a person is never certain
 * however many remarks there were, and a system that could reach certainty here
 * would eventually assert one of its own guesses as a fact the user told it.
 */
export interface KindPolicy {
  readonly kind: InsightKind;

  /**
   * Distinct supporting memories required before anything forms.
   *
   * Distinct after near-duplicates are collapsed. Saying one thing five times is
   * one piece of evidence said loudly, and counting it as five is how a passing
   * remark becomes a settled belief.
   */
  readonly minEvidence: number;

  /**
   * Distinct underlying topics a *generalisation* needs.
   *
   * Applies only to insights that went through the theme table. Three remarks
   * about Unity support "the user enjoys Unity"; they do not support "the user
   * enjoys building interactive technology", because nothing in them is about
   * anything but Unity. Requiring breadth is what makes the difference between
   * summarising evidence and extrapolating past it.
   *
   * One is legitimate for `communication` and `learning_style`: their themes are
   * near-synonym sets rather than generalisations, so "keep it short" twice is
   * evidence for "short, direct answers" and not a leap.
   */
  readonly minThemeBreadth: number;

  /** Days the evidence must span. Zero where a pattern can legitimately be sudden. */
  readonly minSpreadDays: number;

  /** Span at which the spread factor stops rewarding more time. */
  readonly spreadSaturationDays: number;

  /**
   * Evidence count at which more stops raising confidence.
   *
   * Always above `minEvidence`, so an insight can grow surer with corroboration
   * rather than arriving at its final confidence the moment it clears the gate.
   */
  readonly saturationEvidence: number;

  /** Evidence count at which corroboration counts as complete, for stability. */
  readonly stableEvidence: number;

  /** The most this kind may ever be believed. */
  readonly ceiling: number;

  /** Below this, no insight — and an existing one is retired. */
  readonly confidenceFloor: number;

  /** Days an insight of this kind lives before it must be re-earned. */
  readonly ttlDays: number;

  /** Days without new support before confidence starts to fall. */
  readonly stalenessDays: number;

  /** Days each new piece of supporting evidence pushes expiry out. */
  readonly reinforcementExtensionDays: number;

  /**
   * A bare word cannot express this kind, so it needs a theme.
   *
   * "The user has a recurring pattern around chess" is a sentence; "…around
   * short" is not. Kinds whose statements need a phrase rather than a noun are
   * restricted to the theme route, where the phrasing is written down.
   */
  readonly requiresTheme: boolean;

  /**
   * Whether "the user does not …" may stand as an insight of its own.
   *
   * Off for most kinds. That someone is *not* struggling with something, or is
   * *not* working toward it, is true of almost everything and worth recording
   * about almost nothing. Denials still count as opposing evidence when they
   * contradict a standing claim — they simply cannot found one.
   */
  readonly licensesDenial: boolean;

  /** `{hedge}` and `{topic}` are substituted. Nothing else is. */
  readonly template: string;

  /**
   * The verb phrase per certainty band, affirming.
   *
   * The hedge carries the verb rather than sitting in front of one, because
   * English will not let a single template take "may prefer" and "consistently
   * prefers" in the same slot. Keeping the whole phrase here means every
   * sentence this engine can produce is legible in this file.
   */
  readonly hedges: Readonly<Record<InsightCertainty, string>>;

  /** The same, denying. Present for every kind even where denial is not licensed. */
  readonly negativeHedges: Readonly<Record<InsightCertainty, string>>;
}

/**
 * The hard ceiling, above every kind's own.
 *
 * A second bound doing the same job as `ceiling` looks redundant and is not: the
 * per-kind ceilings are tuning, and tuning gets changed by someone in a hurry.
 * This one is the invariant — no configuration, no evidence and no amount of
 * agreement produces a certain insight.
 */
export const CERTAINTY_CEILING = 0.85;

/** Where the bands fall. Wording follows the band, never the raw number. */
export const PROBABLE_AT = 0.45;
export const CONFIDENT_AT = 0.65;

export const KIND_POLICIES: Readonly<Record<InsightKind, KindPolicy>> = {
  /** How they like things done. Cheap to be wrong about, easy to correct. */
  preference: {
    kind: 'preference',
    minEvidence: 2,
    minThemeBreadth: 2,
    minSpreadDays: 0,
    spreadSaturationDays: 14,
    saturationEvidence: 4,
    stableEvidence: 5,
    ceiling: 0.8,
    confidenceFloor: 0.3,
    ttlDays: 365,
    stalenessDays: 180,
    reinforcementExtensionDays: 180,
    requiresTheme: false,
    licensesDenial: true,
    template: 'The user {hedge} {topic}.',
    hedges: {
      tentative: 'may prefer',
      probable: 'appears to prefer',
      confident: 'consistently prefers',
    },
    negativeHedges: {
      tentative: 'may not prefer',
      probable: 'appears not to prefer',
      confident: 'consistently does not prefer',
    },
  },

  /** What they are drawn to. The commonest useful insight, and the mildest. */
  interest: {
    kind: 'interest',
    minEvidence: 3,
    minThemeBreadth: 2,
    minSpreadDays: 0,
    spreadSaturationDays: 30,
    saturationEvidence: 5,
    stableEvidence: 6,
    ceiling: 0.8,
    confidenceFloor: 0.3,
    ttlDays: 365,
    stalenessDays: 180,
    reinforcementExtensionDays: 180,
    requiresTheme: false,
    licensesDenial: true,
    template: 'The user {hedge} {topic}.',
    hedges: {
      tentative: 'may enjoy',
      probable: 'appears to enjoy',
      confident: 'consistently enjoys',
    },
    negativeHedges: {
      tentative: 'may not enjoy',
      probable: 'appears not to enjoy',
      confident: 'consistently does not enjoy',
    },
  },

  /**
   * A recurring behaviour. Needs a week of calendar time, because a behaviour
   * seen three times in one afternoon is an afternoon, not a habit.
   */
  habit: {
    kind: 'habit',
    minEvidence: 3,
    minThemeBreadth: 2,
    minSpreadDays: 7,
    spreadSaturationDays: 45,
    saturationEvidence: 5,
    stableEvidence: 6,
    ceiling: 0.75,
    confidenceFloor: 0.35,
    ttlDays: 180,
    stalenessDays: 90,
    reinforcementExtensionDays: 90,
    requiresTheme: true,
    licensesDenial: false,
    template: 'The user {hedge} {topic}.',
    hedges: {
      tentative: 'may have a recurring pattern around',
      probable: 'appears to have a recurring pattern around',
      confident: 'has a recurring pattern around',
    },
    negativeHedges: {
      tentative: 'may have no recurring pattern around',
      probable: 'appears to have no recurring pattern around',
      confident: 'has no recurring pattern around',
    },
  },

  /**
   * A habit with temporal regularity, which is a stronger claim and priced
   * accordingly: a fortnight of spread and four distinct memories.
   */
  routine: {
    kind: 'routine',
    minEvidence: 4,
    minThemeBreadth: 2,
    minSpreadDays: 14,
    spreadSaturationDays: 60,
    saturationEvidence: 6,
    stableEvidence: 8,
    ceiling: 0.75,
    confidenceFloor: 0.4,
    ttlDays: 180,
    stalenessDays: 90,
    reinforcementExtensionDays: 90,
    requiresTheme: true,
    licensesDenial: false,
    template: "The user's routine {hedge} {topic}.",
    hedges: {
      tentative: 'may include',
      probable: 'appears to include',
      confident: 'includes',
    },
    negativeHedges: {
      tentative: 'may not include',
      probable: 'appears not to include',
      confident: 'does not include',
    },
  },

  /**
   * What matters to them. The most expensive claim in the table — it is about
   * who someone is rather than what they like — so it demands the most evidence,
   * the most breadth, a month of spread, and still tops out at 0.70.
   */
  value: {
    kind: 'value',
    minEvidence: 4,
    minThemeBreadth: 3,
    minSpreadDays: 30,
    spreadSaturationDays: 120,
    saturationEvidence: 6,
    stableEvidence: 8,
    ceiling: 0.7,
    confidenceFloor: 0.4,
    ttlDays: 1095,
    stalenessDays: 365,
    reinforcementExtensionDays: 365,
    requiresTheme: false,
    licensesDenial: true,
    template: 'The user {hedge} {topic}.',
    hedges: {
      tentative: 'may value',
      probable: 'appears to value',
      confident: 'consistently values',
    },
    negativeHedges: {
      tentative: 'may not value',
      probable: 'appears not to value',
      confident: 'consistently does not value',
    },
  },

  /**
   * Something they appear to be working toward.
   *
   * Short-lived on purpose, for the same reason the memory engine expires goals:
   * most goals quietly stop being goals, and a companion still asking about last
   * year's intentions is worse than one that let them go.
   */
  goal: {
    kind: 'goal',
    minEvidence: 2,
    minThemeBreadth: 2,
    minSpreadDays: 0,
    spreadSaturationDays: 21,
    saturationEvidence: 4,
    stableEvidence: 5,
    ceiling: 0.8,
    confidenceFloor: 0.3,
    ttlDays: 180,
    stalenessDays: 90,
    reinforcementExtensionDays: 90,
    requiresTheme: false,
    licensesDenial: false,
    template: 'The user {hedge} {topic}.',
    hedges: {
      tentative: 'may be working toward',
      probable: 'appears to be working toward',
      confident: 'is working toward',
    },
    negativeHedges: {
      tentative: 'may not be working toward',
      probable: 'appears not to be working toward',
      confident: 'is not working toward',
    },
  },

  /**
   * Something they keep finding hard.
   *
   * Phrased as difficulty *with a thing*, never as a shortcoming *of a person*.
   * "Finds difficulty with X" is an observation about a situation; "is bad at X"
   * is a judgement, and the second is not this engine's to make.
   */
  struggle: {
    kind: 'struggle',
    minEvidence: 3,
    minThemeBreadth: 2,
    minSpreadDays: 3,
    spreadSaturationDays: 30,
    saturationEvidence: 5,
    stableEvidence: 6,
    ceiling: 0.7,
    confidenceFloor: 0.35,
    ttlDays: 120,
    stalenessDays: 45,
    reinforcementExtensionDays: 60,
    requiresTheme: false,
    licensesDenial: false,
    template: 'The user {hedge} {topic}.',
    hedges: {
      tentative: 'may be finding difficulty with',
      probable: 'appears to find difficulty with',
      confident: 'repeatedly finds difficulty with',
    },
    negativeHedges: {
      tentative: 'may not be finding difficulty with',
      probable: 'appears not to find difficulty with',
      confident: 'does not find difficulty with',
    },
  },

  /** Something that keeps going well. Priced the same as `struggle`, deliberately. */
  strength: {
    kind: 'strength',
    minEvidence: 3,
    minThemeBreadth: 2,
    minSpreadDays: 3,
    spreadSaturationDays: 30,
    saturationEvidence: 5,
    stableEvidence: 6,
    ceiling: 0.7,
    confidenceFloor: 0.35,
    ttlDays: 120,
    stalenessDays: 45,
    reinforcementExtensionDays: 60,
    requiresTheme: false,
    licensesDenial: false,
    template: 'The user {hedge} {topic}.',
    hedges: {
      tentative: 'may be doing well with',
      probable: 'appears to do well with',
      confident: 'repeatedly does well with',
    },
    negativeHedges: {
      tentative: 'may not be doing well with',
      probable: 'appears not to do well with',
      confident: 'does not do well with',
    },
  },

  /**
   * How they want to be talked to.
   *
   * Worded identically to `preference` and kept a separate kind anyway, because
   * the consumers differ: the expression engine wants only this one, and
   * filtering by wording would be filtering by string match.
   */
  communication: {
    kind: 'communication',
    minEvidence: 2,
    minThemeBreadth: 1,
    minSpreadDays: 0,
    spreadSaturationDays: 14,
    saturationEvidence: 4,
    stableEvidence: 5,
    ceiling: 0.8,
    confidenceFloor: 0.3,
    ttlDays: 365,
    stalenessDays: 180,
    reinforcementExtensionDays: 180,
    requiresTheme: true,
    licensesDenial: true,
    template: 'The user {hedge} {topic}.',
    hedges: {
      tentative: 'may prefer',
      probable: 'appears to prefer',
      confident: 'consistently prefers',
    },
    negativeHedges: {
      tentative: 'may not prefer',
      probable: 'appears not to prefer',
      confident: 'consistently does not prefer',
    },
  },

  /** How they take things in. */
  learning_style: {
    kind: 'learning_style',
    minEvidence: 3,
    minThemeBreadth: 1,
    minSpreadDays: 0,
    spreadSaturationDays: 30,
    saturationEvidence: 5,
    stableEvidence: 6,
    ceiling: 0.75,
    confidenceFloor: 0.35,
    ttlDays: 365,
    stalenessDays: 180,
    reinforcementExtensionDays: 180,
    requiresTheme: true,
    licensesDenial: true,
    template: 'The user {hedge} {topic}.',
    hedges: {
      tentative: 'may learn best',
      probable: 'appears to learn best',
      confident: 'consistently learns best',
    },
    negativeHedges: {
      tentative: 'may not learn best',
      probable: 'appears not to learn best',
      confident: 'consistently does not learn best',
    },
  },

  /**
   * A present state. The most constrained entry in the table, on purpose.
   *
   * Ceiling 0.50, so the band can never reach `confident`. Seven-day life, so it
   * cannot outlast the week it describes. Theme-only, so it can only say what
   * `themes.ts` has written down. And — the part that matters — **every hedge is
   * hedged**, including the one for a band this kind cannot reach. There is no
   * configuration and no volume of evidence that makes this engine say "the user
   * is burnt out". It can say someone may currently be overworking, and that is
   * the whole of its licence.
   */
  condition: {
    kind: 'condition',
    minEvidence: 2,
    minThemeBreadth: 2,
    minSpreadDays: 0,
    spreadSaturationDays: 3,
    saturationEvidence: 3,
    stableEvidence: 4,
    ceiling: 0.5,
    confidenceFloor: 0.3,
    ttlDays: 7,
    stalenessDays: 3,
    reinforcementExtensionDays: 3,
    requiresTheme: true,
    licensesDenial: false,
    template: 'The user {hedge} currently be {topic}.',
    hedges: {
      tentative: 'may',
      probable: 'appears to',
      confident: 'appears to',
    },
    negativeHedges: {
      tentative: 'may not',
      probable: 'appears not to',
      confident: 'appears not to',
    },
  },
};

export const policyFor = (kind: InsightKind): KindPolicy => KIND_POLICIES[kind];
