import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { LayerInfo } from '../types/layers';
import { matchingLayers, parseLayerName, layerLabel, isRepLayer, type SelectionMode } from '../data/layerSelection';
import { USAGE_CODES, DEFAULT_USAGES, type AreaExclusions, type MarkedObject, type ObjectRecord, type ObjectSelection, type UsageCode } from '../types/model';
import type { ProjectionMode, StandardView, ViewState } from '../types/view';
import type { ViewerSnapshot } from '../types/scenes';
import { exportScenePng, type ExportedImage, type ImageExportOptions } from './exportImage';
import { solarDirection, type SolarSettings } from '../data/solar';
import { MeasurementTool, metersPerUnit } from './measurement';

type Renderable = THREE.Mesh | THREE.Line | THREE.Points;
type ObjectMaterial = THREE.Material | THREE.Material[];

interface SelectionEntry {
  object: Renderable;
  original: ObjectMaterial;
  muted: ObjectMaterial;
  objectId: string | null;
  use: UsageCode | null;
  castShadow: boolean;
  receiveShadow: boolean;
  layerIndex: number | null;
  baseVisible: boolean;
  originalVisible: boolean;
  highlighted: boolean;
}

interface ElevationEntry {
  object: Renderable;
  originalVisible: boolean;
  elevation: number;
}

