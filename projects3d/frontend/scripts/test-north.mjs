import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const encode = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const source = stripTypeScriptTypes(await readFile(new URL('../src/data/north.ts', import.meta.url), 'utf8'));
const url = encode(source);
const { normalizeNorthAngle, northPointerAngle, northScreenAngle } = await import(url);
const modelNorthSource = stripTypeScriptTypes(await readFile(new URL('../src/data/modelNorth.ts', import.meta.url), 'utf8'))
  .replace("from 'three'", `from '${import.meta.resolve('three')}'`)
  .replace("from './north'", `from '${url}'`);
const { readModelNorth } = await import(encode(modelNorthSource));
const model = new THREE.Group();
model.userData.layers = [{ name: 'REP-NORTE-VEC' }, { name: 'REP-OUTRO-VEC' }];
model.rotation.x = -Math.PI / 2;
const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0),
]));
line.userData.attributes = { layerIndex: 0 };
line.visible = false;
model.add(line);
assert.equal(readModelNorth(model), 90, 'read the directed line even when REP is hidden');
line.rotation.z = Math.PI / 2;
assert.equal(readModelNorth(model), 0, 'Rhino +Y remains the original north');
line.rotation.z = -Math.PI / 4;
model.position.set(500, 100, -300);
model.scale.setScalar(0.001);
assert.equal(readModelNorth(model), 135, 'north respects object transforms, model axes and scale');
line.geometry.setIndex([1, 0]);
assert.equal(readModelNorth(model), 315, 'indexed geometry preserves start-to-end direction');
line.userData.attributes.layerIndex = 1;
assert.equal(readModelNorth(model), 0, 'missing north layer geometry falls back to project Y');
line.userData.attributes.layerIndex = 0;
line.geometry.setIndex(null);
line.geometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 10)]);
line.rotation.z = 0;
assert.equal(readModelNorth(model), 0, 'vertical vectors have no valid plan direction');
line.geometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
assert.equal(readModelNorth(model), 0, 'zero-length vectors fall back to project Y');
line.geometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3(NaN, 0, 0)]);
assert.equal(readModelNorth(model), 0, 'invalid coordinates fall back to project Y');
assert.equal(readModelNorth(new THREE.Group()), 0, 'missing layer falls back to project Y');
line.geometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -10, 0)]);
line.userData.isEdgeHelper = true;
assert.equal(readModelNorth(model), 0, 'mesh edge helpers cannot define north');
line.userData.isEdgeHelper = false;
const block = new THREE.Group();
block.userData.attributes = { layerIndex: 0 };
delete line.userData.attributes;
block.add(line);
model.add(block);
assert.equal(readModelNorth(model), 180, 'block children inherit the layer of their parent');
const segments = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(), new THREE.Vector3(-10, 0, 0), new THREE.Vector3(), new THREE.Vector3(10, 0, 0),
]));
segments.userData.attributes = { layerIndex: 0 };
const segmentModel = new THREE.Group();
segmentModel.userData.layers = [{ name: 'REP-NORTE-VEC' }];
segmentModel.add(segments);
assert.equal(readModelNorth(segmentModel), 270, 'independent segments use the first directed pair');
const invalidLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]));
invalidLine.userData.attributes = { layerIndex: 0 };
segmentModel.children.unshift(invalidLine);
assert.equal(readModelNorth(segmentModel), 270, 'skip an invalid line and use the next valid vector');
console.log('Model north tests passed: directed line, hidden layer, transforms, indices, inherited layers and fallback.');
const top = [1, 0, 0, -1];
assert.equal(normalizeNorthAngle(-1), 359);
assert.equal(normalizeNorthAngle(360), 0);
for (const projection of [top, [0, -1, -1, 0], [0.8, -0.6, -0.3, -0.4], [1, 0, 0, 1]]) {
  for (const angle of [0, 30, 90, 180, 270, 359]) {
    const screen = northScreenAngle(angle, projection) * Math.PI / 180;
    assert.equal(northPointerAngle(Math.sin(screen), -Math.cos(screen), projection), angle,
      'Pointer-to-world conversion matches the displayed arrow after camera rotation');
  }
}
assert.ok(Number.isFinite(northPointerAngle(1, -1, [1, 0, 0, 0])), 'Edge-on cameras remain usable');

