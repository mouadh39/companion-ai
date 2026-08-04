import { loadConfig } from './config.js';
import { compose } from './composition.js';
import { buildServer } from './server.js';

/**
 * Process entry point.
 *
 * Configuration is validated, the graph is composed, and only then does the
 * server start listening — so a misconfigured deployment never accepts a
 * request it cannot serve.
 */
const main = async (): Promise<void> => {
  const config = loadConfig();
  const app = compose(config);
  const server = buildServer(app, config);

  const shutdown = async (signal: string): Promise<void> => {
    server.log.info({ signal }, 'shutting down');
    await server.close();
    await app.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await server.listen({ host: config.host, port: config.port });
  server.log.info({ provider: app.modelName }, 'nexa backend ready');
};

main().catch((error: unknown) => {
  console.error('[nexa] failed to start', error);
  process.exit(1);
});
