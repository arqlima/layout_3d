import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../src/data/solar.ts', import.meta.url), 'utf8');
const { solarDirection, defaultSolarSettings, solarDayPath, annualSunSamples } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const defaults = defaultSolarSettings();
assert.equal(defaults.exposure, 0.8);
assert.equal(defaults.shadowIntensity, 80);
assert.equal(defaults.sunIntensity, 120);
assert.equal(defaults.minutes, 900);
assert.equal(defaults.northAngle, 0);
const settings = { ...defaults, latitude: 0, longitude: 0, utcOffset: 0, date: '2026-03-20', minutes: 720 };
const noon = solarDirection(settings);
assert.ok(noon.y > 0.99, 'Equinox noon at the equator is near the zenith');
const morning = solarDirection({ ...settings, minutes: 480 });
const afternoon = solarDirection({ ...settings, minutes: 960 });
assert.ok(morning.x > 0 && afternoon.x < 0, 'Sun moves east to west');
assert.ok(solarDirection({ ...settings, minutes: 0 }).y < 0, 'Midnight sun is below the horizon');
const summer = solarDirection({ ...settings, latitude: -20, date: '2026-12-21' });
const winter = solarDirection({ ...settings, latitude: -20, date: '2026-06-21' });
assert.ok(summer.y > winter.y, 'Southern summer sun is higher than winter sun');
assert.deepEqual(solarDirection({ ...settings, longitude: 15, utcOffset: 1 }), noon, 'Timezone and longitude offsets compensate');
for (const latitude of [-90, 90]) {
  const direction = solarDirection({ ...settings, latitude, date: '2024-02-29' });
  assert.ok(Object.values(direction).every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-10);
}
assert.throws(() => solarDirection({ ...settings, date: '2026-02-30' }));
assert.throws(() => solarDirection({ ...settings, latitude: NaN }));
const rotated = solarDirection({ ...settings, minutes: 480, northAngle: 90 });
assert.ok(Math.abs(rotated.x + morning.z) < 1e-10);
assert.ok(Math.abs(rotated.z - morning.x) < 1e-10);
assert.equal(rotated.y, morning.y, 'North rotation preserves solar altitude');
const fullTurn = solarDirection({ ...settings, minutes: 480, northAngle: 360 });
assert.ok(Math.abs(fullTurn.x - morning.x) < 1e-10);
assert.ok(Math.abs(fullTurn.z - morning.z) < 1e-10);
assert.throws(() => solarDirection({ ...settings, northAngle: NaN }));
assert.equal(typeof solarDayPath, 'function', 'Solar overlay needs a full-day path independent of the time slider');
assert.equal(typeof annualSunSamples, 'function', 'Annual exposure needs weighted samples for every month');
const annual = annualSunSamples(settings);
assert.ok(annual.length > 100);
assert.ok(annual.every(sample => sample.direction.y > 0 && sample.hours > 0));
assert.ok(annual.reduce((hours, sample) => hours + sample.hours, 0) > 4000);
assert.deepEqual(annualSunSamples({ ...settings, minutes: 0, date: '2026-12-01' }), annual, 'Annual samples depend on year, not selected day or time');
const path = solarDayPath(settings);
assert.equal(path.length, 289, 'Five-minute samples include midnight at both ends');
assert.ok(path.some(point => point.y > 0.99));
assert.ok(path.some(point => point.y < 0));
assert.deepEqual(solarDayPath({ ...settings, minutes: 100 }), path, 'Selected time does not reshape the daily path');
const rotatedPath = solarDayPath({ ...settings, northAngle: 90 });
assert.ok(Math.abs(rotatedPath[96].x + path[96].z) < 1e-10, 'Path follows model north');
for (const latitude of [-90, 90]) {
  assert.ok(solarDayPath({ ...settings, latitude }).every(point => Object.values(point).every(Number.isFinite)));
}
console.log('Solar tests passed: defaults, equinox, east/west, night, seasons, UTC, poles, leap years and invalid input.');
