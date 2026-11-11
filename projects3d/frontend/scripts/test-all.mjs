import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = new URL('.', import.meta.url);
const tests = readdirSync(directory).filter(name => /^test-.*\.mjs$/.test(name) && name !== 'test-all.mjs').sort();
for (const name of tests) {
  console.log(`\n${name}`);
  const flags = name === 'test-build.mjs' ? ['--experimental-vm-modules'] : [];
  const result = spawnSync(process.execPath, [...flags, fileURLToPath(new URL(name, directory))], {
    stdio: 'inherit', windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`\n${tests.length} frontend test scripts passed.`);
