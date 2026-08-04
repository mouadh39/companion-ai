import Fastify, { type FastifyInstance } from 'fastify';
import { trustExternalId, type CompanionId, type UserId } from '@nexa/shared';
import type { AppConfig } from './config.js';
import type { Application } from './composition.js';

/**
 * The HTTP boundary.
 *
 * Its only job is to turn a request into a `TurnRequest` and a `TurnResult`
 * into JSON. It knows nothing about cognition — no prompt, no memory, no
 * decision logic reaches this file, which is what keeps clients interchangeable.
 */

interface TurnBody {
  readonly companionId?: unknown;
  readonly userId?: unknown;
  readonly text?: unknown;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const buildServer = (app: Application, config: AppConfig): FastifyInstance => {
  const server = Fastify({ logger: { level: config.logLevel } });

  server.get('/health', async () => ({
    status: 'ok',
    model: app.modelName,
    at: app.clock.nowIso(),
  }));

  server.post('/v1/turn', async (request, reply) => {
    const body = request.body as TurnBody | undefined;

    if (body === undefined || !isNonEmptyString(body.text)) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: "Field 'text' is required and must be a non-empty string.",
      });
    }
    if (!isNonEmptyString(body.companionId) || !isNonEmptyString(body.userId)) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: "Fields 'companionId' and 'userId' are required.",
      });
    }

    const result = await app.turn.run({
      companionId: trustExternalId<CompanionId>(body.companionId),
      userId: trustExternalId<UserId>(body.userId),
      text: body.text,
      source: 'user',
    });

    if (!result.ok) {
      const { turnId, stage, error } = result.error;
      request.log.error({ turnId, stage, err: error }, 'cognitive turn failed');

      // The stage is returned deliberately. A failure the caller cannot locate
      // is a failure they cannot report usefully.
      return reply.code(502).send({
        error: 'turn_failed',
        turnId,
        stage,
        message: error.message,
      });
    }

    const { turnId, actions, decision, degraded, durationMs } = result.value;

    // The decision travels with the actions so any answer can be accounted for
    // without a separate lookup — explainability as a property of the response,
    // not a debugging endpoint.
    return reply.code(200).send({
      turnId,
      actions,
      decision: {
        id: decision.id,
        kind: decision.kind,
        confidence: decision.confidence,
        reasonCodes: decision.reasonCodes,
        alternatives: decision.alternatives,
      },
      degraded,
      durationMs,
    });
  });

  return server;
};
