import { describe, expect, it } from 'vitest';
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
} from 'jose';
import { SupabaseJwksAuthenticator } from '../dist/auth/supabase-jwks.js';

/**
 * The asymmetric (JWKS) Supabase verifier.
 *
 * Mirrors `auth.test.ts` for the HS256 verifier: the tokens are real signed
 * JWTs, verified by the production class against a **local** key set, so the
 * exact verification path that runs in production — signature, algorithm,
 * audience, `sub`, `exp` — is the one exercised here. Nothing reaches the
 * network; `createLocalJWKSet` stands in for the project's published JWKS.
 */

const KID = 'test-key-1';

/** A project's signing key + the verifier that trusts it. */
const project = async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256', {
    extractable: true,
  });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: KID, alg: 'ES256', use: 'sig' };
  const keySet = createLocalJWKSet({ keys: [jwk] });
  return {
    auth: new SupabaseJwksAuthenticator({ keySet }),
    sign: (claims: {
      sub?: string;
      audience?: string;
      expiresIn?: string;
      alg?: string;
      noExp?: boolean;
    } = {}) => {
      let jwt = new SignJWT({})
        .setProtectedHeader({ alg: claims.alg ?? 'ES256', kid: KID })
        .setAudience(claims.audience ?? 'authenticated')
        .setIssuedAt();
      if (claims.sub !== undefined) jwt = jwt.setSubject(claims.sub);
      if (!claims.noExp) jwt = jwt.setExpirationTime(claims.expiresIn ?? '1h');
      return jwt.sign(privateKey);
    },
    privateKey,
  };
};

describe('SupabaseJwksAuthenticator', () => {
  it('accepts a token signed by the project key and returns its subject', async () => {
    const { auth, sign } = await project();
    const result = await auth.verify(await sign({ sub: 'alice-uuid' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.userId).toBe('alice-uuid');
      expect(result.identity.issuer).toBe('supabase-jwks');
      expect(result.identity.expiresAt).toBeGreaterThan(Date.now());
    }
  });

  it('refuses a token signed by a different key', async () => {
    const { auth } = await project();
    const other = await project();
    const result = await auth.verify(await other.sign({ sub: 'alice-uuid' }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('invalid_signature');
  });

  it('refuses an expired token', async () => {
    const { auth, sign } = await project();
    const token = await sign({ sub: 'alice-uuid', expiresIn: '-1h' });
    const result = await auth.verify(token);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('expired');
  });

  it('refuses a token for the wrong audience', async () => {
    const { auth, sign } = await project();
    const result = await auth.verify(await sign({ sub: 'alice-uuid', audience: 'anon' }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('wrong_audience');
  });

  it('refuses a token with no subject', async () => {
    const { auth, sign } = await project();
    const result = await auth.verify(await sign({}));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('malformed');
  });

  it('refuses a token with no expiry — a credential that cannot be taken away', async () => {
    const { auth, sign } = await project();
    const result = await auth.verify(await sign({ sub: 'alice-uuid', noExp: true }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('malformed');
  });

  it('refuses a missing credential', async () => {
    const { auth } = await project();
    const result = await auth.verify(null);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('missing');
  });

  it('refuses HS256 — the algorithm is pinned to asymmetric', async () => {
    const { auth } = await project();
    // A token that names HS256 in its header, signed with a symmetric key.
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('alice-uuid')
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-symmetric-secret-pretending-to-be-fine'));

    const result = await auth.verify(token);
    expect(result.ok).toBe(false);
  });
});
