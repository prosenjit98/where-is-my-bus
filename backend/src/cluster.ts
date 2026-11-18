import cluster from 'node:cluster';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { startFromEnv } from './server.ts';

// Several server processes on one machine, all on the same port, so riders' questions use every
// CPU core (npm run start:cluster). They keep the same live buses through Redis and their data in
// PostgreSQL (live-cluster.ts), so both must be set up. WORKERS sets how many; one per core when
// missing. A process that stops is started again. For more than one machine, run this (or
// npm start) on each, behind a load balancer.

if (cluster.isPrimary) {
  if (!process.env.REDIS_URL || !process.env.DATABASE_URL) {
    console.error('Several processes share their live buses through Redis and their data through PostgreSQL: set REDIS_URL and DATABASE_URL (see backend/.env.example).');
    process.exit(1);
  }
  // Every process must take the same admin token.
  if (!process.env.ADMIN_TOKEN) {
    process.env.ADMIN_TOKEN = randomBytes(18).toString('base64url');
    console.log(`Admin token for this run: ${process.env.ADMIN_TOKEN}  (set ADMIN_TOKEN to keep one)`);
  }
  const workers = Number(process.env.WORKERS) || os.availableParallelism();
  console.log(`Starting ${workers} server processes on one port (WORKERS to change).`);
  let stopping = false;
  for (let i = 0; i < workers; i++) cluster.fork({ WIMB_WORKER: String(i) });
  cluster.on('exit', (worker, code) => {
    if (stopping) return;
    console.error(`Server process ${worker.process.pid} stopped (${code}); starting another.`);
    cluster.fork({ WIMB_WORKER: String(worker.id) });
  });
  const stop = () => {
    stopping = true;
    for (const w of Object.values(cluster.workers ?? {})) w?.process.kill('SIGTERM');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} else {
  const n = process.env.WIMB_WORKER ?? '0';
  // Only the first prints the start-up lines; each has its own name among the servers.
  void startFromEnv({ serverId: `${process.env.SERVER_ID || os.hostname()}-${n}`, quiet: n !== '0' });
}
