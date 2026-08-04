import type { EventEnvelope } from '../../interfaces/envelope.js';
import { defineEvent } from '../../interfaces/envelope.js';

/**
 * Facts about sessions and access.
 *
 * **`ShutdownRequested` from the brief is deliberately absent.** "Shut down" is
 * an instruction to a process, not a statement about something that happened —
 * it has a recipient that must act, and the caller cares whether it did. That
 * is a lifecycle concern of the composition root (a signal handler calling
 * `bus.clear()` and closing ports), not a domain fact for the append-only log.
 * Putting it on the bus would mean shutdown correctness depends on at-least-once
 * delivery to an unknown set of listeners.
 *
 * `nexa.system.user.authenticated` carries no credential, no token and no
 * personal data — an authentication *fact*, and the method used. Anything more
 * would be a secret in a log that is designed never to be edited.
 */

export interface SessionStartedPayload {
  /** Which client opened it. Several may attach to one companion. */
  readonly clientId: string;
  readonly clientKind: 'unity' | 'flutter' | 'web' | 'cli' | 'unknown';
  readonly clientVersion: string;
  /** True when resuming rather than starting fresh. */
  readonly resumed: boolean;
}

export interface SessionEndedPayload {
  readonly clientId: string;
  readonly durationMs: number;
  readonly reason: 'user_ended' | 'timeout' | 'client_closed' | 'error';
}

export interface UserAuthenticatedPayload {
  readonly method: 'password' | 'oauth' | 'token' | 'biometric';
  readonly clientId: string;
  /** True on the first authentication for this user. */
  readonly firstLogin: boolean;
}

export const sessionStarted = defineEvent<'nexa.system.session.started', SessionStartedPayload>(
  'nexa.system.session.started',
  1,
  { source: 'system' },
);

export const sessionEnded = defineEvent<'nexa.system.session.ended', SessionEndedPayload>(
  'nexa.system.session.ended',
  1,
  { source: 'system' },
);

export const userAuthenticated = defineEvent<
  'nexa.system.user.authenticated',
  UserAuthenticatedPayload
>('nexa.system.user.authenticated', 1, { source: 'system' });

export type SystemEvent =
  | EventEnvelope<'nexa.system.session.started', SessionStartedPayload>
  | EventEnvelope<'nexa.system.session.ended', SessionEndedPayload>
  | EventEnvelope<'nexa.system.user.authenticated', UserAuthenticatedPayload>;

export const SYSTEM_EVENTS = [sessionStarted, sessionEnded, userAuthenticated] as const;
