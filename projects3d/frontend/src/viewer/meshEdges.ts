import * as THREE from 'three';

const pending = new WeakMap<THREE.Object3D, Promise<void>>();

/** Each mesh retains its own helper for selection, while repeated geometry shares buffers. */
export function addMeshEdges(model: THREE.Object3D, progress: (percent: number) => void = () => {}): Promise<void> {
  const existing = pending.get(model);
  if (existing) return existing;
  const task = buildEdges(model, progress).catch(error => { pending.delete(model); throw error; });
  pending.set(model, task);
  return task;
}

async function buildEdges(model: THREE.Object3D, progress: (percent: number) => void): Promise<void> {
  const meshes: THREE.Mesh[] = [];
  model.traverse(object => {
    if (object instanceof THREE.Mesh && !object.children.some(child => child.userData.isEdgeHelper)) meshes.push(object);
  });
  const geometries = new Map<THREE.BufferGeometry, THREE.EdgesGeometry | null>();
  const materials = new Map<number, THREE.LineBasicMaterial>();
  let lastYield = performance.now();
  for (let index = 0; index < meshes.length; index++) {
    const mesh = meshes[index];
    if (!geometries.has(mesh.geometry)) {
      const edges = new THREE.EdgesGeometry(mesh.geometry, 25);
      if (edges.getAttribute('position').count === 0) {
        edges.dispose();
        geometries.set(mesh.geometry, null);
      } else geometries.set(mesh.geometry, edges);
    }
    const geometry = geometries.get(mesh.geometry);
    if (geometry) {
      const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const opacity = Math.round(Math.min(...originals.map(material => material.opacity)) * 75) / 100;
      let material = materials.get(opacity);
      if (!material) {
        material = new THREE.LineBasicMaterial({ color: '#3f4a4d', transparent: true,
          opacity, depthTest: true, depthWrite: false, toneMapped: false });
        materials.set(opacity, material);
      }
      for (const original of originals) {
        original.polygonOffset = true;
        original.polygonOffsetFactor = 1;
        original.polygonOffsetUnits = 1;
      }
      const helper = new THREE.LineSegments(geometry, material);
      helper.name = `${mesh.name || 'Peça'} / arestas`;
      helper.userData.isEdgeHelper = true;
      helper.renderOrder = 1;
      mesh.add(helper);
    }
    if (index % 64 === 0 || index === meshes.length - 1) progress(Math.round((index + 1) / meshes.length * 100));
    if (performance.now() - lastYield >= 8) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      lastYield = performance.now();
    }
  }
}
