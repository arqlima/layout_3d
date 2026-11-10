import * as THREE from 'three';
import { annualSunSamples, type SolarSettings } from '../data/solar';

interface Surface {
  receiveExposure: boolean;
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
  receiveExposure?: boolean;
  object: THREE.Mesh;
  material: THREE.Material | THREE.Material[];
}

export interface ExposureResult {
  year: string;
  points: number;
  maxHours: number;
  skipped: number;
  reducedDetail: boolean;
}

const MAX_SAMPLES = 25000;
const MAX_OVERLAY_TRIANGLES = 250000;

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

const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Vertex-sampled sunlight interpolated only inside each surface triangle. */
export class AnnualExposure {
  readonly root = new THREE.Group();

  async calculate(sources: ExposureSource[], settings: SolarSettings,
    signal: AbortSignal, progress: (percent: number) => void, targetSamples = 1500): Promise<ExposureResult> {
    this.clear();
    if (!Number.isFinite(targetSamples) || targetSamples <= 0) throw new Error('Informe uma quantidade de amostras positiva.');
    const samples = annualSunSamples(settings);
    const faces: Surface[] = [];
    let skipped = 0, totalArea = 0, processed = 0;
    for (const { object, material, receiveExposure = true } of sources) {
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
        const normal = new THREE.Triangle(...vertices as [THREE.Vector3, THREE.Vector3, THREE.Vector3]).getNormal(new THREE.Vector3()).applyNormalMatrix(normalMatrix).normalize();
        const [a, b, c] = vertices.map(vertex => vertex.applyMatrix4(object.matrixWorld));
        const triangle = new THREE.Triangle(a, b, c);
        const area = triangle.getArea();
        if (area > 0) {
          faces.push({ a, b, c, normal, area, receiveExposure, center: triangle.getMidpoint(new THREE.Vector3()) });
          if (receiveExposure) totalArea += area;
        }
        if (faces.length > 200000) throw new Error('Modelo com mais de 200 mil triângulos opacos. Simplifique o modelo para calcular a exposição.');
        if (++processed % 5000 === 0) { await pause(); signal.throwIfAborted(); }
      }
    }
    const receivers = faces.filter(face => face.receiveExposure);
    if (!receivers.length) throw new Error('Não há superfícies opacas estáticas visíveis fora de REP para analisar.');
    progress(5);
    await pause();
    signal.throwIfAborted();
    const tree = await buildTree([...faces], signal);
    const epsilon = Math.max(1e-6, tree.bounds.getSize(new THREE.Vector3()).length() * 1e-6);
    const positions: number[] = [], values: number[] = [];
    const ray = new THREE.Ray(), hit = new THREE.Vector3();
    const maxHours = samples.reduce((sum, sample) => sum + sample.hours, 0);
    const spacing = Math.sqrt(totalArea / targetSamples) * 2;
    const cache = new Map<string, number>();
    let reducedDetail = false;
    const triangles: Array<{ vertices: THREE.Vector3[]; normal: THREE.Vector3 }> = [];
    for (let faceIndex = 0; faceIndex < receivers.length; faceIndex++) {
      const face = receivers[faceIndex];
      const pending: THREE.Vector3[][] = [[face.a, face.b, face.c]];
      while (pending.length) {
        const vertices = pending.pop()!;
        const lengths = vertices.map((vertex, index) => vertex.distanceToSquared(vertices[(index + 1) % 3]));
        const edge = lengths.indexOf(Math.max(...lengths));
        // Reserve one triangle for every remaining source face; never drop geometry.
        const canSplit = triangles.length + pending.length + receivers.length - faceIndex + 1 <= MAX_OVERLAY_TRIANGLES;
        if (lengths[edge] > spacing * spacing && canSplit) {
          const a = vertices[edge], b = vertices[(edge + 1) % 3], c = vertices[(edge + 2) % 3];
          const midpoint = a.clone().add(b).multiplyScalar(.5);
          pending.push([a, midpoint, c], [midpoint, b, c]);
        } else {
          triangles.push({ vertices, normal: face.normal });
          if (lengths[edge] > spacing * spacing) reducedDetail = true;
        }
      }
      if (triangles.length % 1000 === 0) { await pause(); signal.throwIfAborted(); }
    }
    // Count keys before ray tracing. Complex meshes share samples in progressively
    // larger spatial cells, separated by approximate surface orientation.
    let cellSize = 0;
    const sampleKey = (point: THREE.Vector3, normal: THREE.Vector3): string => {
      if (cellSize === 0) return [...point.toArray().map(value => Math.round(value / epsilon)),
        ...normal.toArray().map(value => Math.round(value * 100000))].join(',');
      const x = point.x - tree.bounds.min.x, y = point.y - tree.bounds.min.y, z = point.z - tree.bounds.min.z;
      const nx = Math.round(normal.x * 4), ny = Math.round(normal.y * 4), nz = Math.round(normal.z * 4);
      // Finer depth bins help keep nearby parallel roofs/floors separate.
      const depth = Math.floor((x * nx + y * ny + z * nz) * 1024 / cellSize);
      return [Math.floor(x / cellSize), Math.floor(y / cellSize), Math.floor(z / cellSize), nx, ny, nz, depth].join(',');
    };
    while (true) {
      const keys = new Set<string>();
      for (let index = 0; index < triangles.length; index++) {
        const { vertices, normal } = triangles[index];
        for (const point of vertices) keys.add(sampleKey(point, normal));
        if (keys.size > MAX_SAMPLES) break;
        if (index % 2000 === 0) { await pause(); signal.throwIfAborted(); }
      }
      if (keys.size <= MAX_SAMPLES) break;
      reducedDetail = true;
      cellSize = cellSize === 0 ? Math.max(epsilon, Math.sqrt(totalArea / targetSamples)) : cellSize * 2;
      await pause(); signal.throwIfAborted();
    }
    const valueAt = (point: THREE.Vector3, normal: THREE.Vector3): number => {
      // Separate normals keep roof/facade corners sharp even at shared positions.
      const key = sampleKey(point, normal);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      ray.origin.copy(point).addScaledVector(normal, epsilon);
      let hours = 0;
      for (const sample of samples) {
        ray.direction.set(sample.direction.x, sample.direction.y, sample.direction.z);
        if (normal.dot(ray.direction) > 1e-6 && !obstructed(ray, tree, hit)) hours += sample.hours;
      }
      const value = hours / Math.max(1, maxHours);
      cache.set(key, value);
      return value;
    };
    let lastYield = performance.now();
    for (let index = 0; index < triangles.length; index++) {
      signal.throwIfAborted();
      const { vertices, normal } = triangles[index];
      for (const point of vertices) {
        positions.push(...point.toArray());
        values.push(valueAt(point, normal));
      }
      if (index % 20 === 0 && performance.now() - lastYield >= 16) {
        progress(5 + Math.round(index / triangles.length * 95)); await pause();
        lastYield = performance.now();
      }
    }
    signal.throwIfAborted();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('exposure', new THREE.Float32BufferAttribute(values, 1));
    const material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: `attribute float exposure;
        varying float solarExposure;
        void main() {
          solarExposure = exposure;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `varying float solarExposure;
        void main() {
          float t = clamp(solarExposure, 0.0, 1.0) * 4.0;
          vec3 color;
          if (t < 1.0) color = mix(vec3(0.,0.,1.), vec3(0.,1.,1.), t);
          else if (t < 2.0) color = mix(vec3(0.,1.,1.), vec3(0.,1.,0.), t - 1.0);
          else if (t < 3.0) color = mix(vec3(0.,1.,0.), vec3(1.,1.,0.), t - 2.0);
          else color = mix(vec3(1.,1.,0.), vec3(1.,0.,0.), t - 3.0);
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.root.name = 'Gradiente de exposição solar anual';
    this.root.userData.includeInImageExport = true;
    const overlay = new THREE.Mesh(geometry, material);
    overlay.renderOrder = 10;
    this.root.add(overlay);
    progress(100);
    return { year: settings.date.slice(0, 4), points: cache.size, maxHours, skipped, reducedDetail };
  }

  clear(): void {
    for (const child of [...this.root.children]) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(material => material.dispose());
      }
      this.root.remove(child);
    }
  }

  dispose(): void { this.clear(); this.root.removeFromParent(); }
}
