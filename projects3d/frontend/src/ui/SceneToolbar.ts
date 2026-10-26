import type { SavedScene } from '../types/scenes';
import { SavedSceneStore, SCENE_COUNT } from '../data/savedScenes';

export function mountSceneToolbar(
  host: HTMLElement, key: string, capture: () => SavedScene, restore: (scene: SavedScene) => void,
): void {
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* O navegador pode bloquear a persistência. */ }
  const store = new SavedSceneStore(storage, key);
  const slots = host.querySelector<HTMLElement>('.scene-slots')!;
  const update = host.querySelector<HTMLButtonElement>('#update-scene')!;
  const status = host.querySelector<HTMLElement>('.scene-feedback')!;
  const buttons: HTMLButtonElement[] = [];
  slots.replaceChildren();
  const render = () => {
    buttons.forEach((button, index) => {
      const saved = store.get(index) !== null;
      const label = saved ? `Abrir cena ${index + 1}` : `Salvar visualização atual na cena ${index + 1}`;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(store.active === index));
      button.classList.toggle('is-saved', saved);
    });
    update.disabled = store.active === null;
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
    button.onclick = () => {
      try {
        const scene = store.get(index);
        if (scene) {
          restore(scene);
          store.active = index;
          feedback(`Cena ${index + 1} aberta`);
        } else feedback(`Cena ${index + 1} salva`, store.save(index, capture()));
        render();
      } catch (error) { feedback(error instanceof Error ? error.message : 'Não foi possível abrir a cena.'); }
    };
    slots.append(button);
    buttons.push(button);
  }
  update.onclick = () => {
    try {
      const persistent = store.update(capture());
      feedback(`Cena ${store.active! + 1} atualizada`, persistent);
      render();
    } catch (error) { feedback(error instanceof Error ? error.message : 'Não foi possível atualizar a cena.'); }
  };
  render();
}
