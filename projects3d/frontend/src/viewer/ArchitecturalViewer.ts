import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RenderScheduler } from './RenderScheduler';
import type { LayerInfo } from '../types/layers';
import { matchingLayers, parseLayerName, layerLabel, isRepLayer, type SelectionMode } from '../data/layerSelection';
import { USAGE_CODES, DEFAULT_USAGES, type AreaExclusions, type MarkedObject, type ObjectRecord, type ObjectSelection, type UsageCode } from '../types/model';
import type { ProjectionMode, StandardView, ViewState } from '../types/view';
import type { ViewerSnapshot } from '../types/scenes';
import { exportScenePng, type ExportedImage, type ImageExportOptions } from './exportImage';
import { solarDirection, type SolarSettings } from '../data/solar';
import { MeasurementTool, metersPerUnit } from './measurement';
import { SectionTool } from '../ui/SectionTool';
import { createCapGeometry, sectionPlane } from './sectionGeometry';
import { isSectionState, isSectionLineSettings, DEFAULT_SECTION_LINES, type SectionState, type SectionLineSettings } from '../types/section';
import { createSectionOutline, applySectionOutlineSettings } from './sectionLines';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { SolarPath } from './SolarPath';
import { AnnualExposure, type ExposureResult } from './AnnualExposure';
import { ModelAppearance } from './ModelAppearance';
import { DEFAULT_USAGE_COLORS, isUsageColorSettings, type UsageColorSettings } from '../types/usageColors';
import { DEFAULT_MODEL_APPEARANCE, isModelAppearanceSettings, type ModelAppearanceSettings } from '../types/appearance';

type Renderable = THREE.Mesh | THREE.Line | THREE.Points;
type ObjectMaterial = THREE.Material | THREE.Material[];

