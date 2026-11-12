import * as THREE from 'three';

function collectResources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const instances = new Set<THREE.InstancedMesh>();
  const skeletons = new Set<THREE.Skeleton>();
  const collectTexture = (value: unknown): void => {
    if (value instanceof THREE.Texture) textures.add(value);
    else if (Array.isArray(value)) value.forEach(collectTexture);
  };
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
    geometries.add(object.geometry);
    const sources = Array.isArray(object.material) ? object.material : [object.material];
    sources.forEach(material => materials.add(material));
    if (object instanceof THREE.Mesh) {
      if (object.customDepthMaterial) materials.add(object.customDepthMaterial);
      if (object.customDistanceMaterial) materials.add(object.customDistanceMaterial);
    }
    if (object instanceof THREE.InstancedMesh) instances.add(object);
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
  });
  if (root instanceof THREE.Scene) {
    collectTexture(root.background);
    collectTexture(root.environment);
  }
  for (const material of materials) {
    Object.values(material).forEach(collectTexture);
    if (material instanceof THREE.ShaderMaterial) {
      Object.values(material.uniforms).forEach(uniform => collectTexture(uniform.value));
    }
  }
  return { geometries, materials, textures, instances, skeletons };
}

/** Dispose each owned resource once, keeping any resources shared with the replacement. */
export function disposeObjectResources(root: THREE.Object3D, preserve?: THREE.Object3D): void {
  const resources = collectResources(root);
  const retained = preserve ? collectResources(preserve) : null;
  const release = <T extends { dispose(): void }>(owned: Set<T>, keep?: Set<T>): void => {
    for (const resource of owned) {
      if (!keep?.has(resource)) resource.dispose();
    }
  };
  release(resources.geometries, retained?.geometries);
  release(resources.materials, retained?.materials);
  release(resources.textures, retained?.textures);
  release(resources.instances, retained?.instances);
  release(resources.skeletons, retained?.skeletons);
}
