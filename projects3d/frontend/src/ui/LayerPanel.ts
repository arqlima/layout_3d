import type { LayerInfo } from '../types/layers';
import { layerKey, layerLabel, type SelectionMode } from '../data/layerSelection';
import type { AreaExclusions } from '../types/model';
import { USAGE_CODES, type UsageCode } from '../types/model';
import { DEFAULT_USAGE_COLORS, type UsageColorSettings } from '../types/usageColors';

export interface LayerPanelActions {
  onUsageColorsChange?(settings: UsageColorSettings): void;
  onModeChange(mode: SelectionMode): void;
  onHideUncheckedChange(hide: boolean): void;
  onToggleMany(indices: number[], checked: boolean): void;
  onAreaExclusionsChange(exclusions: AreaExclusions): void;
}

export interface LayerPanel {
  update(layers: LayerInfo[]): void;
  restore(mode: SelectionMode, hide: boolean, exclusions: AreaExclusions, colors?: UsageColorSettings): void;
}

export function mountLayerPanel(
  mount: HTMLElement, initial: LayerInfo[],
  onToggle: (index: number, checked: boolean) => void,
  onSetAll: (checked: boolean) => void, actions: LayerPanelActions,
): LayerPanel {
  const modes = mount.querySelector<HTMLElement>('#selection-modes')!;
  const list = mount.querySelector<HTMLElement>('#layer-list')!;
  const summary = mount.querySelector<HTMLElement>('#layer-summary')!;
  const hide = mount.querySelector<HTMLInputElement>('#hide-unchecked')!;
  const excludeUncovered = mount.querySelector<HTMLInputElement>('#exclude-uncovered')!;
  const excludeParking = mount.querySelector<HTMLInputElement>('#exclude-parking')!;
  let layers = initial.filter(layer => layer.objectCount > 0).map(layer => ({ ...layer }));
  let mode: SelectionMode = 'name';
  let usageColors = structuredClone(DEFAULT_USAGE_COLORS);
  const colorControl = document.createElement('label');
  colorControl.className = 'hide-unchecked usage-colors-toggle';
  const colorToggle = document.createElement('input');
  colorToggle.type = 'checkbox';
  colorToggle.setAttribute('role', 'switch');
  colorControl.append(colorToggle, document.createTextNode('Aplicar cores por uso'));
  modes.after(colorControl);
  colorToggle.onchange = () => {
    usageColors.enabled = colorToggle.checked;
    actions.onUsageColorsChange?.(structuredClone(usageColors));
    render();
  };

  const render = () => {
    colorControl.hidden = mode !== 'use';
    colorToggle.checked = usageColors.enabled;
    modes.hidden = layers.length === 0;
    mount.querySelector<HTMLElement>('#marked-summary')!.hidden = mode === 'name';
    mount.querySelector<HTMLElement>('#marked-efficiency')!.hidden = mode !== 'group';
    mount.querySelector<HTMLElement>('#area-exclusions')!.hidden = mode === 'name';
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
      const use = layerKey(layer, 'use') as UsageCode;
      const editableColor = mode === 'use' && usageColors.enabled && USAGE_CODES.includes(use);
      fill.style.backgroundColor = editableColor ? usageColors.colors[use] : layer.color;
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
      if (editableColor) {
        const groupRow = document.createElement('div');
        groupRow.className = 'usage-color-row';
        const color = document.createElement('input');
        color.type = 'color';
        color.className = 'usage-color-input';
        color.value = usageColors.colors[use];
        color.setAttribute('aria-label', `Cor de ${layerLabel(layer, mode)}`);
        color.title = `Cor de ${layerLabel(layer, mode)}`;
        color.oninput = () => {
          usageColors.colors[use] = color.value;
          fill.style.backgroundColor = color.value;
          actions.onUsageColorsChange?.(structuredClone(usageColors));
        };
        groupRow.append(row, color);
        list.append(groupRow);
      } else list.append(row);
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
  const changeExclusions = () => actions.onAreaExclusionsChange({
    excludeUncovered: excludeUncovered.checked,
    excludeParking: excludeParking.checked,
  });
  excludeUncovered.onchange = changeExclusions;
  excludeParking.onchange = changeExclusions;
  render();
  return {
    update(updated) { layers = updated.filter(layer => layer.objectCount > 0).map(layer => ({ ...layer })); render(); },
    restore(savedMode, hidden, exclusions, colors = DEFAULT_USAGE_COLORS) {
      usageColors = structuredClone(colors);
      mode = savedMode;
      hide.checked = hidden;
      excludeUncovered.checked = exclusions.excludeUncovered;
      excludeParking.checked = exclusions.excludeParking;
      for (const button of modes.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
      render();
    },
  };
}
