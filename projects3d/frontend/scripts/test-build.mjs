import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SourceTextModule, createContext } from 'node:vm';

// Link the shipped ES modules, checking actual imports and named exports.
// No evaluation is necessary, so this does not require DOM or WebGL.
const root = resolve(import.meta.dirname, '../../static/projects3d/viewer');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const entry = manifest['src/entry.ts'];
assert.match(entry.file, /^viewer-[\w-]+\.js$/);
const context = createContext({});
const modules = new Map();
async function getModule(url) {
  if (modules.has(url)) return modules.get(url);
  const module = new SourceTextModule(await readFile(fileURLToPath(url), 'utf8'), {
    context, identifier: url,
  });
  modules.set(url, module);
  return module;
}
const linker = (specifier, importer) => getModule(new URL(specifier, importer.identifier).href);
for (const record of Object.values(manifest)) {
  await readFile(resolve(root, record.file));
  for (const css of record.css ?? []) await readFile(resolve(root, css));
  if (!record.file.endsWith('.js')) continue;
  const module = await getModule(pathToFileURL(resolve(root, record.file)).href);
  if (module.status === 'unlinked') await module.link(linker);
}
assert.equal([...modules.keys()].filter(url => url.endsWith(`/${entry.file}`)).length, 1);
console.log(`Build modules linked successfully (${modules.size} modules, one application entry).`);
