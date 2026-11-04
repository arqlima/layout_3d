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
const pathSettings = { exposure: 0.8, shadowIntensity: 80, sunIntensity: 120, latitude: -20,
  longitude: -54, utcOffset: -4, date: '2026-10-27', minutes: 720, northAngle: 0 };
viewer.setSolarSettings(pathSettings);
viewer.setSolarPathVisible(true);
const overlay = viewer.solarPath;
assert.equal(overlay.bandMaterial.opacity, 0.12, 'Solar band starts at 12 percent opacity');
viewer.setSolarPathOpacity(65);
assert.equal(overlay.bandMaterial.opacity, 0.65, 'Opacity control changes the annual band');
assert.equal(overlay.dayMaterial.opacity, 1, 'Daily trajectory remains legible');
viewer.setSolarPathOpacity(NaN);
viewer.setSolarPathOpacity(101);
assert.equal(overlay.bandMaterial.opacity, 0.65, 'Invalid opacity is ignored');
viewer.setSolarPathOpacity(0);
assert.equal(overlay.bandMaterial.opacity, 0, 'Band supports full transparency');
viewer.setSolarPathOpacity(100);
assert.equal(overlay.bandMaterial.opacity, 1, 'Band supports full opacity');
viewer.setSolarPathOpacity(65);
const originalPosition = overlay.root.position.clone();
viewer.setSolarPathScale(100);
const fullScale = overlay.root.scale.x;
viewer.setSolarPathScale(25);
assert.equal(overlay.root.scale.x, fullScale / 4, 'Solar band size is adjustable independently of the model');
assert.deepEqual(overlay.root.position, originalPosition, 'Sizing preserves the band center');
viewer.setSolarSettings({ ...pathSettings, minutes: 800 });
assert.equal(overlay.root.scale.x, fullScale / 4, 'Time changes preserve the chosen size');
viewer.setSolarPathScale(NaN);
viewer.setSolarPathScale(0);
assert.equal(overlay.root.scale.x, fullScale / 4, 'Invalid sizes are ignored');
assert.equal(overlay.root.visible, true);
assert.equal(overlay.root.parent, viewer.scene);
assert.equal(overlay.marker.visible, true);
assert.ok(overlay.dayGeometry.getAttribute('position').count > 0);
assert.ok(overlay.bandGeometry.getAttribute('position').count > 0);
for (const geometry of [overlay.bandGeometry, overlay.dayGeometry]) {
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index++) {
    const point = new THREE.Vector3().fromBufferAttribute(position, index);
    assert.ok(point.toArray().every(Number.isFinite), 'Overlay coordinates are finite');
    assert.ok(point.y >= 0, 'Solar overlay is clipped to the horizon');
    assert.ok(Math.abs(point.length() - 1) < 1e-6, 'Band follows the celestial dome');
  }
}
const cachedDay = overlay.dayGeometry.getAttribute('position');
viewer.setSolarSettings({ ...pathSettings, minutes: 0 });
assert.equal(overlay.marker.visible, false, 'Night hides the current sun marker');
assert.equal(overlay.ray.visible, false);
assert.equal(overlay.dayGeometry.getAttribute('position'), cachedDay, 'Time changes reuse path geometry');
viewer.setSolarSettings({ ...pathSettings, latitude: 90, date: '2026-12-21' });
assert.equal(overlay.dayGeometry.getAttribute('position').count, 0, 'Polar night has no daily path');
viewer.setSolarSettings({ ...pathSettings, latitude: 90, date: '2026-06-21' });
assert.ok(overlay.dayGeometry.getAttribute('position').count > 0, 'Polar summer restores the complete path');
viewer.setSolarPathVisible(false);
assert.equal(overlay.root.visible, false);
viewer.setSolarPathVisible(true);
assert.equal(viewer.solarPath, overlay, 'Toggling reuses the same overlay');
assert.equal(overlay.root.scale.x, fullScale / 4, 'Toggling preserves the chosen size');
assert.equal(overlay.bandMaterial.opacity, 0.65, 'Time, date and visibility changes preserve opacity');
viewer.setSolarSettings(null);
assert.equal(overlay.root.visible, false, 'Disabling solar settings hides the overlay');
let disposed = false;
overlay.bandGeometry.addEventListener('dispose', () => { disposed = true; });
overlay.dispose();
assert.equal(overlay.root.parent, null);
assert.equal(disposed, true, 'Overlay releases GPU resources');
viewer.solarPath = null;
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
