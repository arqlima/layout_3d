import { DEFAULT_SECTION_LINES, isSectionLineSettings, type SectionLineSettings } from '../types/section';
import { DEFAULT_MODEL_APPEARANCE, isModelAppearanceSettings, type ModelAppearanceSettings } from '../types/appearance';

export function mountPresentationSettings(host: HTMLElement) {
  host.innerHTML = `
    <button class="presentation-settings-toggle" type="button" popovertarget="presentation-settings"
      aria-label="Configurações da apresentação" title="Configurações da apresentação">
      <svg class="au-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 3-.6 2.3-1.7 1L5 5.7 2.5 10l1.6 1.7v2L2.5 15.4 5 19.7l2.2-.6 1.7 1 .6 2.3h5l.6-2.3 1.7-1 2.2.6 2.5-4.3-1.6-1.7v-2l1.6-1.7L19 5.7l-2.2.6-1.7-1L14.5 3Z" transform="translate(0 -1)"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
    <section id="presentation-settings" class="presentation-settings" popover="auto" aria-labelledby="presentation-settings-title">
      <header><h2 id="presentation-settings-title">Configurações</h2>
        <button type="button" popovertarget="presentation-settings" popovertargetaction="hide" aria-label="Fechar configurações">×</button></header>
      <label class="presentation-setting" for="presentation-theme">Tema da apresentação
        <select id="presentation-theme"><option value="light">Claro</option><option value="dark">Escuro</option></select>
      </label>
      <fieldset><legend>Fundo do ambiente 3D</legend>
        <label class="presentation-color">Cor <input id="presentation-background" type="color" value="#a3a3a3" aria-label="Cor do fundo 3D" /></label>
        <div class="presentation-rgb">
          <label>R<input type="number" min="0" max="255" step="1" value="163" data-channel="0" aria-label="Vermelho (0 a 255)" /></label>
          <label>G<input type="number" min="0" max="255" step="1" value="163" data-channel="1" aria-label="Verde (0 a 255)" /></label>
          <label>B<input type="number" min="0" max="255" step="1" value="163" data-channel="2" aria-label="Azul (0 a 255)" /></label>
        </div>
      </fieldset>
      <fieldset><legend>Cor do modelo · exceto REP</legend>
        <label class="presentation-line-toggle"><input id="model-override-color" type="checkbox" /> Sobrepor cor</label>
        <label class="presentation-color">Cor <input id="model-color" type="color" value="#ffffff" aria-label="Cor de sobreposição do modelo" /></label>
        <div class="presentation-rgb">${['R', 'G', 'B'].map((label, index) => `<label>${label}<input type="number" min="0" max="255" step="1" value="255" data-model-color-channel="${index}" aria-label="${label} da cor do modelo (0 a 255)" /></label>`).join('')}</div>
      </fieldset>
      <fieldset><legend>Arestas · exceto REP</legend>
        <label class="presentation-line-toggle"><input id="model-override-edges" type="checkbox" /> Sobrescrever arestas</label>
        <label class="presentation-color">Cor <input id="model-edge-color" type="color" value="#263238" aria-label="Cor de sobreposição das arestas" /></label>
        <div class="presentation-rgb">${['R', 'G', 'B'].map((label, index) => `<label>${label}<input type="number" min="0" max="255" step="1" value="${[38, 50, 56][index]}" data-model-edge-channel="${index}" aria-label="${label} das arestas (0 a 255)" /></label>`).join('')}</div>
      </fieldset>
      <fieldset><legend>Linhas de corte</legend>
        <label class="presentation-line-toggle"><input id="section-lines-visible" type="checkbox" checked /> Exibir linhas</label>
        <label class="presentation-color">Cor <input id="section-lines-color" type="color" value="#3f4a4d" aria-label="Cor das linhas de corte" /></label>
        <label class="presentation-setting" for="section-lines-width">Espessura (px)
          <input id="section-lines-width" type="number" min="0.5" max="8" step="0.5" value="1" />
        </label>
      </fieldset>
    </section>`;
  const button = host.querySelector<HTMLButtonElement>('.presentation-settings-toggle')!;
  const panel = host.querySelector<HTMLElement>('#presentation-settings')!;
  const theme = host.querySelector<HTMLSelectElement>('#presentation-theme')!;
  const color = host.querySelector<HTMLInputElement>('#presentation-background')!;
  const channels = [...host.querySelectorAll<HTMLInputElement>('[data-channel]')];
  const lineVisible = host.querySelector<HTMLInputElement>('#section-lines-visible')!;
  const lineColor = host.querySelector<HTMLInputElement>('#section-lines-color')!;
  const lineWidth = host.querySelector<HTMLInputElement>('#section-lines-width')!;
  let sectionLines: SectionLineSettings = { ...DEFAULT_SECTION_LINES };
  let notifySectionLines = (_settings: SectionLineSettings) => {};
  let appearance: ModelAppearanceSettings = { ...DEFAULT_MODEL_APPEARANCE };
  let notifyAppearance = (_settings: ModelAppearanceSettings) => {};
  const overrideColor = host.querySelector<HTMLInputElement>('#model-override-color')!;
  const overrideEdges = host.querySelector<HTMLInputElement>('#model-override-edges')!;
  const changeAppearance = (change: Partial<ModelAppearanceSettings>) => {
    const next = { ...appearance, ...change };
    if (!isModelAppearanceSettings(next)) return;
    appearance = next;
    notifyAppearance({ ...next });
  };
  const bindRgb = (id: string, channelSelector: string, update: (color: string) => void) => {
    const picker = host.querySelector<HTMLInputElement>(id)!;
    const rgb = [...host.querySelectorAll<HTMLInputElement>(channelSelector)];
    const sync = (next: string) => {
      picker.value = next;
      rgb.forEach((input, index) => { input.value = String(parseInt(next.slice(1 + index * 2, 3 + index * 2), 16)); });
    };
    picker.addEventListener('input', () => { sync(picker.value); update(picker.value); });
    for (const input of rgb) input.addEventListener('input', () => {
      if (!rgb.every(channel => channel.checkValidity() && Number.isInteger(channel.valueAsNumber))) return;
      const next = `#${rgb.map(channel => channel.valueAsNumber.toString(16).padStart(2, '0')).join('')}`;
      sync(next); update(next);
    });
    return sync;
  };
  const syncModelColor = bindRgb('#model-color', '[data-model-color-channel]', color => changeAppearance({ color }));
  const syncEdgeColor = bindRgb('#model-edge-color', '[data-model-edge-channel]', edgeColor => changeAppearance({ edgeColor }));
  overrideColor.addEventListener('change', () => changeAppearance({ overrideColor: overrideColor.checked }));
  overrideEdges.addEventListener('change', () => changeAppearance({ overrideEdges: overrideEdges.checked }));
  let background = color.value;
  let notify = (_color: string) => {};
  document.documentElement.dataset.presentationTheme = theme.value;
  theme.addEventListener('change', () => {
    document.documentElement.dataset.presentationTheme = theme.value === 'dark' ? 'dark' : 'light';
  });
  button.addEventListener('click', () => {
    const rect = button.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 328))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.bottom + 10, window.innerHeight - 350))}px`;
    panel.style.maxHeight = `${Math.max(0, window.innerHeight - parseFloat(panel.style.top) - 8)}px`;
  });
  const update = (next: string) => {
    background = next;
    color.value = next;
    channels.forEach((input, index) => { input.value = String(parseInt(next.slice(1 + index * 2, 3 + index * 2), 16)); });
    notify(next);
  };
  color.addEventListener('input', () => update(color.value));
  for (const input of channels) {
    input.addEventListener('input', () => {
      if (!channels.every(channel => channel.checkValidity() && Number.isInteger(channel.valueAsNumber))) return;
      update(`#${channels.map(channel => channel.valueAsNumber.toString(16).padStart(2, '0')).join('')}`);
    });
  }
  const updateSectionLines = () => {
    const next = { visible: lineVisible.checked, color: lineColor.value, width: lineWidth.valueAsNumber };
    if (!isSectionLineSettings(next)) return;
    sectionLines = next;
    notifySectionLines({ ...next });
  };
  lineVisible.addEventListener('change', updateSectionLines);
  lineColor.addEventListener('input', updateSectionLines);
  lineWidth.addEventListener('input', updateSectionLines);
  return {
    onModelAppearanceChange(callback: (settings: ModelAppearanceSettings) => void) {
      notifyAppearance = callback; notifyAppearance({ ...appearance });
    },
    setModelAppearance(settings: ModelAppearanceSettings) {
      if (!isModelAppearanceSettings(settings)) return;
      appearance = { ...settings };
      overrideColor.checked = settings.overrideColor;
      overrideEdges.checked = settings.overrideEdges;
      syncModelColor(settings.color);
      syncEdgeColor(settings.edgeColor);
    },
    onBackgroundChange(callback: (color: string) => void) { notify = callback; notify(background); },
    onSectionLineSettingsChange(callback: (settings: SectionLineSettings) => void) {
      notifySectionLines = callback; notifySectionLines({ ...sectionLines });
    },
    setSectionLineSettings(settings: SectionLineSettings) {
      if (!isSectionLineSettings(settings)) return;
      sectionLines = { ...settings };
      lineVisible.checked = settings.visible;
      lineColor.value = settings.color;
      lineWidth.value = String(settings.width);
    },
  };
}
