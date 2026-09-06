import { ConfigurationError } from '@nexa/shared';

/**
 * Configuration, read once at startup.
 *
 * Every value is validated here rather than at the point of use, so a
 * misconfigured deployment fails immediately and loudly instead of on the first
 * request that happens to need the missing setting.
 */

export type ProviderKind = 'anthropic' | 'groq' | 'scripted';

const PROVIDERS: readonly ProviderKind[] = ['anthropic', 'groq', 'scripted'];

/**
 * Which model each provider talks to when `NEXA_MODEL_ID` is unset.
 *
 * Per provider rather than one constant, because a model id is only meaningful
 * to the provider that serves it. A single default meant switching provider
 * without also setting the model produced a 404 from a name the new provider
 * had never heard of — a configuration mistake reported as a runtime failure.
 */
const DEFAULT_MODELS: Record<ProviderKind, string> = {
  anthropic: 'claude-opus-5',
  groq: 'llama-3.3-70b-versatile',
  scripted: 'scripted',
};

/** Which environment variable holds each provider's credential. */
const API_KEY_VARIABLES: Partial<Record<ProviderKind, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
};

export interface AppConfig {
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly provider: ProviderKind;
  readonly modelId: string;
  /** Present only when `provider` is `anthropic`. */
  readonly anthropicApiKey: string | null;
  /** Present only when `provider` is `groq`. */
  readonly groqApiKey: string | null;
  /**
   * Ceiling on one provider request, in milliseconds.
   *
   * A backstop beneath the turn budget, not a replacement for it: Core already
   * scopes each call to what remains of the turn. This exists so a deployment
   * behind a slow network can raise the floor without recompiling.
   */
  readonly providerTimeoutMs: number;
  /**
   * Postgres connection string, or null to keep memory in the heap.
   *
   * Optional on purpose. The in-memory stores remain the default so tests,
   * the replay harness and a first run on a new machine need no database —
   * but a deployment that sets this gets memory that survives a restart, and
   * nothing else in the system changes shape.
   */
  readonly databaseUrl: string | null;
  /**
   * Credential for the embedding provider, or null for lexical-only recall.
   *
   * Optional like `databaseUrl`, and for the same reason: retrieval already
   * degrades gracefully without a semantic signal, so a deployment with no key
   * behaves exactly as it did before Step 3 rather than refusing to start.
   */
  readonly openAiApiKey: string | null;
  /**
   * The Supabase project's JWT secret, or null when authentication is not
   * configured.
   *
   * Null is a refusal, not a bypass: the composition root then binds a verifier
   * that denies every request, so a misconfigured deployment serves 401s rather
   * than silently trusting whatever a caller claims to be. That is the one
   * direction this is allowed to fail in.
   *
   * Never reaches a client. A build that could sign tokens could sign one for
   * anybody.
   */
  readonly supabaseJwtSecret: string | null;
  /**
   * The Supabase project's base URL, e.g. `https://<ref>.supabase.co`, or
   * null. When set, phone authentication verifies access tokens against the
   * project's published JWKS (asymmetric ES256/RS256 signing) rather than a
   * shared HS256 secret — see `SupabaseJwksAuthenticator`. A project created
   * with, or migrated to, asymmetric signing has no `SUPABASE_JWT_SECRET` to
   * give this backend and publishes a rotating public key set instead.
   *
   * Optional in the type so the many test configs that construct `AppConfig`
   * inline do not all need updating; `loadConfig` always sets it (to the env
   * value or null).
   *
   * Not a secret — it is the address of the project's public API, the same
   * value the client dials.
   */
  readonly supabaseUrl?: string | null;
  /**
   * Signs and verifies the headset-issued `nexa-device` access tokens minted
   * by pairing redemption and refresh — never Supabase's.
   *
   * Null the same way `supabaseJwtSecret` is: the composition root then
   * builds no `DeviceTokenAuthenticator` and refresh is unavailable, rather
   * than a headset token verifying against a secret nobody chose. A missing
   * value here must never touch phone/Supabase authentication, which reads
   * `supabaseJwtSecret` alone.
   *
   * Never reaches a client, for the same reason `supabaseJwtSecret` never
   * does — a build that could sign a device token could mint credentials for
   * any account.
   */
  readonly deviceTokenSecret: string | null;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
}

