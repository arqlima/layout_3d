import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

process.on('uncaughtException', error => {
  console.error(error.stack.split('\n').filter(line => !line.includes('data:')).join('\n'));
  process.exitCode = 1;
});

const root = resolve(import.meta.dirname, '..');
// Keep real module URLs so Node's coverage report can include the TypeScript sources.
registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith('.') && !extname(specifier) ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith('.ts')) return next(url, context);
    return { format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceMap: true }) };
  },
});
const moduleUrl = path => pathToFileURL(path).href;

const { sectionPlane, sectionFromPoints, createCapGeometry } = await import(await moduleUrl(resolve(root, 'src/viewer/sectionGeometry.ts')));
const a = new THREE.Vector3(2, 0, 3);
assert.deepEqual(sectionFromPoints(a, new THREE.Vector3(8, 0, 4)), { axis: 'x', coordinate: 3, side: 1, mode: 'orthographic' });
assert.deepEqual(sectionFromPoints(a, new THREE.Vector3(3, 0, 9)), { axis: 'y', coordinate: 2, side: 1, mode: 'orthographic' });
assert.equal(sectionFromPoints(a, a), null, 'Coincident clicks do not create a cut');
const section = { axis: 'x', coordinate: 0, side: 1, mode: 'orthographic' };
const plane = sectionPlane(section);
assert.ok(plane.distanceToPoint(new THREE.Vector3(0, 0, 1)) > 0);
assert.ok(sectionPlane({ ...section, side: -1 }).distanceToPoint(new THREE.Vector3(0, 0, 1)) < 0);

function area(geometry) {
  const positions = geometry.getAttribute('position');
  let result = 0;
  for (let i = 0; i < positions.count; i += 3) {
    const vertices = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(positions, i + offset));
    result += vertices[1].sub(vertices[0]).cross(vertices[2].sub(vertices[0])).length() / 2;
  }
  return result;
}
const box = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 8));
box.updateMatrixWorld(true);
let result = createCapGeometry(box, plane);
assert.equal(result.open, false);
assert.ok(result.geometry);
assert.ok(Math.abs(area(result.geometry) - 24) < 1e-5, 'A box produces its actual section area');
assert.equal(createCapGeometry(box, new THREE.Plane(new THREE.Vector3(0, 0, 1), -20)).geometry, null);
assert.equal(createCapGeometry(box, new THREE.Plane(new THREE.Vector3(0, 0, 1), -4)).geometry, null, 'Tangency needs no cap');
box.position.set(12, 5, 0);
box.scale.set(2, 3, 1);
box.updateMatrixWorld(true);
result = createCapGeometry(box, plane);
assert.ok(Math.abs(area(result.geometry) - 24) < 1e-5, 'Caps are returned in mesh local coordinates');

// A hollow extrusion must retain its opening, including under model transforms.
const shape = new THREE.Shape();
shape.moveTo(-3, -3); shape.lineTo(3, -3); shape.lineTo(3, 3); shape.lineTo(-3, 3); shape.closePath();
const hole = new THREE.Path();
hole.moveTo(-1, -1); hole.lineTo(-1, 1); hole.lineTo(1, 1); hole.lineTo(1, -1); hole.closePath();
shape.holes.push(hole);
const hollow = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false, steps: 1 }));
hollow.updateMatrixWorld(true);
result = createCapGeometry(hollow, new THREE.Plane(new THREE.Vector3(0, 0, 1), -2));
assert.equal(result.open, false);
assert.ok(Math.abs(area(result.geometry) - 32) < 1e-5, 'Voids are holes, not filled polygons');

const open = new THREE.Mesh(new THREE.PlaneGeometry(4, 6));
open.updateMatrixWorld(true);
result = createCapGeometry(open, new THREE.Plane(new THREE.Vector3(1, 0, 0), 0));
assert.equal(result.open, true);
assert.equal(result.geometry, null, 'Open contours are not invented into solids');

