import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '@nexa/core';
import type {
  BodyState,
  CapabilityReason,
  CapabilityResolution,
  CapabilityStatus,
  CognitiveContext,
  Timestamp,
} from '@nexa/models';
import { defaultBudget, defaultPersonality, timestamp } from '@nexa/models';
import { trustExternalId } from '@nexa/shared';
import type { CompanionId, TurnId, UserId } from '@nexa/shared';
import { testIdentity } from './fixtures.js';

/**
 * Embodiment awareness in the system prompt.
 *
 * `no_physical_action` is a real, permanent limitation — true for every client
 * that has not declared it can execute `move`. These tests pin that a client
 * that *has* declared it stops being told the opposite of what is true, and
 * that every other client is entirely unaffected.
 */

const limitations = [
  { id: 'can_be_wrong', kind: 'epistemic' as const, summary: 'Can be mistaken.', permanent: true, mitigation: null },
  {
    id: 'no_physical_action',
    kind: 'architectural' as const,
    summary: 'Cannot move, touch, or change anything in the physical world.',
    permanent: true,
    mitigation: null,
  },
];

const baseContext = (): CognitiveContext => ({
  turnId: trustExternalId<TurnId>('turn-1'),
  companionId: trustExternalId<CompanionId>('companion-1'),
  userId: trustExternalId<UserId>('user-1'),
  at: timestamp('2026-08-11T12:00:00.000Z'),
  perception: {
    text: 'Nexa, come over here.',
    intents: [{ kind: 'request', confidence: 0.9 as never }],
    entities: [],
    emotion: null,
  },
  identity: testIdentity({ limitations }),
  expression: null,
  personality: defaultPersonality(),
  workingMemory: [],
  retrievedMemories: [],
  goals: [],
  availableTools: [],
  clientCapabilities: null,
  emotion: null,
  relationship: null,
  world: null,
  body: null,
  self: null,
  plan: null,
  hint: null,
  budget: defaultBudget(),
});

describe('buildSystemPrompt — embodiment', () => {
  it('states the physical-action limitation for a client that declared nothing', () => {
    const prompt = buildSystemPrompt(baseContext());

    expect(prompt).toContain('Cannot move, touch, or change anything in the physical world.');
    expect(prompt).not.toContain('```nexa');
  });

  it('states the physical-action limitation for a client that did not declare move', () => {
    const context: CognitiveContext = {
      ...baseContext(),
      clientCapabilities: { actions: ['speak', 'wait'], streaming: false, locale: null },
    };

    const prompt = buildSystemPrompt(context);

    expect(prompt).toContain('Cannot move, touch, or change anything in the physical world.');
  });

  it('drops the physical-action limitation and describes the body for an embodied client', () => {
    const context: CognitiveContext = {
      ...baseContext(),
      clientCapabilities: {
        actions: ['speak', 'move', 'stop'],
        streaming: false,
        locale: null,
      },
    };

    const prompt = buildSystemPrompt(context);

    expect(prompt).not.toContain('Cannot move, touch, or change anything in the physical world.');
    expect(prompt).toContain('```nexa');
    expect(prompt).toContain('"type":"move"');
  });

  it('keeps every other permanent limitation for an embodied client', () => {
    const context: CognitiveContext = {
      ...baseContext(),
      clientCapabilities: { actions: ['speak', 'move'], streaming: false, locale: null },
    };

    expect(buildSystemPrompt(context)).toContain('Can be mistaken.');
  });

  it('describes only the actions the client actually declared', () => {
    const context: CognitiveContext = {
      ...baseContext(),
      clientCapabilities: { actions: ['speak', 'move'], streaming: false, locale: null },
    };

    const prompt = buildSystemPrompt(context);

    expect(prompt).toContain('"type":"move"');
    expect(prompt).not.toContain('"type":"follow"');
    expect(prompt).not.toContain('"type":"gesture"');
  });

  it('forbids claiming a physical result in the same reply that requests it', () => {
    const context: CognitiveContext = {
      ...baseContext(),
      clientCapabilities: { actions: ['speak', 'move'], streaming: false, locale: null },
    };

    expect(buildSystemPrompt(context)).toContain(
      'Never claim you moved, looked, or gestured in the same reply',
    );
  });

  it('warns that outcomes are unknowable when no self model is composed in', () => {
    const context: CognitiveContext = {
      ...baseContext(),
      clientCapabilities: { actions: ['speak', 'move'], streaming: false, locale: null },
      self: null,
    };

    expect(buildSystemPrompt(context)).toContain(
      'Do not claim any physical action worked.',
    );
  });
});

