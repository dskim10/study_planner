import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
if (!['start', 'test'].includes(mode)) throw new Error('Use start or test');
const env = { ...process.env, FIREBASE_EMULATORS_PATH: resolve(root, '.tools/firebase-emulators') };
// The Firebase CLI treats any inherited DEBUG value as a request to print
// subprocess environment variables; keep routine emulator output concise.
delete env.DEBUG;
// Prefer a project-local Java runtime when available; otherwise use Java on PATH.
const javaRoot = resolve(root, '.tools/java');
if (existsSync(javaRoot)) {
  const runtime = readdirSync(javaRoot).map(name => join(javaRoot, name, 'bin')).find(path => existsSync(join(path, process.platform === 'win32' ? 'java.exe' : 'java')));
  if (runtime) {
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
    env[pathKey] = `${runtime}${process.platform === 'win32' ? ';' : ':'}${env[pathKey] || ''}`;
  }
}
const args = [resolve(root, 'node_modules/firebase-tools/lib/bin/firebase.js'), mode === 'test' ? 'emulators:exec' : 'emulators:start', '--only', 'auth,firestore', '--project', 'demo-rocky'];
if (mode === 'test') args.push('npm run test:firebase:run');
else {
  args.push('--export-on-exit', '.emulator-data');
  if (existsSync(resolve(root, '.emulator-data/firebase-export-metadata.json'))) args.push('--import', '.emulator-data');
}
const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
