import { defaultSolarSettings, solarDirection, type SolarSettings } from '../data/solar';

export function mountSolarPanel(container: HTMLElement, location?: { latitude: number | null; longitude: number | null; locked: boolean }): { settings(): SolarSettings; setNorthAngle(angle: number): void; onChange(callback: (settings: SolarSettings) => void): void; pathVisible(): boolean; onPathChange(callback: (visible: boolean) => void): void } {
  let settings = defaultSolarSettings();
  if (location?.latitude != null && location.longitude != null) {
    settings = { ...settings, latitude: location.latitude, longitude: location.longitude };
  }
  let notify = (_settings: SolarSettings) => {};
  let notifyPath = (_visible: boolean) => {};
  container.innerHTML = `
    <div class="solar-controls">
      <div class="detail-label">ILUMINAÇÃO E SOMBRAS</div>
      <h2>Estudo solar</h2>
      <label class="solar-path-toggle" for="solar-path"><input id="solar-path" type="checkbox" /> Mostrar faixa solar</label>
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
  pathToggle.addEventListener('change', () => notifyPath(pathToggle.checked));
  const inputs = [...container.querySelectorAll<HTMLInputElement>('input[name]')];
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
