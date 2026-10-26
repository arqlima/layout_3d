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
