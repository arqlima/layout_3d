import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const modules = new Map();
async function moduleUrl(path) {
  if (modules.has(path)) return modules.get(path);
  let code = stripTypeScriptTypes(await readFile(path, 'utf8'), { mode: 'transform' });
  for (const [, specifier] of [...code.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    const url = specifier.startsWith('.') ? await moduleUrl(resolve(dirname(path), `${specifier}.ts`)) : import.meta.resolve(specifier);
    code = code.replace(`from '${specifier}'`, `from '${url}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  modules.set(path, url);
  return url;
}
const { mountSceneToolbar } = await import(await moduleUrl(resolve(import.meta.dirname, '../src/ui/SceneToolbar.ts')));
const { defaultSolarSettings } = await import(await moduleUrl(resolve(import.meta.dirname, '../src/data/solar.ts')));
const { SavedSceneStore, isSavedScene } = await import(await moduleUrl(resolve(import.meta.dirname, '../src/data/savedScenes.ts')));
const scene = { version: 1, areaExclusions: { excludeUncovered: false, excludeParking: false }, viewer: {
  annualExposure: true, solar: { settings: defaultSolarSettings(), pathVisible: true, scale: 50, opacity: 12 },
  camera: { projection: 'perspective', position: [10, 10, 10], up: [0, 1, 0], target: [0, 0, 0], zoom: 1, near: .1, far: 1000, orthographicHeight: 10, maxDistance: 1000, label: 'PERSPECTIVA' },
  layers: [], elevation: [null, null], selectionMode: 'name', activeUsages: [], hideUnchecked: false, selected: null,
} };
const data = new Map();
const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
const named = new SavedSceneStore(storage, 'names');
named.save(0, { ...scene, name: 'persp1' });
named.update(scene);
assert.equal(new SavedSceneStore(storage, 'names').get(0).name, 'persp1', 'Updating a view preserves its name');
assert.equal(isSavedScene({ ...scene, name: 42 }), false);
assert.equal(isSavedScene(scene), true, 'Legacy scenes remain valid');
globalThis.window = { localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } };
const element = () => ({ classList: { toggle() {} }, setAttribute() {}, disabled: false });
globalThis.document = { createElement: element };
const slots = { children: [], replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } };
const update = element(), status = {};
const host = { querySelector: selector => ({ '.scene-slots': slots, '#update-scene': update, '.scene-feedback': status })[selector] };
let finish, fail = false, restores = 0;
mountSceneToolbar(host, 'test-scenes', () => scene, async saved => {
  restores++;
  assert.equal(saved.viewer.annualExposure, true);
  if (fail) throw new Error('Cálculo interrompido');
  await new Promise(resolve => { finish = resolve; });
});
await slots.children[0].onclick();
assert.match(status.textContent, /salva/);
const opening = slots.children[0].onclick();
assert.match(status.textContent, /recalculando/);
assert.ok(slots.children.every(button => button.disabled), 'Scene buttons wait for annual calculation');
assert.equal(update.disabled, true);
await slots.children[1].onclick();
assert.equal(restores, 1, 'Busy scene restoration cannot be interrupted by another scene click');
finish();
await opening;
assert.match(status.textContent, /aberta/);
assert.ok(slots.children.every(button => !button.disabled));
fail = true;
await slots.children[0].onclick();
assert.equal(status.textContent, 'Cálculo interrompido', 'Calculation errors are not reported as successful scene restoration');
assert.equal(update.disabled, true, 'Failed restoration cannot accidentally overwrite a previously active scene');
console.log('Scene toolbar tests passed: persistence, asynchronous map restoration, progress, busy controls and error reporting.');
