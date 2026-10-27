import { normalizeNorthAngle, northPointerAngle, northScreenAngle, type GroundProjection } from '../data/north';
import type { ViewState } from '../types/view';

export function mountNorthControl(host: HTMLElement, onChange: (angle: number) => void) {
  host.innerHTML = `
    <span class="detail-label">NORTE</span>
    <div class="north-dial" role="slider" tabindex="0" aria-label="Direção do norte do projeto"
      aria-valuemin="0" aria-valuemax="359" aria-valuenow="0"
      title="Arraste para girar o norte. Use as setas do teclado para ajustar.">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="north-ring" cx="50" cy="50" r="43" />
        <path class="north-ticks" d="M50 7v6 M93 50h-6 M50 93v-6 M7 50h6" />
        <g class="north-arrow"><path class="north-tip" d="M50 18 39 59 50 53 61 59Z" />
          <path class="north-tail" d="M50 53v24" /><text x="50" y="13" text-anchor="middle">N</text></g>
        <circle class="north-center" cx="50" cy="50" r="3" />
      </svg>
    </div>
    <output class="north-value">0°</output><small>Arraste para girar</small>`;
  const dial = host.querySelector<HTMLElement>('.north-dial')!;
  const arrow = host.querySelector<SVGGElement>('.north-arrow')!;
  const value = host.querySelector<HTMLOutputElement>('.north-value')!;
  let angle = 0;
  let projection: GroundProjection = [1, 0, 0, -1];
  let pointer: number | null = null;
  const render = () => {
    arrow.setAttribute('transform', `rotate(${northScreenAngle(angle, projection)} 50 50)`);
    dial.setAttribute('aria-valuenow', String(angle));
    dial.setAttribute('aria-valuetext', `${angle} graus em relação ao norte original do modelo`);
    value.value = `${angle}°`;
  };
  const change = (next: number) => {
    angle = normalizeNorthAngle(next);
    render();
    onChange(angle);
  };
  const fromPointer = (event: PointerEvent) => {
    const rect = dial.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    if (Math.hypot(x, y) > 10) change(northPointerAngle(x, y, projection));
  };
  dial.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointer !== null) return;
    event.preventDefault();
    dial.focus();
    pointer = event.pointerId;
    dial.setPointerCapture(pointer);
    fromPointer(event);
  });
  dial.addEventListener('pointermove', event => { if (event.pointerId === pointer) fromPointer(event); });
  const finish = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    if (dial.hasPointerCapture(event.pointerId)) dial.releasePointerCapture(event.pointerId);
    pointer = null;
  };
  dial.addEventListener('pointerup', finish);
  dial.addEventListener('pointercancel', finish);
  dial.addEventListener('lostpointercapture', () => { pointer = null; });
  dial.addEventListener('keydown', event => {
    const step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') change(angle + step);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') change(angle - step);
    else if (event.key === 'Home') change(0);
    else if (event.key === 'End') change(359);
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  render();
  return {
    update(state: ViewState) { if (state.groundProjection) projection = state.groundProjection; render(); },
  };
}
