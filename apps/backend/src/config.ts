import { ConfigurationError } from '@nexa/shared';

/**
 * Configuration, read once at startup.
 *
 * Every value is validated here rather than at the point of use, so a
 * misconfigured deployment fails immediately and loudly instead of on the first
 * request that happens to need the missing setting.
 */

export type ProviderKind = 'anthropic' | 'scripted';

export interface AppConfig {
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly provider: ProviderKind;
  readonly modelId: string;
  /** Present only when `provider` is `anthropic`. */
  readonly anthropicApiKey: string | null;
}

const asInt = (value: string | undefined, fallback: number, name: string): number => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new ConfigurationError(`${name} must be an integer.`, { value });
  }
  return parsed;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const providerRaw = (env['NEXA_MODEL_PROVIDER'] ?? 'scripted').toLowerCase();
  if (providerRaw !== 'anthropic' && providerRaw !== 'scripted') {
    throw new ConfigurationError(
      `NEXA_MODEL_PROVIDER must be 'anthropic' or 'scripted'.`,
      { value: providerRaw },
    );
  }

  const apiKey = env['ANTHROPIC_API_KEY'] ?? '';

  // Checked at startup rather than on the first turn: discovering a missing key
  // mid-conversation costs a user-visible failure for a purely operational fault.
  if (providerRaw === 'anthropic' && apiKey.trim() === '') {
    throw new ConfigurationError(
      "NEXA_MODEL_PROVIDER is 'anthropic' but ANTHROPIC_API_KEY is unset.",
    );
  }

  return {
    host: env['HOST'] ?? '0.0.0.0',
    port: asInt(env['PORT'], 3000, 'PORT'),
    logLevel: env['LOG_LEVEL'] ?? 'info',
    provider: providerRaw,
    modelId: env['NEXA_MODEL_ID'] ?? 'claude-opus-5',
    anthropicApiKey: providerRaw === 'anthropic' ? apiKey : null,
  };
};
