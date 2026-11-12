import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadRhinoModel } from './rhinoModel';

export async function loadModel(url: string, libraryUrl: string, options: { withEdges?: boolean } = {}): Promise<THREE.Object3D> {
  if (new URL(url, location.href).pathname.toLowerCase().endsWith('.3dm')) {
    return loadRhinoModel(url, libraryUrl, options);
  }
  const { scene } = await new GLTFLoader().loadAsync(url);
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  scene.userData.absoluteBaseElevationM = bounds.min.y;
  const center = bounds.getCenter(new THREE.Vector3());
  scene.position.set(-center.x, -bounds.min.y, -center.z);
  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    // Exporters can preserve Rhino IDs in glTF extras.
    const id = object.userData.objectId ?? object.userData.id;
    if (typeof id === 'string') object.userData.objectId = id;
  });
  return scene;
}
