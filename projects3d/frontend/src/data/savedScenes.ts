import type { SavedScene } from '../types/scenes';
import { USAGE_CODES } from '../types/model';
import { isSectionState, isSectionLineSettings } from '../types/section';

export const SCENE_COUNT = 10;

export function isSavedScene(value: unknown): value is SavedScene {
  if (!value || typeof value !== 'object') return false;
  const scene = value as SavedScene;
  const state = scene.viewer;
  const camera = state?.camera;
  const vector = (value: unknown) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  if (scene.version !== 1 || !state || !camera || !scene.areaExclusions) return false;
  if (state.section != null && !isSectionState(state.section)) return false;
  if (state.sectionLines !== undefined && !isSectionLineSettings(state.sectionLines)) return false;
  if (!['perspective', 'orthographic'].includes(camera.projection)
    || !vector(camera.position) || !vector(camera.target) || !vector(camera.up)
    || !camera.up.some(value => value !== 0)
    || camera.position.every((value, index) => value === camera.target[index])
    || ![camera.zoom, camera.near, camera.far, camera.orthographicHeight, camera.maxDistance].every(value => Number.isFinite(value) && value > 0)
    || camera.far <= camera.near || typeof camera.label !== 'string') return false;
  if (!Array.isArray(state.layers) || !state.layers.every(layer => layer && typeof layer.name === 'string' && typeof layer.visible === 'boolean')
    || !Array.isArray(state.elevation) || state.elevation.length !== 2
    || !state.elevation.every(value => value === null || Number.isFinite(value))
    || (state.elevation[0] !== null && state.elevation[1] !== null && state.elevation[0] > state.elevation[1])
    || !['name', 'use', 'group'].includes(state.selectionMode)
    || !Array.isArray(state.activeUsages) || !state.activeUsages.every(code => USAGE_CODES.includes(code))
    || typeof state.hideUnchecked !== 'boolean') return false;
  if (state.selected !== null && (!state.selected || (state.selected.id !== null && typeof state.selected.id !== 'string')
    || !Number.isInteger(state.selected.index) || state.selected.index < 0)) return false;
  if (state.selectedObjects !== undefined && (!Array.isArray(state.selectedObjects)
    || !state.selectedObjects.every(item => item && (item.id === null || typeof item.id === 'string')
      && Number.isInteger(item.index) && item.index >= 0))) return false;
  return typeof scene.areaExclusions.excludeUncovered === 'boolean' && typeof scene.areaExclusions.excludeParking === 'boolean';
}

/** Armazenamento separado por projeto/modelo; nenhuma cena é aplicada automaticamente. */
export class SavedSceneStore {
  private readonly scenes: Array<SavedScene | null> = Array(SCENE_COUNT).fill(null);
  active: number | null = null;

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null, private readonly key: string) {
    try {
      const values: unknown = JSON.parse(storage?.getItem(key) ?? 'null');
      if (Array.isArray(values)) {
        for (let index = 0; index < SCENE_COUNT; index++) this.scenes[index] = isSavedScene(values[index]) ? values[index] : null;
      }
    } catch { /* Sem armazenamento ou dados inválidos: inicia com posições vazias. */ }
  }

  get(index: number): SavedScene | null {
    const scene = this.scenes[index];
    return scene ? structuredClone(scene) : null;
  }

  save(index: number, scene: SavedScene): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= SCENE_COUNT || !isSavedScene(scene)) throw new Error('Cena inválida.');
    this.scenes[index] = structuredClone(scene);
    this.active = index;
    try {
      if (!this.storage) return false;
      this.storage.setItem(this.key, JSON.stringify(this.scenes));
      return true;
    } catch { return false; }
  }

  update(scene: SavedScene): boolean {
    if (this.active === null) throw new Error('Selecione uma cena antes de atualizar.');
    return this.save(this.active, scene);
  }
}