/**
 * Reads a string setting, treating blank as absent.
 *
 * `??` alone is wrong here: an env file written as `NEXA_MODEL_ID=` sets the
 * variable to the empty string, which is not `undefined`, so the default is
 * skipped and the provider is asked for a model with no name. That is a
 * configuration mistake that reports itself as a 404 from the API — exactly the
 * failure this file exists to prevent.
 */
const asString = (value: string | undefined, fallback: string): string => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? fallback : trimmed;
};

/** Reads an optional setting, treating blank as absent. */
const asStringOrNull = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

const asInt = (value: string | undefined, fallback: number, name: string): number => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new ConfigurationError(`${name} must be an integer.`, { value });
  }
  return parsed;
};

const isProviderKind = (value: string): value is ProviderKind =>
  (PROVIDERS as readonly string[]).includes(value);

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const providerRaw = (env['NEXA_MODEL_PROVIDER'] ?? 'scripted').toLowerCase();
  if (!isProviderKind(providerRaw)) {
    throw new ConfigurationError(
      `NEXA_MODEL_PROVIDER must be one of: ${PROVIDERS.join(', ')}.`,
      { value: providerRaw },
    );
  }

  // Checked at startup rather than on the first turn: discovering a missing key
  // mid-conversation costs a user-visible failure for a purely operational fault.
  const keyVariable = API_KEY_VARIABLES[providerRaw];
  const apiKey = keyVariable === undefined ? '' : (env[keyVariable] ?? '').trim();

  if (keyVariable !== undefined && apiKey === '') {
    throw new ConfigurationError(
      `NEXA_MODEL_PROVIDER is '${providerRaw}' but ${keyVariable} is unset.`,
    );
  }

  const providerTimeoutMs = asInt(
    env['NEXA_PROVIDER_TIMEOUT_MS'],
    30_000,
    'NEXA_PROVIDER_TIMEOUT_MS',
  );
  if (providerTimeoutMs <= 0) {
    throw new ConfigurationError('NEXA_PROVIDER_TIMEOUT_MS must be greater than zero.', {
      value: providerTimeoutMs,
    });
  }

  return {
    host: asString(env['HOST'], '0.0.0.0'),
    port: asInt(env['PORT'], 3000, 'PORT'),
    logLevel: asString(env['LOG_LEVEL'], 'info'),
    provider: providerRaw,
    modelId: asString(env['NEXA_MODEL_ID'], DEFAULT_MODELS[providerRaw]),
    anthropicApiKey: providerRaw === 'anthropic' ? apiKey : null,
    groqApiKey: providerRaw === 'groq' ? apiKey : null,
    providerTimeoutMs,
    databaseUrl: asStringOrNull(env['DATABASE_URL']),
    openAiApiKey: asStringOrNull(env['OPENAI_API_KEY']),
    supabaseJwtSecret: asStringOrNull(env['SUPABASE_JWT_SECRET']),
    supabaseUrl: asStringOrNull(env['SUPABASE_URL']),
    deviceTokenSecret: asStringOrNull(env['NEXA_DEVICE_TOKEN_SECRET']),
    embeddingModel: asString(env['NEXA_EMBEDDING_MODEL'], 'text-embedding-3-small'),
    // Must match the `vector(N)` column. A mismatch is a configuration fault
    // that should surface at boot, not as a failed insert on the first memory.
    embeddingDimensions: asInt(
      env['NEXA_EMBEDDING_DIMENSIONS'],
      1_536,
      'NEXA_EMBEDDING_DIMENSIONS',
    ),
  };
};
