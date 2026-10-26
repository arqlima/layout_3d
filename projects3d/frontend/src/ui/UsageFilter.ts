import { USAGE_CODES, DEFAULT_USAGES, type UsageCode, type UsageTotal } from '../types/model';

const labels: Record<UsageCode, string> = {
  COM: 'Comum',
  EST: 'Estacionamento',
  PRIV: 'Privativo',
  VAGAS: 'Vagas',
  REP: 'REP',
};

export interface UsageFilter {
  setTotals(totals: Record<UsageCode, UsageTotal>): void;
  setActive(usages: ReadonlySet<UsageCode>): void;
}

/** Botões independentes: usos desligados continuam na cena como contexto esmaecido. */
export function mountUsageFilter(
  host: HTMLElement,
  onChange: (active: ReadonlySet<UsageCode>) => void,
): UsageFilter {
  const active = new Set<UsageCode>(DEFAULT_USAGES);
  const countFormat = new Intl.NumberFormat('pt-BR');
  const areaFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const heading = document.createElement('div');
  heading.className = 'usage-heading';
  heading.textContent = 'FILTRAR POR USO';
  const buttons = document.createElement('div');
  buttons.className = 'usage-buttons';
  const summary = document.createElement('div');
  summary.className = 'usage-summary';
  summary.setAttribute('role', 'status');
  summary.setAttribute('aria-live', 'polite');
  const buttonByCode = new Map<UsageCode, HTMLButtonElement>();
  let totals: Record<UsageCode, UsageTotal> | null = null;

  const render = () => {
    for (const [code, button] of buttonByCode) button.setAttribute('aria-pressed', String(active.has(code)));
    if (!totals) return;
    summary.replaceChildren();
    if (active.size === 0) {
      summary.textContent = 'Nenhum uso ativo';
      return;
    }
    for (const code of USAGE_CODES) {
      if (!active.has(code)) continue;
      const total = totals[code];
      const item = document.createElement('span');
      item.className = 'usage-total';
      const count = code === 'VAGAS'
        ? `${countFormat.format(total.count)} ${total.count === 1 ? 'vaga' : 'vagas'}`
        : `${countFormat.format(total.count)} ${total.count === 1 ? 'unidade' : 'unidades'}`;
      item.textContent = code === 'VAGAS'
        ? `${labels[code]} · ${count}`
        : `${labels[code]} · ${count} · ${areaFormat.format(total.areaM2)} m²`;
      summary.append(item);
    }
  };

  for (const code of USAGE_CODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'usage-button';
    button.textContent = labels[code];
    button.title = `${labels[code]} (${code})`;
    button.setAttribute('aria-pressed', String(active.has(code)));
    button.addEventListener('click', () => {
      if (active.has(code)) active.delete(code);
      else active.add(code);
      render();
      onChange(new Set(active));
    });
    buttonByCode.set(code, button);
    buttons.append(button);
  }
  host.replaceChildren(heading, buttons, summary);
  host.hidden = false;
  return {
    setActive(usages) {
      active.clear();
      for (const code of usages) active.add(code);
      render();
    },
    setTotals(value) {
      totals = value;
      render();
    },
  };
}