const { isSavedScene, SavedSceneStore } = await import(await moduleUrl(resolve(root, 'src/data/savedScenes.ts')));
const saved = {
  version: 1,
  areaExclusions: { excludeUncovered: false, excludeParking: false },
  viewer: { camera: { projection: 'orthographic', position: [0, 0, -10], target: [0, 0, 0], up: [0, 1, 0], zoom: 1, near: .1, far: 500, orthographicHeight: 10, maxDistance: 100, label: 'CORTE' },
    layers: [], elevation: [null, null], selectionMode: 'name', activeUsages: [], hideUnchecked: false, selected: null, section },
};
assert.equal(isSavedScene(saved), true);
for (const invalid of [{ axis: 'z' }, { coordinate: Infinity }, { side: 0 }, { mode: 'invalid' }]) {
  assert.equal(isSavedScene({ ...saved, viewer: { ...saved.viewer, section: { ...section, ...invalid } } }), false);
}
const legacy = structuredClone(saved);
delete legacy.viewer.section;
assert.equal(isSavedScene(legacy), true, 'Existing scenes without cuts stay compatible');
const storage = new Map();
const api = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
new SavedSceneStore(api, 'test').save(0, saved);
assert.deepEqual(new SavedSceneStore(api, 'test').get(0).viewer.section, section);
console.log('Section tests passed: axis locking, side inversion, cap area, transforms, holes, open meshes and scene persistence.');

// Use the actual viewer methods, cameras and controls without requiring a GPU.
const { ArchitecturalViewer } = await import(await moduleUrl(resolve(root, 'src/viewer/ArchitecturalViewer.ts')));
const target = { addEventListener() {}, removeEventListener() {} };
const canvas = { ...target, style: {}, ownerDocument: target, getRootNode: () => target };
const model = new THREE.Group();
model.userData.layers = [{ name: '00-Paredes-PRIV' }];
const material = new THREE.MeshBasicMaterial({ color: '#c47650' });
const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 8), material);
wall.userData.attributes = { layerIndex: 0 };
wall.userData.objectId = 'wall';
model.add(wall);
const viewer = Object.create(ArchitecturalViewer.prototype);
Object.assign(viewer, {
  content: model, layers: [], originalVisibility: new Map(), selectionEntries: [], mutedMaterials: new Set(), solarMaterials: new Map(),
  elevationEntries: [], selectedObject: null, selectedObjects: null, activeUsages: new Set(['PRIV']),
  selectionMode: 'name', hideUnchecked: false, onSelectionChange() {}, onViewStateChange() {},
  elevationBase: -Infinity, elevationTop: Infinity, section: null, sectionCaps: [],
  perspectiveCamera: new THREE.PerspectiveCamera(45, 1.5, .1, 2000),
  orthographicCamera: new THREE.OrthographicCamera(-15, 15, 10, -10, .1, 2000),
  renderer: { domElement: canvas, setSize() {} }, shadowDepthMaterial: new THREE.MeshDepthMaterial(),
  container: { clientWidth: 1200, clientHeight: 800 }, scene: new THREE.Scene(),
  viewLabel: 'PERSPECTIVA', projectionMode: 'perspective', lastViewState: '',
});
viewer.camera = viewer.perspectiveCamera;
viewer.camera.position.set(20, 15, 25);
viewer.controls = viewer.createControls(viewer.camera);
viewer.sectionTool = { drawing: true };
assert.throws(() => viewer.captureState(), /Conclua ou cancele/, 'An unfinished cut cannot be saved as a scene');
viewer.sectionTool = null;
assert.throws(() => viewer.setSection({ ...section, coordinate: NaN }), /inválido/);
viewer.readLayers(model); viewer.prepareSelection(model); viewer.applyVisibilityFilters();
const originalVertices = wall.geometry.getAttribute('position').array.slice();
const quantities = [...viewer.getMarkedObjects()];
viewer.setSection(section);
assert.equal(viewer.sectionCaps.length, 1);
assert.equal(viewer.controls.enableRotate, false);
assert.equal(viewer.camera, viewer.orthographicCamera);
assert.equal(viewer.sectionCaps[0].parent, wall);
assert.equal(viewer.sectionCaps[0].material[0].color.getHexString(), material.color.getHexString());
assert.equal(material.clipShadows, true);
assert.ok(material.clippingPlanes[0].equals(plane));
assert.deepEqual(wall.geometry.getAttribute('position').array, originalVertices, 'Source geometry is preserved');
assert.deepEqual([...viewer.getMarkedObjects()], quantities, 'Cuts do not change project quantities');
const firstCap = viewer.sectionCaps[0];
viewer.setSection({ ...section, mode: '3d' });
assert.equal(viewer.sectionCaps[0], firstCap, 'Switching view modes reuses cap geometry');
assert.equal(viewer.controls.enableRotate, true);
assert.equal(viewer.camera, viewer.perspectiveCamera);
assert.ok(viewer.sectionCaps[0].geometry.groups.every(group => group.materialIndex < viewer.sectionCaps[0].material.length));
viewer.setSection({ ...section, axis: 'y' });
assert.ok(viewer.sectionCaps[0].geometry.groups.every(group => group.materialIndex < viewer.sectionCaps[0].material.length), 'Single-material meshes cannot reference geometry-group materials that do not exist');
viewer.setSection({ ...section, mode: '3d' });
const snapshot = viewer.captureState();
viewer.setSection({ ...section, side: -1 });
assert.equal(firstCap.parent, null);
viewer.restoreState(snapshot);
assert.deepEqual(viewer.captureState().section, snapshot.section);
viewer.setLayerVisible(0, false);
viewer.setHideUnchecked(true);
assert.equal(viewer.isVisible(viewer.sectionCaps[0]), false, 'Caps inherit filtered source visibility');
viewer.restoreState(snapshot);
const withoutSection = structuredClone(snapshot); delete withoutSection.section;
viewer.restoreState(withoutSection);
assert.equal(viewer.section, null, 'Opening an older scene removes any active section');
assert.equal(viewer.sectionCaps.length, 0);
assert.equal(material.clippingPlanes, null);
assert.equal(viewer.controls.enableRotate, true);
viewer.controls.dispose();
console.log('Section integration tests passed: actual cameras, controls, materials, visibility, quantities, unchanged geometry, mode reuse and legacy restoration.');

