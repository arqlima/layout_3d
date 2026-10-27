import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../src/data/solar.ts', import.meta.url), 'utf8');
const { solarDirection, defaultSolarSettings } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
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
console.log('Solar tests passed: defaults, equinox, east/west, night, seasons, UTC, poles, leap years and invalid input.');
