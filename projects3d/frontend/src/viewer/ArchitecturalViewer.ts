import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { LayerInfo } from '../types/layers';
import { matchingLayers, parseLayerName, layerLabel, type SelectionMode } from '../data/layerSelection';
import { USAGE_CODES, type ObjectRecord, type ObjectSelection, type UsageCode } from '../types/model';
import type { ProjectionMode, StandardView, ViewState } from '../types/view';

type Renderable = THREE.Mesh | THREE.Line | THREE.Points;
type ObjectMaterial = THREE.Material | THREE.Material[];

interface SelectionEntry {
  object: Renderable;
  original: ObjectMaterial;
  muted: ObjectMaterial;
  objectId: string | null;
  use: UsageCode | null;
  castShadow: boolean;
  layerIndex: number | null;
  baseVisible: boolean;
  originalVisible: boolean;
}

interface ElevationEntry {
  object: Renderable;
  originalVisible: boolean;
  elevation: number;
}

export class ArchitecturalViewer {
  private readonly scene = new THREE.Scene();
  private readonly perspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  private readonly orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private projectionMode: ProjectionMode = 'perspective';
  private viewLabel = 'PERSPECTIVA';
  private lastViewState = '';
  private content: THREE.Object3D | null = null;
  private layers: LayerInfo[] = [];
  private readonly originalVisibility = new Map<THREE.Object3D, boolean>();
  private readonly elevationEntries: ElevationEntry[] = [];
  private elevationLevels: number[] = [];
  private elevationBase = -Infinity;
  private elevationTop = Infinity;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly selectionEntries: SelectionEntry[] = [];
  private readonly mutedMaterials = new Set<THREE.Material>();
  private selectedObject: Renderable | null = null;
  private selectionMode: SelectionMode = 'name';
  private hideUnchecked = false;
  private activeUsages = new Set<UsageCode>(USAGE_CODES);
  private pointerStart: { id: number; x: number; y: number } | null = null;
  private frameId = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly onSelectionChange: (selection: ObjectSelection | null) => void = () => {},
    private readonly onViewStateChange: (state: ViewState) => void = () => {},
  ) {
    this.scene.background = new THREE.Color('#202a2f');
    this.scene.fog = new THREE.Fog('#202a2f', 55, 120);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.5;
    this.container.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('keydown', this.onKeyDown);

    this.camera.position.set(16, 13, 20);
    this.controls = this.createControls(this.camera);
    this.controls.target.set(0, 1.5, 0);
    this.controls.update();

    this.addEnvironment();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.render();
  }

  setActive(active: boolean): void {
    cancelAnimationFrame(this.frameId);
    if (active) {
      this.resize();
      this.render();
    }
  }

  /** Ponto de entrada para uma cena convertida a partir de um modelo Rhino. */
  setContent(content: THREE.Object3D, objectData?: Map<string, ObjectRecord>): void {
    this.clearSelection();
    this.clearSelectionEntries();
    if (this.content) this.scene.remove(this.content);
    this.content = content;
    this.activeUsages = new Set(USAGE_CODES);
    this.readLayers(content);
    this.prepareSelection(content, objectData);
    this.prepareElevationFilter(content, objectData);
    this.applyVisibilityFilters();
    this.scene.add(content);
    this.fitToContent();
    this.controls.saveState();
  }

  fitToContent(): void {
    if (!this.content) return;
    const bounds = this.getVisibleBounds(this.content);
    if (bounds.isEmpty()) return;

    const center = bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const size = bounds.getSize(new THREE.Vector3());
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    let distance: number;

    if (this.camera instanceof THREE.PerspectiveCamera) {
      const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
      const limitingFov = Math.min(verticalFov, horizontalFov);
      distance = Math.max(6, (sphere.radius / Math.sin(limitingFov / 2)) * 1.2);
    } else {
      distance = Math.max(6, sphere.radius * 3);
    }

    this.camera.position.copy(center).addScaledVector(direction, distance);
    if (this.camera instanceof THREE.OrthographicCamera) {
      this.camera.lookAt(center);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      const halfWidth = (Math.abs(right.x) * size.x + Math.abs(right.y) * size.y + Math.abs(right.z) * size.z) / 2;
      const halfVertical = (Math.abs(up.x) * size.x + Math.abs(up.y) * size.y + Math.abs(up.z) * size.z) / 2;
      const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
      const halfHeight = Math.max(3, halfVertical * 1.35, halfWidth / aspect * 1.35);
      this.camera.left = -halfHeight * aspect;
      this.camera.right = -this.camera.left;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
      this.camera.zoom = 1;
    }

    this.camera.near = Math.max(0.05, distance / 100);
    this.camera.far = Math.max(500, distance + sphere.radius * 5);
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = Math.max(120, distance * 4);
    this.controls.target.copy(center);
    this.controls.update();
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = Math.max(50, sphere.radius * 4);
      this.scene.fog.far = Math.max(120, sphere.radius * 10);
    }
  }

  resetView(): void {
    this.setProjectionMode('perspective');
  }

  setStandardView(view: StandardView): void {
    const directions: Record<StandardView, THREE.Vector3> = {
      top: new THREE.Vector3(0, 1, 0),
      bottom: new THREE.Vector3(0, -1, 0),
      front: new THREE.Vector3(0, 0, 1),
      back: new THREE.Vector3(0, 0, -1),
      left: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
    };
    const names: Record<StandardView, string> = {
      top: 'TOPO', bottom: 'BASE', front: 'FRENTE', back: 'TRÁS', left: 'ESQUERDA', right: 'DIREITA',
    };
    const up = view === 'top' ? new THREE.Vector3(0, 0, -1)
      : view === 'bottom' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    this.activateView('orthographic', directions[view], up, names[view]);
  }

  setProjectionMode(mode: ProjectionMode): void {
    const direction = mode === 'perspective'
      ? new THREE.Vector3(16, 13, 20).normalize()
      : new THREE.Vector3(1, 1, 1).normalize();
    this.activateView(mode, direction, new THREE.Vector3(0, 1, 0), mode === 'perspective' ? 'PERSPECTIVA' : 'ISOMÉTRICA');
  }

  getLayers(): LayerInfo[] {
    return this.layers.map((layer) => ({ ...layer }));
  }

  getElevationLevels(): number[] {
    return [...this.elevationLevels];
  }

  getVisibleObjectIds(): Set<string> {
    const ids = new Set<string>();
    for (const entry of this.selectionEntries) {
      if (entry.objectId && !entry.object.userData.isEdgeHelper && this.isVisible(entry.object)) {
        ids.add(entry.objectId.toLowerCase());
      }
    }
    return ids;
  }

  setActiveUsages(usages: ReadonlySet<UsageCode>): void {
    this.activeUsages = new Set(usages);
    this.selectedObject = null;
    this.applyAppearance();
    this.onSelectionChange(null);
  }

  setElevationRange(base: number, top: number): void {
    if (!Number.isFinite(base) || !Number.isFinite(top) || base > top) return;
    this.elevationBase = base;
    this.elevationTop = top;
    this.applyVisibilityFilters();
  }

  setSelectionMode(mode: SelectionMode): void {
    this.selectionMode = mode;
    this.clearSelection();
  }

  setHideUnchecked(hide: boolean): void {
    this.hideUnchecked = hide;
    this.applyAppearance();
  }

  setLayerVisible(index: number, visible: boolean): void {
    this.setLayersChecked([index], visible);
  }

  setLayersChecked(indices: number[], checked: boolean): void {
    for (const index of indices) {
      const layer = this.layers[index];
      if (layer) layer.visible = checked;
    }
    this.selectedObject = null;
    this.applyAppearance();
    this.onSelectionChange(null);
  }

  setAllLayersVisible(visible: boolean): void {
    this.setLayersChecked(this.layers.map(layer => layer.index), visible);
  }

  clearSelection(): void {
    if (!this.selectedObject) return;
    this.selectedObject = null;
    this.applyAppearance();
    this.onSelectionChange(null);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerCancel);
    window.removeEventListener('keydown', this.onKeyDown);
    this.clearSelection();
    this.clearSelectionEntries();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
      geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      objectMaterials.forEach((material) => materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    if (this.camera instanceof THREE.PerspectiveCamera) this.camera.aspect = width / height;
    else {
      const halfHeight = (this.camera.top - this.camera.bottom) / 2;
      this.camera.left = -halfHeight * width / height;
      this.camera.right = -this.camera.left;
    }
    this.camera.updateProjectionMatrix();
  }

  private createControls(camera: THREE.Camera): OrbitControls {
    const controls = new OrbitControls(camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.minDistance = 4;
    controls.maxDistance = 1000;
    controls.minZoom = 0.1;
    controls.maxZoom = 30;
    controls.maxPolarAngle = Math.PI;
    return controls;
  }

  private activateView(mode: ProjectionMode, direction: THREE.Vector3, up: THREE.Vector3, label: string): void {
    const target = this.controls.target.clone();
    this.controls.dispose();
    this.projectionMode = mode;
    this.viewLabel = label;
    this.camera = mode === 'perspective' ? this.perspectiveCamera : this.orthographicCamera;
    this.camera.up.copy(up);
    this.camera.position.copy(target).addScaledVector(direction, 30);
    this.camera.lookAt(target);
    this.controls = this.createControls(this.camera);
    this.controls.target.copy(target);
    this.fitToContent();
    this.controls.saveState();
    this.emitViewState();
  }

  private emitViewState(): void {
    const rotation = new THREE.Matrix4().makeRotationFromQuaternion(this.camera.quaternion.clone().invert()).elements;
    const signs = [1, -1, 1, 1];
    const css = rotation.map((value, index) => {
      const row = index % 4;
      const column = Math.floor(index / 4);
      return (value * signs[row] * signs[column]).toFixed(5);
    });
    const cubeTransform = `matrix3d(${css.join(',')})`;
    const key = `${cubeTransform}|${this.projectionMode}|${this.viewLabel}`;
    if (key === this.lastViewState) return;
    this.lastViewState = key;
    this.onViewStateChange({ cubeTransform, projection: this.projectionMode, label: this.viewLabel });
  }

  private prepareElevationFilter(content: THREE.Object3D, objectData?: Map<string, ObjectRecord>): void {
    this.elevationEntries.length = 0;
    this.elevationLevels = [];
    this.elevationBase = -Infinity;
    this.elevationTop = Infinity;
    if (!objectData || objectData.size === 0) return;

    const levels = new Set<number>();
    const absoluteBase = typeof content.userData.absoluteBaseElevationM === 'number'
      ? content.userData.absoluteBaseElevationM : 0;
    content.updateMatrixWorld(true);
    content.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
      if (object.userData.isEdgeHelper) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const bounds = object.geometry.boundingBox?.clone().applyMatrix4(object.matrixWorld);
      if (!bounds || bounds.isEmpty()) return;
      const id = this.findObjectId(object)?.toLowerCase();
      const csvElevation = id ? objectData.get(id)?.elevationM : null;
      const elevation = Math.round((csvElevation ?? bounds.min.y + absoluteBase) * 100) / 100;
      this.elevationEntries.push({ object, originalVisible: object.visible, elevation });
      levels.add(elevation);
    });

    // Inclui a altura física da última geometria para representar o topo do modelo.
    const modelBounds = new THREE.Box3().setFromObject(content);
    if (!modelBounds.isEmpty()) levels.add(Math.round((modelBounds.max.y + absoluteBase) * 100) / 100);
    this.elevationLevels = [...levels].sort((a, b) => a - b);
    if (this.elevationLevels.length > 0) {
      this.elevationBase = this.elevationLevels[0];
      this.elevationTop = this.elevationLevels.at(-1)!;
    }
  }

  private applyVisibilityFilters(): void {
    for (const [object, originalVisible] of this.originalVisibility) object.visible = originalVisible;
    for (const entry of this.selectionEntries) {
      entry.baseVisible = entry.originalVisible;
    }
    const byObject = new Map(this.selectionEntries.map(entry => [entry.object, entry]));
    for (const entry of this.elevationEntries) {
      const selection = byObject.get(entry.object);
      if (selection) selection.baseVisible = entry.originalVisible
        && entry.elevation >= this.elevationBase - 0.005
        && entry.elevation <= this.elevationTop + 0.005;
    }
    this.applyAppearance();
    if (this.selectedObject && !this.isVisible(this.selectedObject)) this.clearSelection();
  }

  private prepareSelection(content: THREE.Object3D, objectData?: Map<string, ObjectRecord>): void {
    const cache = new Map<THREE.Material, THREE.Material>();
    content.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
      const original = object.material;
      const mute = (material: THREE.Material): THREE.Material => {
        let muted = cache.get(material);
        if (!muted) {
          muted = material.clone();
          if ('color' in muted && muted.color instanceof THREE.Color) {
            muted.color.lerp(new THREE.Color('#b9c5c1'), 0.9);
          }
          muted.opacity = Math.min(material.opacity, object.userData.isEdgeHelper ? 0.22 : 0.48);
          muted.transparent = true;
          muted.depthWrite = false;
          muted.needsUpdate = true;
          cache.set(material, muted);
          this.mutedMaterials.add(muted);
        }
        return muted;
      };
      const objectId = this.findObjectId(object);
      const layerIndex = this.findLayerIndex(object);
      const layer = layerIndex === null ? undefined : this.layers[layerIndex];
      const layerUse = layer ? parseLayerName(layer.name).use : null;
      const rawUse = layerUse !== 'Sem uso' && layerUse !== null ? layerUse
        : objectId ? objectData?.get(objectId.toLowerCase())?.use?.toUpperCase() : null;
      const use = USAGE_CODES.find((code) => code === rawUse) ?? null;
      this.selectionEntries.push({
        object,
        original,
        muted: Array.isArray(original) ? original.map(mute) : mute(original),
        objectId,
        use,
        castShadow: object.castShadow,
        layerIndex,
        baseVisible: object.visible,
        originalVisible: object.visible,
      });
    });
  }

  private clearSelectionEntries(): void {
    this.selectionEntries.length = 0;
    this.mutedMaterials.forEach((material) => material.dispose());
    this.mutedMaterials.clear();
  }

  private findObjectId(object: THREE.Object3D): string | null {
    let current: THREE.Object3D | null = object;
    while (current && current !== this.content) {
      if (typeof current.userData.objectId === 'string') return current.userData.objectId;
      current = current.parent;
    }
    return null;
  }

  private findLayerIndex(object: THREE.Object3D): number | null {
    let current: THREE.Object3D | null = object;
    while (current && current !== this.content) {
      const index = current.userData.attributes?.layerIndex;
      if (Number.isInteger(index) && this.layers[index]) return index;
      current = current.parent;
    }
    return null;
  }

  private isVisible(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (!current.visible) return false;
      current = current.parent;
    }
    return true;
  }

  private select(object: Renderable): void {
    if (this.selectedObject === object) return;
    this.selectedObject = object;
    const selected = this.selectionEntries.find((entry) => entry.object === object);
    const id = selected?.objectId;
    const layerIndex = selected?.layerIndex ?? null;
    const layer = layerIndex === null ? undefined : this.layers[layerIndex];
    if (layer) {
      const matches = new Set(matchingLayers(this.layers, layer.index, this.selectionMode).map(item => item.index));
      for (const item of this.layers) item.visible = matches.has(item.index);
    }
    this.applyAppearance();
    const layerName = layer ? layerLabel(layer, this.selectionMode) : undefined;
    this.onSelectionChange({
      id: id ?? null,
      name: layerName || object.name?.trim() || object.userData.attributes?.name?.trim() || 'Geometria selecionada',
    });
  }

  private applyAppearance(): void {
    const selected = this.selectedObject;
    const selectedId = selected ? this.selectionEntries.find((entry) => entry.object === selected)?.objectId : null;
    const allUsages = this.activeUsages.size === USAGE_CODES.length;
    for (const entry of this.selectionEntries) {
      const checked = entry.layerIndex === null || this.layers[entry.layerIndex]?.visible !== false;
      const highlighted = checked && (allUsages || (entry.use !== null && this.activeUsages.has(entry.use)))
        && (entry.layerIndex !== null || !selected
          || (selectedId ? entry.objectId === selectedId : entry.object === selected || entry.object.parent === selected));
      entry.object.visible = entry.baseVisible && (!this.hideUnchecked || highlighted);
      entry.object.material = highlighted ? entry.original : entry.muted;
      entry.object.castShadow = highlighted && entry.castShadow;
    }
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button === 0) this.pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || event.button !== 0 || start.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5 || !this.content) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const tolerance = this.camera.position.distanceTo(this.controls.target) * 0.004;
    this.raycaster.params.Line.threshold = tolerance;
    this.raycaster.params.Points.threshold = tolerance;
    const candidates = this.selectionEntries
      .map((entry) => entry.object)
      .filter((object) => !object.userData.isEdgeHelper && this.isVisible(object));
    const hit = this.raycaster.intersectObjects(candidates, false)[0]?.object;
    if (hit instanceof THREE.Mesh || hit instanceof THREE.Line || hit instanceof THREE.Points) this.select(hit);
    else this.clearSelection();
  };

  private readonly onPointerCancel = (): void => { this.pointerStart = null; };
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.clearSelection();
  };

  private readLayers(content: THREE.Object3D): void {
    this.layers = [];
    this.originalVisibility.clear();
    const source = content.userData.layers;
    if (!Array.isArray(source)) return;

    this.layers = source.map((layer: { name?: string; visible?: boolean; color?: { r?: number; g?: number; b?: number; a?: number } }, index: number) => ({
      index,
      name: layer.name?.trim() || `Layer ${index + 1}`,
      color: `#${(['r', 'g', 'b'] as const).map((channel) =>
        Math.round(THREE.MathUtils.clamp(layer.color?.[channel] ?? 128, 0, 255)).toString(16).padStart(2, '0'),
      ).join('')}`,
      visible: layer.visible !== false,
      objectCount: 0,
      opacityMin: 1,
      opacityMax: 0,
    }));

    content.traverse((object) => {
      const index = object.userData.attributes?.layerIndex;
      if (!Number.isInteger(index) || index < 0 || index >= this.layers.length) return;
      this.originalVisibility.set(object, object.visible);
      this.layers[index].objectCount++;
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          this.layers[index].opacityMin = Math.min(this.layers[index].opacityMin, material.opacity);
          this.layers[index].opacityMax = Math.max(this.layers[index].opacityMax, material.opacity);
        }
      }
    });

    for (const layer of this.layers) {
      if (layer.opacityMax === 0 && layer.opacityMin === 1) {
        const alpha = source[layer.index]?.color?.a;
        layer.opacityMin = layer.opacityMax = typeof alpha === 'number' ? THREE.MathUtils.clamp(alpha / 255, 0, 1) : 1;
      }
    }
  }

  private getVisibleBounds(content: THREE.Object3D): THREE.Box3 {
    const bounds = new THREE.Box3();
    content.updateMatrixWorld(true);
    content.traverseVisible((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (object.geometry.boundingBox) {
        bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
      }
    });
    return bounds;
  }

  private render = (): void => {
    this.frameId = requestAnimationFrame(this.render);
    this.controls.update();
    this.emitViewState();
    this.renderer.render(this.scene, this.camera);
  };

  private addEnvironment(): void {
    this.scene.add(new THREE.HemisphereLight('#f7fbff', '#9ba6a0', 2.4));

    const sun = new THREE.DirectionalLight('#fff5e4', 3.4);
    sun.position.set(-12, 22, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.ShadowMaterial({ color: '#000000', opacity: 0.24 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }
}
