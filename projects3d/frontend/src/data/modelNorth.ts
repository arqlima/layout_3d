import * as THREE from 'three';
import { normalizeNorthAngle } from './north';

/** First valid directed line in REP-NORTE-VEC, after model axis conversion.
 * Without a plan vector, north remains Rhino +Y (viewer -Z).
 */
export function readModelNorth(model: THREE.Object3D): number {
  const layers: Array<{ name?: string }> = model.userData.layers ?? [];
  const northLayers = new Set(layers.flatMap((layer, index) =>
    layer.name?.trim().toUpperCase() === 'REP-NORTE-VEC' ? [index] : []));
  if (northLayers.size === 0) return 0;

  model.updateWorldMatrix(true, true);
  let angle: number | null = null;
  model.traverse(object => {
    if (angle !== null || !(object instanceof THREE.Line) || object.userData.isEdgeHelper) return;
    let node: THREE.Object3D | null = object;
    let layerIndex: number | undefined;
    while (node && node !== model && layerIndex === undefined) {
      layerIndex = node.userData.attributes?.layerIndex;
      node = node.parent;
    }
    if (layerIndex === undefined || !northLayers.has(layerIndex)) return;
    const position = object.geometry.getAttribute('position');
    const indices = object.geometry.index;
    const count = indices?.count ?? position?.count ?? 0;
    if (!position || count < 2) return;
    // LineSegments stores independent pairs; use the first directed segment.
    const last = object instanceof THREE.LineSegments ? 1 : count - 1;
    const start = new THREE.Vector3().fromBufferAttribute(position, indices ? indices.getX(0) : 0)
      .applyMatrix4(object.matrixWorld);
    const end = new THREE.Vector3().fromBufferAttribute(position, indices ? indices.getX(last) : last)
      .applyMatrix4(object.matrixWorld);
    const direction = end.sub(start);
    if (![direction.x, direction.z].every(Number.isFinite) || Math.hypot(direction.x, direction.z) < 1e-8) return;
    angle = normalizeNorthAngle(Math.atan2(direction.x, -direction.z) * 180 / Math.PI);
  });
  return angle ?? 0;
}
