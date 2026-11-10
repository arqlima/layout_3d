import { isSavedScene, SCENE_COUNT } from './savedScenes';

/** Stable across uploads; keep legacy keys intact when recovering existing scenes. */
export function projectSceneKey(storage: Storage | null, projectUrl: string, modelUrl: string | null): string {
  const stable = `layout3d:scenes:v2:${projectUrl}`;
  if (!storage) return stable;
  try {
    if (storage.getItem(stable) !== null) return stable;
    const prefix = 'layout3d:scenes:v1:';
    const exact = prefix + JSON.stringify([projectUrl, modelUrl]);
    const candidates = [exact];
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key?.startsWith(prefix) && key !== exact) candidates.push(key);
    }
    for (const key of candidates) {
      try {
        const identity: unknown = JSON.parse(key.slice(prefix.length));
        if (!Array.isArray(identity) || identity[0] !== projectUrl || typeof identity[1] !== 'string') continue;
        const values: unknown = JSON.parse(storage.getItem(key) ?? 'null');
        if (!Array.isArray(values)) continue;
        const scenes = Array.from({ length: SCENE_COUNT }, (_, index) => {
          const scene = values[index];
          return isSavedScene(scene)
            ? { ...scene, viewer: { ...scene.viewer, modelRevision: identity[1] } } : null;
        });
        if (!scenes.some(Boolean)) continue;
        try { storage.setItem(stable, JSON.stringify(scenes)); }
        catch { return key; }
        return stable;
      } catch { /* Ignore malformed legacy entries and continue recovery. */ }
    }
  } catch { /* Storage may be blocked; the scene toolbar reports persistence failures. */ }
  return stable;
}
