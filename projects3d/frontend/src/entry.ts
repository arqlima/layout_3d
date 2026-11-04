import type { ArchitecturalViewer } from './viewer/ArchitecturalViewer';
import { createApp } from './ui/App';
import { loadProjectModel } from './data/projectModel';
import { projectConfig } from './data/config';
import type { ObjectRecord, AreaExclusions } from './types/model';
import type { SelectionMode } from './data/layerSelection';
import { summarizeSelection } from './data/selectionTotals';
import { mountSceneToolbar } from './ui/SceneToolbar';
import { mountImageExport } from './ui/ImageExport';
import './styles/main.css';
import '../../static/projects3d/design-system/auragen.css';
import '../../static/projects3d/design-system/genlabs.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Elemento #app não encontrado.');
const ui = createApp(app);
const notice = document.getElementById('viewer-notice');
let activeViewer: ArchitecturalViewer | null = null;
let massingVisible = false;
let started = false;
function showNotice(message: string): void {
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = !massingVisible;
}

async function start(): Promise<void> {
  const [{ ArchitecturalViewer }, { createDemoScene }, { readModelNorth }] = await Promise.all([
    import('./viewer/ArchitecturalViewer'), import('./viewer/demoScene'),
    import('./data/modelNorth'),
  ]);
  let objectData = new Map<string, ObjectRecord>();
  let selectionMode: SelectionMode = 'name';
  let areaExclusions: AreaExclusions = { excludeUncovered: false, excludeParking: false };
  let refreshTotals = () => {};
  const viewer = new ArchitecturalViewer(ui.viewport, (selection) => {
    const record = selection?.id ? objectData.get(selection.id.toLowerCase()) : undefined;
    ui.setSelection(selection, record);
    ui.updateLayers(viewer.getLayers());
    refreshTotals();
  }, (state) => ui.setViewState(state));
  activeViewer = viewer;
  viewer.mountMeasurement(document.querySelector<HTMLButtonElement>('#measure-distance')!);
  viewer.mountSections(ui.viewport.parentElement!, document.querySelector<HTMLButtonElement>('#create-section')!);
  ui.onBackgroundChange(color => viewer.setBackgroundColor(color));
  ui.onSectionLineSettingsChange(settings => viewer.setSectionLineSettings(settings));
  ui.onSolarSettingsChange(settings => viewer.setSolarSettings(settings));
  ui.onSolarVisibilityChange(visible => viewer.setSelectionEnabled(!visible));
  ui.onSolarPathVisibilityChange(visible => viewer.setSolarPathVisible(visible));
  viewer.setActive(massingVisible);
  ui.setViewActions((view) => viewer.setStandardView(view), (mode) => viewer.setProjectionMode(mode));
  ui.fitButton.addEventListener('click', () => viewer.fitToContent());
  ui.homeButton.addEventListener('click', () => viewer.resetView());
  ui.clearSelectionButton.addEventListener('click', () => viewer.clearSelection());
  const imageExport = mountImageExport(ui.exportButton, projectConfig.name, options => viewer.exportImage(options));
  if (import.meta.hot) import.meta.hot.dispose(() => viewer.dispose());

  viewer.setContent(createDemoScene());
  if (!projectConfig.modelUrl) {
    ui.setSceneInfo(projectConfig.name, 'Sem modelo cadastrado · cena demonstrativa', 'DEMONSTRAÇÃO');
    showNotice('Este projeto ainda não possui modelo. A cena exibida é demonstrativa.');
    imageExport.setReady(true);
    return;
  }
  ui.setSceneInfo(projectConfig.name, 'Preparando a visualização', 'CARREGANDO MODELO');
  try {
    const { model, records, dataError } = await loadProjectModel();
    if (dataError) showNotice('O modelo será exibido, mas a tabela de objetos não pôde ser carregada.');
    model.name = projectConfig.name;
    objectData = records;
    viewer.setContent(model, records);
    ui.setInitialNorthAngle(readModelNorth(model));
    ui.setSceneInfo(projectConfig.name, 'Modelo do projeto', 'MODELO DO PROJETO');
    let usageFilter: ReturnType<typeof ui.setUsageFilter> | null = null;
    const updateUsageTotals = () => {
      const totals = summarizeSelection(viewer.getMarkedObjects(), records, selectionMode === 'name' ? {} : areaExclusions);
      ui.setSelectionTotals(totals);
      usageFilter?.setActive(viewer.getActiveUsages());
      usageFilter?.setTotals(totals.byUse);
    };
    refreshTotals = updateUsageTotals;
    ui.setLayers(
      viewer.getLayers(),
      (index, visible) => { viewer.setLayerVisible(index, visible); updateUsageTotals(); },
      (visible) => { viewer.setAllLayersVisible(visible); updateUsageTotals(); },
      {
        onModeChange: mode => { selectionMode = mode; viewer.setSelectionMode(mode); updateUsageTotals(); },
        onAreaExclusionsChange: exclusions => {
          areaExclusions = exclusions;
          viewer.setAreaExclusions(exclusions);
          updateUsageTotals();
        },
        onHideUncheckedChange: hide => { viewer.setHideUnchecked(hide); updateUsageTotals(); },
        onToggleMany: (indices, checked) => { viewer.setLayersChecked(indices, checked); updateUsageTotals(); },
      },
    );
    ui.setElevationFilter(viewer.getElevationLevels(), (base, top) => {
      viewer.setElevationRange(base, top);
      updateUsageTotals();
    });
    if (records.size > 0) {
      const visibleIds = viewer.getVisibleObjectIds();
      if (![...records.keys()].some((id) => visibleIds.has(id))) {
        showNotice('Nenhum ID da tabela corresponde aos objetos visíveis do modelo. Confira o CSV e o arquivo 3D.');
      }
      usageFilter = ui.setUsageFilter((active) => { viewer.setActiveUsages(active); updateUsageTotals(); });
    }
    updateUsageTotals();
    mountSceneToolbar(ui.sceneToolbar, `layout3d:scenes:v1:${JSON.stringify([projectConfig.objectDataUrl, projectConfig.modelUrl])}`,
      () => ({ version: 1, viewer: viewer.captureState(), areaExclusions: { ...areaExclusions } }),
      scene => {
        viewer.restoreState(scene.viewer);
        selectionMode = scene.viewer.selectionMode;
        areaExclusions = { ...scene.areaExclusions };
        viewer.setAreaExclusions(areaExclusions);
        ui.restoreSceneControls(scene);
        updateUsageTotals();
      },
    );
  } catch (error: unknown) {
    console.warn('Não foi possível carregar o modelo.', error);
    ui.setSceneInfo(projectConfig.name, 'Falha no modelo · cena demonstrativa', 'DEMONSTRAÇÃO');
    showNotice('Não foi possível carregar o arquivo 3D deste projeto. A cena exibida é demonstrativa.');
  }
  imageExport.setReady(true);
}

