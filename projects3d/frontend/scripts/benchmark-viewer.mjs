// Local synthetic scenes only: no database, uploads or browser user profile are read.
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const browserPath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = await mkdtemp(resolve(tmpdir(), 'layout3d-benchmark-'));
let rhinoFixture;
if (process.argv.includes('--stage3')) {
  const { default: rhino3dm } = await import('rhino3dm');
  const rhino = await rhino3dm();
  const document = new rhino.File3dm();
  const layer = new rhino.Layer(); layer.name = '00-Synthetic-PRIV';
  const layerIndex = document.layers().add(layer);
  const mesh = new rhino.Mesh();
  for (const vertex of [[0,0,0], [2,0,0], [2,2,0], [0,2,0], [0,0,2], [2,0,2], [2,2,2], [0,2,2]]) mesh.vertices().add(...vertex);
  for (const face of [[0,3,2,1], [4,5,6,7], [0,1,5,4], [3,7,6,2], [0,4,7,3], [1,2,6,5]]) mesh.faces().addQuadFace(...face);
  mesh.normals().computeNormals();
  const attributes = new rhino.ObjectAttributes(); attributes.layerIndex = layerIndex;
  document.objects().addMesh(mesh, attributes);
  rhinoFixture = Buffer.from(document.toByteArray());
  attributes.delete(); mesh.delete(); layer.delete(); document.delete();
}
const page = `<!doctype html><html><body style="margin:0"><div id="viewport" style="width:960px;height:640px"></div>
<script type="module">
import * as THREE from 'three';
import { ArchitecturalViewer } from '/src/viewer/ArchitecturalViewer.ts';
import { snapVertex } from '/src/viewer/measurement.ts';
import { disposeObjectResources } from '/src/viewer/disposeResources.ts';
import { loadRhinoModel, prepareRhinoEdges } from '/src/viewer/rhinoModel.ts';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
window.measureScene = async count => {
  const started = performance.now();
  const viewer = new ArchitecturalViewer(document.getElementById('viewport'));
  let frames = 0, shadowDraws = 0, renderMs = 0;
  const render = viewer.renderer.render.bind(viewer.renderer);
  viewer.renderer.render = (...args) => { const t = performance.now(); frames++; render(...args); renderMs += performance.now() - t; };
  const model = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const material = new THREE.MeshStandardMaterial({ color: '#d2b48c', roughness: .85 });
  for (let index = 0; index < count; index++) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((index % 32) * 2, 1, Math.floor(index / 32) * 2);
    mesh.onBeforeShadow = () => shadowDraws++;
    model.add(mesh);
  }
  viewer.setContent(model);
  await nextFrame(); await nextFrame();
  const firstViewMs = performance.now() - started;
  await wait(1500);
  const sample = async action => {
    const before = { frames, shadowDraws, renderMs, time: performance.now() };
    await action();
    return { frames: frames - before.frames, shadowDraws: shadowDraws - before.shadowDraws,
      renderSubmissionMs: +(renderMs - before.renderMs).toFixed(2), elapsedMs: +(performance.now() - before.time).toFixed(2) };
  };
  const idle = await sample(() => wait(2000));
  const orbit = await sample(async () => {
    for (let index = 0; index < 30; index++) {
      viewer.controls._sphericalDelta.theta += .015;
      viewer.controls.update(); await nextFrame();
    }
    await wait(1000);
  });
  const background = await sample(async () => { viewer.setBackgroundColor('#aabbcc'); await wait(150); });
  const appearance = await sample(async () => { viewer.setAreaExclusions({ excludeParking: true }); await wait(150); });
  const hidden = await sample(async () => { viewer.setActive(false); await wait(500); });
  viewer.setActive(true); await wait(250);
  const idleAfterResume = await sample(() => wait(500));
  const context = viewer.renderer.getContext();
  const extension = context.getExtension('WEBGL_debug_renderer_info');
  const gpu = extension ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable';
  const measurementStart = performance.now();
  for (let i = 0; i < 30; i++) snapVertex(new THREE.Raycaster(), model.children, viewer.camera, 480 + i % 5, 320, 960, 640);
  const measurement30PicksMs = +(performance.now() - measurementStart).toFixed(2);
  viewer.setSolarSettings({ exposure: .8, shadowIntensity: 80, sunIntensity: 120, latitude: -20,
    longitude: -54, utcOffset: -4, date: '2026-11-11', minutes: 720, northAngle: 0 });
  await wait(100);
  const annualStart = performance.now();
  const annual = await viewer.calculateAnnualExposure(() => {});
  const annualExposureMs = +(performance.now() - annualStart).toFixed(2);
  const result = { objects: count, triangles: count * 12, firstViewMs: +firstViewMs.toFixed(2), gpu,
    idle, orbit, background, appearance, hidden, idleAfterResume,
    measurement30PicksMs, annualExposureMs, annualSamples: annual.points };
  viewer.dispose();
  return result;
};
window.benchmarkReady = true;
window.verifyViewer = async () => {
  const check = (condition, label) => { if (!condition) throw new Error(label); };
  const viewer = new ArchitecturalViewer(document.getElementById('viewport'));
  viewer.controls.enableDamping = false;
  const model = new THREE.Group();
  model.userData.layers = [{ name: '00-Box-PRIV' }, { name: '01-Box-COM' }];
  const records = new Map();
  let frames = 0, shadowDraws = 0;
  const render = viewer.renderer.render.bind(viewer.renderer);
  viewer.renderer.render = (...args) => { frames++; render(...args); };
  for (let i = 0; i < 2; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: '#ccaa88' }));
    mesh.position.set(i * 3, 1 + i * 3, 0);
    mesh.userData.attributes = { layerIndex: i };
    mesh.userData.objectId = mesh.uuid;
    mesh.onBeforeShadow = () => shadowDraws++;
    records.set(mesh.uuid, { id: mesh.uuid, areaM2: 4, elevationM: i * 3, use: i ? 'COM' : 'PRIV' });
    model.add(mesh);
  }
  viewer.setContent(model, records); await wait(200);
  const checks = [];
  const edit = async (label, action, shadow) => {
    frames = shadowDraws = 0;
    await action(); await wait(180);
    check(frames > 0, label + ': missing render');
    check(shadow ? shadowDraws > 0 : shadowDraws === 0, label + ': shadow cache');
    checks.push(label);
  };
  await edit('background', () => viewer.setBackgroundColor('#aabbcc'), false);
  await edit('camera', () => viewer.setStandardView('front'), false);
  viewer.controls.enableDamping = false;
  await edit('model color', () => viewer.setModelAppearance({ overrideColor: true, color: '#ff0000', overrideEdges: false, edgeColor: '#000000' }), false);
  const solar = { exposure: .8, shadowIntensity: 80, sunIntensity: 120, latitude: -20,
    longitude: -54, utcOffset: -4, date: '2026-11-11', minutes: 720, northAngle: 0 };
  await edit('sun direction', () => viewer.setSolarSettings(solar), true);
  await edit('exposure only', () => viewer.setSolarSettings({ ...solar, exposure: 1.2 }), false);
  await edit('solar path', () => viewer.setSolarPathVisible(true), false);
  await edit('path scale', () => viewer.setSolarPathScale(75), false);
  await edit('path opacity', () => viewer.setSolarPathOpacity(40), false);
  await edit('hide layer', () => viewer.setLayerVisible(1, false), true);
  await edit('restore layer', () => viewer.setLayerVisible(1, true), true);
  await edit('elevation', () => viewer.setElevationRange(0, 0), true);
  await edit('restore elevation', () => viewer.setElevationRange(0, 3), true);
  const state = viewer.captureState();
  await edit('section', () => viewer.setSection({ axis: 'x', coordinate: 0, side: 1, mode: 'orthographic' }, false), true);
  await edit('section lines', () => viewer.setSectionLineSettings({ visible: true, color: '#ff0000', width: 2 }), false);
  await edit('restore scene', () => viewer.restoreState(state), true);
  viewer.controls.enableDamping = false; viewer.controls.update(); await wait(200);
  const exported = await viewer.exportImage({ longestEdge: 1024, transparent: false });
  check(exported.blob.size > 0, 'PNG export'); await wait(200); checks.push('PNG export');
  await edit('annual map', () => viewer.calculateAnnualExposure(() => {}), false);
  await edit('hide annual map', () => viewer.setAnnualExposureVisible(false), false);
  frames = 0; await wait(250); check(frames === 0, 'idle after edits'); checks.push('idle after edits');
  viewer.dispose(); await wait(100);
  return checks;
};
window.verifyStage3 = async () => {
  const check = (condition, label) => { if (!condition) throw new Error(label); };
  const model = await loadRhinoModel('/stage3-fixture.3dm', '/vendor/rhino3dm/', { withEdges: false });
  const meshes = [];
  model.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
  check(meshes.length === 1 && meshes[0].userData.objectId, 'Rhino source geometry and GUID');
  check(meshes[0].children.length === 0, 'Deferred Rhino edges');
  await prepareRhinoEdges(model);
  await prepareRhinoEdges(model);
  check(meshes[0].children.length === 1 && meshes[0].children[0].userData.isEdgeHelper, 'Rhino edges exactly once');
  const immediate = await loadRhinoModel('/stage3-fixture.3dm', '/vendor/rhino3dm/');
  let edgeCount = 0;
  immediate.traverse(object => { if (object.userData.isEdgeHelper) edgeCount++; });
  check(edgeCount === 1, 'Existing loader callers include edges');
  disposeObjectResources(immediate);
  const viewer = new ArchitecturalViewer(document.getElementById('viewport'));
  const demo = new THREE.Group();
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.needsUpdate = true;
  const demoMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture }));
  demo.add(demoMesh);
  let geometryDisposals = 0, textureDisposals = 0, sharedDisposals = 0;
  demoMesh.geometry.addEventListener('dispose', () => geometryDisposals++);
  texture.addEventListener('dispose', () => textureDisposals++);
  meshes[0].geometry.addEventListener('dispose', () => sharedDisposals++);
  viewer.setContent(demo); await wait(200);
  viewer.setContent(model, undefined, { ownsResources: false }); await wait(200);
  check(geometryDisposals === 1 && textureDisposals === 1, 'Owned scene resources released on replacement');
  const originalMaterial = meshes[0].material;
  viewer.setModelAppearance({ overrideColor: true, color: '#ff0000', overrideEdges: false, edgeColor: '#000000' });
  viewer.setSection({ axis: 'x', coordinate: 0, side: 1, mode: 'orthographic' }, false);
  await wait(200); viewer.dispose(); await wait(100);
  check(viewer.renderer.getContext().isContextLost(), 'Disposed renderer releases its WebGL context');
  check(sharedDisposals === 0 && meshes[0].material === originalMaterial, 'Borrowed model survives viewer disposal');
  check(meshes[0].customDepthMaterial === undefined && meshes[0].children.length === 1, 'Viewer depth material and caps released');
  const remounted = new ArchitecturalViewer(document.getElementById('viewport'));
  remounted.setContent(model, undefined, { ownsResources: false }); await wait(200);
  check(meshes[0].customDepthMaterial === remounted.shadowDepthMaterial, 'Remounted shadows use the new viewer');
  remounted.dispose(); disposeObjectResources(model);
  check(sharedDisposals === 1, 'Shared geometry released only by its owner');
  return ['Rhino lazy edges', 'Rhino default loader', 'GUID preservation', 'owned replacement', 'shared disposal', 'WebGL context release', 'remount and shadows'];
};
</script></body></html>`;