// Exercise the actual event handlers without a browser or WebGL context.
class Element {
  attributes = new Map(); handlers = new Map(); pointer = null;
  setAttribute(key, value) { this.attributes.set(key, value); }
  addEventListener(type, handler) { this.handlers.set(type, handler); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  focus() {}
  setPointerCapture(id) { this.pointer = id; }
  hasPointerCapture(id) { return this.pointer === id; }
  releasePointerCapture() { this.pointer = null; }
  fire(type, data) { this.handlers.get(type)?.({ preventDefault() {}, stopPropagation() {}, ...data }); }
}
const dial = new Element(), arrow = new Element(), output = {}, reset = new Element();
const host = { querySelector: selector => ({ '.north-dial': dial, '.north-arrow': arrow, '.north-value': output, '.north-reset': reset })[selector] };
const uiSource = stripTypeScriptTypes(await readFile(new URL('../src/ui/NorthControl.ts', import.meta.url), 'utf8'))
  .replace("from '../data/north'", `from '${url}'`);
const { mountNorthControl } = await import(encode(uiSource));
const changes = [];
const control = mountNorthControl(host, angle => changes.push(angle));
assert.equal(output.value, '0°');
dial.fire('keydown', { key: 'ArrowLeft' });
assert.equal(changes.at(-1), 359);
dial.fire('keydown', { key: 'ArrowRight', shiftKey: true });
assert.equal(changes.at(-1), 9);
dial.fire('keydown', { key: 'Home' });
assert.equal(changes.at(-1), 0);
dial.fire('pointerdown', { button: 0, pointerId: 1, clientX: 95, clientY: 50 });
assert.equal(changes.at(-1), 90);
assert.equal(dial.pointer, 1);
dial.fire('pointermove', { pointerId: 2, clientX: 5, clientY: 50 });
assert.equal(changes.at(-1), 90, 'Ignore other touch points');
dial.fire('pointermove', { pointerId: 1, clientX: 50, clientY: 95 });
assert.equal(changes.at(-1), 180);
dial.fire('pointerup', { pointerId: 1 });
assert.equal(dial.pointer, null);
control.update({ groundProjection: [0, -1, -1, 0] });
assert.ok(Math.abs(Number(arrow.attributes.get('transform').match(/rotate\(([^ ]+)/)[1]) + 90) < 1e-10);
assert.equal(changes.at(-1), 180, 'Orbiting the camera changes the indicator, not the chosen north');
assert.equal(dial.attributes.get('aria-valuenow'), '180');
control.setInitialAngle(135);
assert.equal(changes.at(-1), 135, 'initial model direction is applied to solar settings');
dial.fire('keydown', { key: 'ArrowRight', shiftKey: true });
assert.equal(changes.at(-1), 145, 'manual adjustment remains available');
reset.fire('click');
assert.equal(changes.at(-1), 135, 'reset restores the model direction, not zero');
assert.equal(output.value, '135°');
control.update({ groundProjection: top });
assert.ok(Math.abs(Number(arrow.attributes.get('transform').match(/rotate\(([^ ]+)/)[1]) - 135) < 1e-10,
  'camera rotation preserves the reset direction');
dial.fire('keydown', { key: 'ArrowLeft' });
dial.fire('keydown', { key: 'Home' });
assert.equal(changes.at(-1), 135, 'Home also restores the initial model north');
control.setInitialAngle(0);
dial.fire('keydown', { key: 'ArrowRight' });
reset.fire('click');
assert.equal(changes.at(-1), 0, 'fallback north resets to project Y');
console.log('North tests passed: rotation, camera projection, drag, touch capture, keyboard and accessible value.');
