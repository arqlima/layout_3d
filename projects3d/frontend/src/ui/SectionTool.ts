import * as THREE from 'three';
import type { SectionState } from '../types/section';
import { sectionFromPoints } from '../viewer/sectionGeometry';

interface SectionActions {
  camera(): THREE.Camera;
  begin(): void;
  cancel(): void;
  apply(section: SectionState | null): void;
}

/** Two clicks in a fixed top view; drafting events never reach selection or OrbitControls. */
export class SectionTool {
  drawing = false;
  private state: SectionState | null = null;
  private start: THREE.Vector3 | null = null;
  private hover: THREE.Vector3 | null = null;
  private pending: SectionState | null = null;
  private down: { id: number; x: number; y: number } | null = null;
  private readonly panel = document.createElement('div');
  private readonly overlay = document.createElement('div');
  private readonly svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private readonly line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  private readonly hint: HTMLElement;
  private readonly ray = new THREE.Raycaster();
  private readonly positive = document.createElement('button');
  private readonly negative = document.createElement('button');

  constructor(private readonly canvas: HTMLCanvasElement, host: HTMLElement,
    private readonly button: HTMLButtonElement, private readonly actions: SectionActions) {
    this.panel.className = 'section-panel';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Corte arquitetônico');
    this.panel.innerHTML = `<strong>Corte arquitetônico</strong>
      <p class="section-hint" role="status" aria-live="polite"></p>
      <div class="section-actions">
        <button type="button" data-action="orthographic">Ortogonal</button>
        <button type="button" data-action="3d">3D livre</button>
        <button type="button" data-action="invert">Inverter lado</button>
        <button type="button" data-action="reposition">Reposicionar</button>
        <button type="button" data-action="clear">Desativar</button>
      </div><button type="button" data-action="cancel" hidden>Cancelar desenho</button>`;
    this.hint = this.panel.querySelector('.section-hint')!;
    this.overlay.className = 'section-overlay';
    this.overlay.hidden = true;
    this.svg.append(this.line);
    for (const arrow of [this.positive, this.negative]) {
      arrow.type = 'button'; arrow.className = 'section-side-arrow'; arrow.hidden = true;
    }
    this.positive.addEventListener('click', this.choosePositive);
    this.negative.addEventListener('click', this.chooseNegative);
    this.overlay.append(this.svg, this.positive, this.negative);
    host.append(this.panel);
    canvas.parentElement!.append(this.overlay);
    button.addEventListener('click', this.toggle);
    this.panel.addEventListener('click', this.panelClick);
    canvas.addEventListener('pointerdown', this.pointerDown, true);
    canvas.addEventListener('pointerup', this.pointerUp, true);
    canvas.addEventListener('pointermove', this.pointerMove, true);
    canvas.addEventListener('pointercancel', this.pointerCancel, true);
    window.addEventListener('keydown', this.keyDown);
  }

  setState(state: SectionState | null, openCount = 0, unsupportedCount = 0): void {
    this.stopDrawing();
    this.state = state ? { ...state } : null;
    this.panel.hidden = !state;
    this.button.setAttribute('aria-pressed', String(!!state));
    this.button.title = state ? 'Reposicionar corte' : 'Criar corte na vista superior';
    this.panel.querySelector<HTMLElement>('.section-actions')!.hidden = !state;
    for (const mode of ['orthographic', '3d']) {
      this.panel.querySelector(`[data-action="${mode}"]`)!.setAttribute('aria-pressed', String(state?.mode === mode));
    }
    this.hint.textContent = state ? `Direção ${state.axis.toUpperCase()} · ${state.mode === '3d' ? 'Rotação livre' : 'Vista ortogonal'} · Salve em uma cena para reutilizar.` : '';
    if (openCount) this.hint.textContent += ` ${openCount} objeto(s) com contorno aberto: sem preenchimento.`;
    if (unsupportedCount) this.hint.textContent += ` ${unsupportedCount} objeto(s) animados ou instanciados: sem preenchimento.`;
  }

  stopDrawing(): void {
    this.drawing = false;
    this.start = this.hover = null; this.down = null;
    this.pending = null;
    this.positive.hidden = this.negative.hidden = true;
    this.overlay.hidden = true;
    this.canvas.classList.remove('is-sectioning');
    this.panel.querySelector<HTMLElement>('[data-action="cancel"]')!.hidden = true;
  }

  cancelDrawing(): void {
    if (!this.drawing) return;
    this.stopDrawing();
    this.actions.cancel();
  }

  private beginDrawing(): void {
    this.actions.begin();
    this.drawing = true;
    this.state = null;
    this.panel.hidden = false;
    this.overlay.hidden = false;
    this.line.style.display = 'none';
    this.button.setAttribute('aria-pressed', 'true');
    this.canvas.classList.add('is-sectioning');
    this.hint.textContent = 'Clique no início da linha e depois na direção X ou Y · Esc cancela';
    this.panel.querySelector<HTMLElement>('.section-actions')!.hidden = true;
    this.panel.querySelector<HTMLElement>('[data-action="cancel"]')!.hidden = false;
  }

