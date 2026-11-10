import type { SavedScene } from '../types/scenes';
import { SavedSceneStore, SCENE_COUNT } from '../data/savedScenes';
import { projectSceneKey } from '../data/projectSceneStorage';

export interface ScenePrintSource {
  list(): Array<{ index: number; name: string }>;
  visit(indices: number[], capture: (name: string) => Promise<void>): Promise<void>;
}

export function mountSceneToolbar(
  host: HTMLElement, key: string, capture: () => SavedScene, restore: (scene: SavedScene) => void | Promise<void>,
  project?: { url: string; modelUrl: string | null },
): ScenePrintSource {
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* O navegador pode bloquear a persistência. */ }
  const store = new SavedSceneStore(storage, project ? projectSceneKey(storage, project.url, project.modelUrl) : key);
  const slots = host.querySelector<HTMLElement>('.scene-slots')!;
  const update = host.querySelector<HTMLButtonElement>('#update-scene')!;
  const status = host.querySelector<HTMLElement>('.scene-feedback')!;
  const name = host.querySelector<HTMLInputElement>('.scene-name');
  const buttons: HTMLButtonElement[] = [];
  let busy = false;
  slots.replaceChildren();
  const render = () => {
    buttons.forEach((button, index) => {
      const scene = store.get(index);
      const saved = scene !== null;
      button.textContent = scene?.name || String(index + 1);
      const label = saved ? `Abrir cena ${index + 1}${scene?.name ? `: ${scene.name}` : ''}` : `Salvar visualização atual na cena ${index + 1}`;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(store.active === index));
      button.classList.toggle('is-saved', saved);
      button.disabled = busy;
    });
    update.disabled = busy || store.active === null;
    if (name) {
      name.disabled = busy;
      if (!busy && store.active !== null) name.value = store.get(store.active)?.name ?? '';
    }
    const label = store.active === null ? 'Selecione uma cena para atualizar' : `Atualizar cena ${store.active + 1} com a visualização atual`;
    update.title = label;
    update.setAttribute('aria-label', label);
  };
  const feedback = (message: string, persistent = true) => {
    status.textContent = persistent ? message : `${message} apenas nesta sessão: o navegador não permitiu gravar as cenas.`;
  };
  for (let index = 0; index < SCENE_COUNT; index++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scene-shortcut scene-slot';
    button.textContent = String(index + 1);
    button.onclick = async () => {
      if (busy) return;
      busy = true;
      render();
      try {
        const scene = store.get(index);
        if (scene) {
          store.active = null;
          feedback(scene.viewer.annualExposure ? `Abrindo cena ${index + 1}: recalculando mapa de exposição…` : `Abrindo cena ${index + 1}…`);
          await restore(scene);
          store.active = index;
          feedback(`Cena ${index + 1} aberta`);
        } else feedback(`Cena ${index + 1} salva`, store.save(index, { ...capture(), name: name?.value.trim().slice(0, 40) || undefined }));
      } catch (error) { feedback(error instanceof Error ? error.message : 'Não foi possível abrir a cena.'); }
      finally { busy = false; render(); }
    };
    slots.append(button);
    buttons.push(button);
  }
  update.onclick = () => {
    if (busy) return;
    try {
      const scene = capture();
      const persistent = store.update(name ? { ...scene, name: name.value.trim().slice(0, 40) } : scene);
      feedback(`Cena ${store.active! + 1} atualizada`, persistent);
      render();
    } catch (error) { feedback(error instanceof Error ? error.message : 'Não foi possível atualizar a cena.'); }
  };
  render();
  return {
    list: () => buttons.flatMap((_, index) => {
      const scene = store.get(index);
      return scene ? [{ index, name: scene.name || `Cena ${index + 1}` }] : [];
    }),
    async visit(indices, captureImage) {
      if (busy) throw new Error('Aguarde a abertura da cena atual.');
      const scenes = [...new Set(indices)].map(index => {
        const scene = store.get(index);
        if (!scene) throw new Error('Selecione apenas cenas salvas.');
        return { scene, label: scene.name || `Cena ${index + 1}` };
      });
      if (!scenes.length) throw new Error('Selecione pelo menos uma cena salva.');
      const original = capture();
      const active = store.active;
      const draftName = name?.value;
      store.active = null;
      busy = true;
      render();
      try {
        for (const { scene, label } of scenes) {
          feedback(`Preparando ${label}…`);
          await restore(scene);
          await captureImage(label);
        }
      } finally {
        let restored = false;
        try { await restore(original); restored = true; }
        finally {
          store.active = restored ? active : null;
          busy = false; render();
          if (name && draftName !== undefined) name.value = draftName;
          if (restored) feedback('Visualização atual recuperada');
          else feedback('Não foi possível recuperar a visualização atual. Abra uma cena salva para continuar.');
        }
      }
    },
  };
}
