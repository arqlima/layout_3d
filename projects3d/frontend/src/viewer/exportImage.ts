import * as THREE from 'three';

export interface ImageExportOptions {
  longestEdge: number;
  transparent: boolean;
}

export interface ExportedImage {
  blob: Blob;
  width: number;
  height: number;
}

/** Preserva a proporção da vista e respeita os limites da GPU e de memória. */
export function exportImageSize(viewportWidth: number, viewportHeight: number, longestEdge: number, gpuLimit: number): { width: number; height: number } {
  if (![viewportWidth, viewportHeight, longestEdge, gpuLimit].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('A vista precisa estar aberta para gerar a imagem.');
  }
  const scale = Math.min(longestEdge, gpuLimit, 8192) / Math.max(viewportWidth, viewportHeight);
  let width = Math.max(1, Math.round(viewportWidth * scale));
  let height = Math.max(1, Math.round(viewportHeight * scale));
  const memoryScale = Math.min(1, Math.sqrt(32_000_000 / (width * height)));
  width = Math.max(1, Math.floor(width * memoryScale));
  height = Math.max(1, Math.floor(height * memoryScale));
  return { width, height };
}

/** Renderização independente: não redimensiona o canvas nem modifica a câmera da tela. */
export async function exportScenePng(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  content: THREE.Object3D,
  reference: THREE.WebGLRenderer,
  viewport: { width: number; height: number },
  options: ImageExportOptions,
  createRenderer: () => THREE.WebGLRenderer = () => new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }),
): Promise<ExportedImage> {
  const renderer = createRenderer();
  try {
    const gl = renderer.getContext();
    const maxViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    const limit = Math.min(renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, maxViewport[0], maxViewport[1]);
    const { width, height } = exportImageSize(viewport.width, viewport.height, options.longestEdge, limit);
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = reference.outputColorSpace;
    renderer.toneMapping = reference.toneMapping;
    renderer.toneMappingExposure = reference.toneMappingExposure;
    renderer.shadowMap.enabled = reference.shadowMap.enabled;
    renderer.shadowMap.type = reference.shadowMap.type;
    renderer.clippingPlanes = reference.clippingPlanes?.map(plane => plane.clone()) ?? [];
    renderer.localClippingEnabled = reference.localClippingEnabled;
    renderer.setClearColor(0x000000, options.transparent ? 0 : 1);
    const exportCamera = camera.clone();
    if (exportCamera instanceof THREE.PerspectiveCamera) exportCamera.aspect = width / height;
    else {
      const center = (exportCamera.left + exportCamera.right) / 2;
      const halfWidth = (exportCamera.top - exportCamera.bottom) / 2 * width / height;
      exportCamera.left = center - halfWidth;
      exportCamera.right = center + halfWidth;
    }
    exportCamera.updateProjectionMatrix();
    exportCamera.updateMatrixWorld(true);

    const background = scene.background;
    const fog = scene.fog;
    const helpers = scene.children.filter(child => child !== content && !(child instanceof THREE.Light)
      && child.userData.includeInImageExport !== true);
    const helperVisibility = helpers.map(child => child.visible);
    const shadows: Array<{ shadow: THREE.LightShadow; autoUpdate: boolean }> = [];
    scene.traverse(object => {
      if (object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight || object instanceof THREE.PointLight) {
        shadows.push({ shadow: object.shadow, autoUpdate: object.shadow.autoUpdate });
      }
    });
    try {
      // Export owns another WebGL context, even when the live shadow is cached.
      shadows.forEach(({ shadow }) => { shadow.autoUpdate = true; });
      if (options.transparent) { scene.background = null; scene.fog = null; }
      // O piso artificial de sombras não pertence ao modelo enviado.
      helpers.forEach(child => { child.visible = false; });
      renderer.render(scene, exportCamera);
    } finally {
      shadows.forEach(({ shadow, autoUpdate }) => { shadow.autoUpdate = autoUpdate; shadow.needsUpdate = true; });
      scene.background = background;
      scene.fog = fog;
      helpers.forEach((child, index) => { child.visible = helperVisibility[index]; });
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      renderer.domElement.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível gerar o PNG. Tente uma resolução menor.')), 'image/png');
    });
    return { blob, width, height };
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
