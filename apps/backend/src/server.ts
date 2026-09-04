import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  trustExternalId,
  type ActionId,
  type CompanionId,
  type DeviceId,
  type TurnId,
  type UserId,
} from '@nexa/shared';
import {
  ACTION_OUTCOME_STATUSES,
  ACTION_FAILURE_REASONS,
  ACTION_TYPES,
  BODY_ACTIVITIES,
  DEVICE_KINDS,
  DEVICE_STATUSES,
  FACULTY_KEYS,
  SKILL_SOURCES,
  SKILL_VALIDATIONS,
  timestamp,
  type ActionFailureReason,
  type ActionOutcomeStatus,
  type ActionType,
  type BodyActivity,
  type ClientCapabilities,
  type DeviceDescriptor,
  type FacultyKey,
  type SkillDescriptor,
} from '@nexa/models';
import type { AppConfig } from './config.js';
import type { ActionOutcome } from '@nexa/models';
import type { Application } from './composition.js';
import { bearerToken, type AuthenticatedIdentity } from './auth/port.js';
import { parseP256Spki, isPlausibleBase64 } from './devices/spki.js';
import { KEY_SECURITY_LEVELS, type KeySecurityLevel } from './devices/enrolments.js';

/**
 * The HTTP boundary.
 *
 * Its only job is to turn a request into a `TurnRequest` and a `TurnResult`
 * into JSON. It knows nothing about cognition — no prompt, no memory, no
 * decision logic reaches this file, which is what keeps clients interchangeable.
 */

interface ClientCapabilitiesBody {
  readonly actions?: unknown;
  readonly streaming?: unknown;
  readonly locale?: unknown;
  readonly speechOutput?: unknown;
}

/**
 * What a device registration may say about itself.
 *
 * One optional field, on purpose. There is no `kind`, no `userId` and no `id`
 * here — not because the handler ignores them, but because a request that
 * cannot express them cannot be misread as expressing them.
 */
interface DeviceBody {
  readonly label?: unknown;
}

/**
 * What a headset may say about the key it generated.
 *
 * Deliberately two fields. There is no `userId` — the whole point of an
 * enrolment is that it precedes an account. There is no `publicKeyId` either:
 * a fingerprint the caller asserts is a claim, and the key already determines
 * one that cannot be spoofed, so accepting an alternative would only invite a
 * mismatch between what a caller says a key's identity is and what it is.
 */
interface DeviceEnrolmentBody {
  readonly publicKey?: unknown;
  readonly keySecurityLevel?: unknown;
}

/**
 * What an authenticated phone may say when asking for a pairing session.
 *
 * No `userId` — the verified token is the only source of that. No headset
 * public key, no `publicKeyId` — the handle is a pointer the backend
 * resolves, and accepting either from the caller would let a request assert
 * an identity for a key rather than have the enrolment prove it.
 */
interface PairingSessionBody {
  readonly phoneDeviceId?: unknown;
  readonly enrolmentHandle?: unknown;
}

/**
 * What a headset may say when redeeming a pairing code.
 *
 * Two fields, both already meaningless without the other. There is no
 * `publicKeyId` and no `userId` — the key this proof is checked against, and
 * the account it lands on, both come from the session the code resolves to,
 * never from anything this body could assert.
 */
interface RedeemPairingSessionBody {
  readonly code?: unknown;
  readonly signature?: unknown;
}

/**
 * What a headset may say when refreshing its credentials.
 *
 * Two fields, the same shape as `RedeemPairingSessionBody` and for the same
 * reason: no `deviceId`, no `userId`, no `publicKeyId`. Everything about
 * whose family this is and which key must have signed for it comes from the
 * refresh token itself, resolved server-side — see
 * `DeviceTokenStore.refresh` and `buildRefreshChallenge`.
 */
interface RefreshDeviceTokenBody {
  readonly refreshToken?: unknown;
  readonly signature?: unknown;
}

/**
 * A crude, bounded guard against hammering the one route on this server that
 * asks for no credential.
 *
 * Fixed-window rather than sliding — simpler, and adequate here: the route it
 * guards issues nothing of value on its own (see `EnrolmentStore`), so being
 * generous costs little. The tracked-key map is capped so a flood of forged
 * source addresses cannot grow it without bound either, which matters more
 * for this limiter than for most — it is itself part of the defence against
 * unbounded growth from an unauthenticated route.
 *
 * One instance per `buildServer` call, which is what keeps this out of
 * `Application`: it is an HTTP-transport concern, not a domain one, and each
 * test's own server already gets a private counter for free.
 */
