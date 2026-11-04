import { defaultSolarSettings, solarDirection, type SolarSettings } from '../data/solar';
import type { SolarSceneState } from '../types/scenes';
import type { ExposureResult } from '../viewer/AnnualExposure';

interface SolarPanel {
  restoreExposure(): Promise<void>;
  onExposureCalculate(callback: (progress: (percent: number) => void) => Promise<ExposureResult>): void;
  onExposureVisibilityChange(callback: (visible: boolean) => void): void;
  exposureVisible(): boolean;
  invalidateExposure(): void;
  restore(state: SolarSceneState): void;
  settings(): SolarSettings;
  setNorthAngle(angle: number): void;
  onChange(callback: (settings: SolarSettings) => void): void;
  pathVisible(): boolean;
  onPathChange(callback: (visible: boolean) => void): void;
  pathScale(): number;
  onPathScaleChange(callback: (percent: number) => void): void;
  pathOpacity(): number;
  onPathOpacityChange(callback: (percent: number) => void): void;
}

export function mountSolarPanel(container: HTMLElement, location?: { latitude: number | null; longitude: number | null; locked: boolean }): SolarPanel {
  let settings = defaultSolarSettings();
  if (location?.latitude != null && location.longitude != null) {
    settings = { ...settings, latitude: location.latitude, longitude: location.longitude };
  }
  let notify = (_settings: SolarSettings) => {};
  let notifyPath = (_visible: boolean) => {};
  let notifyScale = (_percent: number) => {};
  let notifyOpacity = (_percent: number) => {};
  let calculateExposure = async (_progress: (percent: number) => void): Promise<ExposureResult> => { throw new Error('Carregue o modelo.'); };
  let notifyExposure = (_visible: boolean) => {};
  let exposureRevision = 0;
  container.innerHTML = `
    <div class="solar-controls">
      <div class="detail-label">ILUMINAÇÃO E SOMBRAS</div>
      <h2>Estudo solar</h2>
      <section class="annual-exposure" aria-label="Mapa de exposição anual">
        <h3>Exposição anual</h3>
        <p>Horas estimadas de sol direto por ano nas geometrias fora de REP. REP visível participa apenas das sombras.</p>
        <button id="solar-exposure-calculate" type="button" disabled>Calcular mapa anual</button>
        <button id="solar-exposure-cancel" type="button" hidden>Cancelar</button>
        <label class="solar-path-toggle"><input id="solar-exposure-map" type="checkbox" disabled /> Mostrar mapa em gradiente</label>
        <div id="solar-exposure-legend" hidden><div class="annual-exposure-gradient"></div><div class="annual-exposure-scale"><span>0 h/ano</span><span id="solar-exposure-max"></span></div></div>
        <p id="solar-exposure-status" role="status" aria-live="polite"></p>
        <small>12 dias representativos, intervalos de 1 hora e amostras nas superfícies. O gradiente interpola os resultados; a suavização não aumenta a precisão. Sem nuvens ou dados meteorológicos.</small>
      </section>
      <label class="solar-path-toggle" for="solar-path"><input id="solar-path" type="checkbox" /> Mostrar faixa solar</label>
      <label class="solar-field solar-path-size" for="solar-path-size"><span>Tamanho da faixa <output id="solar-path-size-value" for="solar-path-size">50%</output></span>
        <input id="solar-path-size" type="range" min="5" max="200" step="5" value="50" />
        <small><span>5%</span><span>200%</span></small></label>
      <label class="solar-field" for="solar-path-opacity"><span>Opacidade da faixa <output id="solar-path-opacity-value" for="solar-path-opacity">12%</output></span>
        <input id="solar-path-opacity" type="range" min="0" max="100" step="1" value="12" />
        <small><span>0%</span><span>100%</span></small></label>
      <p class="solar-path-legend">Faixa translúcida: percurso anual aproximado entre os solstícios. Linha dourada: data selecionada. Ponto: sol no horário escolhido. Círculo: horizonte.</p>
      <label class="solar-field" for="solar-exposure"><span>Exposição <output for="solar-exposure"></output></span>
        <input id="solar-exposure" name="exposure" type="range" min="0.2" max="2" step="0.01" value="0.8" />
        <small><span>0,2</span><span>2</span></small></label>
      <label class="solar-field" for="solar-shadow"><span>Intensidade da sombra <output for="solar-shadow"></output></span>
        <input id="solar-shadow" name="shadowIntensity" type="range" min="0" max="100" step="1" value="80" />
        <small><span>0%</span><span>100%</span></small></label>
      <label class="solar-field" for="solar-sun"><span>Intensidade do sol <output for="solar-sun"></output></span>
        <input id="solar-sun" name="sunIntensity" type="range" min="0" max="200" step="1" value="120" />
        <small><span>0%</span><span>200%</span></small></label>
      <div class="solar-coordinates">
        <label for="solar-latitude">Latitude<input id="solar-latitude" name="latitude" type="number" min="-90" max="90" step="any" required /></label>
        <label for="solar-longitude">Longitude<input id="solar-longitude" name="longitude" type="number" min="-180" max="180" step="any" required /></label>
        <label for="solar-utc">Fuso (UTC)<input id="solar-utc" name="utcOffset" type="number" min="-12" max="14" step="0.25" required /></label>
      </div>
      <p class="solar-note">Coordenadas iniciais: Campo Grande/MS. Ajuste para o local do projeto.</p>
      <label class="solar-field" for="solar-date"><span>Data</span><input id="solar-date" name="date" type="date" min="1900-01-01" max="2100-12-31" required /></label>
      <label class="solar-field" for="solar-time"><span>Horário <output for="solar-time"></output></span>
        <input id="solar-time" name="minutes" type="range" min="480" max="1140" step="1" value="900" />
        <small><span>08:00</span><span>19:00</span></small></label>
      <p class="solar-status" role="status"></p>
      <p class="solar-note">Gire a seta N à direita para definir o norte do projeto. A iluminação também será usada no Estudo de massa.</p>
    </div>
    <div class="sidebar-footer"><span>ESTUDO SOLAR</span><span>VISUALIZADOR 3D</span></div>`;
  const pathToggle = container.querySelector<HTMLInputElement>('#solar-path')!;
  const exposureButton = container.querySelector<HTMLButtonElement>('#solar-exposure-calculate')!;
  const exposureCancel = container.querySelector<HTMLButtonElement>('#solar-exposure-cancel')!;
  const exposureToggle = container.querySelector<HTMLInputElement>('#solar-exposure-map')!;
  const exposureStatus = container.querySelector<HTMLElement>('#solar-exposure-status')!;
  const exposureLegend = container.querySelector<HTMLElement>('#solar-exposure-legend')!;
  const invalidateExposure = () => {
    exposureRevision++;
    exposureToggle.checked = false;
    exposureToggle.disabled = true;
    exposureLegend.hidden = true;
    exposureCancel.hidden = true;
    exposureButton.disabled = false;
    exposureStatus.textContent = 'Modelo ou parâmetros alterados. Calcule o mapa novamente.';
  };
  exposureToggle.addEventListener('change', () => {
    notifyExposure(exposureToggle.checked);
    exposureLegend.hidden = !exposureToggle.checked;
  });
  exposureCancel.addEventListener('click', () => {
    notifyExposure(false);
    invalidateExposure();
    exposureStatus.textContent = 'Cálculo cancelado.';
  });
  const runExposure = async () => {
    const revision = ++exposureRevision;
    exposureButton.disabled = true;
    exposureCancel.hidden = false;
    exposureToggle.disabled = true;
    exposureToggle.checked = false;
    exposureLegend.hidden = true;
    exposureStatus.textContent = 'Preparando superfícies…';
    try {
      const result = await calculateExposure(percent => {
        if (revision === exposureRevision) exposureStatus.textContent = `Calculando exposição anual: ${percent}%`;
      });
      if (revision !== exposureRevision) throw new Error('Restauração do mapa interrompida por uma alteração nos parâmetros.');
      exposureToggle.disabled = false;
      exposureToggle.checked = true;
      exposureLegend.hidden = false;
      container.querySelector<HTMLElement>('#solar-exposure-max')!.textContent = `${Math.round(result.maxHours).toLocaleString('pt-BR')} h/ano`;
      exposureStatus.textContent = `${result.year} · ${result.points.toLocaleString('pt-BR')} amostras · Azul: menos sol; vermelho: mais sol.${result.skipped ? ` ${result.skipped} objeto(s) sem suporte foram ignorados.` : ''}`;
    } catch (error) {
      if (revision === exposureRevision) exposureStatus.textContent = error instanceof Error && error.name !== 'AbortError' ? error.message : 'Cálculo cancelado.';
      throw error;
    } finally {
      if (revision === exposureRevision) { exposureButton.disabled = false; exposureCancel.hidden = true; }
    }
  };
  exposureButton.addEventListener('click', () => runExposure().catch(() => {}));
  pathToggle.addEventListener('change', () => notifyPath(pathToggle.checked));
  const pathSize = container.querySelector<HTMLInputElement>('#solar-path-size')!;
  pathSize.addEventListener('input', () => {
    const percent = pathSize.valueAsNumber;
    if (!Number.isFinite(percent) || percent < 5 || percent > 200) return;
    container.querySelector<HTMLOutputElement>('#solar-path-size-value')!.value = `${percent}%`;
    notifyScale(percent);
  });
  const inputs = [...container.querySelectorAll<HTMLInputElement>('input[name]')];
  const pathOpacity = container.querySelector<HTMLInputElement>('#solar-path-opacity')!;
  pathOpacity.addEventListener('input', () => {
    const percent = pathOpacity.valueAsNumber;
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
    container.querySelector<HTMLOutputElement>('#solar-path-opacity-value')!.value = `${percent}%`;
    notifyOpacity(percent);
  });
  if (location?.latitude != null && location.longitude != null) {
    container.querySelector<HTMLElement>('.solar-note')!.textContent = location.locked
      ? 'Coordenadas obtidas do KMZ. Para alterar a localização, substitua ou remova o KMZ no cadastro.'
      : 'Coordenadas cadastradas para este projeto. Ajuste aqui para simular outra localização.';
  }
  const format = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
  const updateLabels = () => {
    for (const input of inputs) {
      const output = container.querySelector<HTMLOutputElement>(`output[for="${input.id}"]`);
      if (!output) continue;
      const value = input.valueAsNumber;
      output.value = input.name === 'minutes'
        ? `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
        : `${format.format(value)}${input.name.endsWith('Intensity') ? '%' : ''}`;
    }
    container.querySelector<HTMLElement>('.solar-status')!.textContent = solarDirection(settings).y <= 0
      ? 'Sol abaixo do horizonte neste horário.' : '';
  };
  for (const input of inputs) {
    const locked = Boolean(location?.locked && ['latitude', 'longitude'].includes(input.name));
    input.disabled = locked;
    input.value = String(settings[input.name as keyof SolarSettings]);
    input.addEventListener('input', () => {
      if (locked) return;
      if (!inputs.every(field => field.checkValidity())) return;
      const next = { ...settings, [input.name]: input.type === 'date' ? input.value : input.valueAsNumber };
      try { solarDirection(next); } catch { return; }
      settings = next;
      updateLabels();
      notify({ ...settings });
    });
  }
  updateLabels();
  return {
    restoreExposure: runExposure,
    onExposureCalculate(callback) { calculateExposure = callback; exposureButton.disabled = false; },
    onExposureVisibilityChange(callback) { notifyExposure = callback; },
    exposureVisible: () => exposureToggle.checked,
    invalidateExposure,
    restore(state) {
      settings = { ...state.settings };
      // The project location remains authoritative when supplied by a KMZ.
      if (location?.locked && location.latitude != null && location.longitude != null) {
        settings.latitude = location.latitude;
        settings.longitude = location.longitude;
      }
      for (const input of inputs) input.value = String(settings[input.name as keyof SolarSettings]);
      pathToggle.checked = state.pathVisible;
      pathSize.value = String(state.scale);
      pathOpacity.value = String(state.opacity);
      container.querySelector<HTMLOutputElement>('#solar-path-size-value')!.value = `${state.scale}%`;
      container.querySelector<HTMLOutputElement>('#solar-path-opacity-value')!.value = `${state.opacity}%`;
      updateLabels();
      notify({ ...settings });
      notifyScale(state.scale);
      notifyOpacity(state.opacity);
      notifyPath(state.pathVisible);
    },
    pathOpacity: () => pathOpacity.valueAsNumber,
    onPathOpacityChange(callback) { notifyOpacity = callback; },
    pathScale: () => pathSize.valueAsNumber,
    onPathScaleChange(callback) { notifyScale = callback; },
    pathVisible: () => pathToggle.checked,
    onPathChange(callback) { notifyPath = callback; },
    settings: () => ({ ...settings }),
    setNorthAngle(angle) {
      settings = { ...settings, northAngle: angle };
      notify({ ...settings });
    },
    onChange(callback) { notify = callback; },
  };
}
