import * as THREE from 'three';
import { Rhino3dmLoader } from 'three/addons/loaders/3DMLoader.js';
import { addMeshEdges } from './meshEdges';

const rhinoModels = new WeakSet<THREE.Object3D>();

interface RhinoColor { r: number; g: number; b: number; a?: number }
interface RhinoLayer { color?: RhinoColor }

export function applyLayerAppearance(model: THREE.Object3D): void {
  const layers = model.userData.layers as RhinoLayer[] | undefined;
  if (!Array.isArray(layers)) return;
  const materialCache = new Map<string, THREE.Material>();

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
    const index = object.userData.attributes?.layerIndex;
    const layer = Number.isInteger(index) ? layers[index] : undefined;
    if (!layer?.color) return;

    const { r, g, b, a = 255 } = layer.color;
    const color = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    const layerAlpha = THREE.MathUtils.clamp(a / 255, 0, 1);
    const tint = (source: THREE.Material): THREE.Material => {
      const key = `${source.uuid}:${index}:${layerAlpha}`;
      const cached = materialCache.get(key);
      if (cached) return cached;

      const material = source.clone();
      if ('color' in material && material.color instanceof THREE.Color) {
        material.color.copy(color);
      }
      if (material instanceof THREE.MeshStandardMaterial && material.name === THREE.Loader.DEFAULT_MATERIAL_NAME) {
        material.metalness = 0;
        material.roughness = 0.85;
      }
      if ('vertexColors' in material) material.vertexColors = false;
      material.opacity = THREE.MathUtils.clamp(source.opacity * layerAlpha, 0, 1);
      material.transparent = source.transparent || material.opacity < 0.999;
      if (material.transparent) material.depthWrite = false;
      material.needsUpdate = true;
      materialCache.set(key, material);
      return material;
    };

    object.material = Array.isArray(object.material)
      ? object.material.map(tint)
      : tint(object.material);
  });
}

/** Simulation can load the source model before the 3D view needs its edges. */
export function prepareRhinoEdges(model: THREE.Object3D, progress?: (percent: number) => void): Promise<void> {
  return rhinoModels.has(model) ? addMeshEdges(model, progress) : Promise.resolve();
}

/** Carrega o modelo Rhino do projeto selecionado no Django. */
export async function loadRhinoModel(url: string, libraryUrl: string, options: { withEdges?: boolean } = {}): Promise<THREE.Object3D> {
  const loader = new Rhino3dmLoader();
  loader.setLibraryPath(libraryUrl);
  loader.setWorkerLimit(2);
  try {
    const model = await loader.loadAsync(url);
    model.name = 'Projeto modelo';

    // Rhino usa Z como eixo vertical; Three.js usa Y.
    model.rotation.x = -Math.PI / 2;
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    model.userData.absoluteBaseElevationM = bounds.min.y;
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -bounds.min.y, -center.z);
    model.updateMatrixWorld(true);

    // Rhino3dmLoader usa branco para volumes sem material; a cor da layer
    // fornece a aparência de exibição e a transparência do material é preservada.
    applyLayerAppearance(model);
    rhinoModels.add(model);
    if (options.withEdges !== false) await addMeshEdges(model);

    // O GUID original associa cada objeto à tabela de dados do projeto.
    model.traverse((object) => {
      const id = object.userData.attributes?.id;
      if (typeof id === 'string') object.userData.objectId = id;
    });
    return model;
  } finally {
    loader.dispose();
  }
}
