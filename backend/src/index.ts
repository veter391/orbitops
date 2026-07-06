import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { buildServer } from './server.js';

const applied = await migrate();
const app = await buildServer();
app.log.info({ applied }, 'migrations up to date');

// Last-resort process guards: log, then shut down cleanly rather than run on in
// an unknown state.
process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, 'unhandledRejection');
});
process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'uncaughtException — shutting down');
  void shutdown('uncaughtException', 1);
});

let shuttingDown = false;
/** Drain in-flight requests, close sockets + DB, then exit. */
async function shutdown(signal: string, code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'graceful shutdown');
  try {
    await app.close(); // stops accepting, drains in-flight, closes WS
    await app.db.close();
    process.exit(code);
  } catch (err) {
    app.log.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => void shutdown(sig));
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
