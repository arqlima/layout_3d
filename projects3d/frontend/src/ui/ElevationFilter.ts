type Limit = 'top' | 'base';
const scaleObservers = new WeakMap<HTMLElement, ResizeObserver>();

/** Controle vertical com limites independentes para topo e base. */
export function mountElevationFilter(
  host: HTMLElement,
  levels: number[],
  onChange: (base: number, top: number) => void,
): void {
  scaleObservers.get(host)?.disconnect();
  scaleObservers.delete(host);
  host.replaceChildren();
  host.hidden = levels.length < 2;
  if (levels.length < 2) return;

  const format = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const min = levels[0];
  const max = levels[levels.length - 1];
  let baseIndex = 0;
  let topIndex = levels.length - 1;

  const heading = document.createElement('div');
  heading.className = 'elevation-heading';
  const title = document.createElement('strong');
  title.textContent = 'COTAS';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Tudo';
  reset.title = 'Mostrar todas as cotas';
  heading.append(title, reset);

  const summary = document.createElement('div');
  summary.className = 'elevation-summary';
  const topValue = document.createElement('span');
  const baseValue = document.createElement('span');
  summary.append(topValue, baseValue);

  const scale = document.createElement('div');
  scale.className = 'elevation-scale';
  const rail = document.createElement('div');
  rail.className = 'elevation-rail';
  const active = document.createElement('div');
  active.className = 'elevation-active';
  scale.append(rail, active);

  const ticks = levels.map((level) => {
    const tick = document.createElement('span');
    tick.className = 'elevation-tick';
    tick.textContent = format.format(level);
    tick.style.top = `${((max - level) / (max - min)) * 100}%`;
    tick.setAttribute('aria-hidden', 'true');
    scale.append(tick);
    return tick;
  });

  const makeHandle = (limit: Limit, label: string) => {
    const handle = document.createElement('div');
    handle.className = `elevation-handle elevation-handle-${limit}`;
    handle.textContent = label;
    handle.title = limit === 'top' ? 'Arraste para ocultar as cotas superiores' : 'Arraste para ocultar as cotas inferiores';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'slider');
    handle.setAttribute('aria-label', `Cota ${limit === 'top' ? 'máxima (topo)' : 'mínima (base)'}`);
    handle.setAttribute('aria-orientation', 'vertical');
    scale.append(handle);
    return handle;
  };
  const topHandle = makeHandle('top', 'T');
  const baseHandle = makeHandle('base', 'B');

  const percentage = (value: number) => ((max - value) / (max - min)) * 100;
  const render = (notify: boolean) => {
    const top = levels[topIndex];
    const base = levels[baseIndex];
    topValue.textContent = `Topo ${format.format(top)} m`;
    baseValue.textContent = `Base ${format.format(base)} m`;
    topHandle.style.top = `${percentage(top)}%`;
    baseHandle.style.top = `${percentage(base)}%`;
    active.style.top = `${percentage(top)}%`;
    active.style.bottom = `${100 - percentage(base)}%`;
    ticks.forEach((tick, index) => tick.classList.toggle('is-in-range', index >= baseIndex && index <= topIndex));
    for (const [handle, value, allowedMin, allowedMax] of [
      [topHandle, top, base, max],
      [baseHandle, base, min, top],
    ] as const) {
      handle.setAttribute('aria-valuemin', String(allowedMin));
      handle.setAttribute('aria-valuemax', String(allowedMax));
      handle.setAttribute('aria-valuenow', String(value));
      handle.setAttribute('aria-valuetext', `${format.format(value)} metros`);
    }
    if (notify) onChange(base, top);
  };

  const nearestIndex = (clientY: number) => {
    const rect = scale.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (rect.bottom - clientY) / rect.height));
    const value = min + fraction * (max - min);
    let nearest = 0;
    for (let index = 1; index < levels.length; index++) {
      if (Math.abs(levels[index] - value) < Math.abs(levels[nearest] - value)) nearest = index;
    }
    return nearest;
  };

  const setIndex = (limit: Limit, index: number) => {
    if (limit === 'top') topIndex = Math.max(baseIndex, Math.min(levels.length - 1, index));
    else baseIndex = Math.max(0, Math.min(topIndex, index));
    render(true);
  };

  for (const [handle, limit] of [[topHandle, 'top'], [baseHandle, 'base']] as const) {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      setIndex(limit, nearestIndex(event.clientY));
    });
    handle.addEventListener('pointermove', (event) => {
      if (handle.hasPointerCapture(event.pointerId)) setIndex(limit, nearestIndex(event.clientY));
    });
    handle.addEventListener('pointerup', (event) => handle.releasePointerCapture(event.pointerId));
    handle.addEventListener('keydown', (event) => {
      const current = limit === 'top' ? topIndex : baseIndex;
      const next = {
        ArrowUp: current + 1,
        ArrowRight: current + 1,
        ArrowDown: current - 1,
        ArrowLeft: current - 1,
        PageUp: current + 3,
        PageDown: current - 3,
        Home: limit === 'top' ? baseIndex : 0,
        End: limit === 'top' ? levels.length - 1 : topIndex,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      setIndex(limit, next);
    });
  }

  scale.addEventListener('pointerdown', (event) => {
    const index = nearestIndex(event.clientY);
    const limit = Math.abs(index - topIndex) <= Math.abs(index - baseIndex) ? 'top' : 'base';
    setIndex(limit, index);
  });
  reset.addEventListener('click', () => {
    baseIndex = 0;
    topIndex = levels.length - 1;
    render(true);
  });

  host.append(heading, summary, scale);
  // Mantém todas as cotas selecionáveis, mas espaça os números em pixels.
  const updateTickLabels = () => {
    const height = scale.clientHeight;
    let lastLabel = -Infinity;
    for (let index = levels.length - 1; index >= 0; index--) {
      const position = ((max - levels[index]) / (max - min)) * height;
      const endpoint = index === 0 || index === levels.length - 1;
      const show = endpoint || (position - lastLabel >= 16 && height - position >= 16);
      ticks[index].classList.toggle('is-minor', !show);
      if (show) lastLabel = position;
    }
  };
  const observer = new ResizeObserver(updateTickLabels);
  observer.observe(scale);
  scaleObservers.set(host, observer);
  updateTickLabels();
  render(false);
}
