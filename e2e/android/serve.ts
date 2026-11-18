import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, type ServerOptions } from '../../backend/src/server.ts';

// The Android tests' server, in a process of its own. The tests drive the phone with adb, and every
// adb command blocks the test's own process; a server inside it would leave the phone's requests
// waiting, sometimes until they time out. Started with `serveForPhone(options)`.

/** Starts the server in a child process with these options; resolves once it listens. */
export function serveForPhone(opts: ServerOptions): Promise<{ close: () => Promise<void> }> {
  const child = fork(fileURLToPath(import.meta.url), [JSON.stringify(opts)], {
    execArgv: ['--disable-warning=ExperimentalWarning'],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`The test server stopped (${code}).`)));
    child.once('message', (m) => {
      if (m !== 'ready') return reject(new Error(String(m)));
      resolve({
        close: () =>
          new Promise<void>((done) => {
            child.removeAllListeners('exit');
            child.once('exit', () => done());
            child.send('stop');
            // Gone within 5 s either way.
            setTimeout(() => {
              child.kill();
              done();
            }, 5_000).unref();
          }),
      });
    });
  });
}

// In the child: start, say so, and stop when told.
if (process.send && process.argv[2]) {
  const s = await startServer(JSON.parse(process.argv[2]) as ServerOptions).catch((e: unknown) => {
    process.send?.(`The test server could not start: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
  process.on('message', (m) => {
    if (m === 'stop') void s.close().finally(() => process.exit(0));
  });
  process.send('ready');
}
