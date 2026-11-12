import assert from 'node:assert/strict';
import './register-typescript.mjs';
import * as THREE from 'three';

const { addMeshEdges } = await import('../src/viewer/meshEdges.ts');
const { disposeObjectResources } = await import('../src/viewer/disposeResources.ts');
const model = new THREE.Group();
const geometry = new THREE.BoxGeometry();
const opaque = new THREE.MeshStandardMaterial();
const transparent = new THREE.MeshStandardMaterial({ opacity: .5, transparent: true });
for (const material of [opaque, transparent, opaque]) model.add(new THREE.Mesh(geometry, material));
const positions = [...geometry.getAttribute('position').array];
const ids = model.children.map(mesh => mesh.uuid);
const first = addMeshEdges(model);
assert.equal(addMeshEdges(model), first, 'Concurrent preparation shares one task');
await first;
const helpers = model.children.map(mesh => mesh.children[0]);
assert.ok(helpers.every(helper => helper.userData.isEdgeHelper));
assert.equal(helpers[0].geometry, helpers[1].geometry, 'Instances share edge buffers');
assert.equal(helpers[0].material, helpers[2].material, 'Equal opacities share edge materials');
assert.equal(helpers[1].material.opacity, .38, 'Preserve original opacity rounding');
assert.equal(helpers[0].geometry.getAttribute('position').count, 24, 'Cube edges exclude coplanar diagonals');
await addMeshEdges(model);
assert.ok(model.children.every(mesh => mesh.children.length === 1), 'No duplicate helpers');
assert.deepEqual([...geometry.getAttribute('position').array], positions);
assert.deepEqual(model.children.map(mesh => mesh.uuid), ids);

const texture = new THREE.Texture();
opaque.map = texture; transparent.alphaMap = texture;
const uniforms = new THREE.ShaderMaterial({ uniforms: { maps: { value: [texture] } } });
model.add(new THREE.Mesh(geometry, uniforms));
const disposed = new Map();
for (const resource of [geometry, helpers[0].geometry, opaque, transparent, helpers[0].material, helpers[1].material, texture, uniforms]) {
  resource.addEventListener('dispose', () => disposed.set(resource, (disposed.get(resource) ?? 0) + 1));
}
const replacement = new THREE.Group();
replacement.add(new THREE.Mesh(geometry, opaque));
disposeObjectResources(model, replacement);
assert.equal(disposed.get(geometry), undefined, 'Keep geometry referenced by replacement');
assert.equal(disposed.get(opaque), undefined);
assert.equal(disposed.get(texture), undefined, 'Keep textures referenced by retained material');
assert.equal(disposed.get(helpers[0].geometry), 1, 'Dispose shared edges exactly once');
assert.equal(disposed.get(transparent), 1);
assert.equal(disposed.get(uniforms), 1);
disposeObjectResources(replacement);
assert.equal(disposed.get(geometry), 1);
assert.equal(disposed.get(opaque), 1);
assert.equal(disposed.get(texture), 1);

const standalone = new THREE.Scene();
const environment = new THREE.Texture();
standalone.background = standalone.environment = environment;
let environmentDisposals = 0;
environment.addEventListener('dispose', () => environmentDisposals++);
disposeObjectResources(standalone);
assert.equal(environmentDisposals, 1);
console.log('Model resource tests passed: shared edges, idempotence, IDs, original geometry, ownership and texture disposal.');
