import * as THREE from 'three';
import { DEFAULT_MODEL_APPEARANCE, type ModelAppearanceSettings } from '../types/appearance';

/** Reversible material copies; source colors, textures and transparency are preserved. */
export class ModelAppearance {
  settings: ModelAppearanceSettings = { ...DEFAULT_MODEL_APPEARANCE };
  private readonly surfaces = new Map<THREE.Material, THREE.Material>();
  private readonly edges = new Map<THREE.Material, THREE.Material>();

  configure(settings: ModelAppearanceSettings): void {
    this.clear();
    this.settings = { ...settings };
  }

  apply(source: THREE.Material, edge: boolean): THREE.Material {
    if (!(edge ? this.settings.overrideEdges : this.settings.overrideColor)) return source;
    if (!('color' in source) || !(source.color instanceof THREE.Color)) return source;
    const cache = edge ? this.edges : this.surfaces;
    let material = cache.get(source);
    if (!material) {
      material = source.clone();
      (material as THREE.MeshBasicMaterial).color.set(edge ? this.settings.edgeColor : this.settings.color);
      if ('map' in material) material.map = null;
      if ('emissiveMap' in material) material.emissiveMap = null;
      if ('emissive' in material && material.emissive instanceof THREE.Color) material.emissive.set(0);
      material.vertexColors = false;
      material.needsUpdate = true;
      cache.set(source, material);
    }
    return material;
  }

  clear(): void {
    for (const cache of [this.surfaces, this.edges]) {
      cache.forEach(material => material.dispose());
      cache.clear();
    }
  }
}
