import { describe, expect, it } from 'vitest';
import {
  NEXA_IDENTITY_V1,
  currentIdentity,
  identityAt,
  identityVersions,
} from '@nexa/identity';

describe('the profile is immutable at runtime', () => {
  it('is frozen at the top level', () => {
    expect(Object.isFrozen(currentIdentity())).toBe(true);
  });

  it('is frozen all the way down', () => {
    const profile = currentIdentity();

    expect(Object.isFrozen(profile.values)).toBe(true);
    expect(Object.isFrozen(profile.values[0])).toBe(true);
    expect(Object.isFrozen(profile.capabilities)).toBe(true);
    expect(Object.isFrozen(profile.capabilities[0])).toBe(true);
    expect(Object.isFrozen(profile.limitations[0])).toBe(true);
    expect(Object.isFrozen(profile.purpose)).toBe(true);
    expect(Object.isFrozen(profile.invariants[0])).toBe(true);
  });

  it('silently rejects mutation rather than accepting it', () => {
    const profile = currentIdentity();
    const before = profile.name;

    // `readonly` is erased at runtime, so this is what actually protects a
    // process-wide singleton every turn reads.
    expect(() => {
      (profile as { name: string }).name = 'Something Else';
    }).toThrow(TypeError);

    expect(currentIdentity().name).toBe(before);
  });

  it('cannot have entries pushed into its catalogues', () => {
    const profile = currentIdentity();
    const count = profile.values.length;

    expect(() => {
      (profile.values as unknown as string[]).push('extra');
    }).toThrow(TypeError);

    expect(currentIdentity().values).toHaveLength(count);
  });
});

describe('the profile is deterministic', () => {
  it('returns the identical object every call', () => {
    expect(currentIdentity()).toBe(currentIdentity());
  });

  it('is the same object the registry holds', () => {
    expect(currentIdentity()).toBe(NEXA_IDENTITY_V1);
    expect(identityAt(1)).toBe(NEXA_IDENTITY_V1);
  });

  it('reads no clock — `revisedAt` is a fixed constant', () => {
    expect(currentIdentity().revisedAt).toBe('2026-07-31T00:00:00.000Z');
    expect(currentIdentity().revisedAt).toBe(currentIdentity().revisedAt);
  });
});

describe('the version registry supports replay', () => {
  it('lists every published version, ascending', () => {
    expect(identityVersions()).toStrictEqual([1]);
  });

  it('returns null for an unknown version rather than falling back', () => {
    // Falling back to current would produce a confident, wrong explanation for
    // a turn recorded under an identity that no longer exists, and nothing
    // downstream could tell the difference.
    expect(identityAt(2)).toBeNull();
    expect(identityAt(0)).toBeNull();
    expect(identityAt(-1)).toBeNull();
  });

  it('agrees with the version recorded on the profile', () => {
    for (const version of identityVersions()) {
      expect(identityAt(version)?.version).toBe(version);
    }
  });
});

describe('identity content', () => {
  it('is named Nexa', () => {
    expect(currentIdentity().name).toBe('Nexa');
  });

  it('states a mission and discrete purposes rather than prose', () => {
    const profile = currentIdentity();

    expect(profile.mission.length).toBeGreaterThan(0);
    expect(profile.purpose.length).toBeGreaterThanOrEqual(3);
    // Each purpose is one aim, not a paragraph.
    for (const aim of profile.purpose) {
      expect(aim.length).toBeLessThan(200);
    }
  });

  it('records invariants with the version they were adopted in', () => {
    const profile = currentIdentity();

    expect(profile.invariants.length).toBeGreaterThanOrEqual(5);
    for (const invariant of profile.invariants) {
      expect(invariant.sinceVersion).toBeLessThanOrEqual(profile.version);
      expect(invariant.sinceVersion).toBeGreaterThan(0);
    }
  });

  it('holds no stored paragraph anyone is meant to speak', () => {
    const profile = currentIdentity();
    const statements = [
      ...profile.values.map((v) => v.statement),
      ...profile.commitments.map((c) => c.statement),
      ...profile.autonomy.map((a) => a.statement),
      ...profile.invariants.map((i) => i.statement),
    ];

    // Structured facts, not scripts. A stored paragraph would be a prompt in
    // the one place that has to survive every model change.
    for (const statement of statements) {
      expect(statement.length).toBeLessThan(220);
    }
  });
});
