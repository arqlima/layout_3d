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
const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), material);
ground.rotation.x = -Math.PI / 2;
const input = object => ({ object, material });
const exposure = new AnnualExposure();
let progress = 0;
const result = await exposure.calculate([input(ground)], settings, new AbortController().signal, value => { progress = value; }, 100);
assert.equal(progress, 100);
assert.equal(result.year, '2026');
assert.equal(result.points, 100);
const sunnyColor = exposure.root.children[0].geometry.getAttribute('color');
for (let index = 0; index < sunnyColor.count; index++) {
  assert.ok(sunnyColor.getX(index) > .99 && sunnyColor.getZ(index) < .01, 'Unobstructed upward surfaces receive all sampled sunlight');
}
assert.equal(ground.material, material, 'Calculation preserves model materials');
const roof = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), material);
roof.rotation.x = -Math.PI / 2;
roof.position.y = .001;
await exposure.calculate([input(ground), input(roof)], settings, new AbortController().signal, () => {}, 100);
const points = exposure.root.children[0].geometry.getAttribute('position');
const colors = exposure.root.children[0].geometry.getAttribute('color');
let shaded = 0;
for (let index = 0; index < points.count; index++) {
  if (points.getY(index) < .0005) {
    assert.ok(colors.getZ(index) > .9 && colors.getX(index) < .01, 'An opaque roof blocks direct sunlight at the ground');
    shaded++;
  }
}
assert.ok(shaded > 0, 'Ground is represented in the area-weighted samples');
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