const createRateLimiter = (max: number, windowMs: number, maxTrackedKeys = 10_000) => {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return {
    allow(key: string): boolean {
      const now = Date.now();
      const entry = hits.get(key);

      if (entry === undefined || now >= entry.resetAt) {
        if (hits.size >= maxTrackedKeys) {
          const oldest = hits.keys().next().value;
          if (oldest !== undefined) hits.delete(oldest);
        }
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }

      if (entry.count >= max) return false;
      entry.count += 1;
      return true;
    },
  };
};

interface TurnBody {
  readonly companionId?: unknown;
  readonly userId?: unknown;
  readonly text?: unknown;
  /** Optional. Omitted means "unknown", handled downstream exactly like a client that never declares itself. */
  readonly clientCapabilities?: ClientCapabilitiesBody;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isActionType = (value: unknown): value is ActionType =>
  typeof value === 'string' && (ACTION_TYPES as readonly string[]).includes(value);

/**
 * Reads a client's declared capabilities, or null when the field is absent or
 * malformed.
 *
 * Malformed is treated the same as absent rather than rejected with a 400: a
 * client capability declaration is advisory, not part of the request's
 * validity, and a client that sent something slightly wrong should get the
 * unrestricted default rather than a failed turn over an optional field.
 */
const readClientCapabilities = (body: ClientCapabilitiesBody | undefined): ClientCapabilities | null => {
  if (body === undefined || !Array.isArray(body.actions)) return null;

  const actions = body.actions.filter(isActionType);
  if (actions.length === 0) return null;

  return {
    actions,
    streaming: body.streaming === true,
    locale: typeof body.locale === 'string' && body.locale.trim().length > 0 ? body.locale : null,
    // Omitted entirely when the client did not send a boolean, so "did not say"
    // stays distinguishable from "said no" — exactOptionalPropertyTypes makes
    // that difference real rather than decorative.
    ...(typeof body.speechOutput === 'boolean' ? { speechOutput: body.speechOutput } : {}),
  };
};


/**
 * Why a caller was turned away, in the shape a route answers with.
 *
 * Shared by both admission steps, so a route handles one failure type however
 * far the caller got, and so the status codes stay in one place rather than
 * being re-decided per route.
 */
type Refused = {
  readonly ok: false;
  readonly status: number;
  readonly error: string;
  readonly message: string;
};

type Authentication = { readonly ok: true; readonly identity: AuthenticatedIdentity } | Refused;

interface Caller {
  readonly userId: UserId;
  readonly companionId: CompanionId;
}

type Admission = { readonly ok: true; readonly caller: Caller } | Refused;

/**
 * Proves who is calling. Nothing more.
 *
 * ## What is trusted and what is not
 *
 * The returned `userId` comes from the verified credential and **never** from
 * the request body. A body may still carry one — every existing client sends it
 * — and it is ignored rather than rejected, so a client can be updated without
 * a flag day. Ignoring is the safe direction: a mismatch cannot escalate, it can
 * only be discarded.
 *
 * ## Why this is separate from the companion check
 *
 * Identity is settled before anyone asks what the caller wants to do. An
 * operation that concerns the *account* rather than a character has no
 * `companionId` to give, and must not be made to invent one to get past the
 * door — which is what a single combined check would force it to do.
 */
export const authenticate = async (
  app: Application,
  request: FastifyRequest,
): Promise<Authentication> => {
  const result = await app.auth.verify(bearerToken(request.headers.authorization));

  if (!result.ok) {
    // Logged in full, answered in one word. Telling a caller precisely why a
    // token failed tells an attacker what to change.
    request.log.warn(
      { kind: result.failure.kind, detail: result.failure.detail },
      'authentication refused',
    );

    return result.failure.kind === 'unavailable'
      ? {
          ok: false,
          status: 503,
          error: 'authentication_unavailable',
          message: 'Authentication is not available.',
        }
      : {
          ok: false,
          status: 401,
          error: 'unauthenticated',
          message: 'A valid bearer credential is required.',
        };
  }

  return { ok: true, identity: result.identity };
};

/**
 * Proves who is calling, and that they may act as the companion they named.
 *
 * Both cognitive routes go through this and neither may skip it. Returning a
 * discriminated result rather than writing the response here keeps the routes
 * readable and keeps one place responsible for the status codes.
 *
 * `companionId` is still the caller's, because only the caller knows which of
 * its companions it is speaking to. What changes is that the claim is checked
 * against a binding, so naming somebody else's companion is a 403 rather than
 * an act of ventriloquism.
 *
 * Built on {@link authenticate} rather than verifying a second time: one
 * verifier, one place where a credential becomes an identity. A second copy
 * would be a second thing to get wrong, and the two would drift.
 */
export const admitForCompanion = async (
  app: Application,
  request: FastifyRequest,
  companionIdClaim: unknown,
): Promise<Admission> => {
  const authentication = await authenticate(app, request);
  if (!authentication.ok) return authentication;

  if (!isNonEmptyString(companionIdClaim)) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_request',
      message: "Field 'companionId' is required.",
    };
  }

  const companionId = trustExternalId<CompanionId>(companionIdClaim);
  const { userId } = authentication.identity;
  const bound = await app.bindings.isBound(userId, companionId);

  if (!bound) {
    // Deliberately not 404. The caller is authenticated and simply not
    // permitted, and pretending the companion does not exist would make a
    // misconfigured client indistinguishable from an attack.
    request.log.warn({ companionId }, 'companion is not bound to the caller');

    return {
      ok: false,
      status: 403,
      error: 'forbidden',
      message: 'That companion is not bound to this account.',
    };
  }

  return { ok: true, caller: { userId, companionId } };
};

