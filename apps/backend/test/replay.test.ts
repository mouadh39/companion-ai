import { describe, expect, it } from 'vitest';
import { diff, replay, type RecordedConversation } from '../src/replay/harness.js';

/**
 * The replay harness, proving the property Phase A was built around.
 *
 * Every engine is pure, every clock read is injected and no engine mints an
 * identifier. The claim those constraints exist to support is that a
 * conversation replayed later reproduces the same cognitive state — and until
 * now that was an argument rather than a test.
 */

const conversation: RecordedConversation = {
  companionId: 'companion-replay',
  userId: 'user-replay',
  startedAt: '2026-08-04T09:00:00.000Z',
  turns: [
    { text: 'Hello there.' },
    { text: "That's wrong, I prefer Unity over Unreal for prototyping.", atOffsetMs: 60_000 },
    { text: 'I am frustrated with the shader compiler.', atOffsetMs: 120_000 },
    { text: 'Can you help me plan the shader work?', atOffsetMs: 180_000 },
    { text: 'Tell me about Unity prototyping.', atOffsetMs: 240_000 },
  ],
};

describe('deterministic replay', () => {
  it('produces identical cognitive state for identical input', async () => {
    const first = await replay(conversation);
    const second = await replay(conversation);

    expect(diff(first, second)).toStrictEqual([]);
  });

  it('produces identical perception, retrieval and plans turn by turn', async () => {
    const first = await replay(conversation);
    const second = await replay(conversation);

    expect(second.turns.map((turn) => turn.perception)).toStrictEqual(
      first.turns.map((turn) => turn.perception),
    );
    expect(second.turns.map((turn) => turn.retrieval)).toStrictEqual(
      first.turns.map((turn) => turn.retrieval),
    );
    expect(second.turns.map((turn) => turn.plan)).toStrictEqual(
      first.turns.map((turn) => turn.plan),
    );
  });

  it('reaches the same stored state', async () => {
    const first = await replay(conversation);
    const second = await replay(conversation);

    expect(second.memoryCount).toBe(first.memoryCount);
    expect(second.insightStatements).toStrictEqual(first.insightStatements);
    expect(second.relationshipStage).toBe(first.relationshipStage);
    expect(second.formationOutcomes).toStrictEqual(first.formationOutcomes);
  });

  it('shares no state between runs', async () => {
    // A harness that reused stores would measure the second run against a world
    // the first had already changed — the class of bug it exists to catch.
    const once = await replay(conversation);
    const twice = await replay(conversation);

    expect(twice.memoryCount).toBe(once.memoryCount);
    expect(twice.consolidationPasses).toBe(once.consolidationPasses);
  });
});

describe('the replay actually exercised the architecture', () => {
  it('ran every turn', async () => {
    const result = await replay(conversation);
    expect(result.turns).toHaveLength(conversation.turns.length);
  });

  it('perceived, retrieved and planned on every turn', async () => {
    const result = await replay(conversation);

    for (const [index, turn] of result.turns.entries()) {
      expect(turn.perception, `turn ${index} perception`).not.toBeNull();
      expect(turn.retrieval, `turn ${index} retrieval`).not.toBeNull();
      expect(turn.plan, `turn ${index} plan`).not.toBeNull();
    }
  });

  it('consolidated after every turn', async () => {
    const result = await replay(conversation);
    expect(result.consolidationPasses).toBe(conversation.turns.length);
  });

  it('formed at least one memory, so retrieval had something to rank', async () => {
    const result = await replay(conversation);
    expect(result.memoryCount).toBeGreaterThan(0);
  });

  it('advanced the relationship', async () => {
    const result = await replay(conversation);
    expect(result.relationshipStage).toBeDefined();
  });
});

describe('the diff is useful, not a boolean', () => {
  it('names the field that moved', async () => {
    const base = await replay(conversation);
    const shorter = await replay({ ...conversation, turns: conversation.turns.slice(0, 2) });

    const differences = diff(base, shorter);
    expect(differences.length).toBeGreaterThan(0);
    expect(differences.some((entry) => entry.startsWith('turns.length'))).toBe(true);
  });

  it('reports nothing when nothing moved', async () => {
    expect(diff(await replay(conversation), await replay(conversation))).toStrictEqual([]);
  });

  it('notices a changed message', async () => {
    const base = await replay(conversation);
    const altered = await replay({
      ...conversation,
      turns: conversation.turns.map((turn, index) =>
        index === 2 ? { ...turn, text: 'Everything is going wonderfully.' } : turn,
      ),
    });

    const differences = diff(base, altered);
    expect(differences.some((entry) => entry.includes('turns[2]'))).toBe(true);
  });
});

describe('time comes from the recording, not from the wall clock', () => {
  it('produces the same result whenever the replay is run', async () => {
    // Nothing reads `Date.now()`. If anything did, two replays seconds apart
    // would differ in recency, decay, or expiry — and this would be flaky
    // rather than failing, which is worse.
    const first = await replay(conversation);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = await replay(conversation);

    expect(diff(first, second)).toStrictEqual([]);
  });

  it('produces different results for a different recorded start', async () => {
    // The proof that the fixed clock is actually being read: same messages,
    // different instant, different timestamps throughout.
    const first = await replay(conversation);
    const later = await replay({ ...conversation, startedAt: '2027-01-01T00:00:00.000Z' });

    expect(diff(first, later).length).toBeGreaterThan(0);
  });
});
