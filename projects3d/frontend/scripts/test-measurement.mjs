import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const source = await readFile(new URL('../src/viewer/measurement.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(source, { mode: 'transform' })
  .replace("from 'three'", `from '${import.meta.resolve('three')}'`);
const { snapVertex, formatDistance, metersPerUnit, MeasurementTool } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
assert.equal(formatDistance(new THREE.Vector3(), new THREE.Vector3(3, 4, 0), 1), '5,00 m');
assert.equal(formatDistance(new THREE.Vector3(), new THREE.Vector3(1234, 0, 0), 0.001), '1,23 m');
assert.equal(metersPerUnit({ modelUnitSystem: { value: 2 } }), 0.001);
assert.equal(metersPerUnit({ modelUnitSystem: { value: 4 } }), 1);
assert.equal(metersPerUnit({ modelUnitSystem: { value: 9 } }), 0.3048);
assert.equal(metersPerUnit(undefined), 1);

const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
mesh.position.x = 1;
mesh.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
// Corner at (2, 1, 1) projects to (700, 400); cursor is just outside the silhouette.
let point = snapVertex(ray, [mesh], camera, 706, 394, 1000, 1000);
assert.ok(point && point.distanceTo(new THREE.Vector3(2, 1, 1)) < 1e-6);
assert.equal(snapVertex(ray, [mesh], camera, 600, 500, 1000, 1000), null, 'surface center does not snap');
assert.equal(snapVertex(ray, [mesh], camera, 730, 370, 1000, 1000), null, 'distant cursor does not snap');
mesh.visible = false;
assert.equal(snapVertex(ray, [mesh], camera, 700, 400, 1000, 1000), null, 'hidden geometry is excluded');
mesh.visible = true;
const parent = new THREE.Group();
parent.add(mesh);
parent.visible = false;
assert.equal(snapVertex(ray, [mesh], camera, 700, 400, 1000, 1000), null, 'hidden parent is excluded');
console.log('Measurement tests passed: meters, two decimals, world transforms, snap radius and hidden geometry.');

// Minimal DOM surface: exercise the real pointer workflow without WebGL.
class Element {
  style = {}; attributes = {}; children = []; listeners = new Map();
  classList = { toggle() {} };
  append(...children) { this.children.push(...children); }
  prepend(child) { this.children.unshift(child); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  removeEventListener(name) { this.listeners.delete(name); }
  remove() { this.removed = true; }
  emit(name, event = {}) { this.listeners.get(name)?.(event); }
}
globalThis.document = { createElement: () => new Element(), createElementNS: () => new Element() };
globalThis.window = new Element();
const canvas = new Element();
canvas.parentElement = new Element();
canvas.clientWidth = canvas.clientHeight = 1000;
canvas.getBoundingClientRect = () => ({ left: 50, top: 20, width: 1000, height: 1000 });
const button = new Element();
parent.visible = true;
const tool = new MeasurementTool(canvas, button, () => camera, () => [mesh], () => 1);
const click = (x, y, dx = 0) => {
  const event = { clientX: x + 50, clientY: y + 20, pointerId: 1, button: 0, isPrimary: true };
  canvas.emit('pointerdown', event);
  canvas.emit('pointerup', { ...event, clientX: event.clientX + dx });
};
button.emit('click');
assert.equal(button.attributes['aria-pressed'], 'true');
click(700, 400, 20);
assert.equal(tool.start, null, 'orbit drags never place endpoints');
click(700, 400);
assert.ok(tool.start);
canvas.emit('pointermove', { clientX: 550, clientY: 420, buttons: 0 });
assert.equal(tool.label.textContent, '2,00 m', 'preview uses snapped points');
click(500, 400);
assert.equal(tool.label.textContent, '2,00 m');
assert.ok(tool.end);
camera.position.x += 1;
camera.updateMatrixWorld(true);
tool.update();
assert.equal(tool.label.style.left, '500px', 'label follows camera movement');
camera.position.x -= 1;
camera.updateMatrixWorld(true);
click(700, 400);
assert.equal(tool.end, null, 'a new click starts a fresh measurement');
canvas.emit('pointercancel');
window.emit('keydown', { key: 'Escape' });
assert.equal(tool.enabled, false);
assert.equal(tool.overlay.hidden, true);
assert.equal(button.attributes['aria-pressed'], 'false');
tool.dispose();
assert.equal(canvas.listeners.size, 0);
assert.equal(button.listeners.size, 0);
assert.equal(tool.overlay.removed, true);
console.log('Measurement interaction tests passed: toggle, preview, two clicks, drag, camera, restart, Escape and disposal.');
