import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNetwork, type Network } from '../../packages/core/src/index.ts';
import { openDb } from './db.ts';
import { openRedis } from './redis.ts';
import { fileNetworkStore, pgNetworkStore, type NetworkStore } from './store.ts';

// Loads a seed network (a JSON file in the app's format, such as data/seed-kolkata.json) into the
// database, or into the network file without one, as `npm run seed -- <file>` from backend/:
//
//   npm run seed -- ../data/seed-kolkata.json             an empty database or a new server
//   npm run seed -- ../data/seed-kolkata.json --replace   replaces the network there now, after
//                                                          saving a copy of it in backend/data/
//
// It reads DATABASE_URL, DATABASE_SCHEMA, REDIS_URL, REDIS_PREFIX and DATA_FILE like the server
// (backend/.env). The seed is checked like an admin import first. Running servers are told of the
// new network through Redis, as after an admin's edit. Owners, buses and trips are not touched.

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const replace = args.includes('--replace');
  if (!file) throw new Error('Give the seed file: npm run seed -- ../data/seed-kolkata.json [--replace]');
  const seedPath = path.resolve(file);
  const seed = JSON.parse(await readFile(seedPath, 'utf8')) as Network;
  const problems = validateNetwork(seed);
  if (problems.length) throw new Error(`The seed has problems:\n- ${problems.join('\n- ')}`);

  const dataFile = path.resolve(process.env.DATA_FILE ?? path.join(here, '../data/network.json'));
  const db = process.env.DATABASE_URL ? await openDb(process.env.DATABASE_URL, process.env.DATABASE_SCHEMA || 'public') : null;
  try {
    // With nothing there yet, loading copies the seed in: the first start of a server does the same.
    const fresh = db ? !(await db.pool.query('SELECT 1 FROM network_meta WHERE id = 1')).rowCount : !existsSync(dataFile);
    const store: NetworkStore = db ? pgNetworkStore(db, seedPath, seedPath) : fileNetworkStore(dataFile, seedPath);
    const where = db ? `PostgreSQL (schema ${db.schema})` : dataFile;
    const current = await store.load();
    if (fresh) {
      console.log(`Seeded ${where} with ${seed.routes.length} routes and ${seed.stops.length} stops from ${seedPath}.`);
      return;
    }
    if (!replace) {
      console.log(`${where} already has a network (v${current.version}, ${current.routes.length} routes). Nothing changed: add --replace to replace it.`);
      return;
    }
    const backup = path.join(here, '../data', `network-backup-v${current.version}-${new Date().toISOString().slice(0, 10)}.json`);
    await mkdir(path.dirname(backup), { recursive: true });
    await writeFile(backup, `${JSON.stringify(current, null, 2)}\n`);
    const next: Network = { ...seed, version: current.version + 1, updatedAt: new Date().toISOString() };
    if ((await store.save(current, next)) === 'conflict') throw new Error('The network changed while seeding. Run it again.');
    console.log(`Replaced network v${current.version} in ${where} with v${next.version}: ${next.routes.length} routes, ${next.stops.length} stops. The old one is in ${backup}.`);
    // Running servers read the new network at this point among their live events (live-cluster.ts).
    if (process.env.REDIS_URL) {
      const kv = await openRedis(process.env.REDIS_URL, process.env.REDIS_PREFIX || 'wimb:');
      await kv.cmd(['XADD', `${kv.prefix}live:events`, 'MAXLEN', '~', 300_000, '*', 'e', JSON.stringify({ t: 'network', version: next.version }), 'o', 'seed']);
      await kv.close();
      console.log('Running servers were told through Redis.');
    }
  } finally {
    await db?.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
