import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const encode = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const source = stripTypeScriptTypes(await readFile(new URL('../src/data/north.ts', import.meta.url), 'utf8'));
const url = encode(source);
const { normalizeNorthAngle, northPointerAngle, northScreenAngle } = await import(url);
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
const dial = new Element(), arrow = new Element(), output = {};
const host = { querySelector: selector => ({ '.north-dial': dial, '.north-arrow': arrow, '.north-value': output })[selector] };
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
console.log('North tests passed: rotation, camera projection, drag, touch capture, keyboard and accessible value.');
