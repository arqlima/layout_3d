import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(await readFile(new URL('../src/ui/PresentationSettings.ts', import.meta.url), 'utf8'));
const { mountPresentationSettings } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
class Element {
  handlers = new Map(); style = {}; value = '';
  addEventListener(type, handler) { this.handlers.set(type, handler); }
  get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); }
  checkValidity() { return this.value !== '' && this.valueAsNumber >= 0 && this.valueAsNumber <= 255; }
  getBoundingClientRect() { return { left: 100, bottom: 90 }; }
  fire(type) { this.handlers.get(type)?.(); }
}
const button = new Element(), panel = new Element(), theme = new Element(), color = new Element();
theme.value = 'light'; color.value = '#a3a3a3';
const channels = ['163', '163', '163'].map(value => Object.assign(new Element(), { value }));
const host = {
  querySelector: selector => ({ '.presentation-settings-toggle': button, '#presentation-settings': panel,
    '#presentation-theme': theme, '#presentation-background': color })[selector],
  querySelectorAll: () => channels,
};
globalThis.document = { documentElement: { dataset: {} } };
globalThis.window = { innerWidth: 900, innerHeight: 700 };
const control = mountPresentationSettings(host);
assert.match(host.innerHTML, /popover="auto"/, 'Native popover provides Escape, outside click and focus return');
assert.match(host.innerHTML, /popovertarget="presentation-settings"/);
assert.equal(document.documentElement.dataset.presentationTheme, 'light');
const colors = [];
control.onBackgroundChange(value => colors.push(value));
assert.deepEqual(colors, ['#a3a3a3']);
assert.match(host.innerHTML, /type="color" value="#a3a3a3"/);
assert.equal((host.innerHTML.match(/value="163" data-channel=/g) ?? []).length, 3);
theme.value = 'dark'; theme.fire('change');
assert.equal(document.documentElement.dataset.presentationTheme, 'dark');
assert.equal(colors.length, 1, 'Theme leaves the 3D background independent');
color.value = '#ff8000'; color.fire('input');
assert.deepEqual(channels.map(input => input.value), ['255', '128', '0']);
assert.equal(colors.at(-1), '#ff8000');
channels[0].value = '0'; channels[0].fire('input');
assert.equal(color.value, '#008000');
for (const invalid of ['', '256', '-1', '1.5']) {
  channels[0].value = invalid; channels[0].fire('input');
  assert.equal(color.value, '#008000', 'Invalid channels never reach the viewer');
}
theme.value = 'light'; theme.fire('change');
assert.equal(document.documentElement.dataset.presentationTheme, 'light');
button.fire('click');
assert.equal(panel.style.left, '100px'); assert.equal(panel.style.top, '100px');
window.innerWidth = 320; window.innerHeight = 300; button.fire('click');
assert.equal(panel.style.left, '8px'); assert.equal(panel.style.top, '8px');
delete globalThis.document; delete globalThis.window;
console.log('Presentation settings tests passed: themes, independent background, RGB synchronization, invalid values and panel placement.');
