import type { ArchitecturalViewer } from './viewer/ArchitecturalViewer';
import { createApp } from './ui/App';
import { loadObjectData } from './data/objectData';
import { projectConfig } from './data/config';
import { USAGE_CODES, type ObjectRecord, type UsageCode, type UsageTotal } from './types/model';
import './styles/main.css';

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
  const [{ ArchitecturalViewer }, { createDemoScene }] = await Promise.all([
    import('./viewer/ArchitecturalViewer'), import('./viewer/demoScene'),
  ]);
  let objectData = new Map<string, ObjectRecord>();
  let refreshTotals = () => {};
  const viewer = new ArchitecturalViewer(ui.viewport, (selection) => {
    const record = selection?.id ? objectData.get(selection.id.toLowerCase()) : undefined;
    ui.setSelection(selection, record);
    ui.updateLayers(viewer.getLayers());
    refreshTotals();
  }, (state) => ui.setViewState(state));
  activeViewer = viewer;
  viewer.setActive(massingVisible);
  ui.setViewActions((view) => viewer.setStandardView(view), (mode) => viewer.setProjectionMode(mode));
  ui.fitButton.addEventListener('click', () => viewer.fitToContent());
  ui.homeButton.addEventListener('click', () => viewer.resetView());
  ui.clearSelectionButton.addEventListener('click', () => viewer.clearSelection());
  if (import.meta.hot) import.meta.hot.dispose(() => viewer.dispose());

  viewer.setContent(createDemoScene());
  if (!projectConfig.modelUrl) {
    ui.setSceneInfo(projectConfig.name, 'Sem modelo cadastrado · cena demonstrativa', 'DEMONSTRAÇÃO');
    showNotice('Este projeto ainda não possui modelo. A cena exibida é demonstrativa.');
    return;
  }
  ui.setSceneInfo(projectConfig.name, 'Preparando a visualização', 'CARREGANDO MODELO');
  try {
    const { loadModel } = await import('./viewer/loadModel');
    const [model, records] = await Promise.all([
      loadModel(projectConfig.modelUrl, projectConfig.rhinoLibraryUrl),
      loadObjectData().catch((error: unknown) => {
        console.warn('Dados por ID indisponíveis.', error);
        showNotice('O modelo será exibido, mas a tabela de objetos não pôde ser carregada.');
        return new Map<string, ObjectRecord>();
      }),
    ]);
    model.name = projectConfig.name;
    objectData = records;
    viewer.setContent(model, records);
    ui.setSceneInfo(projectConfig.name, 'Modelo do projeto', 'MODELO DO PROJETO');
    let usageFilter: ReturnType<typeof ui.setUsageFilter> | null = null;
    const updateUsageTotals = () => {
      if (!usageFilter) return;
      const totals = Object.fromEntries(USAGE_CODES.map((code) => [code, { count: 0, areaM2: 0 }])) as Record<UsageCode, UsageTotal>;
      for (const id of viewer.getVisibleObjectIds()) {
        const record = records.get(id);
        const code = record?.use?.toUpperCase() as UsageCode | undefined;
        if (!code || !USAGE_CODES.includes(code)) continue;
        totals[code].count++;
        if (code !== 'VAGAS' && record?.areaM2 != null) totals[code].areaM2 += record.areaM2;
      }
      usageFilter.setTotals(totals);
    };
    refreshTotals = updateUsageTotals;
    ui.setLayers(
      viewer.getLayers(),
      (index, visible) => { viewer.setLayerVisible(index, visible); updateUsageTotals(); },
      (visible) => { viewer.setAllLayersVisible(visible); updateUsageTotals(); },
      {
        onModeChange: mode => viewer.setSelectionMode(mode),
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
      updateUsageTotals();
    }
  } catch (error: unknown) {
    console.warn('Não foi possível carregar o modelo.', error);
    ui.setSceneInfo(projectConfig.name, 'Falha no modelo · cena demonstrativa', 'DEMONSTRAÇÃO');
    showNotice('Não foi possível carregar o arquivo 3D deste projeto. A cena exibida é demonstrativa.');
  }
}

ui.onMassingVisibilityChange((visible) => {
  massingVisible = visible;
  if (notice) notice.hidden = !visible || !notice.textContent;
  if (visible && !started) {
    started = true;
    start().catch((error: unknown) => {
      console.error(error);
      showNotice('Não foi possível iniciar o visualizador 3D. Verifique se o navegador oferece suporte a WebGL.');
    });
  } else {
    activeViewer?.setActive(visible);
  }
});