const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'restore-reference-source', enforce: 'pre', load(id) {
    if (!process.argv.includes('--reference')) return null;
    const relative = id.replaceAll('\\', '/').split('/projects3d/frontend/')[1];
    if (!['src/viewer/ArchitecturalViewer.ts', 'src/viewer/exportImage.ts'].includes(relative)) return null;
    return execFileSync('git', ['show', 'pre-optimization-2026-11-11:projects3d/frontend/' + relative], { cwd: root, encoding: 'utf8', windowsHide: true });
  } }, { name: 'local-benchmark', configureServer(server) {
    server.middlewares.use('/stage3-fixture.3dm', (_request, response) => {
      if (!rhinoFixture) { response.statusCode = 404; response.end(); return; }
      response.setHeader('Content-Type', 'application/octet-stream'); response.end(rhinoFixture);
    });
    server.middlewares.use('/benchmark.html', async (_request, response, next) => {
      try {
        response.setHeader('Content-Type', 'text/html');
        response.end(await server.transformIndexHtml('/benchmark.html', page));
      } catch (error) { next(error); }
    });
  } }] });
let browser;
let socket;
try {
  await server.listen();
  const url = server.resolvedUrls.local[0] + 'benchmark.html';
  browser = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--window-size=1100,800', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 20000);
    browser.once('error', error => { clearTimeout(timer); reject(error); });
    let output = '';
    browser.stderr.on('data', data => {
      output += data;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map(); let id = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const job = pending.get(message.id); pending.delete(message.id);
    clearTimeout(job.timer);
    if (message.error) job.reject(new Error(JSON.stringify(message.error))); else job.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const messageId = ++id;
    const timer = setTimeout(() => { pending.delete(messageId); reject(new Error(method + ' timed out')); }, 120000);
    pending.set(messageId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Page.navigate', { url }, sessionId);
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('window.benchmarkReady === true')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!await evaluate('window.benchmarkReady === true')) throw new Error('Benchmark page failed to initialize');
  const results = [];
  for (const count of [32, 1024]) {
    results.push(await evaluate(`window.measureScene(${count})`));
    console.log(JSON.stringify(results.at(-1)));
  }
  let checks;
  if (process.argv.includes('--verify')) {
    for (const result of results) {
      assert.equal(result.idle.frames, 0, 'Idle view must stop rendering');
      assert.ok(result.orbit.frames > 0, 'Camera motion must render');
      assert.equal(result.orbit.shadowDraws, 0, 'Camera motion reuses shadows');
      assert.equal(result.hidden.frames, 0, 'Hidden view must stop rendering');
      assert.equal(result.idleAfterResume.frames, 0, 'Resumed view settles');
    }
    checks = await evaluate('window.verifyViewer()');
    console.log('Browser integration checks passed: ' + checks.join(', '));
  }
  let stage3Checks;
  if (process.argv.includes('--stage3')) {
    stage3Checks = await evaluate('window.verifyStage3()');
    console.log('Stage 3 browser checks passed: ' + stage3Checks.join(', '));
  }
  if (process.argv[2]) await writeFile(resolve(process.argv[2]), JSON.stringify({ recordedAt: new Date().toISOString(),
    viewport: [960, 640], revision: process.argv.includes('--reference') ? 'pre-optimization-2026-11-11' : 'working-tree',
    note: 'Synthetic scenes; submission timings are CPU-side, not GPU duration or process utilization.', results, checks, stage3Checks }, null, 2));
  await send('Browser.close');
} finally {
  socket?.close(); browser?.kill(); await server.close();
}