export const buildServer = (app: Application, config: AppConfig): FastifyInstance => {
  const server = Fastify({ logger: { level: config.logLevel } });

  // 20 attempts per 5 minutes per source address — generous for a legitimate
  // headset enrolling once, and bounded for anything else. See
  // `createRateLimiter`.
  const enrolmentRateLimit = createRateLimiter(20, 5 * 60 * 1000);

  // Same shape as the enrolment limiter, and for the same reason: this route
  // asks for no credential either, so a source address is all there is to
  // bound by. A genuine headset redeems once; nothing legitimate comes close
  // to this ceiling.
  const redeemRateLimit = createRateLimiter(20, 5 * 60 * 1000);

  // Same shape again. A refresh also carries its own credential — the
  // signature — rather than a bearer token `authenticate()` would otherwise
  // rate-limit indirectly by rejecting it, so this route needs its own
  // per-address ceiling too. Set higher than enrolment/redeem: unlike those
  // one-time steps, a live headset refreshes repeatedly over its 14-day
  // inactivity window, and a source address may be shared by several devices
  // behind the same network.
  const refreshRateLimit = createRateLimiter(60, 5 * 60 * 1000);

  server.get('/health', async () => ({
    status: 'ok',
    model: app.modelName,
    at: app.clock.nowIso(),
  }));

  /**
   * Register the phone this app is running on.
   *
   * The first durable device on an account, and a precondition for pairing: a
   * pairing session records which device vouched for the headset, so a phone
   * that is not on the account cannot open one.
   *
   * ## What the caller may and may not choose
   *
   * The body carries a display label and nothing else. The account comes from
   * the verified token, the kind is fixed, and the id is minted server-side —
   * none of the three is a field a request could set, so none of them is a
   * field a handler has to remember to ignore.
   *
   * A headset cannot register here, and not merely by policy: it holds no
   * credential until it has paired, so it cannot reach an authenticated route
   * at all. That is the whole reason pairing exists.
   */
  server.post('/v1/devices', async (request, reply) => {
    const authentication = await authenticate(app, request);
    if (!authentication.ok) {
      return reply
        .code(authentication.status)
        .send({ error: authentication.error, message: authentication.message });
    }

    const body = request.body as DeviceBody | undefined;

    // Absent and blank are both "no label". A label is decoration, so a client
    // that sends an empty string should get a device, not a 400.
    const label = isNonEmptyString(body?.label) ? body.label.trim() : null;

    const device = await app.devices.registerPhone({
      userId: authentication.identity.userId,
      label,
    });

    // Deliberately not the whole row. `userId` would echo back something the
    // caller already proved and cannot change, and key material has no reason
    // to appear on an account-facing read.
    return reply.code(201).send({
      deviceId: device.id,
      kind: device.kind,
      label: device.label,
      registeredAt: device.registeredAt.toISOString(),
    });
  });

  /**
   * An authenticated phone turns an enrolment handle into a pairing session.
   *
   * ## What is trusted and what is not
   *
   * `userId` comes from the verified token, exactly as everywhere else in
   * this file — never from the body. `phoneDeviceId` is a claim the caller
   * makes about which of its own devices is asking, checked against
   * `app.devices` before it is trusted for anything; a device id that does
   * not belong to this account is refused precisely as an unbound companion
   * is by `admitForCompanion` — 403, not 404, so a misconfigured client and
   * an attacker read the same.
   *
   * The headset's public key is never a field this route reads. It is
   * resolved server-side from the enrolment the handle names, by
   * `app.pairingSessions`, which is also what makes creating a session the
   * act that consumes that enrolment — see `PairingSessionStore`.
   *
   * ## What this route must never do
   *
   * It does not issue an access token, a refresh token, or a headset device
   * token. It does not call `app.devices.registerPhone` — no device row is
   * created for the headset here, because the headset has not proven
   * anything yet. It does not touch `app.bindings`. Those all belong to
   * redemption, which this step does not implement.
   */
  server.post('/v1/pairing-sessions', async (request, reply) => {
    const authentication = await authenticate(app, request);
    if (!authentication.ok) {
      return reply
        .code(authentication.status)
        .send({ error: authentication.error, message: authentication.message });
    }

    const body = request.body as PairingSessionBody | undefined;

    if (!isNonEmptyString(body?.phoneDeviceId)) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: "Field 'phoneDeviceId' is required.",
      });
    }
    if (!isNonEmptyString(body?.enrolmentHandle)) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: "Field 'enrolmentHandle' is required.",
      });
    }

    const { userId } = authentication.identity;
    const phoneDeviceId = trustExternalId<DeviceId>(body.phoneDeviceId);
    const device = await app.devices.find(userId, phoneDeviceId);

    // Deliberately one message for "no such device", "someone else's
    // device", and "not a phone". Distinguishing them would tell a caller
    // which guess was closer, for no benefit to a legitimate one — a
    // legitimate caller already knows which of its own devices this is.
    if (device === null || device.kind !== 'phone') {
      request.log.warn({ phoneDeviceId }, 'pairing session requested for a device the caller does not own');
      return reply.code(403).send({
        error: 'forbidden',
        message: 'That device is not registered to this account.',
      });
    }

    const result = await app.pairingSessions.create({
      userId,
      phoneDeviceId,
      enrolmentHandle: body.enrolmentHandle,
    });

    if (!result.ok) {
      // Never the handle itself, in the response or in this log line — see
      // the module doc on `PairingSessionStore.create`.
      request.log.warn({ reason: result.reason }, 'enrolment handle could not be resolved');
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'That enrolment handle is not usable.',
      });
    }

    // Exactly what the phone needs to show the code next. No headset
    // identity, no key material, no account information — none of it is
    // this response's to carry.
    return reply.code(201).send({
      pairingSessionId: result.session.pairingSessionId,
      code: result.session.code,
      expiresAt: result.session.expiresAt.toISOString(),
    });
  });

  /**
   * An authenticated phone checks a session it created — the only
   * authoritative way it can ever learn a headset actually redeemed, since
   * `POST /v1/pairing-sessions/redeem` itself is an unauthenticated,
   * headset-only call this phone is never party to. Polled, not pushed: no
   * new infrastructure, a plain GET against the same authenticated-phone
   * boundary `POST /v1/pairing-sessions` already uses.
   *
   * ## What this route must never do
   *
   * The response has exactly two fields, `status` and `deviceId`. No code,
   * no code hash, no public key, no signature, no access token, no refresh
   * token, no private key (which this process never holds in the first
   * place) — none of that is this route's to carry, the same standard
   * every other pairing response in this file already holds itself to.
   *
   * ## Why "not mine" and "does not exist" read identically
   *
   * `PairingSessionStore.getStatus` reports `not_found` for both, and this
   * route answers both with the same 404 — see that method's own doc.
   * Distinguishing them would hand a caller an existence oracle over
   * sessions, and therefore pairing attempts, it has no claim to.
   */
  server.get('/v1/pairing-sessions/:pairingSessionId/status', async (request, reply) => {
    const authentication = await authenticate(app, request);
    if (!authentication.ok) {
      return reply
        .code(authentication.status)
        .send({ error: authentication.error, message: authentication.message });
    }

    const params = request.params as { readonly pairingSessionId?: unknown };

    // A malformed id (missing, empty, or absurdly long) is refused before it
    // ever reaches a store lookup — the same cheap-guard-first shape
    // `PairingCodeValidator.MaxLength` documents on the Unity/headset side
    // for the same reason: refuse what plainly cannot be genuine before
    // spending a query on it.
    if (!isNonEmptyString(params.pairingSessionId) || params.pairingSessionId.length > 128) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'A valid pairing session id is required.',
      });
    }

    const result = await app.pairingSessions.getStatus({
      pairingSessionId: params.pairingSessionId,
      userId: authentication.identity.userId,
    });

    if (!result.ok) {
      // Deliberately identical whether the id is simply wrong or belongs to
      // someone else — see the route's own doc.
      return reply.code(404).send({
        error: 'not_found',
        message: 'No pairing session found for this account.',
      });
    }

    return reply.code(200).send({
      status: result.info.status,
      deviceId: result.info.deviceId,
    });
  });

  /**
   * A headset publishes the public half of a key it generated itself.
   *
   * ## Why this is unauthenticated, deliberately
   *
   * A headset that has never paired holds no Nexa credential — requiring one
   * here would make enrolment impossible for exactly the device that needs
   * it. That is safe only because an enrolment is a publication and nothing
   * more: it names a public key against a short-lived handle, and grants no
   * account access, no token and no binding. See `EnrolmentStore` and
   * `0006_device_enrolments.sql`.
   *
   * ## What this route must never do
   *
   * It has no `userId` to accept and no field that could carry one. It does
   * not read `app.auth`, does not touch `app.devices`, and does not touch
   * `app.bindings`. If a later change makes any of those true, this comment
   * is the place that should have stopped it.
   *
   * A tight per-route body limit, well above any legitimate SPKI DER encoded
   * as base64 but far below anything worth parsing, so an oversized payload
   * is rejected by Fastify before this handler — or the key parser — ever
   * sees it.
   */
  server.post('/v1/device-enrolments', { bodyLimit: 8_192 }, async (request, reply) => {
    if (!enrolmentRateLimit.allow(request.ip)) {
      return reply.code(429).send({
        error: 'rate_limited',
        message: 'Too many enrolment attempts. Try again shortly.',
      });
    }

    const body = request.body as DeviceEnrolmentBody | undefined;

    if (typeof body !== 'object' || body === null || !isNonEmptyString(body.publicKey)) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: "Field 'publicKey' is required and must be base64-encoded SPKI DER.",
      });
    }

    let keySecurityLevel: KeySecurityLevel | null = null;
    if (body.keySecurityLevel !== undefined) {
      if (!isMember(body.keySecurityLevel, KEY_SECURITY_LEVELS)) {
        return reply.code(400).send({
          error: 'invalid_request',
          message: `Field 'keySecurityLevel' must be one of: ${KEY_SECURITY_LEVELS.join(', ')}.`,
        });
      }
      keySecurityLevel = body.keySecurityLevel;
    }

    const parsed = parseP256Spki(body.publicKey);
    if (!parsed.ok) {
      // Not authentication, so — unlike a token failure — there is no reason
      // to collapse the reason. A headset developer debugging a bad key
      // benefits from being told what was actually wrong with it.
      const messages: Record<typeof parsed.reason, string> = {
        malformed_base64: "Field 'publicKey' is not valid base64.",
        malformed_der: "Field 'publicKey' does not decode as an X.509 SubjectPublicKeyInfo.",
        not_ec: "Field 'publicKey' must be an EC public key.",
        wrong_curve: "Field 'publicKey' must be a P-256 (prime256v1) key.",
      };
      return reply.code(400).send({ error: 'invalid_request', message: messages[parsed.reason] });
    }

    const issued = await app.enrolments.enrol({
      publicKey: parsed.der,
      publicKeyId: parsed.keyId,
      keySecurityLevel,
    });

    // Exactly what the headset needs to hold the code up next: the handle,
    // once, and when it stops being usable. Nothing else — no account state
    // exists yet to describe.
    return reply.code(201).send({
      enrolmentId: issued.enrolmentId,
      handle: issued.handle,
      expiresAt: issued.expiresAt.toISOString(),
    });
  });

  /**
   * A headset proves it holds the private key bound to a pairing session,
   * and — if the proof holds — is registered as a device on the account
   * that session belongs to, and issued its first `nexa-device` credentials.
   *
   * ## Why this is unauthenticated, deliberately
   *
   * The headset has no Nexa credential at this point in the flow; the
   * signature it sends **is** the credential this route accepts, exactly as
   * `/v1/device-enrolments` accepts a published key with no credential
   * behind it either.
   *
   * ## What this route must never do
   *
   * It has no `userId` field and no `publicKeyId` field — nothing about the
   * account or the key comes from the request body, only from the session
   * `app.pairingSessions.redeem` resolves server-side. It does not read
   * `app.auth` and does not touch `app.bindings`: the credentials it returns
   * come entirely from `redeem`'s own result (Step 3E), never minted here.
   * If a later change makes any of those false, this comment is the place
   * that should have stopped it.
   */
  server.post('/v1/pairing-sessions/redeem', async (request, reply) => {
    if (!redeemRateLimit.allow(request.ip)) {
      return reply.code(429).send({
        error: 'rate_limited',
        message: 'Too many redemption attempts. Try again shortly.',
      });
    }

    const body = request.body as RedeemPairingSessionBody | undefined;

    if (!isNonEmptyString(body?.code) || !body.code.startsWith('NX2.')) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: "Field 'code' is required and must be a valid NX2 pairing code.",
      });
    }
    if (!isNonEmptyString(body.signature) || !isPlausibleBase64(body.signature)) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: "Field 'signature' is required and must be base64-encoded.",
      });
    }

    const result = await app.pairingSessions.redeem({
      // The prefix is a display/transport marker, not part of what was
      // signed or hashed — stripped here, once, at the request boundary.
      secret: body.code.slice('NX2.'.length),
      signature: Buffer.from(body.signature, 'base64'),
    });

    if (!result.ok) {
      // One message for "no such code", "expired", "already redeemed" and
      // "wrong signature" alike — see the module doc on
      // `PairingSessionStore.redeem`. Never logged with the code or the
      // signature; both are exactly the values a real attempt must not leak.
      request.log.warn({ reason: result.reason }, 'pairing code could not be redeemed');
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'That pairing code could not be redeemed.',
      });
    }

    // Exactly what a freshly-paired headset needs to start calling
    // authenticated routes: its own device id, and the one time its
    // refresh token's plaintext is ever returned. Nothing about the
    // account beyond the id it was just registered under.
    return reply.code(200).send({
      paired: true,
      deviceId: result.redeemed.deviceId,
      accessToken: result.redeemed.accessToken,
      refreshToken: result.redeemed.refreshToken,
      expiresIn: result.redeemed.expiresInSeconds,
    });
  });

  /**
   * A headset trades a still-live refresh token, plus a fresh signature over
   * it, for a rotated access+refresh pair.
   *
   * ## Why this is unauthenticated, deliberately
   *
   * Same reasoning as `/v1/pairing-sessions/redeem`: the refresh token and
   * the signature over it together **are** the credential this route
   * accepts. There is no bearer token to check first — the access token may
   * already be expired, which is the entire reason a refresh is happening.
   *
   * ## What this route must never do
   *
   * It has no `deviceId` field, no `userId` field and no `publicKeyId`
   * field — which family this is, which device it belongs to, and which key
   * must have signed for it all come from `app.deviceTokens.refresh`
   * resolving the token server-side, never from anything this body could
   * assert. It does not read `app.auth`.
   */
  server.post('/v1/devices/token/refresh', async (request, reply) => {
    if (!refreshRateLimit.allow(request.ip)) {
      return reply.code(429).send({
        error: 'rate_limited',
        message: 'Too many refresh attempts. Try again shortly.',
      });
    }

    const body = request.body as RefreshDeviceTokenBody | undefined;

    if (!isNonEmptyString(body?.refreshToken)) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: "Field 'refreshToken' is required.",
      });
    }
    if (!isNonEmptyString(body.signature) || !isPlausibleBase64(body.signature)) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: "Field 'signature' is required and must be base64-encoded.",
      });
    }

    const result = await app.deviceTokens.refresh(body.refreshToken, Buffer.from(body.signature, 'base64'));

    if (!result.ok) {
      // One message for "unknown token", "expired", "revoked", "already
      // rotated", "revoked device", "wrong signature" and "modified
      // challenge" alike — see the module doc on `DeviceTokenStore.refresh`.
      // Never logged with the refresh token or the signature; both are
      // exactly the values a real attempt must not leak.
      request.log.warn({ reason: result.reason }, 'device token could not be refreshed');
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'That refresh token could not be used.',
      });
    }

    return reply.code(200).send({
      accessToken: result.credentials.accessToken,
      refreshToken: result.credentials.refreshToken,
      expiresIn: result.credentials.expiresInSeconds,
    });
  });

  server.post('/v1/turn', async (request, reply) => {
    const body = request.body as TurnBody | undefined;

    if (body === undefined || !isNonEmptyString(body.text)) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: "Field 'text' is required and must be a non-empty string.",
      });
    }
    const admission = await admitForCompanion(app, request, body.companionId);
    if (!admission.ok) {
      return reply
        .code(admission.status)
        .send({ error: admission.error, message: admission.message });
    }

    const clientCapabilities = readClientCapabilities(body.clientCapabilities);

    const result = await app.turn.run({
      // Both from the admission, never from the body. A `userId` in the payload
      // is a claim the caller made about itself and is discarded.
      companionId: admission.caller.companionId,
      userId: admission.caller.userId,
      text: body.text,
      source: 'user',
      // exactOptionalPropertyTypes: omitted entirely rather than set to
      // undefined, matching TurnRequest's own "omitted means unknown" contract.
      ...(clientCapabilities !== null ? { clientCapabilities } : {}),
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

  /**
   * What a client's body did with the actions it was given.
   *
   * The return leg of the action protocol, and a *fact ingress* rather than a
   * turn: it writes and returns, and never reasons. Actions arrive on the turn's
   * response and outcomes arrive here, minutes or milliseconds later, from a
   * body that has its own clock and its own idea of when it is finished.
   *
   * This is the endpoint that makes "the language model is not the authority on
   * whether the action succeeded" enforceable rather than a hope. Before it
   * existed, the only thing that knew whether Nexa had moved was the Unity
   * process, and the only thing writing the sentence about it was a model with
   * no access to that process.
   *
   * Deliberately not `/v1/turn` with a flag. A turn perceives, retrieves,
   * deliberates and generates; an outcome does none of those, and routing it
   * through the pipeline would mean the body could not report a failure without
   * spending a provider call to be told about it.
   *
   * Accepts a batch, because the executor finishes a queue of actions and should
   * not need one request per gesture.
   */
  server.post('/v1/action-result', async (request, reply) => {
    const body = request.body as OutcomeBody | undefined;

    const admission = await admitForCompanion(app, request, body?.companionId);
    if (!admission.ok) {
      return reply
        .code(admission.status)
        .send({ error: admission.error, message: admission.message });
    }

    const raw = Array.isArray(body?.outcomes) ? body.outcomes : [];
    const activity = readActivity(body?.activity);

    // A post with no outcomes is legitimate once a client can report state on
    // its own: a microphone unplugged while the body is idle finishes no
    // action, and refusing it would mean the companion only learns its
    // hardware changed the next time it happens to move.
    if (raw.length === 0 && activity === null) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: "Send at least one outcome, or an 'activity' describing the body now.",
      });
    }

    const { companionId, userId } = admission.caller;

    // Read and reported per item. A batch in which one entry is malformed still
    // records the rest: dropping four good outcomes because a fifth had a typo
    // would lose exactly the evidence the companion needs, and the client has no
    // way to resend them.
    let accepted = 0;
    const rejected: string[] = [];

    for (const entry of raw) {
      const outcome = readOutcome(entry);
      if (outcome === null) {
        // Identified by the action id it claimed, when it claimed a readable
        // one. A rejection the client cannot match to an action is a rejection
        // it cannot act on, and inventing an identifier would be worse than
        // admitting the entry was unrecognisable.
        const claimed =
          typeof entry === 'object' && entry !== null
            ? (entry as Record<string, unknown>)['actionId']
            : undefined;
        rejected.push(isNonEmptyString(claimed) ? claimed : 'unidentified');
        continue;
      }

      await app.reportActionOutcome(companionId, userId, outcome);
      accepted += 1;
    }

    // The body's own account of what it is doing now, when it sent one. Separate
    // from the outcomes because it is a claim about the present rather than
    // about something finished — see `EmbodimentState.observe`.
    if (activity !== null) {
      app.observeBody(companionId, {
        activity,
        following: isNonEmptyString(body?.following) ? body.following : null,
        canPerform: Array.isArray(body?.canPerform)
          ? body.canPerform.filter(isActionType)
          : [],
        // Read per item and silently dropped when unreadable. A malformed
        // device must not cost the report the ones alongside it, and it must
        // never fail the request: a body describing itself badly is still a
        // body that moved, and the outcomes in the same post are the part that
        // cannot be resent.
        ...(Array.isArray(body?.devices)
          ? { devices: body.devices.map(readDevice).filter(isPresent) }
          : {}),
        ...(Array.isArray(body?.skills)
          ? { skills: body.skills.map(readSkill).filter(isPresent) }
          : {}),
      });
    }

    // Only a failure when outcomes were actually sent. A state-only post
    // legitimately accepts nothing, and rejecting it would refuse the very
    // reports — a microphone unplugged, a rig without a clip — that arrive when
    // no action is running.
    if (accepted === 0 && raw.length > 0) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'No outcome in the batch could be read.',
        rejected,
      });
    }

    return reply.code(202).send({ accepted, rejected });
  });

  return server;
};