/**
 * The Self Model as the model sees it.
 *
 * These replace the body-only section's tests rather than sitting beside them.
 * Every distinction asserted here exists because collapsing it produces a
 * specific lie: a companion that says "I can't" to a missing camera, an unbuilt
 * feature and a rig without a clip has told the user nothing.
 */
describe('buildSystemPrompt — the self section', () => {
  const AT = '2026-08-29T12:00:00.000Z' as Timestamp;

  const resolution = (
    id: string,
    status: CapabilityStatus,
    reason: CapabilityReason | null = null,
  ): CapabilityResolution => ({
    id,
    domain: 'conversation',
    status,
    reason,
    recovery: 'none',
    summary: `${id} summary`,
  });

  const bodyState = (over: Partial<BodyState> = {}): BodyState => ({
    activity: 'idle',
    following: null,
    canPerform: ['move', 'look', 'gesture'],
    recentOutcomes: [],
    observedAt: AT,
    stale: false,
    ...over,
  });

  const withSelf = (
    capabilities: readonly CapabilityResolution[],
    body: BodyState | null = bodyState(),
  ): CognitiveContext => {
    const base = baseContext();
    return {
      ...base,
      clientCapabilities: {
        actions: ['speak', 'move', 'look', 'gesture'],
        streaming: false,
        locale: null,
      },
      self: {
        companionId: base.companionId,
        identity: base.identity,
        capabilities,
        devices: [],
        skills: [],
        body,
        observedAt: AT,
      },
    };
  };

  it('states plainly that the section is fact rather than guesswork', () => {
    expect(buildSystemPrompt(withSelf([resolution('conversation', 'available')]))).toContain(
      'These are system facts, not guesses',
    );
  });

  it('lists what it can currently do', () => {
    const prompt = buildSystemPrompt(
      withSelf([resolution('walk', 'available'), resolution('long_term_recall', 'available')]),
    );

    expect(prompt).toContain('You can currently:');
    expect(prompt).toContain('walk');
    // Ids are humanised rather than printed raw.
    expect(prompt).toContain('long term recall');
  });

  // ── the six states must not collapse ──────────────────────────────────
  // "I don't know", "I can't", "I can't right now" and "I don't have the
  // skill yet" are four different admissions, and a listener should be able to
  // tell which one they got.

  it('renders not-built as something nobody has made, not as a refusal', () => {
    const prompt = buildSystemPrompt(withSelf([resolution('see', 'unavailable', 'not_built')]));

    expect(prompt).toContain('Does not exist yet:');
    expect(prompt).toContain('nobody has built this yet');
  });

  it('renders a missing device as a right-now problem, not a permanent one', () => {
    const prompt = buildSystemPrompt(
      withSelf([resolution('see', 'currently_unavailable', 'device_missing')]),
    );

    expect(prompt).toContain('Not right now:');
    expect(prompt).toContain('hardware it needs is not connected');
    expect(prompt).not.toContain('nobody has built this yet');
  });

  it('renders a missing skill as not-yet rather than cannot', () => {
    const prompt = buildSystemPrompt(
      withSelf([resolution('gesture', 'unsupported', 'body_cannot_perform')]),
    );

    expect(prompt).toContain('This body or client cannot:');
    expect(prompt).toContain('do not have the skill for it yet');
  });

  it('renders unknown as not knowing, and tells it not to guess', () => {
    const prompt = buildSystemPrompt(withSelf([resolution('walk', 'unknown', 'no_report')]));

    expect(prompt).toContain('You do not know whether you can:');
    expect(prompt).toContain('do not guess');
  });

  it('distinguishes unsupported from unknown in the same prompt', () => {
    const prompt = buildSystemPrompt(
      withSelf([
        resolution('gesture', 'unsupported', 'body_cannot_perform'),
        resolution('walk', 'unknown', 'no_report'),
      ]),
    );

    expect(prompt).toContain('This body or client cannot:');
    expect(prompt).toContain('You do not know whether you can:');
  });

  it('renders degraded as working-with-a-limitation', () => {
    const prompt = buildSystemPrompt(
      withSelf([resolution('use_tools', 'degraded', 'partially_built')]),
    );

    expect(prompt).toContain('Partly working');
  });

  it('omits headings for states with nothing under them', () => {
    const prompt = buildSystemPrompt(withSelf([resolution('conversation', 'available')]));

    expect(prompt).not.toContain('Does not exist yet:');
    expect(prompt).not.toContain('Not right now:');
    expect(prompt).not.toContain('You do not know whether you can:');
  });

  // ── body state and action truth, carried over from Phase 5 ────────────

  it('reports what the body is doing', () => {
    const prompt = buildSystemPrompt(
      withSelf([], bodyState({ activity: 'following', following: 'you' })),
    );

    expect(prompt).toContain('Right now you are: following you');
  });

  it('renders a reported failure as a fact, and says the action did not happen', () => {
    const prompt = buildSystemPrompt(
      withSelf(
        [],
        bodyState({
          recentOutcomes: [
            {
              actionId: 'action-1' as never,
              actionType: 'move',
              parameter: null,
              turnId: null,
              status: 'failed',
              reason: 'blocked',
              detail: null,
              at: AT,
              durationMs: 1200,
            },
          ],
        }),
      ),
    );

    expect(prompt).toContain('FAILED');
    expect(prompt).toContain('something was in the way');
    expect(prompt).toContain('You did not do it.');
  });

  it('renders a reported success as finished', () => {
    const prompt = buildSystemPrompt(
      withSelf(
        [],
        bodyState({
          recentOutcomes: [
            {
              actionId: 'action-1' as never,
              actionType: 'move',
              parameter: null,
              turnId: null,
              status: 'completed',
              reason: null,
              detail: null,
              at: AT,
              durationMs: 900,
            },
          ],
        }),
      ),
    );

    expect(prompt).toContain('finished successfully');
    expect(prompt).not.toContain('You did not do it.');
  });

  it('says it does not know what its body is doing when the report is stale', () => {
    expect(buildSystemPrompt(withSelf([], bodyState({ stale: true })))).toContain(
      'has not reported in a while',
    );
  });

  // ── separation ────────────────────────────────────────────────────────

  it('carries no user id into the prompt', () => {
    const context = withSelf([resolution('conversation', 'available')]);
    const prompt = buildSystemPrompt(context);

    expect(prompt).not.toContain(context.userId);
  });

  it('says nothing about devices or skills until something reports them', () => {
    const prompt = buildSystemPrompt(withSelf([resolution('conversation', 'available')]));

    expect(prompt).not.toContain('Connected:');
    expect(prompt).not.toContain('Things you know how to perform:');
  });

  it('keeps the spoken-delivery rules after the self section for a voice turn', () => {
    const base = withSelf([resolution('conversation', 'available')]);
    const context: CognitiveContext = {
      ...base,
      clientCapabilities: { ...base.clientCapabilities!, speechOutput: true },
    };

    const prompt = buildSystemPrompt(context);

    // The delivery rules must govern the final shape, so they come last.
    expect(prompt.indexOf('Write for the ear.')).toBeGreaterThan(
      prompt.indexOf('These are system facts'),
    );
  });

  it('places the self section after the frozen identity block', () => {
    const prompt = buildSystemPrompt(withSelf([resolution('conversation', 'available')]));

    // Identity is the cacheable prefix; anything that changes per turn must
    // come after it or nothing caches.
    expect(prompt.indexOf('These are system facts')).toBeGreaterThan(
      prompt.indexOf('Your values, numbered by precedence'),
    );
  });
});