export class ArchitecturalViewer {
  private readonly sun = new THREE.DirectionalLight('#fff5e4', 3.4);
  private readonly shadowDepthMaterial = new THREE.MeshDepthMaterial({
    polygonOffset: true,
    polygonOffsetFactor: 3,
    polygonOffsetUnits: 4,
  });
  private readonly shadowGround = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000),
    new THREE.ShadowMaterial({ color: '#000000', opacity: 0.24 }));
  private solarSettings: SolarSettings | null = null;
  private readonly solarMaterials = new Map<THREE.Material, THREE.MeshStandardMaterial>();
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
  private selectedObjects: Set<Renderable> | null = null;
  private selectionEnabled = true;
  private selectionMode: SelectionMode = 'name';
  private hideUnchecked = false;
  private excludeUncovered = false;
  private excludeParking = false;
  private activeUsages = new Set<UsageCode>(DEFAULT_USAGES);
  private pointerStart: { id: number; x: number; y: number } | null = null;
  private frameId = 0;
  private measurement: MeasurementTool | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly onSelectionChange: (selection: ObjectSelection | null) => void = () => {},
    private readonly onViewStateChange: (state: ViewState) => void = () => {},
  ) {
    this.scene.background = new THREE.Color('#a3a3a3');
    this.scene.fog = new THREE.Fog('#a3a3a3', 55, 120);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
    if (!active) this.measurement?.setEnabled(false);
    if (active) {
      this.resize();
      this.render();
    }
  }

  setBackgroundColor(color: string): void {
    if (!/^#[\da-f]{6}$/i.test(color)) return;
    this.scene.background = new THREE.Color(color);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(this.scene.background);
  }

  /** Ponto de entrada para uma cena convertida a partir de um modelo Rhino. */
  setContent(content: THREE.Object3D, objectData?: Map<string, ObjectRecord>): void {
    this.measurement?.setEnabled(false);
    this.clearSelection();
    this.clearSelectionEntries();
    if (this.content) this.scene.remove(this.content);
    this.content = content;
    this.activeUsages = new Set(DEFAULT_USAGES);
    this.readLayers(content);
    this.prepareModelShadows(content);
    this.prepareSelection(content, objectData);
    this.prepareElevationFilter(content, objectData);
    this.applyVisibilityFilters();
    this.scene.add(content);
    this.setSolarSettings(this.solarSettings);
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

  setSolarSettings(settings: SolarSettings | null): void {
    this.solarSettings = settings;
    this.renderer.toneMappingExposure = settings?.exposure ?? 1.5;
    const direction = settings ? solarDirection(settings) : null;
    this.sun.intensity = settings ? (direction!.y > 0 ? 3.4 * settings.sunIntensity / 100 : 0) : 3.4;
    this.sun.shadow.intensity = settings ? settings.shadowIntensity / 100 : 1;
    this.shadowGround.material.opacity = settings ? settings.shadowIntensity / 100 : 0.24;
    const bounds = this.content ? new THREE.Box3().setFromObject(this.content) : new THREE.Box3();
    const sphere = bounds.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 30)
      : bounds.getBoundingSphere(new THREE.Sphere());
    const modelRadius = Math.max(10, sphere.radius);
    const sunDirection = direction ? new THREE.Vector3(direction.x, direction.y, direction.z)
      : new THREE.Vector3(-12, 22, 14);
    sunDirection.normalize();
    this.sun.target.position.copy(sphere.center);
    this.sun.position.copy(sphere.center).addScaledVector(sunDirection, modelRadius * 3);
    if (this.sun.target.parent !== this.scene) this.scene.add(this.sun.target);
    this.configureSunShadow(modelRadius * 1.1);
    this.shadowGround.scale.setScalar(Math.max(1, modelRadius * 6 / 2000));
    this.applyAppearance();
  }

  private prepareModelShadows(model: THREE.Object3D): void {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      object.receiveShadow = true;
      object.castShadow = materials.some(material => !material.transparent && material.opacity > 0.99);
      object.customDepthMaterial ??= this.shadowDepthMaterial;
    });
  }

  private configureSunShadow(size: number): void {
    const camera = this.sun.shadow.camera;
    camera.left = camera.bottom = -size;
    camera.right = camera.top = size;
    const distance = this.sun.position.distanceTo(this.sun.target.position);
    camera.near = Math.max(0.1, distance - size * 1.1);
    camera.far = Math.max(camera.near + 1, distance + size * 1.1);
    const worldTexel = (size * 2) / this.sun.shadow.mapSize.x;
    // Models use metres; keep normal bias within 2–15 cm and depth bias within 5 cm.
    this.sun.shadow.normalBias = THREE.MathUtils.clamp(worldTexel * 0.75, 0.02, 0.15);
    this.sun.shadow.bias = -Math.min(0.05, worldTexel * 0.25) / (camera.far - camera.near);
    camera.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
  }

  private solarMaterial(material: THREE.Material): THREE.Material {
    if (!(material instanceof THREE.MeshBasicMaterial)) return material;
    let converted = this.solarMaterials.get(material);
    if (!converted) {
      converted = new THREE.MeshStandardMaterial({ color: material.color, map: material.map,
        alphaMap: material.alphaMap, opacity: material.opacity, transparent: material.transparent,
        alphaTest: material.alphaTest, side: material.side, depthWrite: material.depthWrite,
        depthTest: material.depthTest, vertexColors: material.vertexColors,
        polygonOffset: material.polygonOffset, polygonOffsetFactor: material.polygonOffsetFactor,
        polygonOffsetUnits: material.polygonOffsetUnits, roughness: 0.85, metalness: 0 });
      this.solarMaterials.set(material, converted);
    }
    return converted;
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

  exportImage(options: ImageExportOptions): Promise<ExportedImage> {
    if (!this.content) return Promise.reject(new Error('Carregue o modelo antes de exportar.'));
    return exportScenePng(this.scene, this.camera, this.content, this.renderer,
      { width: this.container.clientWidth, height: this.container.clientHeight }, options);
  }

  captureState(): ViewerSnapshot {
    const index = this.selectionEntries.findIndex(entry => entry.object === this.selectedObject);
    return {
      camera: {
        projection: this.projectionMode,
        position: this.camera.position.toArray(),
        up: this.camera.up.toArray(),
        target: this.controls.target.toArray(),
        zoom: this.camera.zoom,
        near: this.camera.near,
        far: this.camera.far,
        orthographicHeight: this.orthographicCamera.top - this.orthographicCamera.bottom,
        maxDistance: this.controls.maxDistance,
        label: this.viewLabel,
      },
      layers: this.layers.map(({ name, visible }) => ({ name, visible })),
      elevation: [Number.isFinite(this.elevationBase) ? this.elevationBase : null, Number.isFinite(this.elevationTop) ? this.elevationTop : null],
      selectionMode: this.selectionMode,
      activeUsages: [...this.activeUsages],
      hideUnchecked: this.hideUnchecked,
      selected: index < 0 ? null : { id: this.selectionEntries[index].objectId, index },
      selectedObjects: this.selectedObjects == null ? undefined : [...this.selectedObjects].map(object => {
        const index = this.selectionEntries.findIndex(entry => entry.object === object);
        return { id: this.selectionEntries[index].objectId, index };
      }),
    };
  }

  restoreState(state: ViewerSnapshot): void {
    if (state.layers.length !== this.layers.length || state.layers.some((layer, index) => layer.name !== this.layers[index].name)) {
      throw new Error('A cena salva pertence a uma versão diferente das layers deste modelo.');
    }
    this.selectedObject = null;
    this.selectedObjects = null;
    state.layers.forEach((layer, index) => { this.layers[index].visible = layer.visible; });
    this.selectionMode = state.selectionMode;
    this.activeUsages = new Set(state.activeUsages);
    this.hideUnchecked = state.hideUnchecked;
    this.elevationBase = state.elevation[0] ?? -Infinity;
    this.elevationTop = state.elevation[1] ?? Infinity;
    this.applyVisibilityFilters();
    const savedSelection = state.selectedObjects ?? (state.selected ? [state.selected] : null);
    if (savedSelection && this.selectionEnabled !== false) {
      this.selectedObjects = new Set();
      for (const saved of savedSelection) {
        const entry = saved.id
          ? this.selectionEntries.find(entry => !entry.object.userData.isEdgeHelper && entry.objectId === saved.id)
          : this.selectionEntries[saved.index];
        if (entry && !entry.object.userData.isEdgeHelper && this.isVisible(entry.object)) {
          this.selectedObjects.add(entry.object);
          this.selectedObject = entry.object;
        }
      }
    }
    this.applyAppearance();

    // Recreate controls to discard residual damping from the preceding view.
    this.controls.dispose();
    this.projectionMode = state.camera.projection;
    this.viewLabel = state.camera.label;
    this.camera = this.projectionMode === 'perspective' ? this.perspectiveCamera : this.orthographicCamera;
    this.camera.position.fromArray(state.camera.position);
    this.camera.up.fromArray(state.camera.up);
    this.camera.zoom = state.camera.zoom;
    this.camera.near = state.camera.near;
    this.camera.far = state.camera.far;
    const halfHeight = state.camera.orthographicHeight / 2;
    this.orthographicCamera.top = halfHeight;
    this.orthographicCamera.bottom = -halfHeight;
    this.controls = this.createControls(this.camera);
    this.controls.target.fromArray(state.camera.target);
    this.controls.maxDistance = state.camera.maxDistance;
    this.resize();
    this.controls.update();
    this.controls.saveState();
    this.lastViewState = '';
    this.emitViewState();
    this.notifySelection();
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
    if (this.selectionMode === 'group') return;
    if (this.selectionMode === 'use') {
      for (const layer of this.layers) {
        const use = USAGE_CODES.find(code => code === parseLayerName(layer.name).use);
        if (use) layer.visible = usages.has(use);
      }
    }
    if (usages.has('REP') !== this.activeUsages.has('REP')) {
      for (const layer of this.layers) {
        if (parseLayerName(layer.name).use === 'REP') layer.visible = usages.has('REP');
      }
    }
    this.activeUsages = new Set(usages);
    this.selectedObject = null;
    this.selectedObjects = null;
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
    this.selectedObject = null;
    this.selectedObjects = null;
    // Group selection must not retain a usage mask from another mode.
    this.activeUsages = new Set(DEFAULT_USAGES);
    if (this.layers.some(layer => layer.visible && parseLayerName(layer.name).use === 'REP')) this.activeUsages.add('REP');
    this.applyAppearance();
    this.onSelectionChange(null);
  }

  setHideUnchecked(hide: boolean): void {
    this.hideUnchecked = hide;
    this.applyAppearance();
  }

  setAreaExclusions(exclusions: Partial<AreaExclusions>): void {
    this.excludeUncovered = exclusions.excludeUncovered === true;
    this.excludeParking = exclusions.excludeParking === true;
    this.applyAppearance();
  }

  setLayerVisible(index: number, visible: boolean): void {
    this.setLayersChecked([index], visible);
  }

  setLayersChecked(indices: number[], checked: boolean): void {
    const targets = new Set(indices.flatMap(index => matchingLayers(this.layers, index, this.selectionMode).map(layer => layer.index)));
    for (const index of targets) {
      const layer = this.layers[index];
      if (layer) layer.visible = checked;
      if (layer && checked) {
        const use = USAGE_CODES.find(code => code === parseLayerName(layer.name).use);
        if (use) this.activeUsages.add(use);
      }
    }
    if (this.layers.some(layer => layer.visible && parseLayerName(layer.name).use === 'REP')) this.activeUsages.add('REP');
    else this.activeUsages.delete('REP');
    this.selectedObject = null;
    this.selectedObjects = null;
    this.applyAppearance();
    this.onSelectionChange(null);
  }

  setAllLayersVisible(visible: boolean): void {
    this.setLayersChecked(this.layers.map(layer => layer.index), visible);
  }

  getActiveUsages(): ReadonlySet<UsageCode> {
    return new Set(this.activeUsages);
  }

  getMarkedObjects(): Map<string, MarkedObject> {
    const objects = new Map<string, MarkedObject>();
    for (const entry of this.selectionEntries) {
      // Visual area exclusions must preserve the existing totals and parking-space counts.
      if (entry.object.userData.isEdgeHelper || !entry.highlighted || !entry.baseVisible
        || (entry.object.parent && !this.isVisible(entry.object.parent))) continue;
      objects.set(entry.objectId?.toLowerCase() ?? entry.object.uuid, {
        use: entry.use,
        layerName: entry.layerIndex === null ? entry.object.name : this.layers[entry.layerIndex].name,
      });
    }
    return objects;
  }

  clearSelection(): void {
    if (!this.selectedObject && this.selectedObjects == null) return;
    this.selectedObject = null;
    this.selectedObjects = null;
    this.applyAppearance();
    this.onSelectionChange(null);
  }

  setSelectionEnabled(enabled: boolean): void {
    this.selectionEnabled = enabled;
    this.pointerStart = null;
    if (!enabled) {
      this.clearSelection();
      this.measurement?.setEnabled(false);
    }
  }

  mountMeasurement(button: HTMLButtonElement): void {
    this.measurement?.dispose();
    this.measurement = new MeasurementTool(this.renderer.domElement, button,
      () => this.camera,
      () => this.selectionEntries.map(entry => entry.object).filter(object => !object.userData.isEdgeHelper),
      () => metersPerUnit(this.content?.userData.settings));
  }

  dispose(): void {
    this.measurement?.dispose();
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
    this.shadowDepthMaterial.dispose();
    this.sun.shadow.dispose();
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
    this.onViewStateChange({ cubeTransform, projection: this.projectionMode, label: this.viewLabel,
      groundProjection: [rotation[0], rotation[8], rotation[1], rotation[9]] });
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
    if (this.selectedObjects != null) {
      const visible = new Set([...this.selectedObjects].filter(object => this.isVisible(object)));
      if (visible.size !== this.selectedObjects.size) {
        this.selectedObjects = visible;
        this.selectedObject = [...visible].at(-1) ?? null;
        this.applyAppearance();
        this.notifySelection();
      }
    }
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
            muted.color.lerp(new THREE.Color('#94a3b8'), 0.9);
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
        receiveShadow: object.receiveShadow,
        layerIndex,
        baseVisible: object.visible,
        originalVisible: object.visible,
        highlighted: false,
      });
    });
  }

  private clearSelectionEntries(): void {
    this.selectedObject = null;
    this.selectedObjects = null;
    this.solarMaterials.forEach(material => material.dispose());
    this.solarMaterials.clear();
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

  private select(object: Renderable, action: 'replace' | 'add' | 'remove' = 'replace'): void {
    if (this.selectionEnabled === false) return;
    const byObject = new Map(this.selectionEntries.map(entry => [entry.object, entry]));
    const selected = byObject.get(object);
    const layerIndex = selected?.layerIndex ?? null;
    const layer = layerIndex === null ? undefined : this.layers[layerIndex];
    // A grouped mode never falls back to selecting an individual object.
    if (this.selectionMode !== 'name') {
      if (!layer) return;
      const category = parseLayerName(layer.name);
      if (this.selectionMode === 'group' && category.group === 'Sem grupo') return;
      if (this.selectionMode === 'use' && category.use === 'Sem uso') return;
    }
    const objects = action === 'replace' ? new Set<Renderable>() : new Set(this.selectedObjects ?? []);
    const matches = layer ? new Set(matchingLayers(this.layers, layer.index, this.selectionMode).map(item => item.index)) : new Set();
    const sameSelection = (candidate: Renderable) => {
      const entry = byObject.get(candidate);
      return this.selectionMode === 'name'
        ? (selected?.objectId ? entry?.objectId === selected.objectId : candidate === object)
        : entry?.layerIndex != null && matches.has(entry.layerIndex);
    };
    if (action === 'remove') {
      if (this.selectedObjects == null) {
        for (const entry of this.selectionEntries) {
          if (entry.highlighted && !entry.object.userData.isEdgeHelper && this.isVisible(entry.object)) objects.add(entry.object);
        }
      }
      for (const candidate of objects) {
        if (sameSelection(candidate)) objects.delete(candidate);
      }
    } else if (![...objects].some(sameSelection)) {
      objects.add(object);
    }
    this.selectedObjects = objects;
    this.selectedObject = [...objects].at(-1) ?? null;
    if (this.layers.length) {
      const matches = new Set<number>();
      for (const candidate of objects) {
        const index = byObject.get(candidate)?.layerIndex;
        if (index != null) {
          for (const item of matchingLayers(this.layers, index, this.selectionMode)) matches.add(item.index);
        }
      }
      for (const item of this.layers) item.visible = matches.has(item.index);
      this.activeUsages = new Set(DEFAULT_USAGES);
      if (this.layers.some(item => item.visible && parseLayerName(item.name).use === 'REP')) this.activeUsages.add('REP');
      else this.activeUsages.delete('REP');
    }
    this.applyAppearance();
    this.notifySelection();
  }

  private notifySelection(): void {
    const object = this.selectedObject;
    if (!object) { this.onSelectionChange(null); return; }
    const selected = this.selectionEntries.find(entry => entry.object === object);
    const layer = selected?.layerIndex == null ? undefined : this.layers[selected.layerIndex];
    const layerName = layer ? layerLabel(layer, this.selectionMode) : undefined;
    this.onSelectionChange({
      id: this.selectionMode === 'name' && (this.selectedObjects?.size ?? 1) === 1 ? selected?.objectId ?? null : null,
      name: (this.selectedObjects?.size ?? 0) > 1 ? `${this.selectedObjects!.size} seleções`
        : layerName || object.name?.trim() || object.userData.attributes?.name?.trim() || 'Geometria selecionada',
      mode: this.selectionMode,
    });
  }

  private applyAppearance(): void {
    const selectedObjects = this.selectedObjects;
    const selectedIds = new Set(this.selectionEntries.filter(entry => selectedObjects?.has(entry.object) && entry.objectId).map(entry => entry.objectId));
    const allUsages = DEFAULT_USAGES.every(code => this.activeUsages.has(code));
    for (const entry of this.selectionEntries) {
      const checked = entry.layerIndex === null || this.layers[entry.layerIndex]?.visible !== false;
      const highlighted = checked && (entry.use === null ? allUsages : this.activeUsages.has(entry.use))
        && (this.selectionMode !== 'name' || selectedObjects == null
          || (entry.objectId ? selectedIds.has(entry.objectId) : selectedObjects.has(entry.object)
            || (entry.object.parent != null && selectedObjects.has(entry.object.parent as Renderable))));
      entry.highlighted = highlighted;
      const rep = entry.use === 'REP' || (entry.layerIndex !== null && isRepLayer(this.layers[entry.layerIndex].name));
      const layerName = (entry.layerIndex === null ? entry.object.name : this.layers[entry.layerIndex].name).toUpperCase();
      const excluded = this.selectionMode !== 'name' && ((this.excludeUncovered && layerName.includes('DESC'))
        || (this.excludeParking && layerName.includes('EST')));
      const visuallyHighlighted = highlighted && !excluded;
      entry.object.visible = entry.baseVisible && (!(this.hideUnchecked || rep) || visuallyHighlighted);
      entry.object.material = visuallyHighlighted || (rep && !excluded) ? entry.original : entry.muted;
      const solarMesh = this.solarSettings && entry.object instanceof THREE.Mesh;
      entry.object.castShadow = visuallyHighlighted && entry.castShadow;
      entry.object.receiveShadow = entry.receiveShadow;
      if (solarMesh) {
        entry.object.material = Array.isArray(entry.object.material)
          ? entry.object.material.map(material => this.solarMaterial(material))
          : this.solarMaterial(entry.object.material);
      }
    }
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.selectionEnabled && event.button === 0) this.pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent): void => this.handlePointerUp(event);

  private handlePointerUp(event: PointerEvent): void {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (this.measurement?.enabled) return;
    if (!this.selectionEnabled) return;
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
    if (hit instanceof THREE.Mesh || hit instanceof THREE.Line || hit instanceof THREE.Points) {
      this.select(hit, event.ctrlKey ? 'remove' : event.shiftKey ? 'add' : 'replace');
    } else if (!event.ctrlKey && !event.shiftKey) this.clearSelection();
  }

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
      visible: layer.visible !== false && !isRepLayer(layer.name ?? ''),
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
    this.measurement?.update();
    this.renderer.render(this.scene, this.camera);
  };

  private addEnvironment(): void {
    this.scene.add(new THREE.HemisphereLight('#f7fbff', '#9ba6a0', 2.4));

    const sun = this.sun;
    sun.position.set(-12, 22, 14);
    sun.castShadow = true;
    const resolution = Math.min(4096, this.renderer.capabilities.maxTextureSize);
    sun.shadow.mapSize.set(resolution, resolution);
    sun.shadow.radius = 1.5;
    this.scene.add(sun, sun.target);
    this.configureSunShadow(30);

    const ground = this.shadowGround;
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }
}
