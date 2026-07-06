import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { buildServer } from './server.js';
import { initTracing, shutdownTracing } from './observability.js';

// Tracing first so all subsequent work is instrumented (no-op without endpoint).
const tracing = await initTracing();

const applied = await migrate();
const app = await buildServer();
app.log.info({ applied, tracing }, 'migrations up to date');

// Telemetry retention: purge on boot, then hourly. Disabled at 0 (keep forever);
// a TimescaleDB deployment replaces this with add_retention_policy().
let retentionTimer: ReturnType<typeof setInterval> | null = null;
if (config.TELEMETRY_RETENTION_DAYS > 0) {
  const purge = async () => {
    try {
      const removed = await app.telemetry.purgeOlderThan(config.TELEMETRY_RETENTION_DAYS);
      if (removed > 0) app.log.info({ removed }, 'telemetry retention purge');
    } catch (err) {
      app.log.error({ err }, 'telemetry retention purge failed');
    }
  };
  await purge();
  retentionTimer = setInterval(purge, 60 * 60 * 1000);
  retentionTimer.unref();
}

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
/** Drain in-flight requests, close sockets + DB, flush traces, then exit. */
async function shutdown(signal: string, code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'graceful shutdown');
  try {
    if (retentionTimer) clearInterval(retentionTimer);
    await app.close(); // stops accepting, drains in-flight, closes WS
    await app.db.close();
    await shutdownTracing();
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
