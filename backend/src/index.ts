import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { buildServer } from './server.js';

const applied = await migrate();
const app = await buildServer();
app.log.info({ applied }, 'migrations up to date');

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
