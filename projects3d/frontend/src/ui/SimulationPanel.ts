import { calculateSimulation, emptySimulation, parseSimulationNumber, SimulationStore, simulationLayerLabel, simulationUsageSections } from '../data/simulation';
import { projectConfig } from '../data/config';
import type { SimulationLayer, SimulationResult } from '../types/simulation';
import { createIcon, iconMarkup } from './icons';

const amount = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}

export function mountSimulationPanel(host: HTMLElement, sourceRows: SimulationLayer[]): void {
  const rows = sourceRows.filter(row => row.use !== 'VAGAS');
  host.innerHTML = `<div class="sim-sheet">
    <header class="sim-header"><div><p class="document-eyebrow">ESTUDO ECONÔMICO</p><h1>Simulação</h1><p class="sim-project"></p></div><span class="sim-editing">Nova simulação</span></header>
    <p class="sim-help">Áreas do modelo em laranja · valores editáveis em azul · custos em vermelho · VGV em verde. Marque as layers que entram em cada cálculo. Campos vazios valem zero. REP e VAGAS ficam fora da planilha.</p>
    <p class="sim-area-warning" role="status"></p>
    <section><h2>Investimento</h2><h3>Custos fixos iniciais</h3>
      <div class="sim-fixed"><label>Terreno <span>Valor total (R$)</span><input data-fixed="land" inputmode="decimal" autocomplete="off" placeholder="0,00" aria-label="Valor total do terreno em reais" /></label>
      <label>Outorga <span>Valor total (R$)</span><input data-fixed="grant" inputmode="decimal" autocomplete="off" placeholder="0,00" aria-label="Valor total da outorga em reais" /></label></div>
      <div class="sim-subtotal">Total fixo <output data-summary="fixedTotal" class="sim-expense"></output></div>
      <h3>Custos variáveis</h3><div class="sim-cost-tables"></div>
      <div class="sim-grand-total">Investimento total <output data-summary="investment" class="sim-expense"></output></div>
    </section>
    <section class="sim-vgv"><h2>VGV</h2><p class="sim-help">Valor de venda das layers privativas, cobertas e descobertas.</p><div class="sim-sale-tables"></div></section>
    <section class="sim-bottom"><div class="sim-summary"><h2>Resumo</h2><dl>
      <div><dt>Investimento total</dt><dd data-summary="investment" class="sim-expense"></dd></div>
      <div><dt>VGV total</dt><dd data-summary="vgv" class="sim-income"></dd></div>
      <div><dt>VGV%</dt><dd data-summary="vgvRatio" class="sim-income"></dd></div>
      <div><dt><label for="simulation-years">Período (anos)</label></dt><dd><input id="simulation-years" data-fixed="years" inputmode="decimal" autocomplete="off" placeholder="Ex.: 5" aria-label="Período da simulação em anos" /></dd></div>
      <div><dt>Média por ano</dt><dd data-summary="annualRatio" class="sim-blue"></dd></div>
    </dl><p class="sim-help">VGV% = VGV ÷ investimento. Média por ano = VGV% ÷ anos.</p></div>
    <aside class="sim-actions"><button class="sim-save" type="button">Salvar simulação</button><div class="sim-slots" role="group" aria-label="Simulações salvas"></div>
      <button class="sim-clear" type="button">${iconMarkup('trash')} Limpar campos</button><button class="sim-print" type="button">${iconMarkup('printer')} Imprimir</button>
      <p class="sim-help">Sem posição selecionada, salva na próxima posição livre. Selecione um número para editar; clique nele novamente para voltar a uma nova simulação.</p>
    </aside></section><p class="sim-feedback" role="status" aria-live="polite"></p></div>
    <dialog class="sim-export-dialog"><h2>Exportar simulação</h2><p>Arquivo em formato A4.</p><label>Formato <select class="sim-export-format"><option value="pdf">PDF</option><option value="png">PNG</option></select></label>
      <p class="sim-help">Em PNG, relatórios com mais de uma página são reunidos em um arquivo ZIP com imagens A4.</p><div><button class="sim-export-cancel" type="button">Cancelar</button><button class="sim-export-confirm" type="button">${iconMarkup('download')} Gerar arquivo</button></div><p class="sim-export-status" role="status"></p></dialog>`;
  host.querySelector<HTMLElement>('.sim-project')!.textContent = projectConfig.name;
  const warning = host.querySelector<HTMLElement>('.sim-area-warning')!;
  const missingAreas = rows.reduce((sum, row) => sum + row.missingAreas, 0);
  warning.textContent = missingAreas ? `Áreas parciais: ${missingAreas} objeto(s) sem área no CSV. Complete a tabela para uma simulação integral.` : '';
  const feedback = host.querySelector<HTMLElement>('.sim-feedback')!;
  const save = host.querySelector<HTMLButtonElement>('.sim-save')!;
  const print = host.querySelector<HTMLButtonElement>('.sim-print')!;
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* Mantém o uso na sessão. */ }
  const storageKey = `layout3d:simulation:v1:${JSON.stringify([projectConfig.objectDataUrl, projectConfig.modelUrl, sourceRows.map(row => [row.key, row.areaM2])])}`;
  const store = new SimulationStore(storage, storageKey, rows);
  let draft = emptySimulation(rows);
  let result: SimulationResult | null = null;
  const inputs: HTMLInputElement[] = [];
  const checkboxes: Array<{ input: HTMLInputElement; section: 'costs' | 'sales'; key: string; row: HTMLTableRowElement; price: HTMLInputElement }> = [];
  const lineOutputs = new Map<string, HTMLOutputElement>();
  const groupOutputs = new Map<string, HTMLOutputElement>();
  const slots: HTMLButtonElement[] = [];
  const updateSlots = () => {
    slots.forEach((button, index) => {
      button.disabled = store.get(index) === null;
      button.setAttribute('aria-pressed', String(store.active === index));
      button.title = button.disabled ? `Simulação ${index + 1} vazia` : `Selecionar simulação ${index + 1}`;
    });
    host.querySelector<HTMLElement>('.sim-editing')!.textContent = store.active === null ? 'Nova simulação' : `Simulação ${store.active + 1}`;
    save.replaceChildren(createIcon('save'), document.createTextNode(store.active === null ? 'Salvar simulação' : `Salvar simulação ${store.active + 1}`));
    save.disabled = result === null || (store.full && store.active === null);
    save.title = store.full && store.active === null ? 'As quatro posições estão preenchidas. Selecione uma para sobrescrever.' : 'Salvar os valores e as layers marcadas';
  };
  const recalculate = () => {
    try {
      result = calculateSimulation(rows, draft);
      for (const node of host.querySelectorAll<HTMLElement>('[data-summary]')) {
        const key = node.dataset.summary as 'fixedTotal' | 'investment' | 'vgv' | 'vgvRatio' | 'annualRatio';
        const value = result[key];
        node.textContent = value === null ? '—' : key.endsWith('Ratio') ? percent.format(value) : `R$ ${amount.format(value)}`;
      }
      for (const [section, lines] of [['costs', result.costLines], ['sales', result.saleLines]] as const) {
        for (const line of lines) lineOutputs.get(`${section}:${line.key}`)!.textContent = amount.format(line.total);
        for (const group of new Set(lines.map(line => line.group))) {
          groupOutputs.get(`${section}:${group}`)!.textContent = amount.format(lines.filter(line => line.group === group).reduce((sum, line) => sum + line.total, 0));
        }
      }
      for (const item of checkboxes) {
        item.row.classList.toggle('sim-excluded', !item.input.checked);
        item.price.disabled = !item.input.checked;
      }
      print.disabled = false;
    } catch {
      result = null;
      for (const node of host.querySelectorAll<HTMLElement>('[data-summary], .sim-line-total, .sim-group-total')) node.textContent = '—';
      print.disabled = true;
    }
    updateSlots();
  };
  const bindInput = (input: HTMLInputElement, write: (value: string) => void) => {
    input.addEventListener('input', () => {
      write(input.value);
      const invalid = parseSimulationNumber(input.value) === null;
      input.setAttribute('aria-invalid', String(invalid));
      input.setCustomValidity(invalid ? 'Use um número positivo ou zero, com até duas casas decimais.' : '');
      recalculate();
    });
    inputs.push(input);
  };
  for (const input of host.querySelectorAll<HTMLInputElement>('[data-fixed]')) {
    bindInput(input, value => { draft[input.dataset.fixed as 'land' | 'grant' | 'years'] = value; });
  }
  const buildTables = (section: 'costs' | 'sales') => {
    const members = section === 'sales' ? rows.filter(row => row.use === 'PRIV') : rows;
    const target = host.querySelector<HTMLElement>(section === 'costs' ? '.sim-cost-tables' : '.sim-sale-tables')!;
    if (!members.length) { target.append(el('p', 'sim-help', 'Nenhuma layer privativa disponível.')); return; }
    for (const group of new Set(members.map(row => row.group))) {
      const block = el('div', 'sim-group');
      block.append(el('h4', '', group === 'Sem grupo' ? group : `Grupo ${group}`));
      const scroll = el('div', 'sim-table-scroll');
      const table = el('table', 'sim-table');
      const head = el('thead');
      const header = el('tr');
      for (const label of ['Layer / incluir', 'Área (m²)', 'Valor/m² (R$)', 'Total (R$)']) { const cell = el('th', '', label); cell.scope = 'col'; header.append(cell); }
      head.append(header); table.append(head);
      const body = el('tbody');
      for (const useSection of simulationUsageSections(members.filter(row => row.group === group))) {
        const usageRow = el('tr', 'sim-use-heading');
        const usageLabel = el('th', '', useSection.label);
        usageLabel.colSpan = 4;
        usageLabel.scope = 'rowgroup';
        usageRow.append(usageLabel); body.append(usageRow);
        for (const row of useSection.rows) {
        const tr = el('tr');
        const nameCell = el('td');
        const label = el('label', 'sim-layer');
        const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = true;
        checkbox.setAttribute('aria-label', `Incluir ${row.name} ${section === 'costs' ? 'no investimento' : 'no VGV'}`);
        label.title = row.name;
        label.append(checkbox, document.createTextNode(simulationLayerLabel(row.name))); nameCell.append(label);
        const area = el('td', 'sim-area', amount.format(row.areaM2));
        if (row.missingAreas) area.title = `Área parcial: ${row.missingAreas} objeto(s) sem área.`;
        const priceCell = el('td'); const price = el('input', 'sim-rate');
        price.inputMode = 'decimal'; price.autocomplete = 'off'; price.placeholder = '0,00';
        price.dataset.section = section; price.dataset.key = row.key;
        price.setAttribute('aria-label', `${section === 'costs' ? 'Custo' : 'Venda'} por m² de ${row.name}`);
        bindInput(price, value => { draft[section][row.key] = value; });
        checkbox.onchange = () => {
          const key = section === 'costs' ? 'includedCosts' : 'includedSales';
          draft[key] = checkbox.checked ? [...new Set([...draft[key], row.key])] : draft[key].filter(value => value !== row.key);
          recalculate();
        };
        priceCell.append(price);
        const totalCell = el('td', section === 'costs' ? 'sim-expense' : 'sim-income');
        const total = el('output', 'sim-line-total'); totalCell.append(total);
        lineOutputs.set(`${section}:${row.key}`, total);
        checkboxes.push({ input: checkbox, section, key: row.key, row: tr, price });
        tr.append(nameCell, area, priceCell, totalCell); body.append(tr);
        }
      }
      table.append(body); scroll.append(table); block.append(scroll);
      const subtotal = el('div', 'sim-subtotal', 'Total do grupo');
      const value = el('output', `sim-group-total ${section === 'costs' ? 'sim-expense' : 'sim-income'}`);
      groupOutputs.set(`${section}:${group}`, value); subtotal.append(value); block.append(subtotal); target.append(block);
    }
  };
  buildTables('costs'); buildTables('sales');
  const applyDraft = () => {
    inputs.forEach(input => {
      input.value = input.dataset.fixed ? draft[input.dataset.fixed as 'land' | 'grant' | 'years'] : draft[input.dataset.section as 'costs' | 'sales'][input.dataset.key!] ?? '';
      input.setAttribute('aria-invalid', 'false'); input.setCustomValidity('');
    });
    checkboxes.forEach(item => { item.input.checked = (item.section === 'costs' ? draft.includedCosts : draft.includedSales).includes(item.key); });
    recalculate();
  };
  for (let index = 0; index < 4; index++) {
    const button = el('button', 'sim-slot', String(index + 1)); button.type = 'button';
    button.setAttribute('aria-label', `Simulação ${index + 1}`);
    button.onclick = () => {
      if (store.active === index) { store.active = null; feedback.textContent = 'Nova simulação a partir dos valores atuais.'; }
      else { const saved = store.get(index); if (!saved) return; store.active = index; draft = saved; feedback.textContent = `Simulação ${index + 1} selecionada. Salvar sobrescreverá esta posição.`; }
      applyDraft();
    };
    slots.push(button); host.querySelector('.sim-slots')!.append(button);
  }
  save.onclick = () => {
    try {
      const saved = store.save(draft);
      feedback.textContent = `Simulação ${saved.index + 1} salva${saved.persistent ? ' neste navegador.' : ' apenas nesta sessão: o armazenamento do navegador está bloqueado.'}`;
      updateSlots();
      if (store.full && store.active === null) feedback.textContent += ' As quatro posições estão preenchidas; selecione uma para substituir.';
    } catch (error) { feedback.textContent = error instanceof Error ? error.message : 'Não foi possível salvar.'; }
  };
  host.querySelector<HTMLButtonElement>('.sim-clear')!.onclick = () => {
    draft = emptySimulation(rows); store.active = null; applyDraft(); feedback.textContent = 'Campos limpos. As simulações salvas foram preservadas.';
  };
  const dialog = host.querySelector<HTMLDialogElement>('.sim-export-dialog')!;
  const confirm = host.querySelector<HTMLButtonElement>('.sim-export-confirm')!;
  const exportStatus = host.querySelector<HTMLElement>('.sim-export-status')!;
  print.onclick = () => { if (result) { exportStatus.textContent = ''; dialog.showModal(); } };
  host.querySelector<HTMLButtonElement>('.sim-export-cancel')!.onclick = () => dialog.close();
  confirm.onclick = async () => {
    if (!result) return;
    confirm.disabled = true; exportStatus.textContent = 'Gerando arquivo A4…';
    try {
      const sales = new Map(result.saleLines.map(line => [line.key, line]));
      const format = host.querySelector<HTMLSelectElement>('.sim-export-format')!.value;
      const response = await fetch(projectConfig.simulationExportUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': projectConfig.csrfToken },
        body: JSON.stringify({ format, land: result.land, grant: result.grant, years: result.years, missingAreas,
          rows: result.costLines.map(line => ({ name: line.name, group: line.group, use: line.use, areaM2: line.areaM2,
            costPrice: line.price, includeCost: line.included, salePrice: sales.get(line.key)?.price ?? 0, includeSale: sales.get(line.key)?.included ?? false })) }),
      });
      if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.error ?? 'Não foi possível exportar. Recarregue a página e tente novamente.'); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob); const link = el('a');
      link.href = url;
      link.download = /filename="?([^";]+)"?/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? `simulacao.${format}`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      dialog.close(); feedback.textContent = 'Arquivo A4 gerado.';
    } catch (error) { exportStatus.textContent = error instanceof Error ? error.message : 'Erro ao exportar.'; }
    finally { confirm.disabled = false; }
  };
  applyDraft();
}
