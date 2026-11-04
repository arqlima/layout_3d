import * as THREE from 'three';
import { solarDayPath, solarDirection, type SolarSettings } from '../data/solar';

/** Visual guide only: independent of model geometry, selection and shadows. */
export class SolarPath {
  readonly root = new THREE.Group();
  private readonly bandGeometry = new THREE.BufferGeometry();
  private readonly dayGeometry = new THREE.BufferGeometry();
  private readonly rayGeometry = new THREE.BufferGeometry();
  private readonly bandMaterial = new THREE.MeshBasicMaterial({
    color: '#efa83b', transparent: true, opacity: 0.12, side: THREE.DoubleSide,
    depthWrite: false, toneMapped: false, fog: false,
  });
  private readonly dayMaterial = new THREE.LineBasicMaterial({ color: '#ffbf37', toneMapped: false, fog: false });
  private readonly horizonMaterial = new THREE.LineBasicMaterial({
    color: '#8798a4', transparent: true, opacity: 0.65, depthWrite: false, toneMapped: false, fog: false,
  });
  private readonly marker = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 10),
    new THREE.MeshBasicMaterial({ color: '#ffe5a0', toneMapped: false, fog: false }));
  private readonly ray = new THREE.Line(this.rayGeometry, this.dayMaterial);
  private cacheKey = '';
  private radius = 60;
  private scalePercent = 50;

  setOpacity(percent: number): void {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
    this.bandMaterial.opacity = percent / 100;
  }

  setScale(percent: number): void {
    if (!Number.isFinite(percent) || percent < 5 || percent > 200) return;
    this.scalePercent = percent;
    this.root.scale.setScalar(this.radius * percent / 100);
  }

  constructor() {
    this.root.name = 'Faixa solar';
    this.root.userData.includeInImageExport = true;
    this.root.visible = false;
    const horizon = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 129 }, (_, index) => {
      const angle = index / 128 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    }));
    this.root.add(new THREE.Mesh(this.bandGeometry, this.bandMaterial),
      new THREE.LineSegments(this.dayGeometry, this.dayMaterial),
      new THREE.Line(horizon, this.horizonMaterial), this.ray, this.marker);
  }

  update(settings: SolarSettings, bounds: THREE.Box3): void {
    const sphere = bounds.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 30) : bounds.getBoundingSphere(new THREE.Sphere());
    this.root.position.set(sphere.center.x, bounds.isEmpty() ? 0 : bounds.min.y, sphere.center.z);
    this.radius = Math.max(10, sphere.radius) * 2;
    this.setScale(this.scalePercent);
    // Time and lighting sliders only move the sun marker; paths are cached.
    const key = JSON.stringify([settings.latitude, settings.longitude, settings.utcOffset, settings.date, settings.northAngle]);
    if (key !== this.cacheKey) {
      const day = solarDayPath(settings).map(point => new THREE.Vector3(point.x, point.y, point.z));
      const year = settings.date.slice(0, 4);
      const june = solarDayPath({ ...settings, date: `${year}-06-21` }).map(p => new THREE.Vector3(p.x, p.y, p.z));
      const december = solarDayPath({ ...settings, date: `${year}-12-21` }).map(p => new THREE.Vector3(p.x, p.y, p.z));
      const band: THREE.Vector3[] = [];
      const line: THREE.Vector3[] = [];
      for (let index = 0; index < day.length - 1; index++) {
        const a = day[index], b = day[index + 1];
        if (a.y >= 0 || b.y >= 0) {
          line.push(a.y >= 0 ? a : horizonPoint(a, b), b.y >= 0 ? b : horizonPoint(a, b));
        }
        // Subdivide across seasons so the band follows the celestial dome.
        for (let strip = 0; strip < 8; strip++) {
          const a0 = june[index].clone().lerp(december[index], strip / 8).normalize();
          const a1 = june[index].clone().lerp(december[index], (strip + 1) / 8).normalize();
          const b0 = june[index + 1].clone().lerp(december[index + 1], strip / 8).normalize();
          const b1 = june[index + 1].clone().lerp(december[index + 1], (strip + 1) / 8).normalize();
          for (const triangle of [[a0, a1, b0], [a1, b1, b0]]) {
            const clipped = clipAboveHorizon(triangle);
            for (let vertex = 1; vertex < clipped.length - 1; vertex++) {
              band.push(clipped[0], clipped[vertex], clipped[vertex + 1]);
            }
          }
        }
      }
      this.bandGeometry.setAttribute('position', new THREE.Float32BufferAttribute(band.flatMap(point => point.toArray()), 3));
      this.bandGeometry.computeBoundingSphere();
      this.dayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(line.flatMap(point => point.toArray()), 3));
      this.dayGeometry.computeBoundingSphere();
      this.cacheKey = key;
    }
    const sun = solarDirection(settings);
    this.marker.position.set(sun.x, sun.y, sun.z);
    this.marker.visible = this.ray.visible = sun.y > 0;
    this.rayGeometry.setFromPoints([new THREE.Vector3(), this.marker.position]);
    this.rayGeometry.computeBoundingSphere();
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) object.geometry.dispose();
    });
    this.bandMaterial.dispose();
    this.dayMaterial.dispose();
    this.horizonMaterial.dispose();
    this.marker.material.dispose();
  }
}

function horizonPoint(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  const point = a.clone().lerp(b, a.y / (a.y - b.y));
  point.y = 0;
  return point.normalize();
}

function clipAboveHorizon(points: THREE.Vector3[]): THREE.Vector3[] {
  const result: THREE.Vector3[] = [];
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length];
    if (a.y >= 0) result.push(a);
    if ((a.y >= 0) !== (b.y >= 0)) result.push(horizonPoint(a, b));
  }
  return result;
}