class Element {
  style = {}; attributes = {}; children = []; listeners = new Map(); queries = new Map();
  classList = { add() {}, remove() {} };
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) { if (!this.queries.has(selector)) this.queries.set(selector, new Element()); return this.queries.get(selector); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  removeEventListener(name) { this.listeners.delete(name); }
  remove() { this.removed = true; }
  focus() {}
  emit(name, event = {}) { this.listeners.get(name)?.(event); }
}
globalThis.document = { createElement: () => new Element(), createElementNS: () => new Element() };
globalThis.window = new Element();
const { SectionTool } = await import(await moduleUrl(resolve(root, 'src/ui/SectionTool.ts')));
const drawingCanvas = new Element(); drawingCanvas.parentElement = new Element();
drawingCanvas.clientWidth = drawingCanvas.clientHeight = 1000;
drawingCanvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1000 });
const topCamera = new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 100);
topCamera.position.set(0, 10, 0); topCamera.up.set(0, 0, -1); topCamera.lookAt(0, 0, 0); topCamera.updateMatrixWorld(true);
const button = new Element(), host = new Element();
let applied = null, begins = 0, cancels = 0;
const tool = new SectionTool(drawingCanvas, host, button, {
  camera: () => topCamera, begin: () => { begins++; }, cancel: () => { cancels++; tool.setState(null); },
  apply: state => { applied = state; tool.setState(state); },
});
const click = (x, y, drag = 0) => {
  const event = { clientX: x, clientY: y, pointerId: 1, button: 0, stopImmediatePropagation() {} };
  drawingCanvas.emit('pointerdown', event);
  drawingCanvas.emit('pointerup', { ...event, clientX: x + drag });
};
button.emit('click');
assert.equal(begins, 1); assert.equal(tool.drawing, true);
click(350, 500, 20); assert.equal(tool.start, null, 'Dragging does not place the line');
click(350, 500); click(650, 520);
assert.equal(applied, null, 'A side must be chosen before applying the cut');
assert.equal(tool.pending.axis, 'x');
assert.equal(tool.negative.hidden, false);
tool.negative.emit('click');
assert.equal(applied.side, -1); assert.equal(tool.drawing, false);
button.emit('click');
window.emit('keydown', { key: 'Escape', preventDefault() {} });
assert.equal(cancels, 1); assert.equal(tool.drawing, false);
button.emit('click'); click(500, 350); click(520, 650); tool.positive.emit('click');
assert.equal(applied.axis, 'y'); assert.equal(applied.side, 1);
const action = name => tool.panel.emit('click', { target: { closest: () => ({ dataset: { action: name } }) } });
action('3d'); assert.equal(applied.mode, '3d');
action('invert'); assert.equal(applied.side, -1);
action('orthographic'); assert.equal(applied.mode, 'orthographic');
tool.setState(applied, 1, 2);
assert.match(tool.hint.textContent, /contorno aberto/);
assert.match(tool.hint.textContent, /instanciados/);
action('reposition'); assert.equal(tool.drawing, true);
action('cancel'); assert.equal(tool.drawing, false);
tool.setState(section); action('clear'); assert.equal(applied, null);
tool.dispose();
assert.equal(drawingCanvas.listeners.size, 0); assert.equal(button.listeners.size, 0);
assert.equal(tool.overlay.removed, true); assert.equal(tool.panel.removed, true);
console.log('Section interaction tests passed: two clicks, drag rejection, explicit side arrows, X/Y, Escape and disposal.');

