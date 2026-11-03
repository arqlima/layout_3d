import * as THREE from 'three';
import type { SectionState } from '../types/section';

export function sectionFromPoints(a: THREE.Vector3, b: THREE.Vector3): SectionState | null {
  if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-6) return null;
  const axis = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z) ? 'x' : 'y';
  return { axis, coordinate: axis === 'x' ? a.z : a.x, side: 1, mode: 'orthographic' };
}

/** Positive distances identify the portion of the model that remains visible. */
export function sectionPlane(state: SectionState): THREE.Plane {
  const normal = state.axis === 'x' ? new THREE.Vector3(0, 0, state.side) : new THREE.Vector3(state.side, 0, 0);
  return new THREE.Plane(normal, -state.coordinate * state.side);
}

interface Node { point: THREE.Vector3; adjacent: Set<string> }
interface Loop { points: THREE.Vector2[]; material: number; parent: number; depth: number }

function contains(polygon: THREE.Vector2[], point: THREE.Vector2): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Intersect triangles, join closed contours and triangulate islands with their holes.
 * Return local coordinates so the cap can inherit its source object's transform/visibility.
 * Open/branched contours are reported rather than closed with fictitious surfaces.
 */
export function createCapGeometry(mesh: THREE.Mesh, plane: THREE.Plane): { geometry: THREE.BufferGeometry | null; open: boolean } {
  const empty = { geometry: null, open: false };
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  if (!position || mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh) return empty;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
  const tolerance = Math.max(1e-7, bounds.getSize(new THREE.Vector3()).length() * 1e-8);
  const centerDistance = plane.distanceToPoint(bounds.getCenter(new THREE.Vector3()));
  const halfSize = bounds.getSize(new THREE.Vector3()).multiplyScalar(.5);
  const radius = Math.abs(plane.normal.x) * halfSize.x + Math.abs(plane.normal.y) * halfSize.y + Math.abs(plane.normal.z) * halfSize.z;
  if (Math.abs(centerDistance) >= radius - tolerance) return empty;

  const nodes = new Map<string, Node>();
  const segments = new Map<string, number>();
  const key = (p: THREE.Vector3) => [p.x, p.y, p.z].map(v => Math.round(v / tolerance)).join(',');
  const segmentKey = (a: string, b: string) => [a, b].sort().join('|');
  const indices = geometry.index;
  const count = indices?.count ?? position.count;
  const start = geometry.drawRange.start;
  const end = Math.min(count, start + geometry.drawRange.count);
  for (let i = start; i + 2 < end; i += 3) {
    const vertices = [0, 1, 2].map(offset => new THREE.Vector3()
      .fromBufferAttribute(position, indices ? indices.getX(i + offset) : i + offset).applyMatrix4(mesh.matrixWorld));
    const distances = vertices.map(v => plane.distanceToPoint(v));
    if (distances.every(d => Math.abs(d) <= tolerance)) continue;
    const hits: THREE.Vector3[] = [];
    for (let e = 0; e < 3; e++) {
      const next = (e + 1) % 3;
      if (Math.abs(distances[e]) <= tolerance) hits.push(vertices[e]);
      else if ((distances[e] > tolerance && distances[next] < -tolerance)
        || (distances[e] < -tolerance && distances[next] > tolerance)) {
        hits.push(vertices[e].clone().lerp(vertices[next], distances[e] / (distances[e] - distances[next])));
      }
    }
    const unique = [...new Map(hits.map(p => [key(p), p])).entries()];
    if (unique.length !== 2) continue;
    const [[a, pa], [b, pb]] = unique;
    const id = segmentKey(a, b);
    if (segments.has(id)) continue;
    const group = geometry.groups.find(g => i >= g.start && i < g.start + g.count);
    const materialIndex = Array.isArray(mesh.material) && (group?.materialIndex ?? 0) < mesh.material.length
      ? group?.materialIndex ?? 0 : 0;
    segments.set(id, materialIndex);
    if (!nodes.has(a)) nodes.set(a, { point: pa, adjacent: new Set() });
    if (!nodes.has(b)) nodes.set(b, { point: pb, adjacent: new Set() });
    nodes.get(a)!.adjacent.add(b); nodes.get(b)!.adjacent.add(a);
  }
  if (!nodes.size) return empty;
  if ([...nodes.values()].some(node => node.adjacent.size !== 2)) return { geometry: null, open: true };

  const tangent = new THREE.Vector3(0, 1, 0).cross(plane.normal).normalize();
  const vertical = plane.normal.clone().cross(tangent).normalize();
  const origin = plane.coplanarPoint(new THREE.Vector3());
  const visited = new Set<string>();
  const loops: Loop[] = [];
  for (const first of nodes.keys()) {
    if (visited.has(first)) continue;
    const points: THREE.Vector2[] = [];
    const materialLengths = new Map<number, number>();
    let current = first, previous = '';
    do {
      visited.add(current);
      const node = nodes.get(current)!;
      points.push(new THREE.Vector2(node.point.dot(tangent), node.point.dot(vertical)));
      const next = [...node.adjacent].find(id => id !== previous)!;
      const material = segments.get(segmentKey(current, next))!;
      materialLengths.set(material, (materialLengths.get(material) ?? 0) + node.point.distanceTo(nodes.get(next)!.point));
      previous = current; current = next;
    } while (current !== first && !visited.has(current));
    if (current !== first || points.length < 3) return { geometry: null, open: true };
    loops.push({ points, material: [...materialLengths].sort((a, b) => b[1] - a[1])[0][0], parent: -1, depth: 0 });
  }
  const areas = loops.map(loop => Math.abs(THREE.ShapeUtils.area(loop.points)));
  loops.forEach((loop, index) => {
    let smallest = Infinity;
    loops.forEach((candidate, j) => {
      if (j !== index && areas[j] > areas[index] && areas[j] < smallest && contains(candidate.points, loop.points[0])) {
        loop.parent = j; smallest = areas[j];
      }
    });
  });
  for (const loop of loops) {
    for (let parent = loop.parent; parent !== -1; parent = loops[parent].parent) loop.depth++;
  }
  const positions: number[] = [];
  const cap = new THREE.BufferGeometry();
  const inverse = mesh.matrixWorld.clone().invert();
  // Shift inside the retained half-space to avoid numerical clipping of the cap.
  origin.addScaledVector(plane.normal, tolerance * 2);
  loops.forEach((loop, index) => {
    if (loop.depth % 2) return;
    const holes = loops.filter(candidate => candidate.parent === index && candidate.depth % 2 === 1).map(candidate => candidate.points);
    const points = [loop.points, ...holes].flat();
    const triangles = THREE.ShapeUtils.triangulateShape(loop.points, holes);
    const groupStart = positions.length / 3;
    for (const triangle of triangles) {
      for (const vertex of triangle) {
        const point = points[vertex];
        const local = origin.clone().addScaledVector(tangent, point.x).addScaledVector(vertical, point.y).applyMatrix4(inverse);
        positions.push(local.x, local.y, local.z);
      }
    }
    cap.addGroup(groupStart, positions.length / 3 - groupStart, loop.material);
  });
  if (!positions.length) { cap.dispose(); return empty; }
  cap.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  cap.computeVertexNormals();
  cap.computeBoundingSphere();
  return { geometry: cap, open: false };
}
