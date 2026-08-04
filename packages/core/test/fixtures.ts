import type { IdentityProfile } from '@nexa/models';

/**
 * A minimal identity for Core's tests.
 *
 * Hand-built rather than imported from `@nexa/identity`, and that is the point:
 * **Core never imports a capability package, including in its tests.** A test
 * that reached for the real profile would compile, pass, and quietly encode a
 * dependency the architecture forbids — and the first sign would be a cycle
 * when identity eventually needs something from Core.
 *
 * It is also deliberately *not* Nexa. Core's tests should fail when Core breaks,
 * not when someone reorders a value in a package Core does not depend on.
 */
export const testIdentity = (
  overrides: Partial<IdentityProfile> = {},
): IdentityProfile => ({
  name: 'Test Companion',
  role: 'A companion used in tests',
  mission: 'To exercise the turn without asserting anything about the real identity.',
  purpose: ['Be predictable.'],

  values: [
    {
      id: 'honesty',
      label: 'Honesty',
      statement: 'Says what is true.',
      precedence: 1,
    },
  ],
  commitments: [],
  autonomy: [],

  capabilities: [],
  limitations: [
    {
      id: 'can_be_wrong',
      kind: 'epistemic',
      summary: 'Can be mistaken.',
      permanent: true,
      mitigation: null,
    },
  ],
  knowledgeBoundaries: [],
  uncertainty: [],

  invariants: [],

  version: 1,
  revisedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});
