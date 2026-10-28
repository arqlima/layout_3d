import * as THREE from 'three';

/** Rhino enum values; glTF and the demo use meters. No geometry is rescaled. */
export function metersPerUnit(settings?: { modelUnitSystem?: number | { value: number } }): number {
  const unit = settings?.modelUnitSystem;
  const code = typeof unit === 'number' ? unit : unit?.value;
  const factors: Record<number, number> = {
    1: 1e-6, 2: 0.001, 3: 0.01, 4: 1, 5: 1000,
    6: 0.0000000254, 7: 0.0000254, 8: 0.0254, 9: 0.3048,
    10: 1609.344, 12: 1e-10, 13: 1e-9, 14: 0.1, 15: 10,
    16: 100, 17: 1e6, 18: 1e9, 19: 0.9144, 20: 0.0254 / 72,
    21: 0.0254 / 6, 22: 1852, 23: 149597870700,
    24: 9.4607304725808e15, 25: 3.085677581491367e16,
  };
  return code === undefined ? 1 : factors[code] ?? 1;
}

export function formatDistance(a: THREE.Vector3, b: THREE.Vector3, factor: number): string {
  return `${(a.distanceTo(b) * factor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}

function visible(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

/** Sample around the pointer so corners also snap just outside a silhouette.
 * Only vertices of the frontmost intersected faces/segments are considered.
 * The radius is in CSS pixels, independent of zoom and device pixel ratio.
 */
export function snapVertex(
  ray: THREE.Raycaster, objects: THREE.Object3D[], camera: THREE.Camera,
  x: number, y: number, width: number, height: number,
): THREE.Vector3 | null {
  const radius = 14;
  const candidates = objects.filter(visible);
  const pointer = new THREE.Vector2();
  let best: THREE.Vector3 | null = null;
  let bestDistance = radius;
  const offsets = [[0, 0], [-10, 0], [10, 0], [0, -10], [0, 10], [-10, -10], [10, -10], [-10, 10], [10, 10]];
  for (const [dx, dy] of offsets) {
    pointer.set((x + dx) / width * 2 - 1, -(y + dy) / height * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(candidates, false)[0];
    if (!hit) continue;
    const object = hit.object as THREE.Mesh | THREE.Line | THREE.Points;
    const positions = object.geometry?.getAttribute('position');
    if (!positions) continue;
    const indices = hit.face ? [hit.face.a, hit.face.b, hit.face.c]
      : hit.index === undefined ? [] : object instanceof THREE.Points ? [hit.index] : [hit.index, hit.index + 1];
    for (const index of indices) {
      if (index >= positions.count) continue;
      const world = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld);
      const projected = world.clone().project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const distance = Math.hypot((projected.x + 1) * width / 2 - x, (1 - projected.y) * height / 2 - y);
      if (distance < bestDistance) { best = world; bestDistance = distance; }
    }
  }
  return best;
}

export class MeasurementTool {
  enabled = false;
  private start: THREE.Vector3 | null = null;
  private end: THREE.Vector3 | null = null;
  private hover: THREE.Vector3 | null = null;
  private down: { id: number; x: number; y: number } | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly overlay = document.createElement('div');
  private readonly svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private readonly line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  private readonly dots = [0, 1, 2].map(() => document.createElementNS('http://www.w3.org/2000/svg', 'circle'));
  private readonly label = document.createElement('span');
  private readonly hint = document.createElement('span');

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly button: HTMLButtonElement,
    private readonly getCamera: () => THREE.Camera,
    private readonly getObjects: () => THREE.Object3D[],
    private readonly getUnits: () => number,
  ) {
    this.overlay.className = 'measurement-overlay';
    this.overlay.hidden = true;
    this.label.className = 'measurement-label';
    this.hint.className = 'measurement-hint';
    this.hint.setAttribute('role', 'status');
    this.hint.setAttribute('aria-live', 'polite');
    this.dots.forEach(dot => { dot.setAttribute('r', '5'); this.svg.append(dot); });
    this.svg.prepend(this.line);
    this.overlay.append(this.svg, this.label, this.hint);
    canvas.parentElement!.append(this.overlay);
    button.addEventListener('click', this.toggle);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointerup', this.pointerUp);
    canvas.addEventListener('pointercancel', this.cancelPointer);
    canvas.addEventListener('pointerleave', this.leave);
    window.addEventListener('keydown', this.keyDown);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.button.setAttribute('aria-pressed', String(enabled));
    this.canvas.classList.toggle('is-measuring', enabled);
    this.overlay.hidden = !enabled;
    this.start = this.end = this.hover = null;
    this.down = null;
    this.hint.textContent = 'Selecione o primeiro vértice · Esc para sair';
    this.update();
  }

  private readonly toggle = (): void => this.setEnabled(!this.enabled);
  private readonly keyDown = (event: KeyboardEvent): void => {
    if (this.enabled && event.key === 'Escape') this.setEnabled(false);
  };
  private readonly cancelPointer = (): void => { this.down = null; };
  private readonly leave = (): void => { this.hover = null; this.update(); };
  private readonly pointerDown = (event: PointerEvent): void => {
    this.down = this.enabled && event.button === 0 && event.isPrimary
      ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
  };
  private pick(event: PointerEvent): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.getCamera().updateMatrixWorld();
    return snapVertex(this.ray, this.getObjects(), this.getCamera(), event.clientX - rect.left,
      event.clientY - rect.top, rect.width, rect.height);
  }
  private readonly move = (event: PointerEvent): void => {
    if (!this.enabled || event.buttons) return;
    this.hover = this.pick(event);
    this.update();
  };
  private readonly pointerUp = (event: PointerEvent): void => {
    const down = this.down;
    this.down = null;
    if (!this.enabled || !down || down.id !== event.pointerId || event.button !== 0
      || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    const point = this.pick(event);
    if (!point) return;
    if (!this.start || this.end) { this.start = point; this.end = null; }
    else if (this.start.distanceToSquared(point) > 1e-16) this.end = point;
    this.hover = point;
    this.hint.textContent = this.end
      ? `${formatDistance(this.start, this.end, this.getUnits())} · Clique para medir novamente · Esc para sair`
      : 'Selecione o segundo vértice · Esc para sair';
    this.update();
  };

  update(): void {
    if (!this.enabled) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const project = (point: THREE.Vector3) => {
      const p = point.clone().project(this.getCamera());
      return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2, visible: p.z >= -1 && p.z <= 1 };
    };
    const end = this.end ?? this.hover;
    [this.start, end, this.hover].forEach((point, index) => {
      const p = point && project(point);
      this.dots[index].style.display = p?.visible ? '' : 'none';
      if (p) { this.dots[index].setAttribute('cx', String(p.x)); this.dots[index].setAttribute('cy', String(p.y)); }
    });
    const a = this.start && project(this.start);
    const b = end && project(end);
    const show = !!(a?.visible && b?.visible);
    this.line.style.display = show ? '' : 'none';
    this.label.hidden = !show;
    if (show && a && b && this.start && end) {
      this.line.setAttribute('x1', String(a.x)); this.line.setAttribute('y1', String(a.y));
      this.line.setAttribute('x2', String(b.x)); this.line.setAttribute('y2', String(b.y));
      this.label.style.left = `${(a.x + b.x) / 2}px`;
      this.label.style.top = `${(a.y + b.y) / 2}px`;
      this.label.textContent = formatDistance(this.start, end, this.getUnits());
    }
  }

  dispose(): void {
    this.setEnabled(false);
    this.button.removeEventListener('click', this.toggle);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerdown', this.pointerDown);
    this.canvas.removeEventListener('pointerup', this.pointerUp);
    this.canvas.removeEventListener('pointercancel', this.cancelPointer);
    this.canvas.removeEventListener('pointerleave', this.leave);
    window.removeEventListener('keydown', this.keyDown);
    this.overlay.remove();
  }
}