ui.onMassingVisibilityChange((visible) => {
  massingVisible = visible;
  if (notice) notice.hidden = !visible || !notice.textContent;
  if (visible && !started) {
    started = true;
    start().catch((error: unknown) => {
      console.error(error);
      const detail = error instanceof Error ? error.message : 'Erro inesperado';
      showNotice(`Não foi possível iniciar o visualizador 3D: ${detail}`);
    });
  } else {
    activeViewer?.setActive(visible);
  }
});

let simulationStarted = false;
ui.onSimulationVisibilityChange(visible => {
  if (!visible || simulationStarted) return;
  simulationStarted = true;
  ui.simulationPanel.textContent = 'Carregando as áreas do modelo…';
  (async () => {
    const [{ mountSimulationPanel }, { collectSimulationLayers }, { model, records, dataError }] = await Promise.all([
      import('./ui/SimulationPanel'), import('./data/simulation'), loadProjectModel(),
    ]);
    if (dataError || records.size === 0) throw new Error('Cadastre uma tabela CSV com as áreas dos objetos para usar a simulação.');
    const rows = collectSimulationLayers(model, records);
    if (!rows.length) throw new Error('Nenhuma layer de área disponível fora do grupo REP. Confira o modelo e o CSV.');
    mountSimulationPanel(ui.simulationPanel, rows);
  })().catch(error => {
    simulationStarted = false;
    ui.simulationPanel.textContent = error instanceof Error ? error.message : 'Não foi possível preparar a simulação.';
  });
});
