import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const solar = stripTypeScriptTypes(await readFile(new URL('../src/data/solar.ts', import.meta.url), 'utf8'));
const solarUrl = `data:text/javascript;base64,${Buffer.from(solar).toString('base64')}`;
const source = stripTypeScriptTypes(await readFile(new URL('../src/viewer/AnnualExposure.ts', import.meta.url), 'utf8'), { mode: 'transform' })
  .replace("'three'", JSON.stringify(import.meta.resolve('three'))).replace("'../data/solar'", JSON.stringify(solarUrl));
const { AnnualExposure } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const settings = { exposure: 0.8, shadowIntensity: 80, sunIntensity: 120,
  latitude: 0, longitude: 0, utcOffset: 0, date: '2026-11-04', minutes: 900, northAngle: 0 };
const material = new THREE.MeshBasicMaterial({ color: '#ffffff' });
// Existing mesh vertices alone exceed the old 25,000 point ceiling.
const dense = new THREE.Mesh(new THREE.PlaneGeometry(10, 10, 160, 160), material);
dense.rotation.x = -Math.PI / 2;
const adaptive = new AnnualExposure();
const denseResult = await adaptive.calculate([{ object: dense, material }], settings, new AbortController().signal, () => {}, 100);
assert.ok(denseResult.points > 0 && denseResult.points <= 25000, 'Complex meshes respect the sample budget');
assert.equal(denseResult.reducedDetail, true, 'Reduced detail is reported to the panel');
assert.equal(adaptive.root.children[0].geometry.getAttribute('position').count, dense.geometry.index.count,
  'Adaptive sampling still covers every original triangle');
const denseValues = adaptive.root.children[0].geometry.getAttribute('exposure');
for (let i = 0; i < denseValues.count; i++) assert.ok(denseValues.getX(i) > .99, 'Open surfaces keep their sunlight values');
adaptive.dispose(); dense.geometry.dispose();
const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), material);
ground.rotation.x = -Math.PI / 2;
const input = object => ({ object, material });
const exposure = new AnnualExposure();
let progress = 0;
const result = await exposure.calculate([input(ground)], settings, new AbortController().signal, value => { progress = value; }, 100);
assert.equal(progress, 100);
assert.equal(result.year, '2026');
assert.ok(result.points > 0);
assert.ok(exposure.root.children[0] instanceof THREE.Mesh, 'Exposure is a continuous surface mesh instead of points');
assert.ok(exposure.root.children[0].geometry.getAttribute('position').count > ground.geometry.getAttribute('position').count, 'Large surfaces are subdivided to resolve shadow gradients');
assert.equal(exposure.root.children[0].material.transparent, false, 'Heatmap fully replaces the original surface colors');
assert.ok(exposure.root.children[0].renderOrder > ground.renderOrder, 'Heatmap renders after original model materials');
const sunnyValues = exposure.root.children[0].geometry.getAttribute('exposure');
for (let index = 0; index < sunnyValues.count; index++) assert.ok(sunnyValues.getX(index) > .99, 'Open upward surfaces receive all sampled sunlight');
assert.equal(ground.material, material, 'Calculation preserves model materials');
const roof = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), material);
roof.rotation.x = -Math.PI / 2;
roof.position.y = .001;
await exposure.calculate([input(ground), input(roof)], settings, new AbortController().signal, () => {}, 100);
const points = exposure.root.children[0].geometry.getAttribute('position');
const values = exposure.root.children[0].geometry.getAttribute('exposure');
let shaded = 0;
for (let index = 0; index < points.count; index++) {
  if (points.getY(index) < .0005) {
    assert.ok(values.getX(index) < .01, 'An opaque roof blocks direct sunlight at the ground');
    shaded++;
  }
}
assert.ok(shaded > 0, 'Ground is represented in the area-weighted samples');
await exposure.calculate([input(ground), { ...input(roof), receiveExposure: false }], settings, new AbortController().signal, () => {}, 100);
const analyzedPositions = exposure.root.children[0].geometry.getAttribute('position');
const analyzedValues = exposure.root.children[0].geometry.getAttribute('exposure');
for (let index = 0; index < analyzedPositions.count; index++) {
  assert.ok(analyzedPositions.getY(index) < .0005, 'REP blockers must not receive the exposure gradient');
  assert.ok(analyzedValues.getX(index) < .01, 'REP geometry still casts shadows on analyzed surfaces');
}
await assert.rejects(exposure.calculate([{ ...input(roof), receiveExposure: false }], settings,
  new AbortController().signal, () => {}, 100), /superfícies/, 'A model with only REP cannot produce an exposure map');
const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), material);
await exposure.calculate([input(box)], settings, new AbortController().signal, () => {}, 100);
const cornerPositions = exposure.root.children[0].geometry.getAttribute('position');
const cornerValues = exposure.root.children[0].geometry.getAttribute('exposure');
const corners = new Map();
for (let index = 0; index < cornerPositions.count; index++) {
  const point = new THREE.Vector3().fromBufferAttribute(cornerPositions, index);
  const key = point.toArray().join(',');
  const list = corners.get(key) ?? [];
  list.push(cornerValues.getX(index));
  corners.set(key, list);
}
assert.ok([...corners.values()].some(list => Math.max(...list) - Math.min(...list) > .1), 'Roof/facade values stay separate at shared corner positions');
const cancelled = new AbortController();
const inProgress = new AbortController();
await assert.rejects(exposure.calculate([input(ground)], settings, inProgress.signal, percent => {
  if (percent >= 5) inProgress.abort();
}), { name: 'AbortError' });
cancelled.abort();
await assert.rejects(exposure.calculate([input(ground)], settings, cancelled.signal, () => {}), { name: 'AbortError' });
await assert.rejects(exposure.calculate([], settings, new AbortController().signal, () => {}), /superfícies opacas/);
const glass = new THREE.MeshBasicMaterial({ transparent: true, opacity: .5 });
await assert.rejects(exposure.calculate([{ object: ground, material: glass }], settings, new AbortController().signal, () => {}), /superfícies opacas/);
exposure.dispose();
assert.equal(exposure.root.children.length, 0);
console.log('Annual exposure tests passed: weighted sunlight, real shadow occlusion, area sampling, material preservation, cancellation, empty/transparent models and cleanup.');