interface OutcomeBody {
  readonly companionId?: unknown;
  readonly userId?: unknown;
  readonly devices?: unknown;
  readonly skills?: unknown;
  readonly outcomes?: unknown;
  readonly activity?: unknown;
  readonly following?: unknown;
  readonly canPerform?: unknown;
}

const isMember = <TMember extends string>(
  value: unknown,
  members: readonly TMember[],
): value is TMember =>
  typeof value === 'string' && (members as readonly string[]).includes(value);


const isPresent = <T>(value: T | null): value is T => value !== null;

/**
 * Reads one reported device, or nothing.
 *
 * Strict about `kind` and `status`, because those are what resolution branches
 * on, and forgiving about the rest. `provides` is filtered to known faculties
 * rather than rejected: a client on a newer vocabulary should still be able to
 * report the hardware this build understands.
 *
 * **Nothing here grants anything.** A device's `provides` list is only ever
 * consulted for faculties the backend has separately marked client-providable,
 * so a camera claiming `vision` is recorded faithfully and changes nothing —
 * see `FacultyFacts.clientProvidable`.
 */
const readDevice = (value: unknown): DeviceDescriptor | null => {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Record<string, unknown>;

  if (!isNonEmptyString(entry['id'])) return null;
  if (!isMember(entry['kind'], DEVICE_KINDS)) return null;

  const provides = Array.isArray(entry['provides'])
    ? entry['provides'].filter((faculty): faculty is FacultyKey =>
        isMember(faculty, FACULTY_KEYS),
      )
    : [];

  return {
    id: entry['id'],
    kind: entry['kind'],
    label: isNonEmptyString(entry['label']) ? entry['label'] : entry['kind'],
    // An unreadable status is `unknown` rather than `connected`. Guessing the
    // optimistic direction is how a companion comes to claim hardware it does
    // not have.
    status: isMember(entry['status'], DEVICE_STATUSES) ? entry['status'] : 'unknown',
    provides,
    observedAt: timestamp(new Date().toISOString()),
  };
};