  private readonly toggle = (): void => {
    if (this.drawing) this.cancelDrawing(); else this.beginDrawing();
  };
  private readonly panelClick = (event: MouseEvent): void => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.action;
    if (action === 'cancel') this.cancelDrawing();
    else if (action === 'reposition') this.beginDrawing();
    else if (action === 'clear') this.actions.apply(null);
    else if (this.state) {
      if (action === 'invert') this.actions.apply({ ...this.state, side: this.state.side === 1 ? -1 : 1 });
      if (action === 'orthographic' || action === '3d') this.actions.apply({ ...this.state, mode: action });
    }
  };
  private readonly keyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.drawing) { event.preventDefault(); this.cancelDrawing(); }
  };
  private chooseSide(side: 1 | -1): void {
    if (!this.pending) return;
    const section = { ...this.pending, side };
    this.stopDrawing();
    this.actions.apply(section);
  }
  private readonly choosePositive = (): void => this.chooseSide(1);
  private readonly chooseNegative = (): void => this.chooseSide(-1);
  private pick(event: PointerEvent): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const camera = this.actions.camera();
    camera.updateMatrixWorld(true);
    this.ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  }
  private readonly pointerDown = (event: PointerEvent): void => {
    if (!this.drawing) return;
    event.stopImmediatePropagation();
    this.down = event.button === 0 ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
  };
  private readonly pointerCancel = (): void => { this.down = null; };
  private readonly pointerUp = (event: PointerEvent): void => {
    if (!this.drawing) return;
    event.stopImmediatePropagation();
    if (this.pending) return;
    const down = this.down; this.down = null;
    if (!down || down.id !== event.pointerId || event.button !== 0
      || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    const point = this.pick(event);
    if (!point) return;
    if (!this.start) { this.start = point; this.hint.textContent = 'Indique a direção da linha · Trava automática em X ou Y · Esc cancela'; }
    else {
      const section = sectionFromPoints(this.start, point);
      if (section) {
        this.pending = section; this.hover = point;
        const horizontal = section.axis === 'x';
        this.positive.textContent = horizontal ? '↓' : '→';
        this.negative.textContent = horizontal ? '↑' : '←';
        this.positive.setAttribute('aria-label', horizontal ? 'Olhar para baixo na planta' : 'Olhar para a direita na planta');
        this.negative.setAttribute('aria-label', horizontal ? 'Olhar para cima na planta' : 'Olhar para a esquerda na planta');
        this.positive.hidden = this.negative.hidden = false;
        this.update();
        this.positive.focus();
      }
    }
  };
  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.drawing) return;
    event.stopImmediatePropagation();
    if (this.pending) return;
    this.hover = this.pick(event);
    this.update();
  };

  update(): void {
    if (!this.drawing || !this.start || !this.hover) return;
    const section = sectionFromPoints(this.start, this.hover);
    if (!section) return;
    const end = this.hover.clone();
    if (section.axis === 'x') end.z = this.start.z; else end.x = this.start.x;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const a = this.start.clone().project(this.actions.camera()), b = end.project(this.actions.camera());
    this.line.style.display = '';
    this.line.setAttribute('x1', String((a.x + 1) * width / 2)); this.line.setAttribute('y1', String((1 - a.y) * height / 2));
    this.line.setAttribute('x2', String((b.x + 1) * width / 2)); this.line.setAttribute('y2', String((1 - b.y) * height / 2));
    const centerX = (a.x + b.x + 2) * width / 4, centerY = (2 - a.y - b.y) * height / 4;
    const horizontal = section.axis === 'x';
    this.positive.style.left = `${centerX + (horizontal ? 0 : 40)}px`;
    this.positive.style.top = `${centerY + (horizontal ? 40 : 0)}px`;
    this.negative.style.left = `${centerX - (horizontal ? 0 : 40)}px`;
    this.negative.style.top = `${centerY - (horizontal ? 40 : 0)}px`;
    this.hint.textContent = this.pending ? 'Escolha uma seta para definir o lado de observação · Esc cancela'
      : `Direção ${section.axis.toUpperCase()} · Clique para fixar a linha · Esc cancela`;
  }

  dispose(): void {
    this.stopDrawing();
    this.button.removeEventListener('click', this.toggle);
    this.panel.removeEventListener('click', this.panelClick);
    this.positive.removeEventListener('click', this.choosePositive);
    this.negative.removeEventListener('click', this.chooseNegative);
    this.canvas.removeEventListener('pointerdown', this.pointerDown, true);
    this.canvas.removeEventListener('pointerup', this.pointerUp, true);
    this.canvas.removeEventListener('pointermove', this.pointerMove, true);
    this.canvas.removeEventListener('pointercancel', this.pointerCancel, true);
    window.removeEventListener('keydown', this.keyDown);
    this.overlay.remove(); this.panel.remove();
  }
}
