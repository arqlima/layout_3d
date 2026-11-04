export interface SolarSettings {
  exposure: number;
  shadowIntensity: number;
  sunIntensity: number;
  latitude: number;
  longitude: number;
  utcOffset: number;
  date: string;
  minutes: number;
  northAngle: number;
}

export function defaultSolarSettings(): SolarSettings {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return { exposure: 0.8, shadowIntensity: 80, sunIntensity: 120,
    latitude: -20.4697, longitude: -54.6201, utcOffset: -4, date, minutes: 900, northAngle: 0 };
}

/** Full civil day sampled every five minutes, including the closing midnight. */
export function solarDayPath(settings: SolarSettings): ReturnType<typeof solarDirection>[] {
  return Array.from({ length: 289 }, (_, index) => solarDirection({ ...settings, minutes: index === 288 ? 0 : index * 5 }));
}

/** NOAA approximation. World axes: east +X, up +Y, north -Z (Rhino +Y).
 * https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 */
export function solarDirection(settings: SolarSettings): { x: number; y: number; z: number } {
  const { latitude, longitude, utcOffset, date, minutes, northAngle } = settings;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== date
    || ![latitude, longitude, utcOffset, minutes, northAngle].every(Number.isFinite)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || utcOffset < -12 || utcOffset > 14
    || minutes < 0 || minutes >= 1440) throw new Error('Informe coordenadas, fuso, data e horário válidos.');
  const year = Number(date.slice(0, 4));
  const start = Date.parse(`${year}-01-01T00:00:00Z`);
  const days = (Date.parse(`${year + 1}-01-01T00:00:00Z`) - start) / 86400000;
  const day = (timestamp - start) / 86400000;
  const gamma = 2 * Math.PI / days * (day + (minutes / 60 - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const hourAngle = ((minutes + eqtime + 4 * longitude - 60 * utcOffset) / 4 - 180) * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const north = Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const east = -Math.cos(decl) * Math.sin(hourAngle);
  const angle = northAngle * Math.PI / 180;
  return {
    x: east * Math.cos(angle) + north * Math.sin(angle),
    y: Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle),
    z: east * Math.sin(angle) - north * Math.cos(angle),
  };
}