/**
 * Reads one reported skill, or nothing.
 *
 * `source` defaults to `builtin` and `validation` to `unvalidated`, which is
 * the conservative pair: an unvalidated skill is still offerable when it ships
 * with the body, and a *generated* one never is until something validates it.
 * That gate lives in `isOfferable` in the domain, so a client cannot talk its
 * way past it by choosing flattering values here.
 */
const readSkill = (value: unknown): SkillDescriptor | null => {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Record<string, unknown>;

  if (!isNonEmptyString(entry['id'])) return null;
  if (!isActionType(entry['satisfies'])) return null;

  return {
    id: entry['id'],
    name: isNonEmptyString(entry['name']) ? entry['name'] : entry['id'],
    description: isNonEmptyString(entry['description']) ? entry['description'] : '',
    satisfies: entry['satisfies'],
    parameter: isNonEmptyString(entry['parameter']) ? entry['parameter'] : null,
    requires: Array.isArray(entry['requires'])
      ? entry['requires'].filter((faculty): faculty is FacultyKey =>
          isMember(faculty, FACULTY_KEYS),
        )
      : [],
    source: isMember(entry['source'], SKILL_SOURCES) ? entry['source'] : 'builtin',
    version:
      typeof entry['version'] === 'number' && Number.isFinite(entry['version'])
        ? entry['version']
        : 1,
    validation: isMember(entry['validation'], SKILL_VALIDATIONS)
      ? entry['validation']
      : 'unvalidated',
  };
};

