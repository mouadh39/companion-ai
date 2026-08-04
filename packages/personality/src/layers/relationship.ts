import type {
  CommunicationStyle,
  ExpressionDimension,
  ExpressionReasonCode,
  Relationship,
} from '@nexa/models';
import { RELATIONSHIP_RANK } from '@nexa/models';
import type { ExpressionDraft } from '../draft.js';
import { explain, nudge, step } from '../draft.js';

/**
 * Layer 2 — what the companion and this user have become to each other.
 *
 * The layer that makes a companion different from an assistant. An assistant
 * speaks the same way to everyone forever; this is where six months of history
 * changes how the same sentence is delivered.
 *
 * Everything here is *earned*. Nothing in this layer can be reached on a first
 * meeting, and every adjustment is small — `17_Relationship_Engine.md` requires
 * gradual change, and a companion that becomes chummy after one good
 * conversation has not modelled a relationship, it has modelled enthusiasm.
 *
 * ## Trust and familiarity are read separately
 *
 * They genuinely diverge, and conflating them produces the two worst failures
 * in opposite directions. High familiarity with low trust is someone the
 * companion knows well and should still be careful with — the case a single
 * "closeness" number cannot represent, and the case where being presumptuous
 * costs the most.
 */
export const applyRelationship = (
  draft: ExpressionDraft,
  relationship: Relationship | null,
): void => {
  // No relationship record is a first meeting, not a bad one. The base layer's
  // defaults already encode how the companion treats a stranger, so there is
  // nothing to adjust and nothing to report.
  if (relationship === null) return;

  // `inferredStyle` is deliberately not read here — see the note at the end.
  const { dimensions, type, boundaries } = relationship;

  // Boundaries first, and unconditionally. They are the one field that only
  // restricts, so they must not be reachable only through a branch that an
  // earlier `return` could skip.
  if (boundaries.length > 0) {
    draft.boundaries = [...boundaries];
    explain(
      draft,
      'relationship_boundaries',
      [],
      `${String(boundaries.length)} subject(s) not to raise.`,
    );
  }

  const stage = RELATIONSHIP_RANK[type];

  // Familiarity relaxes formality and permits humour. Scaled by the dimension
  // rather than switched by the stage, so the change is continuous and a user
  // never experiences a sudden shift in how the companion talks to them.
  if (dimensions.familiarity > 0) {
    nudge(draft, 'formality', -0.25 * dimensions.familiarity);
    nudge(draft, 'directness', 0.15 * dimensions.familiarity);
    explain(
      draft,
      'relationship_familiarity',
      ['formality', 'directness'],
      `Familiarity ${dimensions.familiarity.toFixed(2)}: less formal, more direct.`,
    );
  }

  nudge(draft, 'warmth', 0.2 * (dimensions.warmth - 0.5));

  // Humour is gated on the *stage*, not the dimensions, because it is a step
  // change in what is permissible rather than a gradual warming. Joking with
  // someone is a licence, and licences are granted rather than approached.
  if (stage >= RELATIONSHIP_RANK.familiar) {
    nudge(draft, 'humor', 0.15);
    explain(
      draft,
      'relationship_familiarity',
      ['humor', 'warmth'],
      `Stage '${type}': humour is welcome.`,
    );
  }

  // Low trust holds the companion back on every axis that could presume. This
  // deliberately overlaps the familiarity boost above and is applied after, so
  // that the familiar-but-guarded case resolves guarded.
  if (dimensions.trust < 0.35) {
    nudge(draft, 'humor', -0.2);
    nudge(draft, 'directness', -0.1);
    nudge(draft, 'emotionalExpression', -0.1);
    explain(
      draft,
      'relationship_guarded',
      ['humor', 'directness', 'emotionalExpression'],
      `Trust ${dimensions.trust.toFixed(2)}: holding back.`,
    );
  }

  // Someone who relies on the companion expects it to volunteer things. This
  // can raise initiative to `offer` but never to `lead` — that remains gated on
  // stated permission, one layer down.
  if (dimensions.reliance >= 0.6) {
    step(draft, 'initiative', 1);
    explain(
      draft,
      'relationship_familiarity',
      ['initiative'],
      `Reliance ${dimensions.reliance.toFixed(2)}: volunteer more.`,
    );
  }

  // `relationship.inferredStyle` is deliberately not applied in this layer. It
  // competes with `UserPreferences.communicationStyle` for the same dimensions,
  // and letting both layers push independently leaves a residue: an inferred
  // `detailed` that raised detail by a step is still partly present after a
  // stated `concise` lowered it, so the stated preference does not actually
  // win — it merely gets the last word on a value the guess already moved.
  //
  // Resolution belongs wherever both values are visible, which is the
  // preferences layer. This one reports only what the relationship itself knows.
};

/**
 * Applies a communication style at a given strength.
 *
 * Shared by the inferred style here and the stated one in the preferences
 * layer, because the *meaning* of `direct` does not change with its source —
 * only how hard it is applied. Two copies would be two places for the meaning
 * of `concise` to drift.
 */
export const applyStyle = (
  draft: ExpressionDraft,
  style: CommunicationStyle,
  strength: number,
  code: Extract<ExpressionReasonCode, 'inferred_style' | 'stated_preference'>,
): void => {
  const note = (dimensions: readonly ExpressionDimension[]): void => {
    explain(draft, code, dimensions, `Communication style '${style}'.`);
  };

  switch (style) {
    case 'direct': {
      nudge(draft, 'directness', 0.3 * strength);
      if (strength >= 1) step(draft, 'detail', -1);
      note(['directness', 'detail']);
      return;
    }
    case 'concise': {
      nudge(draft, 'directness', 0.2 * strength);
      step(draft, 'detail', strength >= 1 ? -2 : -1);
      note(['directness', 'detail']);
      return;
    }
    case 'detailed': {
      step(draft, 'detail', strength >= 1 ? 2 : 1);
      note(['detail']);
      return;
    }
    case 'socratic': {
      nudge(draft, 'curiosity', 0.3 * strength);
      step(draft, 'initiative', strength >= 1 ? 1 : 0);
      note(['curiosity', 'initiative']);
      return;
    }
    case 'encouraging': {
      nudge(draft, 'warmth', 0.2 * strength);
      nudge(draft, 'emotionalExpression', 0.2 * strength);
      note(['warmth', 'emotionalExpression']);
      return;
    }
  }
};