// Optional read-only validation against an existing local Rhino file. No model is written.
if (process.argv[2]) {
  const { default: rhino3dm } = await import('rhino3dm');
  const rhino = await rhino3dm();
  const doc = rhino.File3dm.fromByteArray(new Uint8Array(await readFile(resolve(process.argv[2]))));
  const group = new THREE.Group(); group.rotation.x = -Math.PI / 2;
  const loader = new THREE.BufferGeometryLoader();
  for (let i = 0; i < doc.objects().count; i++) {
    const object = doc.objects().get(i), geo = object.geometry();
    let mesh = null;
    if (geo instanceof rhino.Mesh) mesh = geo;
    else if (geo instanceof rhino.Brep) {
      mesh = new rhino.Mesh(); const faces = geo.faces();
      for (let j = 0; j < faces.count; j++) {
        const face = faces.get(j), faceMesh = face.getMesh(rhino.MeshType.Any);
        if (faceMesh) { mesh.append(faceMesh); faceMesh.delete(); } face.delete();
      }
      faces.delete();
    } else if (geo instanceof rhino.Extrusion) mesh = geo.getMesh(rhino.MeshType.Any);
    if (mesh?.faces().count) {
      const converted = new THREE.Mesh(loader.parse(mesh.toThreejsJSON()));
      converted.userData.attributes = { layerIndex: object.attributes().layerIndex };
      group.add(converted);
    }
    if (mesh && mesh !== geo) mesh.delete(); geo.delete(); object.delete();
  }
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group), center = bounds.getCenter(new THREE.Vector3());
  group.position.set(-center.x, -bounds.min.y, -center.z); group.updateMatrixWorld(true);
  const summary = [];
  for (const axis of ['x', 'y']) {
    let caps = 0, open = 0;
    const started = performance.now();
    for (const mesh of group.children) {
      const result = createCapGeometry(mesh, sectionPlane({ ...section, axis }));
      if (result.geometry) { caps++; result.geometry.dispose(); }
      if (result.open) open++;
    }
    summary.push({ axis, caps, open, milliseconds: Math.round(performance.now() - started) });
  }
  group.children.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); }); doc.delete();
  assert.ok(summary.some(result => result.caps > 0), 'The real model must produce filled sections');
  console.log('Local Rhino model section validation:', JSON.stringify({ meshes: group.children.length, summary }));
}
