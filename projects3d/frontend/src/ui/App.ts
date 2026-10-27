import type { LayerInfo } from '../types/layers';
import { mountLayerPanel, type LayerPanelActions, type LayerPanel } from './LayerPanel';
import type { ObjectRecord, ObjectSelection, SelectionTotals } from '../types/model';
import { mountSelectionSummary } from './SelectionSummary';
import { mountElevationFilter, type ElevationFilter } from './ElevationFilter';
import type { SavedScene } from '../types/scenes';
import { mountUsageFilter, type UsageFilter } from './UsageFilter';
import { createViewCube } from './ViewCube';
import type { ProjectionMode, StandardView, ViewState } from '../types/view';
import type { UsageCode } from '../types/model';
import { mountLocationVideo } from './LocationVideo';
import { projectConfig } from '../data/config';
import { mountProjectPanels } from './ProjectPanels';
import { iconMarkup } from './icons';
import { mountSolarPanel } from './SolarPanel';
import type { SolarSettings } from '../data/solar';
import { mountNorthControl } from './NorthControl';

export interface AppElements {
  viewport: HTMLDivElement;
  fitButton: HTMLButtonElement;
  homeButton: HTMLButtonElement;
  exportButton: HTMLButtonElement;
  clearSelectionButton: HTMLButtonElement;
  sceneToolbar: HTMLElement;
  simulationPanel: HTMLElement;
  onSimulationVisibilityChange(callback: (visible: boolean) => void): void;
  onMassingVisibilityChange(callback: (visible: boolean) => void): void;
  onSolarSettingsChange(callback: (settings: SolarSettings) => void): void;
  onSolarVisibilityChange(callback: (visible: boolean) => void): void;
  setBrand(name: string, markUrl: string): void;
  setSceneInfo(title: string, subtitle: string, status: string): void;
  setSelection(selection: ObjectSelection | null, record?: ObjectRecord): void;
  setLayers(layers: LayerInfo[], onToggle: (index: number, visible: boolean) => void, onSetAll: (visible: boolean) => void, actions: LayerPanelActions): void;
  updateLayers(layers: LayerInfo[]): void;
  setSelectionTotals(totals: SelectionTotals): void;
  restoreSceneControls(scene: SavedScene): void;
  setElevationFilter(levels: number[], onChange: (base: number, top: number) => void): void;
  setUsageFilter(onChange: (active: ReadonlySet<UsageCode>) => void): UsageFilter;
  setViewActions(onView: (view: StandardView) => void, onProjection: (mode: ProjectionMode) => void): void;
  setViewState(state: ViewState): void;
}

