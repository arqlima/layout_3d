import * as THREE from 'three';

/** Volumes fictícios. IDs exemplificam a ligação futura com registros JSON. */
export function createDemoScene(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Estudo demonstrativo';

  const plaster = new THREE.MeshStandardMaterial({ color: '#ece9df', roughness: 0.92 });
  const concrete = new THREE.MeshStandardMaterial({ color: '#aeb9b3', roughness: 0.94 });
  const charcoal = new THREE.MeshStandardMaterial({ color: '#263c40', roughness: 0.78 });
  const wood = new THREE.MeshStandardMaterial({ color: '#b47e54', roughness: 0.82 });
  const glass = new THREE.MeshStandardMaterial({ color: '#6f999d', metalness: 0.15, roughness: 0.22, transparent: true, opacity: 0.78 });
  const grass = new THREE.MeshStandardMaterial({ color: '#9caf97', roughness: 1 });
  const leaves = new THREE.MeshStandardMaterial({ color: '#537b64', roughness: 1 });

  function box(name: string, size: [number, number, number], position: [number, number, number], material: THREE.Material, id?: string): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (id) mesh.userData.objectId = id;
    root.add(mesh);
    return mesh;
  }

  box('Base do terreno', [19, 0.25, 15], [0, 0.12, 0], grass, 'demo-terreno');
  box('Plataforma', [14, 0.32, 10], [0, 0.32, 0], concrete, 'demo-plataforma');
  box('Piso', [11.7, 0.12, 7.2], [0, 0.56, 0], plaster, 'demo-piso');
  box('Volume principal', [10.1, 3.65, 5.7], [0, 2.47, -0.4], plaster, 'demo-volume');
  box('Volume lateral', [3.1, 3.65, 2.3], [3.5, 2.47, 3.45], charcoal, 'demo-volume-lateral');
  box('Cobertura em balanço', [12.6, 0.32, 8.2], [0, 4.48, 0], charcoal, 'demo-cobertura');
  box('Faixa superior', [12.1, 0.15, 0.12], [0, 4.16, 4.02], wood);

  // Fachada frontal: grandes planos de vidro e divisões escuras.
  box('Vidro frontal', [6.55, 2.85, 0.09], [-1.55, 2.22, 2.5], glass, 'demo-fachada-vidro');
  box('Soleira frontal', [6.85, 0.13, 0.18], [-1.55, 0.77, 2.56], charcoal);
  for (const x of [-4.78, -2.65, -0.52, 1.61]) {
    box('Montante frontal', [0.075, 2.9, 0.14], [x, 2.23, 2.59], charcoal);
  }
  box('Travessa frontal', [6.6, 0.065, 0.13], [-1.55, 3.05, 2.59], charcoal);

  // Plano envidraçado lateral e ritmo de brises de madeira.
  box('Vidro lateral', [0.09, 2.6, 4.3], [5.1, 2.22, -0.8], glass, 'demo-fachada-lateral');
  for (let z = -2.65; z <= 1.4; z += 0.58) {
    box('Brise lateral', [0.12, 3.15, 0.16], [5.28, 2.42, z], wood);
  }

  // Percurso, degraus e elementos de escala.
  box('Passeio', [2.5, 0.055, 4.5], [-2.4, 0.18, 6.15], concrete, 'demo-passeio');
  box('Degrau 1', [4.2, 0.14, 0.7], [-2.4, 0.36, 4.62], plaster);
  box('Degrau 2', [4.2, 0.14, 0.7], [-2.4, 0.51, 4.12], plaster);
  box('Banco', [1.8, 0.17, 0.58], [6.48, 0.62, 4.85], wood, 'demo-banco');
  box('Apoio do banco A', [0.14, 0.5, 0.48], [5.8, 0.36, 4.85], charcoal);
  box('Apoio do banco B', [0.14, 0.5, 0.48], [7.16, 0.36, 4.85], charcoal);

  for (const [x, z, scale] of [[-7.4, -4.8, 1], [7.7, -4.9, 0.8], [7.8, 5.9, 0.72]] as const) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * scale, 0.16 * scale, 1.65 * scale, 8), wood);
    trunk.position.set(x, 1.1 * scale, z);
    trunk.castShadow = true;
    root.add(trunk);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.12 * scale, 1), leaves);
    crown.position.set(x, 2.5 * scale, z);
    crown.castShadow = true;
    root.add(crown);
  }

  return root;
}
