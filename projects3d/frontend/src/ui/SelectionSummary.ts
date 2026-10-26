import type { SelectionTotals } from '../types/model';

export function mountSelectionSummary(host: HTMLElement): (totals: SelectionTotals) => void {
  host.innerHTML = `<h3 class="detail-label">RESUMO DOS MARCADOS</h3>
    <dl class="marked-totals">
      <div><dt>Área privativa</dt><dd data-total="PRIV"></dd></div>
      <div><dt>Área comum</dt><dd data-total="COM"></dd></div>
      <div><dt>Área de estacionamento</dt><dd data-total="EST"></dd></div>
      <div><dt>Total de vagas</dt><dd data-total="VAGAS"></dd></div>
      <div class="marked-grand-total"><dt>Total de áreas</dt><dd data-total="area"></dd></div>
    </dl><p class="marked-total-note">Privativa + comum + estacionamento</p>
    <dl id="marked-efficiency" class="marked-totals marked-efficiency" hidden>
      <div><dt>Eficiência</dt><dd data-total="efficiency" title="Área privativa ÷ total de áreas"></dd></div>
    </dl>
    <p class="marked-data-note" role="status" aria-live="polite"></p>`;
  const area = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const count = new Intl.NumberFormat('pt-BR');
  const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fields = new Map([...host.querySelectorAll<HTMLElement>('[data-total]')].map(item => [item.dataset.total!, item]));
  const note = host.querySelector<HTMLElement>('.marked-data-note')!;
  return totals => {
    for (const code of ['PRIV', 'COM', 'EST'] as const) fields.get(code)!.textContent = `${area.format(totals.byUse[code].areaM2)} m²`;
    fields.get('VAGAS')!.textContent = count.format(totals.byUse.VAGAS.count);
    fields.get('area')!.textContent = `${area.format(totals.areaM2)} m²`;
    fields.get('efficiency')!.textContent = totals.efficiencyRatio === null ? '—' : percent.format(totals.efficiencyRatio);
    note.textContent = totals.objectCount === 0 ? 'Nenhum objeto marcado.'
      : totals.missingAreaCount > 0 ? `Total parcial: ${count.format(totals.missingAreaCount)} objeto(s) sem área ou uso informado.` : '';
  };
}
