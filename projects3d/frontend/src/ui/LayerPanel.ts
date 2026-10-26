import type { LayerInfo } from '../types/layers';
import { layerKey, layerLabel, type SelectionMode } from '../data/layerSelection';

export interface LayerPanelActions {
  onModeChange(mode: SelectionMode): void;
  onHideUncheckedChange(hide: boolean): void;
  onToggleMany(indices: number[], checked: boolean): void;
}

export function mountLayerPanel(
  mount: HTMLElement, initial: LayerInfo[],
  onToggle: (index: number, checked: boolean) => void,
  onSetAll: (checked: boolean) => void, actions: LayerPanelActions,
): (layers: LayerInfo[]) => void {
  const modes = mount.querySelector<HTMLElement>('#selection-modes')!;
  const list = mount.querySelector<HTMLElement>('#layer-list')!;
  const summary = mount.querySelector<HTMLElement>('#layer-summary')!;
  const hide = mount.querySelector<HTMLInputElement>('#hide-unchecked')!;
  let layers = initial.map(layer => ({ ...layer }));
  let mode: SelectionMode = 'name';
  modes.hidden = layers.length === 0;

  const render = () => {
    list.replaceChildren();
    const groups = new Map<string, LayerInfo[]>();
    for (const layer of layers) {
      const key = layerKey(layer, mode);
      const members = groups.get(key) ?? [];
      members.push(layer);
      groups.set(key, members);
    }
    summary.textContent = `${layers.filter(layer => layer.visible).length} / ${layers.length} marcados`;
    for (const members of groups.values()) {
      const layer = members[0];
      const row = document.createElement('label');
      row.className = 'layer-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = members.every(member => member.visible);
      input.indeterminate = !input.checked && members.some(member => member.visible);
      input.onchange = () => {
        for (const member of members) member.visible = input.checked;
        if (mode === 'name') onToggle(layer.index, input.checked);
        else actions.onToggleMany(members.map(member => member.index), input.checked);
        render();
      };
      const swatch = document.createElement('span');
      swatch.className = 'layer-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span');
      fill.style.backgroundColor = layer.color;
      fill.style.opacity = String(layer.opacityMin);
      swatch.append(fill);
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = layerLabel(layer, mode);
      name.title = members.map(member => member.name).join('\n');
      const opacity = document.createElement('span');
      opacity.className = 'layer-opacity';
      if (mode === 'name' && layer.opacityMin < 0.999) {
        const min = Math.round(layer.opacityMin * 100);
        const max = Math.round(layer.opacityMax * 100);
        opacity.textContent = min === max ? `${min}%` : `${min}–${max}%`;
        opacity.title = 'Opacidade dos objetos desta layer';
      }
      const count = document.createElement('span');
      count.className = 'layer-count';
      count.textContent = String(members.reduce((total, member) => total + member.objectCount, 0));
      row.append(input, swatch, name, opacity, count);
      list.append(row);
    }
  };
  for (const button of modes.querySelectorAll<HTMLButtonElement>('button')) {
    button.onclick = () => {
      mode = button.dataset.mode as SelectionMode;
      for (const item of modes.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item === button));
      actions.onModeChange(mode);
      render();
    };
  }
  const setAll = (checked: boolean) => {
    for (const layer of layers) layer.visible = checked;
    onSetAll(checked);
    render();
  };
  mount.querySelector<HTMLButtonElement>('#show-layers')!.onclick = () => setAll(true);
  mount.querySelector<HTMLButtonElement>('#hide-layers')!.onclick = () => setAll(false);
  hide.onchange = () => actions.onHideUncheckedChange(hide.checked);
  render();
  return updated => { layers = updated.map(layer => ({ ...layer })); render(); };
}
