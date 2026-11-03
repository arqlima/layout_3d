import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const root = resolve(import.meta.dirname, '..');
const modules = new Map();
async function moduleUrl(path) {
  if (modules.has(path)) return modules.get(path);
  let code = stripTypeScriptTypes(await readFile(path, 'utf8'), { mode: 'transform' });
  for (const [, specifier] of [...code.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    const url = specifier.startsWith('.')
      ? await moduleUrl(resolve(dirname(path), `${specifier}.ts`)) : import.meta.resolve(specifier);
    code = code.replaceAll(`from '${specifier}'`, `from '${url}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  modules.set(path, url);
  return url;
}

const { sectionPlane, sectionFromPoints, createCapGeometry } = await import(await moduleUrl(resolve(root, 'src/viewer/sectionGeometry.ts')));
const a = new THREE.Vector3(2, 0, 3);
assert.deepEqual(sectionFromPoints(a, new THREE.Vector3(8, 0, 4)), { axis: 'x', coordinate: 3, side: 1, mode: 'orthographic' });
assert.deepEqual(sectionFromPoints(a, new THREE.Vector3(3, 0, 9)), { axis: 'y', coordinate: 2, side: 1, mode: 'orthographic' });
assert.equal(sectionFromPoints(a, a), null, 'Coincident clicks do not create a cut');
const section = { axis: 'x', coordinate: 0, side: 1, mode: 'orthographic' };
const plane = sectionPlane(section);
assert.ok(plane.distanceToPoint(new THREE.Vector3(0, 0, 1)) > 0);
assert.ok(sectionPlane({ ...section, side: -1 }).distanceToPoint(new THREE.Vector3(0, 0, 1)) < 0);

function area(geometry) {
  const positions = geometry.getAttribute('position');
  let result = 0;
  for (let i = 0; i < positions.count; i += 3) {
    const vertices = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(positions, i + offset));
    result += vertices[1].sub(vertices[0]).cross(vertices[2].sub(vertices[0])).length() / 2;
  }
  return result;
}
const box = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 8));
box.updateMatrixWorld(true);
let result = createCapGeometry(box, plane);
assert.equal(result.open, false);
assert.ok(result.geometry);
assert.ok(Math.abs(area(result.geometry) - 24) < 1e-5, 'A box produces its actual section area');
assert.equal(createCapGeometry(box, new THREE.Plane(new THREE.Vector3(0, 0, 1), -20)).geometry, null);
assert.equal(createCapGeometry(box, new THREE.Plane(new THREE.Vector3(0, 0, 1), -4)).geometry, null, 'Tangency needs no cap');
box.position.set(12, 5, 0);
box.scale.set(2, 3, 1);
box.updateMatrixWorld(true);
result = createCapGeometry(box, plane);
assert.ok(Math.abs(area(result.geometry) - 24) < 1e-5, 'Caps are returned in mesh local coordinates');

// A hollow extrusion must retain its opening, including under model transforms.
const shape = new THREE.Shape();
shape.moveTo(-3, -3); shape.lineTo(3, -3); shape.lineTo(3, 3); shape.lineTo(-3, 3); shape.closePath();
const hole = new THREE.Path();
hole.moveTo(-1, -1); hole.lineTo(-1, 1); hole.lineTo(1, 1); hole.lineTo(1, -1); hole.closePath();
shape.holes.push(hole);
const hollow = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false, steps: 1 }));
hollow.updateMatrixWorld(true);
result = createCapGeometry(hollow, new THREE.Plane(new THREE.Vector3(0, 0, 1), -2));
assert.equal(result.open, false);
assert.ok(Math.abs(area(result.geometry) - 32) < 1e-5, 'Voids are holes, not filled polygons');

const open = new THREE.Mesh(new THREE.PlaneGeometry(4, 6));
open.updateMatrixWorld(true);
result = createCapGeometry(open, new THREE.Plane(new THREE.Vector3(1, 0, 0), 0));
assert.equal(result.open, true);
assert.equal(result.geometry, null, 'Open contours are not invented into solids');

const { isSavedScene, SavedSceneStore } = await import(await moduleUrl(resolve(root, 'src/data/savedScenes.ts')));
const saved = {
  version: 1,
  areaExclusions: { excludeUncovered: false, excludeParking: false },
  viewer: { camera: { projection: 'orthographic', position: [0, 0, -10], target: [0, 0, 0], up: [0, 1, 0], zoom: 1, near: .1, far: 500, orthographicHeight: 10, maxDistance: 100, label: 'CORTE' },
    layers: [], elevation: [null, null], selectionMode: 'name', activeUsages: [], hideUnchecked: false, selected: null, section },
};
assert.equal(isSavedScene(saved), true);
for (const invalid of [{ axis: 'z' }, { coordinate: Infinity }, { side: 0 }, { mode: 'invalid' }]) {
  assert.equal(isSavedScene({ ...saved, viewer: { ...saved.viewer, section: { ...section, ...invalid } } }), false);
}
const legacy = structuredClone(saved);
delete legacy.viewer.section;
assert.equal(isSavedScene(legacy), true, 'Existing scenes without cuts stay compatible');
const storage = new Map();
const api = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
new SavedSceneStore(api, 'test').save(0, saved);
assert.deepEqual(new SavedSceneStore(api, 'test').get(0).viewer.section, section);
console.log('Section tests passed: axis locking, side inversion, cap area, transforms, holes, open meshes and scene persistence.');