const readActivity = (value: unknown): BodyActivity | null =>
  isMember(value, BODY_ACTIVITIES) ? value : null;

/**
 * Reads one reported outcome, or nothing.
 *
 * Strict about `status` and `actionType` and forgiving about everything else,
 * because those two are the fields anything downstream branches on. A `reason`
 * this backend does not recognise becomes `unknown` rather than failing the
 * outcome: the fact that the action failed is the part the companion must not
 * lose, and a client on a newer vocabulary should still be able to tell it so.
 *
 * `reason` is forced to null on success and defaulted to `unknown` on failure,
 * so `ActionOutcome`'s invariant — a reason exactly when the status is not
 * `completed` — holds for anything that reaches the store, whatever the client
 * sent.
 */
const readOutcome = (value: unknown): ActionOutcome | null => {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Record<string, unknown>;

  if (!isNonEmptyString(entry['actionId'])) return null;
  if (!isActionType(entry['actionType'])) return null;
  if (!isMember(entry['status'], ACTION_OUTCOME_STATUSES)) return null;

  const status: ActionOutcomeStatus = entry['status'];
  const reason: ActionFailureReason | null =
    status === 'completed'
      ? null
      : isMember(entry['reason'], ACTION_FAILURE_REASONS)
        ? entry['reason']
        : 'unknown';

  const durationMs = entry['durationMs'];

  return {
    actionId: trustExternalId<ActionId>(entry['actionId']),
    actionType: entry['actionType'],
    // Absent on a client that does not send it, which is every client that
    // predates the field. Null is the honest reading: the variant is unknown,
    // not empty.
    parameter: isNonEmptyString(entry['parameter']) ? entry['parameter'] : null,
    turnId: isNonEmptyString(entry['turnId'])
      ? trustExternalId<TurnId>(entry['turnId'])
      : null,
    status,
    reason,
    detail: isNonEmptyString(entry['detail']) ? entry['detail'] : null,
    // The client's clock is trusted for `at` only when it sent one that parses,
    // and it is *normalised* rather than passed through. A body reporting a real
    // outcome must never be rejected over the precision of its clock: .NET's
    // round-trip format emits seven fractional digits, this domain requires
    // exactly three, and `timestamp()` throws rather than returning a value — so
    // passing the raw string through turned one Unity client into a 500 that took
    // the whole batch with it, including the outcomes that were perfectly
    // readable. Round-tripping through Date yields the exact shape the domain
    // wants from anything Date can parse.
    at: timestamp(
      isNonEmptyString(entry['at']) && !Number.isNaN(Date.parse(entry['at']))
        ? new Date(entry['at']).toISOString()
        : new Date().toISOString(),
    ),
    durationMs:
      typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
        ? durationMs
        : 0,
  };
};
