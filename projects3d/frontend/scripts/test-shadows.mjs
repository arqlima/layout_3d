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
      ? await moduleUrl(resolve(dirname(path), `${specifier}.ts`))
      : import.meta.resolve(specifier);
    code = code.replace(`from '${specifier}'`, `from '${url}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  modules.set(path, url);
  return url;
}
const { ArchitecturalViewer } = await import(await moduleUrl(resolve(root, 'src/viewer/ArchitecturalViewer.ts')));
const viewer = Object.create(ArchitecturalViewer.prototype);
const model = new THREE.Group();
const opaque = new THREE.MeshStandardMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 1 });
const faint = new THREE.MeshStandardMaterial({ opacity: 0.99 });
const texture = new THREE.Texture();
opaque.map = texture;
const meshes = [opaque, glass, faint, [glass, opaque]].map(material => new THREE.Mesh(new THREE.BoxGeometry(20, 8, 30), material));
model.add(...meshes);
model.position.set(100, 4, -200);
const ownDepth = new THREE.MeshDepthMaterial();
meshes[3].customDepthMaterial = ownDepth;
Object.assign(viewer, {
  shadowDepthMaterial: new THREE.MeshDepthMaterial({ polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 4 }),
  sun: new THREE.DirectionalLight(), scene: new THREE.Scene(), content: model,
  renderer: { toneMappingExposure: 1 }, shadowGround: new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShadowMaterial()),
  selectionEntries: [], solarMaterials: new Map(), mutedMaterials: new Set(), layers: [],
  activeUsages: new Set(['COM', 'EST', 'PRIV', 'VAGAS']), selectionMode: 'name', selectedObject: null,
});
viewer.sun.shadow.mapSize.set(4096, 4096);
viewer.scene.add(viewer.sun, model);
viewer.prepareModelShadows(model);
assert.deepEqual(meshes.map(mesh => mesh.castShadow), [true, false, false, true]);
assert.ok(meshes.every(mesh => mesh.receiveShadow));
assert.equal(meshes[0].customDepthMaterial, viewer.shadowDepthMaterial);
assert.equal(meshes[1].customDepthMaterial, viewer.shadowDepthMaterial);
assert.equal(meshes[3].customDepthMaterial, ownDepth);
assert.equal(meshes[0].material, opaque);
assert.equal(opaque.map, texture);
assert.equal(opaque.polygonOffsetFactor, 1);
assert.deepEqual(meshes[0].geometry.boundingBox, null, 'Shadow preparation leaves geometry untouched');
viewer.prepareSelection(model);
for (const settings of [null, { exposure: 0.8, shadowIntensity: 80, sunIntensity: 120, latitude: -20, longitude: -54, utcOffset: -4, date: '2026-10-27', minutes: 390, northAngle: 0 }]) {
  viewer.setSolarSettings(settings);
  assert.deepEqual(meshes.map(mesh => mesh.castShadow), [true, false, false, true], 'Solar settings preserve transparent caster exclusion');
  const sphere = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
  assert.ok(viewer.sun.target.position.distanceTo(sphere.center) < 1e-9);
  assert.ok(Math.abs(viewer.sun.position.distanceTo(sphere.center) - sphere.radius * 3) < 1e-9);
  assert.equal(viewer.sun.target.parent, viewer.scene);
  viewer.scene.updateMatrixWorld(true);
  viewer.sun.shadow.updateMatrices(viewer.sun);
  for (const mesh of meshes) {
    for (const x of [-10, 10]) for (const y of [-4, 4]) for (const z of [-15, 15]) {
      const ndc = mesh.localToWorld(new THREE.Vector3(x, y, z)).project(viewer.sun.shadow.camera);
      assert.ok(ndc.toArray().every(value => Math.abs(value) <= 1), 'Light frustum encloses model at grazing sun angles');
    }
  }
}
for (const size of [0.01, 11, 100, 10000]) {
  viewer.configureSunShadow(size);
  const shadow = viewer.sun.shadow;
  const camera = shadow.camera;
  assert.ok(camera.near >= 0.1 && camera.far >= camera.near + 1);
  assert.ok(shadow.normalBias >= 0.02 && shadow.normalBias <= 0.15);
  assert.ok(Math.abs(shadow.bias * (camera.far - camera.near)) <= 0.05, 'Depth bias is limited in scene units');
  assert.equal(shadow.needsUpdate, true);
}
viewer.content = new THREE.Group();
viewer.setSolarSettings(null);
assert.ok(Number.isFinite(viewer.sun.shadow.camera.far), 'Empty models have a finite fallback');
console.log('Shadow tests passed: opaque casters, shared/custom depth, preserved materials, solar framing, grazing light, bias bounds and empty models.');
