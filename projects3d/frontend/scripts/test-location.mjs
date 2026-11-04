import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const loadSource = async path => stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'));
const solarUrl = `data:text/javascript;base64,${Buffer.from(await loadSource('../src/data/solar.ts')).toString('base64')}`;
const panelSource = (await loadSource('../src/ui/SolarPanel.ts')).replace("'../data/solar'", JSON.stringify(solarUrl));
const { mountSolarPanel } = await import(`data:text/javascript;base64,${Buffer.from(panelSource).toString('base64')}`);

function mount(location) {
  const inputs = ['latitude', 'longitude', 'utcOffset', 'date', 'minutes', 'northAngle', 'exposure', 'shadowIntensity', 'sunIntensity']
    .map(name => ({ name, id: `solar-${name}`, type: name === 'date' ? 'date' : 'number', value: '',
      get valueAsNumber() { return Number(this.value); }, checkValidity: () => true,
      addEventListener(_event, callback) { this.change = callback; } }));
  const elements = { '.solar-note': {}, '.solar-status': {}, '#solar-path-opacity-value': {}, '#solar-path-opacity': {
    value: '12', get valueAsNumber() { return Number(this.value); },
    set valueAsNumber(value) { this.value = String(value); }, addEventListener(_event, callback) { this.change = callback; },
  }, '#solar-path-size-value': {}, '#solar-path-size': {
    value: '50', get valueAsNumber() { return Number(this.value); },
    set valueAsNumber(value) { this.value = String(value); }, addEventListener(_event, callback) { this.change = callback; },
  }, '#solar-path': {
    checked: false, addEventListener(_event, callback) { this.change = callback; },
  } };
  for (const id of ['solar-exposure-calculate', 'solar-exposure-cancel', 'solar-exposure-map', 'solar-exposure-status', 'solar-exposure-legend', 'solar-exposure-max']) {
    elements[`#${id}`] = { disabled: true, checked: false, hidden: true,
      addEventListener(_event, callback) { this.action = callback; } };
  }
  const container = { innerHTML: '', querySelectorAll: () => inputs, querySelector: selector => elements[selector] || null };
  return { panel: mountSolarPanel(container, location), inputs, elements };
}

const locked = mount({ latitude: -20, longitude: -54, locked: true });
assert.equal(locked.panel.settings().latitude, -20);
assert.equal(locked.panel.settings().longitude, -54);
const latitude = locked.inputs.find(input => input.name === 'latitude');
assert.equal(latitude.disabled, true);
latitude.value = '80';
latitude.change();
assert.equal(locked.panel.settings().latitude, -20, 'KMZ coordinates ignore simulated manual input');
locked.panel.setNorthAngle(45);
assert.equal(locked.panel.settings().northAngle, 45);
assert.match(locked.elements['.solar-note'].textContent, /KMZ/);
const manual = mount({ latitude: 0, longitude: 0, locked: false });
assert.equal(manual.panel.pathVisible(), false, 'Solar path is off by default');
assert.equal(manual.panel.pathScale(), 50, 'Solar overlay starts at a smaller size');
assert.equal(manual.panel.pathOpacity(), 12, 'Opacity starts at 12 percent');
let opacity = null;
manual.panel.onPathOpacityChange(percent => { opacity = percent; });
for (const percent of [0, 65, 100]) {
  manual.elements['#solar-path-opacity'].valueAsNumber = percent;
  manual.elements['#solar-path-opacity'].change();
  assert.equal(opacity, percent, 'Opacity slider notifies the viewer');
  assert.equal(manual.elements['#solar-path-opacity-value'].value, `${percent}%`);
}
manual.elements['#solar-path-opacity'].valueAsNumber = 101;
manual.elements['#solar-path-opacity'].change();
assert.equal(opacity, 100, 'Invalid opacity does not notify the viewer');
let size = null;
manual.panel.onPathScaleChange(percent => { size = percent; });
manual.elements['#solar-path-size'].valueAsNumber = 25;
manual.elements['#solar-path-size'].change();
assert.equal(size, 25, 'Size slider notifies the viewer');
assert.equal(manual.elements['#solar-path-size-value'].value, '25%');
let pathVisible = null;
manual.panel.onPathChange(value => { pathVisible = value; });
manual.elements['#solar-path'].checked = true;
manual.elements['#solar-path'].change();
assert.equal(pathVisible, true, 'Checkbox activates the solar path independently of lighting');
assert.equal(manual.panel.pathVisible(), true);
manual.elements['#solar-path'].checked = false;
manual.elements['#solar-path'].change();
assert.equal(pathVisible, false, 'Checkbox deactivates the solar path');
const longitude = manual.inputs.find(input => input.name === 'longitude');
assert.equal(longitude.disabled, false);
longitude.value = '10';
longitude.change();
assert.equal(manual.panel.settings().longitude, 10);
const solarSaved = {
  settings: { ...manual.panel.settings(), date: '2026-06-21', minutes: 720, northAngle: 45 },
  pathVisible: true, scale: 30, opacity: 70,
};
manual.panel.restore(solarSaved);
assert.deepEqual(manual.panel.settings(), solarSaved.settings, 'Solar scene restores date, time, north and lighting controls');
assert.equal(manual.panel.pathScale(), 30);
assert.equal(manual.panel.pathOpacity(), 70);
assert.equal(manual.panel.pathVisible(), true);
assert.equal(size, 30);
assert.equal(opacity, 70);
assert.equal(pathVisible, true, 'Restoring controls synchronizes the viewer callbacks');
locked.panel.restore({ ...solarSaved, settings: { ...solarSaved.settings, latitude: 70, longitude: 10 } });
assert.equal(locked.panel.settings().latitude, -20, 'Saved scenes retain the authoritative KMZ location');
assert.equal(locked.panel.settings().longitude, -54);
assert.equal(mount().panel.settings().latitude, -20.4697, 'Legacy projects retain the existing fallback');
manual.panel.onExposureCalculate(async progress => { progress(50); return { year: '2026', points: 1500, maxHours: 4300, skipped: 0 }; });
await manual.elements['#solar-exposure-calculate'].action();
assert.equal(manual.panel.exposureVisible(), true, 'Completed calculation activates the map');
assert.equal(manual.elements['#solar-exposure-legend'].hidden, false);
assert.match(manual.elements['#solar-exposure-status'].textContent, /2026/);
manual.panel.invalidateExposure();
assert.equal(manual.panel.exposureVisible(), false, 'Changed parameters invalidate displayed results');
assert.equal(manual.elements['#solar-exposure-map'].disabled, true);
await manual.panel.restoreExposure();
assert.equal(manual.panel.exposureVisible(), true, 'Scene restoration recalculates the map and synchronizes its controls');
manual.panel.onExposureCalculate(async () => { throw new Error('map failure'); });
await assert.rejects(manual.panel.restoreExposure(), /map failure/, 'Restore failures reach the scene toolbar');
console.log('Location panel tests passed: KMZ lock, manual editing, project coordinates and legacy fallback.');
