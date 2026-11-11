import assert from 'node:assert/strict';
import './register-typescript.mjs';
const { RenderScheduler } = await import('../src/viewer/RenderScheduler.ts');

const frames = new Map(); let nextId = 0;
globalThis.requestAnimationFrame = callback => { const id = ++nextId; frames.set(id, callback); return id; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
const tick = () => {
  const callbacks = [...frames.values()]; frames.clear();
  for (const callback of callbacks) callback(0);
};
let draws = 0;
const scheduler = new RenderScheduler(() => draws++);
assert.equal(frames.size, 0, 'No work until a change is requested');
scheduler.invalidate(); scheduler.invalidate(); scheduler.invalidate();
assert.equal(frames.size, 1, 'Several edits coalesce into one frame');
tick(); assert.equal(draws, 1); assert.equal(frames.size, 0, 'Static scenes stop scheduling');
tick(); assert.equal(draws, 1, 'Idle ticks do not draw');
scheduler.setActive(false); scheduler.invalidate();
assert.equal(frames.size, 0, 'Inactive views defer edits');
scheduler.setActive(true); tick(); assert.equal(draws, 2, 'Reactivation redraws the latest state');
scheduler.invalidate(); scheduler.setActive(false); tick();
assert.equal(draws, 2, 'Deactivation cancels queued work');
scheduler.setActive(true); scheduler.dispose(); tick(); scheduler.invalidate(); scheduler.setActive(true);
assert.equal(draws, 2); assert.equal(frames.size, 0, 'Disposed viewers never restart');

// OrbitControls emits change inside update() while damping is settling.
let settling = 4;
const damping = new RenderScheduler(() => { if (--settling > 0) damping.invalidate(); });
damping.invalidate();
for (let i = 0; i < 8; i++) tick();
assert.equal(settling, 0); assert.equal(frames.size, 0, 'Damping continues then stops');
damping.dispose();
console.log('Rendering scheduler tests passed: idle, coalescing, damping, pause, resume and disposal.');
