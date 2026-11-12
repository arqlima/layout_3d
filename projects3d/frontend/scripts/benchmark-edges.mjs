import './register-typescript.mjs';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';

const { addMeshEdges } = await import('../src/viewer/meshEdges.ts');
const source = execFileSync('git', ['show', 'pre-optimization-stage3-2026-11-12:projects3d/frontend/src/viewer/rhinoModel.ts'], { encoding: 'utf8', windowsHide: true });
const start = source.indexOf('function addMeshEdges');
const end = source.indexOf('/** Carrega o modelo', start);
if (start < 0 || end < 0) throw new Error('Original edge function not found in restoration tag');
const baselineCode = `import * as THREE from ${JSON.stringify(import.meta.resolve('three'))};\nexport ${stripTypeScriptTypes(source.slice(start, end))}`;
const baseline = await import(`data:text/javascript;base64,${Buffer.from(baselineCode).toString('base64')}`);
function createModel(count, shared) {
  const model = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial();
  for (let index = 0; index < count; index++) {
    model.add(new THREE.Mesh(shared ? geometry : geometry.clone(), material));
  }
  return model;
}
async function measure(prepare, count, shared) {
  const model = createModel(count, shared);
  let timerTicks = 0;
  const timer = setInterval(() => timerTicks++, 0);
  const started = performance.now();
  await prepare(model);
  const elapsedMs = +(performance.now() - started).toFixed(2);
  clearInterval(timer);
  const geometries = new Set(model.children.map(mesh => mesh.children[0].geometry));
  const edgeBufferBytes = [...geometries].reduce((total, geometry) => total + geometry.getAttribute('position').array.byteLength, 0);
  return { elapsedMs, uniqueEdgeGeometries: geometries.size, edgeBufferBytes, timerTicks };
}
const results = [];
for (const shared of [true, false]) {
  for (const count of [32, 1024]) {
    const before = await measure(baseline.addMeshEdges, count, shared);
    const after = await measure(addMeshEdges, count, shared);
    const result = { count, sharedGeometry: shared, before, after };
    results.push(result);
    console.log(JSON.stringify(result));
  }
}
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify({ recordedAt: new Date().toISOString(), results }, null, 2), { flag: 'wx' });
