import * as THREE from 'three';
import { annualSunSamples, type SolarSettings } from '../data/solar';

interface Surface {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  normal: THREE.Vector3;
  area: number;
  center: THREE.Vector3;
}

interface Node {
  bounds: THREE.Box3;
  surfaces?: Surface[];
  left?: Node;
  right?: Node;
}

export interface ExposureSource {
  object: THREE.Mesh;
  material: THREE.Material | THREE.Material[];
}

export interface ExposureResult {
  year: string;
  points: number;
  maxHours: number;
  skipped: number;
}

async function buildTree(surfaces: Surface[], signal: AbortSignal): Promise<Node> {
  signal.throwIfAborted();
  if (surfaces.length > 4096) await pause();
  const bounds = new THREE.Box3();
  for (const face of surfaces) bounds.expandByPoint(face.a).expandByPoint(face.b).expandByPoint(face.c);
  if (surfaces.length <= 12) return { bounds, surfaces };
  const size = bounds.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  surfaces.sort((a, b) => a.center[axis] - b.center[axis]);
  const middle = Math.floor(surfaces.length / 2);
  return { bounds, left: await buildTree(surfaces.slice(0, middle), signal), right: await buildTree(surfaces.slice(middle), signal) };
}

function obstructed(ray: THREE.Ray, tree: Node, hit: THREE.Vector3): boolean {
  if (!ray.intersectsBox(tree.bounds)) return false;
  if (tree.surfaces) return tree.surfaces.some(face => ray.intersectTriangle(face.a, face.b, face.c, false, hit) !== null);
  return obstructed(ray, tree.left!, hit) || obstructed(ray, tree.right!, hit);
}

function fraction(index: number, base: number): number {
  let result = 0, factor = 1 / base;
  while (index > 0) { result += (index % base) * factor; index = Math.floor(index / base); factor /= base; }
  return result;
}

const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Point-sampled annual direct sunlight; never modifies source meshes/materials. */
export class AnnualExposure {
  readonly root = new THREE.Group();

  async calculate(sources: ExposureSource[], settings: SolarSettings,
    signal: AbortSignal, progress: (percent: number) => void, pointCount = 1500): Promise<ExposureResult> {
    this.clear();
    const samples = annualSunSamples(settings);
    const faces: Surface[] = [];
    let skipped = 0, totalArea = 0, processed = 0;
    for (const { object, material } of sources) {
      signal.throwIfAborted();
      if (object instanceof THREE.InstancedMesh || object instanceof THREE.SkinnedMesh || object.morphTargetInfluences?.some(value => value !== 0)) {
        skipped++; continue;
      }
      object.updateWorldMatrix(true, false);
      const geometry = object.geometry;
      const position = geometry.getAttribute('position');
      if (!position) { skipped++; continue; }
      const index = geometry.index;
      const materials = Array.isArray(material) ? material : [material];
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
      const count = index?.count ?? position.count;
      const end = Math.min(count, geometry.drawRange.start + geometry.drawRange.count);
      for (let offset = geometry.drawRange.start; offset + 2 < end; offset += 3) {
        const group = geometry.groups.find(group => offset >= group.start && offset < group.start + group.count);
        const faceMaterial = materials[Array.isArray(material) ? group?.materialIndex ?? 0 : 0];
        if (!faceMaterial || faceMaterial.transparent || faceMaterial.opacity <= 0.99) continue;
        const vertices = [0, 1, 2].map(corner => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(offset + corner) : offset + corner));
        const normal = new THREE.Triangle(...vertices as [THREE.Vector3, THREE.Vector3, THREE.Vector3]).getNormal(new THREE.Vector3()).applyNormalMatrix(normalMatrix);
        const [a, b, c] = vertices.map(vertex => vertex.applyMatrix4(object.matrixWorld));
        const triangle = new THREE.Triangle(a, b, c);
        const area = triangle.getArea();
        if (area > 0) {
          faces.push({ a, b, c, normal, area, center: triangle.getMidpoint(new THREE.Vector3()) });
          totalArea += area;
        }
        if (faces.length > 200000) throw new Error('Modelo com mais de 200 mil triângulos opacos. Simplifique o modelo para calcular a exposição.');
        if (++processed % 5000 === 0) { await pause(); signal.throwIfAborted(); }
      }
    }
    if (!faces.length) throw new Error('Não há superfícies opacas estáticas visíveis para analisar.');
    progress(5);
    await pause();
    signal.throwIfAborted();
    const tree = await buildTree([...faces], signal);
    const epsilon = Math.max(1e-6, tree.bounds.getSize(new THREE.Vector3()).length() * 1e-6);
    const positions: number[] = [], colors: number[] = [];
    const ray = new THREE.Ray(), hit = new THREE.Vector3();
    const color = new THREE.Color();
    const maxHours = samples.reduce((sum, sample) => sum + sample.hours, 0);
    let faceIndex = 0, areaEnd = faces[0].area;
    for (let index = 0; index < pointCount; index++) {
      signal.throwIfAborted();
      const targetArea = totalArea * (index + 0.5) / pointCount;
      while (targetArea > areaEnd && faceIndex < faces.length - 1) areaEnd += faces[++faceIndex].area;
      const face = faces[faceIndex];
      const u = Math.sqrt(fraction(index + 1, 2)), v = fraction(index + 1, 3);
      const point = face.a.clone().multiplyScalar(1 - u).addScaledVector(face.b, u * (1 - v)).addScaledVector(face.c, u * v);
      ray.origin.copy(point).addScaledVector(face.normal, epsilon);
      let hours = 0;
      for (const sample of samples) {
        ray.direction.set(sample.direction.x, sample.direction.y, sample.direction.z);
        if (face.normal.dot(ray.direction) > 1e-6 && !obstructed(ray, tree, hit)) hours += sample.hours;
      }
      positions.push(...ray.origin.toArray());
      color.setHSL((1 - hours / Math.max(1, maxHours)) * (2 / 3), 1, 0.5);
      colors.push(...color.toArray());
      if (index % 20 === 0) { progress(5 + Math.round(index / pointCount * 95)); await pause(); }
    }
    signal.throwIfAborted();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.ShaderMaterial({
      vertexColors: true, depthWrite: false,
      vertexShader: 'varying vec3 exposureColor; void main() { exposureColor = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = 7.0; }',
      fragmentShader: 'varying vec3 exposureColor; void main() { if (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard; gl_FragColor = vec4(exposureColor, 1.0);\n#include <colorspace_fragment>\n}',
    });
    this.root.name = 'Exposição solar anual por amostras';
    this.root.add(new THREE.Points(geometry, material));
    progress(100);
    return { year: settings.date.slice(0, 4), points: pointCount, maxHours, skipped };
  }

  clear(): void {
    for (const child of [...this.root.children]) {
      if (child instanceof THREE.Points) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(material => material.dispose());
      }
      this.root.remove(child);
    }
  }

  dispose(): void { this.clear(); this.root.removeFromParent(); }
}
