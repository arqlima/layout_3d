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
  const elements = { '.solar-note': {}, '.solar-status': {} };
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
const longitude = manual.inputs.find(input => input.name === 'longitude');
assert.equal(longitude.disabled, false);
longitude.value = '10';
longitude.change();
assert.equal(manual.panel.settings().longitude, 10);
assert.equal(mount().panel.settings().latitude, -20.4697, 'Legacy projects retain the existing fallback');
console.log('Location panel tests passed: KMZ lock, manual editing, project coordinates and legacy fallback.');