export function createApp(mount: HTMLElement): AppElements {
  mount.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand" aria-label="Visualização arquitetônica">
          ${iconMarkup('box')}
          <img id="brand-mark" class="brand-mark" alt="" width="46" height="46" hidden />
          <div><strong id="brand-name">Visualização arquitetônica</strong><small>VISUALIZAÇÃO ARQUITETÔNICA</small></div>
        </div>
        <nav class="section-tabs" aria-label="Seções do projeto" role="tablist">
          <button id="tab-cover" class="section-tab" type="button" role="tab" aria-selected="true" aria-controls="cover-panel">${iconMarkup('home')} Capa</button>
          <button id="tab-location" class="section-tab" type="button" role="tab" aria-selected="false" aria-controls="location-panel" tabindex="-1">${iconMarkup('map-pin')} Localização</button>
          <button id="tab-solar" class="section-tab" type="button" role="tab" aria-selected="false" aria-controls="massing-panel" tabindex="-1"><span aria-hidden="true">☀</span> Estudo solar</button>
          <button id="tab-guidelines" class="section-tab" type="button" role="tab" aria-selected="false" aria-controls="guidelines-panel" tabindex="-1">${iconMarkup('file-text')} Diretrizes</button>
          <button id="tab-massing" class="section-tab" type="button" role="tab" aria-selected="false" aria-controls="massing-panel" tabindex="-1">${iconMarkup('box')} Estudo de massa</button>
          <button id="tab-concept" class="section-tab" type="button" role="tab" aria-selected="false" aria-controls="concept-panel" tabindex="-1">${iconMarkup('image')} Conceito</button>
          <button id="tab-simulation" class="section-tab" type="button" role="tab" aria-selected="false" aria-controls="simulation-panel" tabindex="-1">${iconMarkup('calculator')} Simulação</button>
        </nav>
        <div class="topbar-right"><a id="back-projects" class="back-projects">${iconMarkup('arrow-left')} Projetos</a><span class="project-tag"><span class="status-dot"></span> <span id="scene-status">PROJETO</span></span></div>
      </header>

      <section id="cover-panel" class="project-cover-panel" role="tabpanel" aria-labelledby="tab-cover" tabindex="0"></section>
      <section id="guidelines-panel" class="project-document-panel" role="tabpanel" aria-labelledby="tab-guidelines" tabindex="0" hidden></section>
      <section id="concept-panel" class="project-document-panel" role="tabpanel" aria-labelledby="tab-concept" tabindex="0" hidden></section>
      <section id="simulation-panel" class="simulation-panel" role="tabpanel" aria-labelledby="tab-simulation" tabindex="0" hidden></section>
      <main id="massing-panel" class="workspace" role="tabpanel" aria-labelledby="tab-massing" tabindex="0" hidden>
        <aside id="solar-sidebar" class="sidebar solar-sidebar" aria-label="Configurações do estudo solar" hidden></aside>
        <aside class="sidebar" aria-label="Informações do estudo">
          <div class="sidebar-inner">
            <div id="selection-modes" class="selection-modes" role="group" aria-label="Selecionar objetos por" hidden><button type="button" data-mode="name" aria-pressed="true">Nome</button><button type="button" data-mode="use" aria-pressed="false">Uso</button><button type="button" data-mode="group" aria-pressed="false">Grupo</button></div>
            <div class="eyebrow"><span class="eyebrow-line"></span> ESTUDO 001 <span class="eyebrow-count">/ 001</span></div>
            <p class="intro">Um espaço de trabalho para explorar modelos arquitetônicos com liberdade de movimento e clareza visual.</p>
            <div class="sidebar-divider"></div>
            <div class="detail-label">CENA ATUAL</div>
            <div class="scene-card">
              <div class="scene-thumb" aria-hidden="true"><span class="thumb-building"></span></div>
              <div><strong id="scene-title">Pavilhão de estudo</strong><span id="scene-subtitle">Volumes demonstrativos</span></div>
              <span class="scene-arrow" aria-hidden="true">${iconMarkup('arrow-up-right')}</span>
            </div>
            <section id="layer-section" class="layer-section" aria-label="Filtro de layers" hidden>
              <div class="layer-heading"><span class="detail-label">LAYERS DO MODELO</span><span id="layer-summary" class="layer-summary"></span></div>
              <div class="layer-actions"><button id="show-layers" type="button">Marcar todos</button><button id="hide-layers" type="button">Marcar nenhum</button></div>
              <div id="layer-list" class="layer-list"></div>
              <div id="area-exclusions" class="area-exclusions" role="group" aria-label="Exclusões do cálculo de áreas" hidden>
                <label class="hide-unchecked"><input id="exclude-uncovered" type="checkbox" role="switch" /> Excluir áreas descobertas</label>
                <label class="hide-unchecked"><input id="exclude-parking" type="checkbox" role="switch" /> Excluir estacionamento</label>
              </div>
              <section id="marked-summary" class="marked-summary" aria-label="Resumo dos objetos marcados" hidden></section>
              <label class="hide-unchecked"><input id="hide-unchecked" type="checkbox" role="switch" /> Ocultar desmarcados</label>
            </section>
            <div class="sidebar-spacer"></div>
            <div class="controls-guide">
              <div class="detail-label">NAVEGAÇÃO</div>
              <div class="guide-row"><span class="guide-icon">${iconMarkup('orbit')}</span><span>Arraste para orbitar</span></div>
              <div class="guide-row"><span class="guide-icon">${iconMarkup('zoom')}</span><span>Roda para aproximar</span></div>
              <div class="guide-row"><span class="guide-icon">${iconMarkup('move')}</span><span>Botão direito para deslocar</span></div>
            </div>
          </div>
          <div class="sidebar-footer"><span>ESTUDO DE MASSA</span><span>VISUALIZADOR 3D</span></div>
        </aside>

        <section class="viewer-panel" aria-label="Visualizador 3D">
          <div id="viewport" class="viewport"></div>
          <div class="viewport-top"><span class="view-label"><span class="view-label-square"></span> <span id="view-name">PERSPECTIVA</span> <span class="view-label-separator">/</span> <span id="view-projection">3D</span></span></div>
          <nav id="view-cube-panel" class="view-cube-panel" aria-label="Orientação e projeção da vista"></nav>
          <aside id="north-control" class="north-control" aria-label="Ajustar norte do projeto" hidden></aside>
          <aside id="elevation-filter" class="elevation-filter" aria-label="Filtro por cota" hidden></aside>
          <section id="usage-filter" class="usage-filter" aria-label="Filtro por uso" hidden></section>
          <div class="selection-hint" id="selection-hint" role="status" hidden>
            <div class="selection-heading"><div><strong>GEOMETRIA SELECIONADA</strong><span id="selection-name"></span></div><button id="clear-selection" type="button" aria-label="Limpar seleção">Limpar ${iconMarkup('x')}</button></div>
            <dl class="selection-details">
              <div><dt>Área</dt><dd id="selection-area"></dd></div>
              <div><dt>Uso</dt><dd id="selection-use"></dd></div>
              <div><dt>Cota</dt><dd id="selection-elevation"></dd></div>
              <div><dt>Piso a piso</dt><dd id="selection-floor-to-floor"></dd></div>
            </dl>
          </div>
          <div class="viewport-bottom">
            <div id="scene-toolbar" class="viewer-toolbar" role="toolbar" aria-label="Vistas e cenas salvas">
              <button id="fit-view" type="button" class="scene-shortcut scene-navigation" title="Enquadrar toda a cena" aria-label="Enquadrar toda a cena">${iconMarkup('maximize')}</button>
              <button id="home-view" type="button" class="scene-shortcut scene-navigation" title="Vista inicial" aria-label="Vista inicial">${iconMarkup('home')}</button>
              <div class="scene-slots" role="group" aria-label="Cenas de 1 a 10"></div>
              <button id="update-scene" type="button" class="scene-shortcut scene-update" title="Selecione uma cena para atualizar" aria-label="Selecione uma cena para atualizar" disabled>${iconMarkup('refresh')}</button>
              <div class="scene-export-actions"><span class="scene-feedback" role="status" aria-live="polite"></span><button id="export-view" class="image-export-button" type="button" disabled>${iconMarkup('printer')} Imprimir</button></div>
            </div>
          </div>
        </section>
      </main>
      <section id="location-panel" class="location-panel" role="tabpanel" aria-labelledby="tab-location" tabindex="0" hidden>
        <div class="location-stage">
          <video id="location-video" class="location-video" preload="metadata" playsinline aria-label="Vídeo de localização"></video>
          <p id="location-error" class="location-error" role="status" hidden>O vídeo de localização não está disponível neste ambiente.</p>
        </div>
        <div class="video-controls" aria-label="Controles do vídeo de localização">
          <button id="video-toggle" class="video-toggle" type="button" aria-label="Reproduzir vídeo"><span id="video-icon" aria-hidden="true">▶</span><span id="video-action">Reproduzir</span></button>
          <span id="video-current" class="video-time">0:00</span>
          <input id="video-timeline" class="video-timeline" type="range" min="0" max="1000" value="0" disabled aria-label="Posição do vídeo" />
          <span id="video-duration" class="video-time">--:--</span>
        </div>
      </section>
    </div>
  `;

  mount.querySelector<HTMLAnchorElement>('#back-projects')!.href = projectConfig.listUrl;
  mount.querySelector<HTMLElement>('.intro')!.textContent = projectConfig.description || 'Explore o modelo, selecione peças e ajuste os filtros para consultar o estudo.';
  mount.querySelector<HTMLElement>('#brand-name')!.textContent = projectConfig.name;
  mountProjectPanels(mount);
  const massingPanel = mount.querySelector<HTMLElement>('#massing-panel');
  const locationPanel = mount.querySelector<HTMLElement>('#location-panel');
  const locationVideo = mount.querySelector<HTMLVideoElement>('#location-video');
  if (!massingPanel || !locationPanel || !locationVideo) throw new Error('Abas incompletas.');
  mountLocationVideo(locationPanel);
  const tabs = [...mount.querySelectorAll<HTMLButtonElement>('.section-tab')];
  const solarSidebar = mount.querySelector<HTMLElement>('#solar-sidebar')!;
  const solarPanel = mountSolarPanel(solarSidebar);
  let solarActive = false;
  const northHost = mount.querySelector<HTMLElement>('#north-control')!;
  const northControl = mountNorthControl(northHost, angle => solarPanel.setNorthAngle(angle));
  let onSolarSettings = (_settings: SolarSettings) => {};
  let onSolarVisibility = (_visible: boolean) => {};
  solarPanel.onChange(settings => onSolarSettings(settings));
  let onMassingVisibility = (_visible: boolean) => {};
  let onSimulationVisibility = (_visible: boolean) => {};
  const activateTab = (tab: HTMLButtonElement) => {
    solarActive = tab.id === 'tab-solar';
    const viewerVisible = solarActive || tab.id === 'tab-massing';
    mount.querySelector<HTMLElement>('.app-shell')!.classList.toggle('is-cover', tab.id === 'tab-cover');
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      mount.querySelector<HTMLElement>(`#${item.getAttribute('aria-controls')}`)!.hidden = !active;
    }
    massingPanel.hidden = !viewerVisible;
    massingPanel.setAttribute('aria-labelledby', solarActive ? 'tab-solar' : 'tab-massing');
    massingPanel.classList.toggle('is-solar', solarActive);
    solarSidebar.hidden = !solarActive;
    northHost.hidden = !solarActive;
    mount.querySelector<HTMLElement>('.sidebar:not(.solar-sidebar)')!.hidden = solarActive;
    if (tab.id !== 'tab-location') locationVideo.pause();
    onMassingVisibility(viewerVisible);
    onSolarVisibility(solarActive);
    onSolarSettings(solarPanel.settings());
    onSimulationVisibility(tab.id === 'tab-simulation');
  };
  const requested = new URLSearchParams(location.search).get('section');
  const initialTab = tabs.find(tab => tab.id === `tab-${requested}`) ?? tabs[0];
  activateTab(initialTab);
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', (event) => {
      let next: HTMLButtonElement;
      if (event.key === 'ArrowLeft') next = tabs[(index + tabs.length - 1) % tabs.length];
      else if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      else if (event.key === 'Home') next = tabs[0];
      else if (event.key === 'End') next = tabs[tabs.length - 1];
      else return;
      event.preventDefault();
      activateTab(next);
      next.focus();
    });
  }

  const viewport = mount.querySelector<HTMLDivElement>('#viewport');
  const fitButton = mount.querySelector<HTMLButtonElement>('#fit-view');
  const homeButton = mount.querySelector<HTMLButtonElement>('#home-view');
  const clearSelectionButton = mount.querySelector<HTMLButtonElement>('#clear-selection');
  const brand = mount.querySelector<HTMLElement>('.brand');
  const brandName = mount.querySelector<HTMLElement>('#brand-name');
  const brandMark = mount.querySelector<HTMLImageElement>('#brand-mark');
  const selectionHint = mount.querySelector<HTMLElement>('#selection-hint');
  const selectionName = mount.querySelector<HTMLElement>('#selection-name');
  const selectionArea = mount.querySelector<HTMLElement>('#selection-area');
  const selectionUse = mount.querySelector<HTMLElement>('#selection-use');
  const selectionElevation = mount.querySelector<HTMLElement>('#selection-elevation');
  const selectionFloorToFloor = mount.querySelector<HTMLElement>('#selection-floor-to-floor');
  const elevationFilter = mount.querySelector<HTMLElement>('#elevation-filter');
  const usageFilter = mount.querySelector<HTMLElement>('#usage-filter');
  const viewCubePanel = mount.querySelector<HTMLElement>('#view-cube-panel');
  const viewName = mount.querySelector<HTMLElement>('#view-name');
  const viewProjection = mount.querySelector<HTMLElement>('#view-projection');
  const sceneTitle = mount.querySelector<HTMLElement>('#scene-title');
  const sceneSubtitle = mount.querySelector<HTMLElement>('#scene-subtitle');
  const sceneStatus = mount.querySelector<HTMLElement>('#scene-status');
  const sidebar = mount.querySelector<HTMLElement>('.sidebar:not(.solar-sidebar)');
  const layerSection = mount.querySelector<HTMLElement>('#layer-section');
  const layerList = mount.querySelector<HTMLElement>('#layer-list');
  const layerSummary = mount.querySelector<HTMLElement>('#layer-summary');
  const showLayers = mount.querySelector<HTMLButtonElement>('#show-layers');
  const hideLayers = mount.querySelector<HTMLButtonElement>('#hide-layers');
  if (!viewport || !fitButton || !homeButton || !clearSelectionButton || !brand || !brandName || !brandMark || !selectionHint || !selectionName || !selectionArea || !selectionUse || !selectionElevation || !selectionFloorToFloor || !elevationFilter || !usageFilter || !viewCubePanel || !viewName || !viewProjection || !sceneTitle || !sceneSubtitle || !sceneStatus || !sidebar || !layerSection || !layerList || !layerSummary || !showLayers || !hideLayers) throw new Error('Interface incompleta.');
  const metric = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const viewCube = createViewCube(viewCubePanel);
  let layerPanel: LayerPanel | null = null;
  let elevationControl: ElevationFilter | null = null;
  const updateSelectionSummary = mountSelectionSummary(mount.querySelector<HTMLElement>('#marked-summary')!);
  return {
    viewport,
    fitButton,
    homeButton,
    exportButton: mount.querySelector<HTMLButtonElement>('#export-view')!,
    clearSelectionButton,
    sceneToolbar: mount.querySelector<HTMLElement>('#scene-toolbar')!,
    simulationPanel: mount.querySelector<HTMLElement>('#simulation-panel')!,
    onSimulationVisibilityChange(callback) {
      onSimulationVisibility = callback;
      callback(!mount.querySelector<HTMLElement>('#simulation-panel')!.hidden);
    },
    onMassingVisibilityChange(callback) {
      onMassingVisibility = callback;
      callback(!massingPanel.hidden);
    },
    onSolarSettingsChange(callback) {
      onSolarSettings = callback;
      callback(solarPanel.settings());
    },
    onSolarVisibilityChange(callback) {
      onSolarVisibility = callback;
      callback(solarActive);
    },
    setBrand(name, markUrl) {
      brandName.textContent = name;
      brand.setAttribute('aria-label', name);
      brandMark.src = markUrl;
      brandMark.hidden = false;
      document.title = `${name} · Visualização arquitetônica`;
    },
    setViewActions(onView, onProjection) {
      viewCube.setActions(onView, onProjection);
    },
    setViewState(state) {
      viewCube.update(state);
      northControl.update(state);
      viewName.textContent = state.label;
      viewProjection.textContent = state.projection === 'perspective' ? '3D' : 'ORTO';
    },
    setElevationFilter(levels, onChange) {
      elevationControl = mountElevationFilter(elevationFilter, levels, onChange);
    },
    setUsageFilter(onChange) {
      return mountUsageFilter(usageFilter, onChange);
    },
    setSelection(selection, record) {
      selectionName.textContent = selection?.name ?? '';
      selectionArea.textContent = record?.use?.toUpperCase() === 'VAGAS'
        ? 'Não contabilizada'
        : record?.areaM2 == null ? 'Não informada' : `${metric.format(record.areaM2)} m²`;
      selectionUse.textContent = record?.use || 'Não informado';
      selectionElevation.textContent = record?.elevationM == null ? 'Não informada' : `${metric.format(record.elevationM)} m`;
      selectionFloorToFloor.textContent = record?.floorToFloorM == null ? 'Não informado' : `${metric.format(record.floorToFloorM)} m`;
      selectionHint.hidden = selection === null || (selection.mode !== undefined && selection.mode !== 'name');
    },
    setSceneInfo(title, subtitle, status) {
      sceneTitle.textContent = title;
      sceneSubtitle.textContent = subtitle;
      sceneStatus.textContent = status;
    },
    setLayers(layers, onToggle, onSetAll, actions) {
      layerSection.hidden = layers.length === 0;
      sidebar.classList.toggle('has-layers', layers.length > 0);
      layerPanel = mountLayerPanel(mount, layers, onToggle, onSetAll, {
        ...actions,
        onModeChange(mode) {
          usageFilter.hidden = mode !== 'name' || !usageFilter.childElementCount;
          actions.onModeChange(mode);
        },
      });
    },
    updateLayers(layers) { layerPanel?.update(layers); },
    setSelectionTotals(totals) { updateSelectionSummary(totals); },
    restoreSceneControls(scene) {
      layerPanel?.restore(scene.viewer.selectionMode, scene.viewer.hideUnchecked, scene.areaExclusions);
      elevationControl?.setRange(...scene.viewer.elevation);
      usageFilter.hidden = scene.viewer.selectionMode !== 'name' || !usageFilter.childElementCount;
    },
  };
}