interface SelectionSnapshot {
  object: Renderable | null;
  objects: Set<Renderable> | null;
  layers: boolean[];
  usages: Set<UsageCode>;
}

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
  private solarPath: SolarPath | null = null;
  private solarPathScale = 50;
  private solarPathOpacity = 12;
  private annualExposure: AnnualExposure | null = null;
  private exposureAbort: AbortController | null = null;
  private exposureKey = '';
  private exposureInvalidated = () => {};
  private modelAppearance: ModelAppearance | null = null;
  private usageColors: UsageColorSettings = structuredClone(DEFAULT_USAGE_COLORS);
  private usageMaterials = new Map<UsageCode, ModelAppearance>();

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
  private shadowProjectionKey = '';
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
  private selectionHistory: SelectionSnapshot[] = [];
  private active = true;
  private selectionEnabled = true;
  private selectionMode: SelectionMode = 'name';
  private hideUnchecked = false;
  private excludeUncovered = false;
  private excludeParking = false;
  private activeUsages = new Set<UsageCode>(DEFAULT_USAGES);
  private pointerStart: { id: number; x: number; y: number } | null = null;
  private renderScheduler: RenderScheduler | null = null;
  private measurement: MeasurementTool | null = null;
  private section: SectionState | null = null;
  private sectionTool: SectionTool | null = null;
  private beforeSectionDrawing: ViewerSnapshot | null = null;
  private sectionCaps: THREE.Mesh[] = [];
  private sectionLineSettings: SectionLineSettings = { ...DEFAULT_SECTION_LINES };
  private sectionOpenCount = 0;
  private sectionUnsupportedCount = 0;

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
    this.requestRender = this.requestRender.bind(this);
    this.renderScheduler = new RenderScheduler(this.render);
    this.container.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.camera.position.set(16, 13, 20);
    this.controls = this.createControls(this.camera);
    this.controls.target.set(0, 1.5, 0);
    this.controls.update();

    this.addEnvironment();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.onVisibilityChange();
  }

  setActive(active: boolean): void {
    this.active = active;
    this.renderScheduler?.setActive(active && !document.hidden);
    if (!active) this.sectionTool?.cancelDrawing();
    if (!active) this.measurement?.setEnabled(false);
    if (active) {
      this.resize();
    }
  }

  setBackgroundColor(color: string): void {
    if (!/^#[\da-f]{6}$/i.test(color)) return;
    this.scene.background = new THREE.Color(color);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(this.scene.background);
    this.requestRender();
  }

  /** Ponto de entrada para uma cena convertida a partir de um modelo Rhino. */
  setContent(content: THREE.Object3D, objectData?: Map<string, ObjectRecord>): void {
    this.selectionHistory = [];
    this.beforeSectionDrawing = null;
    this.setSection(null, false);
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
    this.requestRender();
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
    if (!settings && this.solarPath) this.solarPath.root.visible = false;
    if (settings && this.solarPath?.root.visible) this.solarPath.update(settings, bounds);
    this.applyAppearance();
  }

  setUsageColors(settings: UsageColorSettings): void {
    if (!isUsageColorSettings(settings)) return;
    this.usageMaterials?.forEach(appearance => appearance.clear());
    this.usageMaterials = new Map();
    this.usageColors = structuredClone(settings);
    this.applyAppearance();
  }

  setModelAppearance(settings: ModelAppearanceSettings): void {
    if (!isModelAppearanceSettings(settings)) return;
    this.modelAppearance ??= new ModelAppearance();
    this.modelAppearance.configure(settings);
    this.applyAppearance();
  }

  private isRepEntry(entry: SelectionEntry): boolean {
    if (entry.use === 'REP' || (entry.layerIndex !== null && isRepLayer(this.layers[entry.layerIndex].name))) return true;
    let object: THREE.Object3D | null = entry.object;
    while (object && object !== this.content) {
      if (isRepLayer(object.name)) return true;
      object = object.parent;
    }
    return false;
  }

  setSolarPathVisible(visible: boolean): void {
    if (!this.solarPath && visible) {
      this.solarPath = new SolarPath();
      this.solarPath.setScale(this.solarPathScale ?? 50);
      this.solarPath.setOpacity(this.solarPathOpacity ?? 12);
      this.scene.add(this.solarPath.root);
    }
    if (!this.solarPath) return;
    this.solarPath.root.visible = visible && this.solarSettings != null;
    if (this.solarPath.root.visible) {
      this.solarPath.update(this.solarSettings!, this.content ? new THREE.Box3().setFromObject(this.content) : new THREE.Box3());
    }
    this.requestRender();
  }

  setSolarPathScale(percent: number): void {
    if (!Number.isFinite(percent) || percent < 5 || percent > 200) return;
    this.solarPathScale = percent;
    this.solarPath?.setScale(percent);
    this.requestRender();
  }

  setSolarPathOpacity(percent: number): void {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
    this.solarPathOpacity = percent;
    this.solarPath?.setOpacity(percent);
    this.requestRender();
  }

  onAnnualExposureInvalidated(callback: () => void): void { this.exposureInvalidated = callback; }

  private annualExposureKey(): string {
    const settings = this.solarSettings;
    return JSON.stringify([settings?.date.slice(0, 4), settings?.latitude, settings?.longitude,
      settings?.utcOffset, settings?.northAngle, this.section,
      this.selectionEntries.filter(entry => entry.object instanceof THREE.Mesh && this.isVisible(entry.object)).map(entry => entry.object.uuid)]);
  }

  async calculateAnnualExposure(progress: (percent: number) => void): Promise<ExposureResult> {
    if (!this.solarSettings || !this.content) throw new Error('Carregue o modelo e configure o estudo solar.');
    if (this.section) throw new Error('Desative o corte antes de calcular a exposição anual.');
    this.exposureAbort?.abort();
    const controller = new AbortController();
    this.exposureAbort = controller;
    this.annualExposure ??= new AnnualExposure();
    if (!this.annualExposure.root.parent) this.scene.add(this.annualExposure.root);
    this.exposureKey = this.annualExposureKey();
    const sources = this.selectionEntries.filter(entry => entry.object instanceof THREE.Mesh && this.isVisible(entry.object))
      .map(entry => ({
        object: entry.object as THREE.Mesh,
        material: entry.original,
        receiveExposure: entry.use !== 'REP'
          && !isRepLayer(entry.layerIndex === null ? entry.object.name : this.layers[entry.layerIndex].name),
      }));
    this.annualExposure.root.visible = false;
    this.requestRender();
    try {
      const result = await this.annualExposure.calculate(sources, { ...this.solarSettings }, controller.signal, progress);
      controller.signal.throwIfAborted();
      this.annualExposure.root.visible = true;
      this.requestRender();
      return result;
    } finally {
      if (this.exposureAbort === controller) this.exposureAbort = null;
    }
  }

  setAnnualExposureVisible(visible: boolean): void {
    if (!visible) this.exposureAbort?.abort();
    if (this.annualExposure) this.annualExposure.root.visible = visible && this.exposureKey === this.annualExposureKey();
    this.requestRender();
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
    const key = JSON.stringify([size, ...this.sun.position.toArray(), ...this.sun.target.position.toArray(), this.sun.shadow.mapSize.x]);
    if (key === this.shadowProjectionKey) return;
    this.shadowProjectionKey = key;
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
      converted.clippingPlanes = material.clippingPlanes;
      converted.clipShadows = material.clipShadows;
      this.solarMaterials.set(material, converted);
    }
    return converted;
  }

  resetView(): void {
    this.setProjectionMode('perspective');
  }

  setStandardView(view: StandardView): void {
    this.sectionTool?.cancelDrawing();
    if (this.section) {
      this.section.mode = '3d';
      this.sectionTool?.setState(this.section, this.sectionOpenCount, this.sectionUnsupportedCount);
    }
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
    this.sectionTool?.cancelDrawing();
    if (this.section) {
      this.section.mode = '3d';
      this.sectionTool?.setState(this.section, this.sectionOpenCount, this.sectionUnsupportedCount);
    }
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
    if (this.exposureAbort) return Promise.reject(new Error('Aguarde o cálculo do mapa de exposição terminar antes de exportar.'));
    return exportScenePng(this.scene, this.camera, this.content, this.renderer,
      { width: this.container.clientWidth, height: this.container.clientHeight }, options)
      .finally(() => this.requestRender());
  }

  captureState(): ViewerSnapshot {
    if (this.sectionTool?.drawing) throw new Error('Conclua ou cancele o desenho do corte antes de salvar uma cena.');
    if (this.exposureAbort) throw new Error('Aguarde o cálculo do mapa de exposição terminar antes de salvar a cena.');
    const index = this.selectionEntries.findIndex(entry => entry.object === this.selectedObject);
    return {
      modelAppearance: { ...(this.modelAppearance?.settings ?? DEFAULT_MODEL_APPEARANCE) },
      usageColors: structuredClone(this.usageColors ?? DEFAULT_USAGE_COLORS),
      ...(this.annualExposure?.root.visible && this.exposureKey === this.annualExposureKey() ? { annualExposure: true } : {}),
      ...(this.solarSettings ? { solar: {
        settings: { ...this.solarSettings },
        pathVisible: this.solarPath?.root.visible ?? false,
        scale: this.solarPathScale ?? 50,
        opacity: this.solarPathOpacity ?? 12,
      } } : {}),
      section: this.section ? { ...this.section } : null,
      sectionLines: { ...(this.sectionLineSettings ?? DEFAULT_SECTION_LINES) },
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

  restoreState(state: ViewerSnapshot, adaptToUpdatedModel = false): void {
    if (!adaptToUpdatedModel && (state.layers.length !== this.layers.length || state.layers.some((layer, index) => layer.name !== this.layers[index].name))) {
      throw new Error('A cena salva pertence a uma versão diferente das layers deste modelo.');
    }
    this.setAnnualExposureVisible(false);
    this.exposureKey = '';
    this.exposureInvalidated?.();
    this.selectionHistory = [];
    this.beforeSectionDrawing = null;
    this.sectionTool?.stopDrawing();
    this.setModelAppearance(state.modelAppearance ?? DEFAULT_MODEL_APPEARANCE);
    this.setUsageColors(state.usageColors ?? DEFAULT_USAGE_COLORS);
    this.setSolarPathVisible(false);
    if (state.solar) {
      this.setSolarPathScale(state.solar.scale);
      this.setSolarPathOpacity(state.solar.opacity);
      this.setSolarSettings({ ...state.solar.settings });
      this.setSolarPathVisible(state.solar.pathVisible);
    }
    this.setSectionLineSettings(state.sectionLines ?? DEFAULT_SECTION_LINES);
    this.selectedObject = null;
    this.selectedObjects = null;
    const savedLayers = new Map(state.layers.map(layer => [layer.name, layer.visible]));
    this.layers.forEach(layer => {
      const visible = savedLayers.get(layer.name);
      if (visible !== undefined) layer.visible = visible;
    });
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
          : adaptToUpdatedModel ? undefined : this.selectionEntries[saved.index];
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
    this.setSection(state.section ?? null, false);
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
    this.selectionHistory = [];
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
    this.selectionHistory = [];
    this.elevationBase = base;
    this.elevationTop = top;
    this.applyVisibilityFilters();
  }

  setSelectionMode(mode: SelectionMode): void {
    this.selectionHistory = [];
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
    const previous = this.captureSelection();
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
    this.rememberSelection(previous);
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
    const previous = this.captureSelection();
    this.selectedObject = null;
    this.selectedObjects = null;
    this.applyAppearance();
    this.rememberSelection(previous);
    this.onSelectionChange(null);
  }

  private captureSelection(): SelectionSnapshot {
    return {
      object: this.selectedObject,
      objects: this.selectedObjects == null ? null : new Set(this.selectedObjects),
      layers: this.layers.map(layer => layer.visible),
      usages: new Set(this.activeUsages),
    };
  }

  private rememberSelection(previous: SelectionSnapshot): void {
    const current = this.captureSelection();
    if (previous.object === current.object
      && (previous.objects === null) === (current.objects === null)
      && (previous.objects?.size ?? 0) === (current.objects?.size ?? 0)
      && [...previous.objects ?? []].every(object => current.objects?.has(object))
      && previous.layers.every((visible, index) => visible === current.layers[index])
      && previous.usages.size === current.usages.size
      && [...previous.usages].every(use => current.usages.has(use))) return;
    this.selectionHistory ??= [];
    this.selectionHistory.push(previous);
    if (this.selectionHistory.length > 100) this.selectionHistory.shift();
  }

  undoSelection(): boolean {
    if (this.selectionEnabled === false || this.measurement?.enabled) return false;
    const previous = this.selectionHistory?.pop();
    if (!previous) return false;
    this.selectedObject = previous.object;
    this.selectedObjects = previous.objects;
    this.layers.forEach((layer, index) => { layer.visible = previous.layers[index]; });
    this.activeUsages = previous.usages;
    this.applyAppearance();
    this.notifySelection();
    return true;
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
      () => [...this.selectionEntries.map(entry => entry.object).filter(object => !object.userData.isEdgeHelper), ...this.sectionCaps],
      () => metersPerUnit(this.content?.userData.settings),
      () => this.section ? sectionPlane(this.section) : null,
      () => this.sectionTool?.cancelDrawing());
  }

  mountSections(host: HTMLElement, button: HTMLButtonElement): void {
    this.sectionTool?.dispose();
    this.sectionTool = new SectionTool(this.renderer.domElement, host, button, {
      camera: () => this.camera,
      begin: () => {
        const previous = this.captureState();
        this.measurement?.setEnabled(false);
        this.setSection(null, false);
        this.setStandardView('top');
        this.beforeSectionDrawing = previous;
        this.controls.enabled = false;
      },
      cancel: () => {
        const previous = this.beforeSectionDrawing;
        this.beforeSectionDrawing = null;
        if (previous) this.restoreState(previous);
      },
      apply: state => { this.beforeSectionDrawing = null; this.setSection(state); },
    });
  }

  setSectionLineSettings(settings: SectionLineSettings): void {
    if (!isSectionLineSettings(settings)) return;
    this.sectionLineSettings = { ...settings };
    for (const cap of this.sectionCaps ?? []) {
      for (const child of cap.children) {
        if (child instanceof LineSegments2) applySectionOutlineSettings(child, settings);
      }
    }
    this.requestRender();
  }

  /** A visual section only: never alters source model geometry or project quantities. */
  setSection(state: SectionState | null, orient = true): void {
    if (state !== null && !isSectionState(state)) throw new Error('Corte inválido.');
    this.sectionTool?.stopDrawing();
    const samePlane = !!state && !!this.section && state.axis === this.section.axis
      && state.coordinate === this.section.coordinate && state.side === this.section.side;
    for (const cap of samePlane ? [] : this.sectionCaps ?? []) {
      for (const child of cap.children) {
        if (child instanceof LineSegments2) { child.geometry.dispose(); child.material.dispose(); }
      }
      cap.removeFromParent(); cap.geometry.dispose();
      const materials = Array.isArray(cap.material) ? cap.material : [cap.material];
      materials.forEach(material => material.dispose());
    }
    if (!samePlane) this.sectionCaps = [];
    this.section = state ? { ...state } : null;
    if (!state && orient) this.viewLabel = this.projectionMode === 'perspective' ? 'PERSPECTIVA' : 'ORTOGRÁFICA';
    const plane = state ? sectionPlane(state) : null;
    // Local planes clip the model and its edges, leaving the environment untouched.
    // The shared depth material also clips model shadows.
    this.renderer.localClippingEnabled = !!plane;
    this.shadowDepthMaterial.clippingPlanes = plane ? [plane] : [];
    this.shadowDepthMaterial.clipShadows = !!plane;
    this.shadowDepthMaterial.needsUpdate = true;
    const modelMaterials = new Set<THREE.Material>();
    for (const entry of this.selectionEntries) {
      for (const value of [entry.original, entry.muted]) {
        (Array.isArray(value) ? value : [value]).forEach(material => modelMaterials.add(material));
      }
    }
    this.solarMaterials?.forEach(material => modelMaterials.add(material));
    for (const material of modelMaterials) {
      material.clippingPlanes = plane ? [plane] : null;
      material.clipShadows = !!plane;
      material.needsUpdate = true;
    }
    this.controls.enabled = true;
    this.controls.enableRotate = state?.mode !== 'orthographic';
    if (plane) this.measurement?.setEnabled(false);
    let openCount = samePlane ? this.sectionOpenCount : 0;
    let unsupportedCount = samePlane ? this.sectionUnsupportedCount : 0;
    if (plane && this.content && !samePlane) {
      this.content.updateWorldMatrix(true, true);
      for (const entry of this.selectionEntries) {
        if (!(entry.object instanceof THREE.Mesh)) continue;
        if (entry.object instanceof THREE.SkinnedMesh || entry.object instanceof THREE.InstancedMesh) { unsupportedCount++; continue; }
        const result = createCapGeometry(entry.object, plane);
        if (result.open) openCount++;
        if (!result.geometry) continue;
        const originals = Array.isArray(entry.original) ? entry.original : [entry.original];
        const materials = originals.map(source => new THREE.MeshBasicMaterial({
          color: 'color' in source && source.color instanceof THREE.Color ? source.color : '#cccccc',
          side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        }));
        const cap = new THREE.Mesh(result.geometry, materials);
        cap.userData.isSectionCap = true;
        cap.name = 'Preenchimento do corte';
        cap.renderOrder = 2;
        cap.add(createSectionOutline(result.geometry, this.sectionLineSettings ?? DEFAULT_SECTION_LINES));
        entry.object.add(cap);
        this.sectionCaps.push(cap);
      }
    }
    this.sectionOpenCount = openCount;
    this.sectionUnsupportedCount = unsupportedCount;
    this.syncSectionAppearance();
    if (state && orient) {
      const normal = plane!.normal;
      const direction = normal.clone().negate();
      if (state.mode === '3d') direction.add(new THREE.Vector3(0, .7, 0))
        .addScaledVector(new THREE.Vector3(0, 1, 0).cross(normal), .5).normalize();
      this.activateView(state.mode === '3d' ? 'perspective' : 'orthographic', direction,
        new THREE.Vector3(0, 1, 0), `CORTE ${state.axis.toUpperCase()}`);
      this.controls.enableRotate = state.mode === '3d';
    }
    this.sectionTool?.setState(this.section, openCount, unsupportedCount);
    this.invalidateShadows();
  }

  private syncSectionAppearance(): void {
    for (const cap of this.sectionCaps ?? []) {
      const source = cap.parent as THREE.Mesh;
      const sources = Array.isArray(source.material) ? source.material : [source.material];
      const materials = cap.material as THREE.MeshBasicMaterial[];
      materials.forEach((material, index) => {
        const original = sources[index] ?? sources[0];
        if ('color' in original && original.color instanceof THREE.Color) material.color.copy(original.color);
        material.opacity = original.opacity;
        if (material.transparent !== original.transparent) { material.transparent = original.transparent; material.needsUpdate = true; }
        material.depthWrite = original.depthWrite;
      });
      const opacity = Math.min(...materials.map(material => material.opacity));
      for (const child of cap.children) {
        if (child instanceof LineSegments2) child.material.opacity = opacity;
      }
    }
    if (this.exposureKey && this.exposureKey !== this.annualExposureKey()) {
      this.exposureAbort?.abort();
      if (this.annualExposure) this.annualExposure.root.visible = false;
      this.exposureKey = '';
      this.exposureInvalidated?.();
    }
  }

  dispose(): void {
    this.exposureAbort?.abort();
    this.annualExposure?.dispose();
    this.solarPath?.dispose();
    this.sectionTool?.dispose();
    this.measurement?.dispose();
    this.renderScheduler?.dispose();
    this.renderScheduler = null;
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerCancel);
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
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
    this.requestRender();
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
    controls.addEventListener('change', this.requestRender);
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
    this.controls.enableRotate = this.section?.mode !== 'orthographic';
    this.controls.target.copy(target);
    this.fitToContent();
    this.controls.saveState();
    this.emitViewState();
    this.requestRender();
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
      const layerIndex = this.findLayerIndex(object);
      const layerName = layerIndex === null ? object.name : this.layers[layerIndex]?.name ?? object.name;
      if (isRepLayer(layerName)) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const bounds = object.geometry.boundingBox?.clone().applyMatrix4(object.matrixWorld);
      if (!bounds || bounds.isEmpty()) return;
      const id = this.findObjectId(object)?.toLowerCase();
      const csvElevation = id ? objectData.get(id)?.elevationM : null;
      const elevation = Math.round((csvElevation ?? bounds.min.y + absoluteBase) * 100) / 100;
      this.elevationEntries.push({ object, originalVisible: object.visible, elevation });
      levels.add(elevation);
    });

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
    this.invalidateShadows();
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
    this.usageMaterials?.forEach(appearance => appearance.clear());
    this.usageMaterials?.clear();
    this.modelAppearance?.clear();
    this.selectionHistory = [];
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
    const previous = this.captureSelection();
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
    this.rememberSelection(previous);
    this.notifySelection();
  }

  private notifySelection(): void {
    const object = this.selectedObject;
    if (!object) { this.onSelectionChange(null); return; }
    const selected = this.selectionEntries.find(entry => entry.object === object);
    const layer = selected?.layerIndex == null ? undefined : this.layers[selected.layerIndex];
    const layerName = layer ? layerLabel(layer, this.selectionMode) : undefined;
    this.onSelectionChange({
      count: this.selectedObjects?.size ?? 1,
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
    let shadowsChanged = false;
    for (const entry of this.selectionEntries) {
      const wasVisible = entry.object.visible;
      const castShadow = entry.object.castShadow;
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
      shadowsChanged ||= wasVisible !== entry.object.visible || castShadow !== entry.object.castShadow;
      entry.object.receiveShadow = entry.receiveShadow;
      if (solarMesh) {
        entry.object.material = Array.isArray(entry.object.material)
          ? entry.object.material.map(material => this.solarMaterial(material))
          : this.solarMaterial(entry.object.material);
      }
      if (this.modelAppearance && !this.isRepEntry(entry)) {
        const edge = entry.object instanceof THREE.Line;
        entry.object.material = Array.isArray(entry.object.material)
          ? entry.object.material.map(material => this.modelAppearance!.apply(material, edge))
          : this.modelAppearance.apply(entry.object.material, edge);
      }
      if (this.selectionMode === 'use' && this.usageColors?.enabled && entry.use
        && visuallyHighlighted && !(entry.object instanceof THREE.Line)) {
        let appearance = this.usageMaterials.get(entry.use);
        if (!appearance) {
          appearance = new ModelAppearance();
          appearance.configure({ ...DEFAULT_MODEL_APPEARANCE, overrideColor: true, color: this.usageColors.colors[entry.use] });
          this.usageMaterials.set(entry.use, appearance);
        }
        entry.object.material = Array.isArray(entry.object.material)
          ? entry.object.material.map(material => appearance!.apply(material, false))
          : appearance.apply(entry.object.material, false);
      }
    }
    this.syncSectionAppearance();
    if (shadowsChanged) this.invalidateShadows();
    else this.requestRender();
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
    const plane = this.section ? sectionPlane(this.section) : null;
    const picked = this.raycaster.intersectObjects([...candidates, ...(this.sectionCaps ?? [])], false)
      .find(hit => !plane || plane.distanceToPoint(hit.point) >= -1e-7)?.object;
    const hit = picked?.userData.isSectionCap ? picked.parent : picked;
    if (hit instanceof THREE.Mesh || hit instanceof THREE.Line || hit instanceof THREE.Points) {
      this.select(hit, event.ctrlKey ? 'remove' : event.shiftKey ? 'add' : 'replace');
    } else if (!event.ctrlKey && !event.shiftKey) this.clearSelection();
  }

  private readonly onPointerCancel = (): void => { this.pointerStart = null; };
  private readonly onKeyDown = (event: KeyboardEvent): void => this.handleKeyDown(event);

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.active === false) return;
    const target = event.target as HTMLElement | null;
    if (event.defaultPrevented || target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z') {
      if (this.undoSelection()) event.preventDefault();
      return;
    }
    if (event.key === 'Escape') this.clearSelection();
  }

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

  private requestRender(): void { this.renderScheduler?.invalidate(); }

  private invalidateShadows(): void {
    // The camera does not affect this directional light's shadow projection.
    if (this.sun) this.sun.shadow.needsUpdate = true;
    this.requestRender();
  }

  private readonly onVisibilityChange = (): void => {
    this.renderScheduler?.setActive(this.active && !document.hidden);
  };

  private render = (): void => {
    this.controls.update();
    this.emitViewState();
    this.measurement?.update();
    this.sectionTool?.update();
    this.renderer.render(this.scene, this.camera);
  };

  private addEnvironment(): void {
    this.scene.add(new THREE.HemisphereLight('#f7fbff', '#9ba6a0', 2.4));

    const sun = this.sun;
    sun.position.set(-12, 22, 14);
    sun.castShadow = true;
    sun.shadow.autoUpdate = false;
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
