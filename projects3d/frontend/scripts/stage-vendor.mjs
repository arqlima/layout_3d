import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const vendor = resolve(root, 'public/vendor/rhino3dm');
await mkdir(vendor, { recursive: true });
for (const name of ['rhino3dm.js', 'rhino3dm.wasm']) {
  await copyFile(resolve(root, 'node_modules/rhino3dm', name), resolve(vendor, name));
}
