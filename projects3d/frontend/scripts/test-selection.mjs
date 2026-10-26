import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

// Exercise the real viewer methods without creating a WebGL context.
const root = resolve(import.meta.dirname, '..');
const modules = new Map();
async function moduleUrl(path) {
  if (modules.has(path)) return modules.get(path);
  let code = stripTypeScriptTypes(await readFile(path, 'utf8'), { mode: 'transform' });
  const imports = [...code.matchAll(/from ['"]([^'"]+)['"]/g)];
  for (const [, specifier] of imports) {
    const url = specifier.startsWith('.')
      ? await moduleUrl(resolve(dirname(path), `${specifier}.ts`))
      : import.meta.resolve(specifier);
    code = code.replace(`from '${specifier}'`, `from '${url}'`).replace(`from "${specifier}"`, `from '${url}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  modules.set(path, url);
  return url;
}
const { parseLayerName, matchingLayers } = await import(await moduleUrl(resolve(root, 'src/data/layerSelection.ts')));
const { ArchitecturalViewer } = await import(await moduleUrl(resolve(root, 'src/viewer/ArchitecturalViewer.ts')));
assert.deepEqual(parseLayerName('00-Res_des-priv'), { group: '00', name: 'Res_des', use: 'PRIV' });
assert.deepEqual(parseLayerName('01-circ-vert-com'), { group: '01', name: 'circ-vert', use: 'COM' });
assert.deepEqual(parseLayerName('CALCULO'), { group: 'Sem grupo', name: 'CALCULO', use: 'Sem uso' });
const model = new THREE.Group();
model.userData.layers = ['00-Res-PRIV', '01-Res_des-priv', '00-circ_vert-COM', 'CALCULO'].map(name => ({ name }));
const meshes = model.userData.layers.map((_, layerIndex) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  mesh.userData.attributes = { layerIndex };
  mesh.userData.objectId = `object-${layerIndex}`;
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial());
  edge.userData.isEdgeHelper = true;
  mesh.add(edge);
  model.add(mesh);
  return mesh;
});
const viewer = Object.create(ArchitecturalViewer.prototype);
const sameLayerPeer = meshes[0].clone();
sameLayerPeer.userData.objectId = 'object-peer';
model.add(sameLayerPeer);
Object.assign(viewer, {
  content: model, layers: [], originalVisibility: new Map(), selectionEntries: [], mutedMaterials: new Set(),
  elevationEntries: [], selectedObject: null, activeUsages: new Set(['COM', 'EST', 'PRIV', 'VAGAS', 'REP']),
  selectionMode: 'name', hideUnchecked: false, onSelectionChange: () => {}, elevationBase: -Infinity, elevationTop: Infinity,
});
viewer.readLayers(model);
viewer.prepareSelection(model);
viewer.applyVisibilityFilters();
assert.deepEqual(matchingLayers(viewer.getLayers(), 0, 'use').map(layer => layer.index), [0, 1]);
viewer.setSelectionMode('use');
viewer.select(meshes[0]);
assert.deepEqual(viewer.getLayers().map(layer => layer.visible), [true, true, false, false]);
assert.equal(meshes[1].material, viewer.selectionEntries.find(entry => entry.object === meshes[1]).original);
assert.equal(meshes[2].visible, true, 'unchecked objects remain faded by default');
assert.equal(meshes[2].material, viewer.selectionEntries.find(entry => entry.object === meshes[2]).muted);
viewer.setHideUnchecked(true);
assert.equal(meshes[2].visible, false);
assert.equal(viewer.isVisible(meshes[2].children[0]), false, 'edges disappear with their parent');
viewer.setHideUnchecked(false);
assert.equal(meshes[2].visible, true, 'switching off restores faded geometry');
viewer.setSelectionMode('group');
viewer.select(meshes[0]);
assert.deepEqual(viewer.getLayers().map(layer => layer.visible), [true, false, true, false]);
viewer.setSelectionMode('name');
viewer.select(meshes[1]);
assert.deepEqual(viewer.getLayers().map(layer => layer.visible), [false, true, false, false]);
viewer.setAllLayersVisible(false);
assert.equal(meshes.every(mesh => mesh.visible), true);
viewer.setHideUnchecked(true);
assert.equal(meshes.every(mesh => !mesh.visible), true);
viewer.setAllLayersVisible(true);
assert.equal(meshes.every(mesh => mesh.visible), true);
viewer.setLayersChecked([0, 2], false);
assert.deepEqual(meshes.map(mesh => mesh.visible), [false, true, false, true]);
viewer.setActiveUsages(new Set(['PRIV']));
assert.equal(meshes[1].visible, true, 'usage falls back to the layer suffix without CSV');
assert.equal(meshes[3].visible, false);
viewer.elevationEntries = [{ object: meshes[1], originalVisible: true, elevation: 10 }];
viewer.setElevationRange(0, 5);
assert.equal(meshes[1].visible, false, 'elevation filtering remains effective');
viewer.setHideUnchecked(false);
assert.equal(meshes[1].visible, false, 'fading does not override elevation filtering');
viewer.setElevationRange(0, 15);
assert.equal(meshes[1].visible, true);
console.log('Selection tests passed: parsing, modes, checkboxes, fading, visibility, edges, usage and elevation.');

const { summarizeSelection } = await import(await moduleUrl(resolve(root, 'src/data/selectionTotals.ts')));
const { DEFAULT_USAGES } = await import(await moduleUrl(resolve(root, 'src/types/model.ts')));
assert.equal(DEFAULT_USAGES.includes('REP'), false);
const summaryModel = new THREE.Group();
summaryModel.userData.layers = ['00-res-PRIV', '00-circ-COM', '00-est-EST', '00-vagas-VAGAS', 'REP-context-COM', '01-res-PRIV', '00-rep-REP'].map(name => ({ name }));
const summaryMeshes = summaryModel.userData.layers.map((_, layerIndex) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  mesh.userData.attributes = { layerIndex };
  mesh.userData.objectId = `summary-${layerIndex}`;
  summaryModel.add(mesh);
  return mesh;
});
// Several meshes belonging to the same Rhino object must not multiply its area.
const duplicate = summaryMeshes[0].clone();
summaryModel.add(duplicate);
const summaryViewer = Object.create(ArchitecturalViewer.prototype);
Object.assign(summaryViewer, {
  content: summaryModel, layers: [], originalVisibility: new Map(), selectionEntries: [], mutedMaterials: new Set(),
  elevationEntries: [], selectedObject: null, activeUsages: new Set(DEFAULT_USAGES),
  selectionMode: 'name', hideUnchecked: false, onSelectionChange: () => {}, elevationBase: -Infinity, elevationTop: Infinity,
});
const records = new Map([100, 20, 50, 99999, 5000, 200, 9000].map((areaM2, index) => [`summary-${index}`, {
  id: `summary-${index}`, areaM2, use: index === 3 ? 'VAGAS' : 'PRIV', elevationM: 0,
}]));
summaryViewer.readLayers(summaryModel);
summaryViewer.prepareSelection(summaryModel, records);
summaryViewer.applyVisibilityFilters();
assert.equal(summaryViewer.getLayers()[4].visible, false, 'REP group starts unchecked even when its use is COM');
assert.equal(summaryViewer.getLayers()[6].visible, false, 'REP usage also starts unchecked');
assert.equal(summaryMeshes[4].visible, false, 'REP group starts hidden even when hide-unchecked is off');
assert.equal(summaryMeshes[6].visible, false, 'REP usage never appears as faded context');
let totals = summarizeSelection(summaryViewer.getMarkedObjects(), records);
assert.equal(totals.byUse.COM.areaM2, 20, 'faded REP group does not contribute to common area');
assert.equal(totals.areaM2, 370, 'only privative, common and parking areas enter the sum');
assert.equal(totals.byUse.VAGAS.count, 1);
assert.equal(totals.byUse.VAGAS.areaM2, 0, 'parking-space area never enters the sum');
assert.equal(totals.byUse.REP.count, 0);
summaryViewer.setSelectionMode('group');
summaryViewer.select(summaryMeshes[0]);
totals = summarizeSelection(summaryViewer.getMarkedObjects(), records);
assert.equal(totals.byUse.PRIV.areaM2, 100, 'other groups and duplicate meshes are excluded');
assert.equal(totals.byUse.COM.areaM2, 20, 'layer usage takes precedence over inconsistent CSV usage');
assert.equal(totals.byUse.EST.areaM2, 50);
assert.equal(totals.byUse.VAGAS.count, 1);
assert.equal(totals.areaM2, 170);
summaryViewer.setHideUnchecked(true);
assert.deepEqual(summarizeSelection(summaryViewer.getMarkedObjects(), records), totals, 'hiding the unmarked context does not change totals');
summaryViewer.setSelectionMode('use');
summaryViewer.select(summaryMeshes[2]);
totals = summarizeSelection(summaryViewer.getMarkedObjects(), records);
assert.equal(totals.areaM2, 50);
assert.equal(totals.byUse.PRIV.count, 0);
summaryViewer.setAllLayersVisible(false);
assert.equal(summarizeSelection(summaryViewer.getMarkedObjects(), records).areaM2, 0);
summaryViewer.setSelectionMode('name');
summaryViewer.setLayersChecked([4], true);
assert.equal(summarizeSelection(summaryViewer.getMarkedObjects(), records).byUse.COM.areaM2, 5000, 'REP group can be included manually');
summaryViewer.setLayersChecked([6], true);
assert.equal(summaryViewer.getActiveUsages().has('REP'), true, 'checking REP synchronizes the usage filter');
summaryViewer.setActiveUsages(new Set(DEFAULT_USAGES));
assert.equal(summaryViewer.getLayers()[6].visible, false, 'switching REP off synchronizes its layer');
summaryViewer.setAllLayersVisible(true);
summaryViewer.elevationEntries = [{ object: summaryMeshes[2], originalVisible: true, elevation: 10 }];
summaryViewer.setElevationRange(0, 5);
assert.equal(summarizeSelection(summaryViewer.getMarkedObjects(), records).byUse.EST.areaM2, 0, 'totals respect the elevation range');
const missing = summarizeSelection(new Map([
  ['missing', { use: 'PRIV', layerName: '00-res-PRIV' }],
  ['space', { use: 'VAGAS', layerName: '00-vagas-VAGAS' }],
]), new Map());
assert.equal(missing.missingAreaCount, 1);
assert.equal(missing.byUse.VAGAS.count, 1, 'spaces can be counted from the model without area data');
assert.equal(missing.areaM2, 0);
console.log('Summary tests passed: REP defaults, selected areas, groups, uses, deduplication, spaces, missing data and elevation.');

let selectedCategory = null;
summaryViewer.onSelectionChange = selection => { selectedCategory = selection; };
summaryViewer.setElevationRange(0, 15);
summaryViewer.setHideUnchecked(false);
summaryViewer.setSelectionMode('use');
summaryViewer.select(summaryMeshes[0]);
assert.equal(selectedCategory.mode, 'use');
assert.equal(selectedCategory.id, null, 'use selection never exposes the clicked object as an individual selection');
assert.equal(summaryViewer.getLayers()[5].visible, true, 'same usage is selected across groups');
summaryViewer.setLayerVisible(0, false);
assert.equal(summaryViewer.getLayers()[5].visible, false, 'a per-layer action still affects the entire usage in use mode');
summaryViewer.setLayerVisible(5, true);
assert.equal(summaryViewer.getLayers()[0].visible, true);
summaryViewer.setActiveUsages(new Set(['PRIV']));
summaryViewer.setSelectionMode('group');
summaryViewer.select(summaryMeshes[0]);
assert.equal(selectedCategory.mode, 'group');
assert.equal(selectedCategory.id, null, 'group selection never exposes individual object data');
assert.equal(summaryViewer.getMarkedObjects().has('summary-1'), true, 'a complete group includes common use despite a prior usage filter');
assert.equal(summaryViewer.getMarkedObjects().has('summary-2'), true, 'a complete group includes parking use');
summaryViewer.setActiveUsages(new Set(['PRIV']));
assert.equal(summaryViewer.getMarkedObjects().has('summary-1'), true, 'usage filtering cannot split a group while in group mode');
summaryViewer.setLayerVisible(0, false);
for (const index of [0, 1, 2, 3, 6]) assert.equal(summaryViewer.getLayers()[index].visible, false, 'group checkbox acts on every member');
summaryViewer.setLayerVisible(2, true);
for (const index of [0, 1, 2, 3, 6]) assert.equal(summaryViewer.getLayers()[index].visible, true);
summaryViewer.setSelectionMode('name');
summaryViewer.select(summaryMeshes[0]);
assert.equal(selectedCategory.id, 'summary-0', 'individual object details remain available in name mode');
for (const index of [4, 6]) {
  summaryViewer.setLayersChecked([index], true);
  const entry = summaryViewer.selectionEntries.find(item => item.object === summaryMeshes[index]);
  assert.equal(summaryMeshes[index].visible, true);
  assert.equal(summaryMeshes[index].material, entry.original, 'REP uses its original appearance when enabled');
  summaryViewer.setLayersChecked([index], false);
  assert.equal(summaryMeshes[index].visible, false);
  assert.equal(summaryMeshes[index].material, entry.original, 'REP is hidden instead of receiving a faded material');
  summaryViewer.setHideUnchecked(true);
  summaryViewer.setHideUnchecked(false);
  assert.equal(summaryMeshes[index].visible, false, 'turning off hide-unchecked cannot reveal disabled REP');
}
viewer.setSelectionMode('group');
viewer.select(meshes[3]);
assert.equal(viewer.selectedObject, null, 'unclassified objects cannot fall back to individual selection in group mode');
viewer.setSelectionMode('use');
viewer.select(meshes[3]);
assert.equal(viewer.selectedObject, null, 'unclassified objects cannot fall back to individual selection in use mode');
console.log('Mode restriction and REP visibility tests passed.');

viewer.setSelectionMode('name');
viewer.setAllLayersVisible(true);
viewer.setHideUnchecked(false);
viewer.select(meshes[0]);
const selectedEntry = viewer.selectionEntries.find(entry => entry.object === meshes[0]);
const peerEntry = viewer.selectionEntries.find(entry => entry.object === sameLayerPeer);
assert.equal(meshes[0].material, selectedEntry.original, 'name mode highlights the clicked Rhino object');
assert.equal(sameLayerPeer.material, peerEntry.muted, 'a different object on the very same layer must fade');
assert.equal(sameLayerPeer.visible, true, 'unselected peers remain visible as faded context');
assert.equal(meshes[0].children[0].material, viewer.selectionEntries.find(entry => entry.object === meshes[0].children[0]).original, 'selected object edges remain highlighted');
assert.equal(sameLayerPeer.children[0].material, viewer.selectionEntries.find(entry => entry.object === sameLayerPeer.children[0]).muted, 'peer edges fade together with their object');
assert.deepEqual([...viewer.getMarkedObjects().keys()], ['object-0'], 'individual totals exclude all other objects on the selected layer');
viewer.setHideUnchecked(true);
assert.equal(sameLayerPeer.visible, false, 'hide unchecked also hides unselected peers of the same layer');
viewer.setHideUnchecked(false);
viewer.select(sameLayerPeer);
assert.equal(meshes[0].material, selectedEntry.muted, 'a second click moves the highlight to the new object');
assert.equal(sameLayerPeer.material, peerEntry.original);
viewer.clearSelection();
assert.equal(meshes[0].material, selectedEntry.original, 'clearing individual selection restores the checked layer');
assert.equal(sameLayerPeer.material, peerEntry.original);
viewer.setLayerVisible(0, true);
assert.equal(meshes[0].material, selectedEntry.original, 'sidebar layer checkboxes still affect the entire layer');
assert.equal(sameLayerPeer.material, peerEntry.original);
viewer.setSelectionMode('use');
viewer.select(meshes[0]);
assert.equal(sameLayerPeer.material, peerEntry.original, 'use mode still highlights every matching object');
viewer.setSelectionMode('group');
viewer.select(meshes[0]);
assert.equal(sameLayerPeer.material, peerEntry.original, 'group mode still highlights every matching object');
summaryViewer.setSelectionMode('name');
summaryViewer.select(summaryMeshes[0]);
assert.equal(duplicate.material, summaryViewer.selectionEntries.find(entry => entry.object === duplicate).original, 'all meshes with the same Rhino GUID form one individual object');
console.log('Individual 3D selection tests passed: same-layer peers, edges, GUIDs, totals, clearing and grouped modes.');

const exclusionRows = [
  ['covered-private', 'PRIV', '00-Res-PRIV', 100],
  ['uncovered-private', 'PRIV', '00-Res_desc-priv', 20],
  ['covered-common', 'COM', '00-circ-COM', 50],
  ['uncovered-common', 'COM', '00-CIRC_DESC-COM', 10],
  ['parking', 'EST', '00-est-EST', 80],
  ['uncovered-parking', 'EST', '00-est_desc-EST', 30],
  ['parking-space', 'VAGAS', '00-est_vagas-VAGAS', 9999],
];
const exclusionObjects = new Map(exclusionRows.map(([id, use, layerName]) => [id, { use, layerName }]));
const exclusionRecords = new Map(exclusionRows.map(([id, use, , areaM2]) => [id, { id, use, areaM2, elevationM: 0 }]));
const fullTotals = summarizeSelection(exclusionObjects, exclusionRecords);
assert.equal(fullTotals.areaM2, 290);
assert.equal(fullTotals.efficiencyRatio, 120 / 290);
const withoutUncovered = summarizeSelection(exclusionObjects, exclusionRecords, { excludeUncovered: true });
assert.equal(withoutUncovered.byUse.PRIV.areaM2, 100, 'DESC detection ignores case');
assert.equal(withoutUncovered.byUse.COM.areaM2, 50);
assert.equal(withoutUncovered.byUse.EST.areaM2, 80, 'uncovered parking is excluded by DESC too');
assert.equal(withoutUncovered.areaM2, 230);
assert.equal(withoutUncovered.efficiencyRatio, 100 / 230, 'efficiency uses the filtered private and total areas');
const withoutParking = summarizeSelection(exclusionObjects, exclusionRecords, { excludeParking: true });
assert.equal(withoutParking.byUse.EST.areaM2, 0);
assert.equal(withoutParking.byUse.PRIV.areaM2, 120);
assert.equal(withoutParking.areaM2, 180);
assert.equal(withoutParking.efficiencyRatio, 120 / 180);
assert.equal(withoutParking.byUse.VAGAS.count, 1, 'excluding parking area preserves the space count');
const withoutBoth = summarizeSelection(exclusionObjects, exclusionRecords, { excludeUncovered: true, excludeParking: true });
assert.equal(withoutBoth.areaM2, 150, 'overlapping exclusions do not subtract the same area twice');
assert.equal(withoutBoth.efficiencyRatio, 100 / 150);
assert.equal(withoutBoth.byUse.VAGAS.count, 1);
assert.equal(withoutBoth.objectCount, fullTotals.objectCount, 'area filters do not unmark objects');
assert.deepEqual(summarizeSelection(exclusionObjects, exclusionRecords), fullTotals, 'switching filters off restores all areas');
const excludedMissing = summarizeSelection(new Map([
  ['missing', { use: 'PRIV', layerName: '00-res_DESC-PRIV' }],
]), new Map(), { excludeUncovered: true });
assert.equal(excludedMissing.missingAreaCount, 0, 'excluded areas need not contribute a missing-data warning');
summaryViewer.setSelectionMode('group');
summaryViewer.layers[1].name = '00-circ_desc-COM';
summaryViewer.select(summaryMeshes[0]);
const beforeExclusions = summaryViewer.getLayers();
const beforeMaterials = summaryMeshes.map(mesh => mesh.material);
const groupedFiltered = summarizeSelection(summaryViewer.getMarkedObjects(), records, { excludeUncovered: true, excludeParking: true });
assert.equal(groupedFiltered.areaM2, 100, 'the viewer supplies the selected layer names to the summary');
assert.equal(groupedFiltered.byUse.VAGAS.count, 1);
assert.deepEqual(summaryViewer.getLayers(), beforeExclusions);
assert.deepEqual(summaryMeshes.map(mesh => mesh.material), beforeMaterials, 'exclusions do not change the 3D appearance');
console.log('Area-exclusion tests passed: DESC, EST, independent switches, overlaps, restoration, spaces and unchanged selection.');
assert.equal(summarizeSelection(new Map(), new Map()).efficiencyRatio, null, 'empty selection has no efficiency instead of division by zero');
assert.equal(missing.efficiencyRatio, null, 'no area data has no efficiency');
assert.equal(groupedFiltered.efficiencyRatio, 1, 'an exclusively private area has 100 percent efficiency');
const onlyCommon = summarizeSelection(new Map([['common', { use: 'COM', layerName: '00-circ-COM' }]]),
  new Map([['common', { id: 'common', use: 'COM', areaM2: 50, elevationM: 0 }]]));
assert.equal(onlyCommon.efficiencyRatio, 0, 'a nonzero total without private area has zero percent efficiency');
console.log('Efficiency tests passed: filtered totals, empty selection, missing data, zero and 100 percent.');

// Actual Three.js cameras and OrbitControls, with event targets instead of a WebGL canvas.
const eventTarget = { addEventListener() {}, removeEventListener() {} };
const canvas = { ...eventTarget, style: {}, ownerDocument: eventTarget, getRootNode: () => eventTarget };
Object.assign(viewer, {
  perspectiveCamera: new THREE.PerspectiveCamera(45, 1.5, 0.1, 2000),
  orthographicCamera: new THREE.OrthographicCamera(-15, 15, 10, -10, 0.1, 2000),
  renderer: { domElement: canvas, setSize() {} },
  container: { clientWidth: 1200, clientHeight: 800 },
  viewLabel: 'PERSPECTIVA', projectionMode: 'perspective', lastViewState: '', onViewStateChange() {},
});
viewer.camera = viewer.perspectiveCamera;
viewer.camera.position.set(100, 80, 40);
viewer.controls = viewer.createControls(viewer.camera);
viewer.controls.target.set(1, 2, 3);
viewer.controls.update();
viewer.setSelectionMode('group');
viewer.select(meshes[0]);
viewer.setElevationRange(0, 15);
viewer.setHideUnchecked(true);
const savedView = viewer.captureState();
const savedTotals = [...viewer.getMarkedObjects().keys()];
viewer.setSelectionMode('name');
viewer.setAllLayersVisible(false);
viewer.setElevationRange(0, 5);
viewer.setHideUnchecked(false);
viewer.camera.position.set(-50, 100, 120);
viewer.controls.target.set(8, 9, 10);
viewer.restoreState(savedView);
const restoredView = viewer.captureState();
for (const key of ['layers', 'elevation', 'selectionMode', 'activeUsages', 'hideUnchecked', 'selected']) {
  assert.deepEqual(restoredView[key], savedView[key], `restores ${key}`);
}
for (const key of ['position', 'target', 'up']) restoredView.camera[key].forEach((value, index) => assert.ok(Math.abs(value - savedView.camera[key][index]) < 1e-8));
assert.equal(restoredView.camera.projection, 'perspective');
assert.deepEqual([...viewer.getMarkedObjects().keys()], savedTotals);
const savedIndividual = structuredClone(savedView);
savedIndividual.selectionMode = 'name';
savedIndividual.hideUnchecked = false;
viewer.restoreState(savedIndividual);
assert.equal(meshes[0].material, selectedEntry.original);
assert.equal(sameLayerPeer.material, peerEntry.muted, 'saved individual highlights do not become layer-wide');
const savedOrtho = structuredClone(savedView);
Object.assign(savedOrtho.camera, { projection: 'orthographic', position: [0, 100, 0], up: [0, 0, -1], target: [0, 0, 0], zoom: 2, orthographicHeight: 48, label: 'TOPO' });
viewer.restoreState(savedOrtho);
assert.equal(viewer.camera, viewer.orthographicCamera);
assert.equal(viewer.camera.zoom, 2);
assert.equal(viewer.camera.top - viewer.camera.bottom, 48);
assert.equal(viewer.camera.right - viewer.camera.left, 72, 'orthographic width adapts to viewport aspect');
assert.equal(viewer.captureState().camera.label, 'TOPO');
const incompatible = structuredClone(savedView);
incompatible.layers[0].name = 'different-model-layer';
const beforeIncompatible = viewer.captureState();
assert.throws(() => viewer.restoreState(incompatible));
assert.deepEqual(viewer.captureState(), beforeIncompatible, 'incompatible scenes do not alter the current view');

const { SavedSceneStore, isSavedScene, SCENE_COUNT } = await import(await moduleUrl(resolve(root, 'src/data/savedScenes.ts')));
const scene = { version: 1, viewer: savedView, areaExclusions: { excludeUncovered: true, excludeParking: false } };
assert.equal(isSavedScene(scene), true);
const persisted = new Map();
const storage = { getItem: key => persisted.get(key) ?? null, setItem: (key, value) => persisted.set(key, value) };
const scenes = new SavedSceneStore(storage, 'project-A');
assert.equal(scenes.active, null);
assert.throws(() => scenes.update(scene));
assert.equal(scenes.save(0, scene), true);
const nextScene = { ...scene, viewer: savedOrtho };
scenes.save(1, nextScene);
scenes.active = 0;
assert.equal(scenes.update(nextScene), true);
assert.deepEqual(scenes.get(0), nextScene, 'update overwrites the active slot');
assert.deepEqual(scenes.get(1), nextScene, 'updating a slot leaves other slots intact');
const copy = scenes.get(0);
copy.viewer.layers[0].visible = !copy.viewer.layers[0].visible;
assert.deepEqual(scenes.get(0), nextScene, 'saved snapshots are not mutated through retrieved copies');
const reopened = new SavedSceneStore(storage, 'project-A');
assert.deepEqual(reopened.get(0), nextScene, 'scenes survive a page reload');
assert.equal(reopened.active, null, 'reopening does not silently apply a saved scene');
assert.equal(new SavedSceneStore(storage, 'project-B').get(0), null, 'projects have independent scenes');
assert.throws(() => scenes.save(SCENE_COUNT, scene));
storage.setItem('broken', '{bad-json');
assert.equal(new SavedSceneStore(storage, 'broken').get(0), null);
const invalid = structuredClone(scene);
invalid.viewer.camera.zoom = 0;
assert.equal(isSavedScene(invalid), false);
const zeroPosition = structuredClone(scene);
zeroPosition.viewer.camera.position = [...zeroPosition.viewer.camera.target];
assert.equal(isSavedScene(zeroPosition), false);
storage.setItem('mixed', JSON.stringify([invalid, scene]));
assert.equal(new SavedSceneStore(storage, 'mixed').get(0), null);
assert.deepEqual(new SavedSceneStore(storage, 'mixed').get(1), scene, 'one invalid slot does not discard valid slots');
const blockedStore = new SavedSceneStore({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } }, 'blocked');
assert.equal(blockedStore.save(0, scene), false, 'storage failure is reported rather than falsely claiming persistence');
assert.deepEqual(blockedStore.get(0), scene, 'blocked persistence still permits use during the current session');
console.log('Scene tests passed: cameras, projections, layers, elevation, individual selection, updating, persistence, isolation and invalid storage.');

const { collectSimulationLayers, calculateSimulation, emptySimulation, parseSimulationNumber, SimulationStore, simulationLayerLabel, simulationUsageSections } = await import(await moduleUrl(resolve(root, 'src/data/simulation.ts')));
const simulationLayers = collectSimulationLayers(summaryModel, records);
assert.equal(simulationLayers.some(row => row.group === 'REP' || row.use === 'REP'), false);
assert.equal(simulationLayers.find(row => row.use === 'VAGAS').areaM2, 0, 'parking-space layers appear without duplicating parking floor area');
assert.equal(simulationLayers.find(row => row.use === 'PRIV' && row.group === '00').areaM2, 100, 'simulation areas deduplicate Rhino objects');
summaryViewer.setAllLayersVisible(false);
assert.deepEqual(collectSimulationLayers(summaryModel, records), simulationLayers, 'simulation uses full model areas regardless of visibility');
for (const [raw, expected] of [['1.234,56', 1234.56], ['1234,56', 1234.56], ['1234.56', 1234.56], ['1.000', 1000], ['', 0], ['-5', null], ['NaN', null], ['1,234', null]]) {
  assert.equal(parseSimulationNumber(raw), expected);
}
const simRows = [0, 1, 2, 3].map(index => ({ key: `layer-${index}`, name: `0${Math.floor(index / 2)}-RES${index % 2 ? '_DESC' : ''}-PRIV`, group: `0${Math.floor(index / 2)}`, use: 'PRIV', areaM2: 200, missingAreas: 0 }));
const simDraft = emptySimulation(simRows);
Object.assign(simDraft, { land: '60.000,00', grant: '20.000,00', years: '5' });
simRows.forEach(row => { simDraft.costs[row.key] = '100'; simDraft.sales[row.key] = '500'; });
const simResult = calculateSimulation(simRows, simDraft);
assert.equal(simResult.investment, 160000);
assert.equal(simResult.vgv, 400000);
assert.equal(simResult.vgvRatio, 2.5);
assert.equal(simResult.annualRatio, .5);
const excludedDraft = structuredClone(simDraft);
excludedDraft.includedCosts = excludedDraft.includedCosts.filter(key => key !== 'layer-1');
excludedDraft.includedSales = excludedDraft.includedSales.filter(key => key !== 'layer-1');
assert.equal(calculateSimulation(simRows, excludedDraft).investment, 140000);
assert.equal(calculateSimulation(simRows, excludedDraft).vgv, 300000, 'unchecking an uncovered layer removes it from the chosen calculations');
assert.equal(calculateSimulation(simRows, emptySimulation(simRows)).vgvRatio, null);
assert.equal(calculateSimulation(simRows, { ...simDraft, years: '' }).annualRatio, null);
const simStorage = new SimulationStore(storage, 'sim-project', simRows);
for (let index = 0; index < 4; index++) assert.equal(simStorage.save(simDraft).index, index, 'new simulations fill slots in order');
assert.equal(simStorage.full, true);
assert.throws(() => simStorage.save(simDraft));
simStorage.active = 0;
simStorage.save(excludedDraft);
assert.deepEqual(simStorage.get(0), excludedDraft);
assert.deepEqual(simStorage.get(1), simDraft, 'overwriting simulation 1 preserves simulation 2');
assert.deepEqual(new SimulationStore(storage, 'sim-project', simRows).get(0), excludedDraft);
assert.equal(new SimulationStore(storage, 'other-sim-project', simRows).get(0), null);
assert.equal(new SimulationStore(null, 'blocked', simRows).save(simDraft).persistent, false);
console.log('Simulation tests passed: complete model areas, exclusions, user formulas, numeric input, four ordered saves and overwriting.');
assert.equal(simulationLayerLabel('00-C_CLUB_AMEN-COM'), 'C_CLUB_AMEN');
assert.equal(simulationLayerLabel('01-PRIV_DESC-PRIV'), 'PRIV_DESC');
assert.equal(simulationLayerLabel('CALCULO'), 'CALCULO', 'unstructured layer names are preserved');
const usageSections = simulationUsageSections([
  { ...simRows[0], use: 'EST' }, { ...simRows[1], use: 'PRIV' },
  { ...simRows[2], use: 'VAGAS' }, { ...simRows[3], use: 'COM' },
]);
assert.deepEqual(usageSections.map(section => section.label), ['COM · Comum', 'PRIV · Privado', 'EST · Estacionamento']);
assert.equal(usageSections.flatMap(section => section.rows).length, 3);
const oldDraft = structuredClone(simDraft);
oldDraft.costs['old-vagas-layer'] = '123';
oldDraft.includedCosts.push('old-vagas-layer');
const legacy = new SimulationStore(storage, 'legacy-simulation', simRows);
legacy.save(oldDraft);
assert.deepEqual(new SimulationStore(storage, 'legacy-simulation', simRows).get(0), oldDraft, 'display changes keep saved drafts and original layer keys');
console.log('Simulation organization tests passed: readable labels, usage sections, no VAGAS and saved draft preservation.');
