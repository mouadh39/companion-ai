import { ConfigurationError } from '@nexa/shared';

/**
 * Cross-origin access for the browser client (Flutter Web).
 *
 * The mobile app, curl, and every server-to-server caller send no `Origin`
 * header and are untouched by any of this. CORS is a browser mechanism for
 * deciding whether a page on another origin may *read* a response — it is not
 * an access-control boundary. `/v1/*` authentication is unchanged and still
 * runs on every real request; only a preflight `OPTIONS`, which carries no
 * credentials by design, is answered before it.
 *
 * `NEXA_CORS_ORIGINS` is a comma-separated allowlist. Each entry is either:
 *   - an exact origin — `https://app.nexa.example`
 *   - a loopback host with any port — `http://localhost:*`, `http://127.0.0.1:*`
 *     or `http://[::1]:*` — for a local Flutter Web dev server whose port
 *     changes between runs.
 *
 * A `:*` wildcard is refused for anything but a loopback host, so a production
 * value cannot accidentally open every port on a public host. Production lists
 * its real origins and no `:*` token; an unset variable allows nothing, which
 * is the same as CORS being off.
 */

/** `http://` or `https://` followed by exactly a loopback host, nothing more. */
const LOOPBACK_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])$/;

export interface CorsPolicy {
  /** Whether a browser on `origin` may read responses from this API. */
  allows(origin: string): boolean;
  /** True when the policy permits nothing — CORS is effectively disabled. */
  readonly isEmpty: boolean;
}

/** Splits `NEXA_CORS_ORIGINS` into trimmed, non-empty entries. */
export const parseCorsOrigins = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

/**
 * Compiles the allowlist once, at startup. A bad entry (a non-loopback `:*`)
 * fails here, loudly, rather than silently widening what the API accepts.
 */
export const corsPolicy = (entries: readonly string[]): CorsPolicy => {
  const exact = new Set<string>();
  const loopbackPrefixes: string[] = [];

  for (const entry of entries) {
    if (entry.endsWith(':*')) {
      const base = entry.slice(0, -2);
      if (!LOOPBACK_ORIGIN.test(base)) {
        throw new ConfigurationError(
          "NEXA_CORS_ORIGINS: a ':*' wildcard port is only allowed for a loopback " +
            'host (localhost, 127.0.0.1 or [::1]).',
          { entry },
        );
      }
      loopbackPrefixes.push(`${base}:`);
    } else {
      exact.add(entry);
    }
  }

  return {
    isEmpty: exact.size === 0 && loopbackPrefixes.length === 0,
    allows(origin: string): boolean {
      if (exact.has(origin)) return true;
      return loopbackPrefixes.some((prefix) => {
        if (!origin.startsWith(prefix)) return false;
        const port = origin.slice(prefix.length);
        return port.length > 0 && /^\d+$/.test(port);
      });
    },
  };
};
