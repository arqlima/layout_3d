import * as THREE from 'three';
import { isRepLayer, parseLayerName } from './layerSelection';
import type { ObjectRecord } from '../types/model';
import type { SimulationDraft, SimulationLayer, SimulationLine, SimulationResult } from '../types/simulation';

export function simulationLayerLabel(name: string): string {
  return parseLayerName(name).name;
}

export function simulationUsageSections(rows: SimulationLayer[]): Array<{ code: string; label: string; rows: SimulationLayer[] }> {
  const names: Record<string, string> = { COM: 'Comum', PRIV: 'Privado', EST: 'Estacionamento' };
  const order = ['COM', 'PRIV', 'EST'];
  const codes = [...new Set(rows.filter(row => row.use !== 'VAGAS').map(row => row.use))];
  codes.sort((a, b) => (order.includes(a) ? order.indexOf(a) : 3) - (order.includes(b) ? order.indexOf(b) : 3) || a.localeCompare(b, 'pt-BR'));
  return codes.map(code => ({ code, label: names[code] ? `${code} · ${names[code]}` : code, rows: rows.filter(row => row.use === code) }));
}

/** Áreas integrais do modelo, sem depender dos filtros da vista 3D. */
export function collectSimulationLayers(model: THREE.Object3D, records: ReadonlyMap<string, ObjectRecord>): SimulationLayer[] {
  const source: Array<{ name?: string }> = model.userData.layers ?? [];
  const rows = new Map<number, SimulationLayer>();
  source.forEach((layer, index) => {
    if (!layer.name || isRepLayer(layer.name)) return;
    const parsed = parseLayerName(layer.name);
    rows.set(index, { key: `${index}:${layer.name}`, name: layer.name, group: parsed.group, use: parsed.use, areaM2: 0, missingAreas: 0 });
  });
  const seen = new Set<string>();
  const populatedLayers = new Set<number>();
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) || object.userData.isEdgeHelper) return;
    let node: THREE.Object3D | null = object;
    let layerIndex: number | undefined;
    let id: string | undefined;
    while (node && node !== model) {
      layerIndex ??= node.userData.attributes?.layerIndex;
      id ??= node.userData.objectId ?? node.userData.attributes?.id;
      node = node.parent;
    }
    if (!Number.isInteger(layerIndex) || !source[layerIndex!]?.name) return;
    populatedLayers.add(layerIndex!);
    const name = source[layerIndex!]!.name!;
    const parsed = parseLayerName(name);
    if (isRepLayer(name) || parsed.use === 'VAGAS') return;
    const identity = typeof id === 'string' ? id.toLowerCase() : object.uuid;
    if (seen.has(identity)) return;
    seen.add(identity);
    const record = records.get(identity);
    const row = rows.get(layerIndex!) ?? {
      key: `${layerIndex}:${name}`, name, group: parsed.group,
      use: parsed.use === 'Sem uso' ? record?.use?.trim().toUpperCase() ?? parsed.use : parsed.use,
      areaM2: 0, missingAreas: 0,
    };
    if (row.use === 'Sem uso' && record?.use) row.use = record.use.trim().toUpperCase();
    if (record?.areaM2 != null && Number.isFinite(record.areaM2) && record.areaM2 >= 0) row.areaM2 += record.areaM2;
    else row.missingAreas++;
    rows.set(layerIndex!, row);
  });
  return [...rows.entries()].filter(([index]) => populatedLayers.has(index)).map(([, row]) => row)
    .sort((a, b) => a.group.localeCompare(b.group, 'pt-BR', { numeric: true }) || a.name.localeCompare(b.name, 'pt-BR'));
}

export function emptySimulation(rows: SimulationLayer[]): SimulationDraft {
  return { land: '', grant: '', years: '', costs: {}, sales: {}, includedCosts: rows.map(row => row.key), includedSales: rows.filter(row => row.use === 'PRIV').map(row => row.key) };
}

/** Aceita 1234,56, 1.234,56 ou 1234.56; vazio equivale a zero. */
export function parseSimulationNumber(raw: string): number | null {
  const value = raw.trim();
  if (!value) return 0;
  if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{0,2})?$/.test(value) && !/^\d+(?:\.\d{0,2})?$/.test(value)) return null;
  const normalized = value.includes(',') ? value.replaceAll('.', '').replace(',', '.') : /^\d{1,3}(?:\.\d{3})+$/.test(value) ? value.replaceAll('.', '') : value;
  const number = Number(normalized);
  return Number.isFinite(number) && number <= 1e12 ? number : null;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export function calculateSimulation(rows: SimulationLayer[], draft: SimulationDraft): SimulationResult {
  const number = (value = '') => {
    const parsed = parseSimulationNumber(value);
    if (parsed === null) throw new Error('Preencha os valores com números positivos ou zero, usando até duas casas decimais.');
    return parsed;
  };
  const land = number(draft.land);
  const grant = number(draft.grant);
  const years = number(draft.years);
  const line = (row: SimulationLayer, section: 'costs' | 'sales'): SimulationLine => {
    const included = (section === 'costs' ? draft.includedCosts : draft.includedSales).includes(row.key);
    const price = number(draft[section][row.key]);
    return { ...row, price, included, total: included ? money(row.areaM2 * price) : 0 };
  };
  const costLines = rows.map(row => line(row, 'costs'));
  const saleLines = rows.filter(row => row.use === 'PRIV').map(row => line(row, 'sales'));
  const fixedTotal = money(land + grant);
  const investment = money(fixedTotal + costLines.reduce((sum, row) => sum + row.total, 0));
  const vgv = money(saleLines.reduce((sum, row) => sum + row.total, 0));
  const vgvRatio = investment > 0 ? vgv / investment : null;
  return { land, grant, years, costLines, saleLines, fixedTotal, investment, vgv, vgvRatio, annualRatio: vgvRatio !== null && years > 0 ? vgvRatio / years : null };
}

export class SimulationStore {
  private slots: Array<SimulationDraft | null> = Array(4).fill(null);
  active: number | null = null;
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null, private key: string, private rows: SimulationLayer[]) {
    try {
      const stored: unknown = JSON.parse(storage?.getItem(key) ?? 'null');
      if (Array.isArray(stored)) for (let index = 0; index < 4; index++) {
        const draft = stored[index];
        if (draft && typeof draft === 'object' && ['land', 'grant', 'years'].every(key => typeof draft[key] === 'string')
          && ['costs', 'sales'].every(key => draft[key] && typeof draft[key] === 'object' && Object.values(draft[key]).every(value => typeof value === 'string'))
          && ['includedCosts', 'includedSales'].every(key => Array.isArray(draft[key]) && draft[key].every((value: unknown) => typeof value === 'string'))) {
          calculateSimulation(rows, draft as SimulationDraft);
          this.slots[index] = draft as SimulationDraft;
        }
      }
    } catch { /* Dados ausentes ou inválidos não impedem uma nova simulação. */ }
  }
  get(index: number): SimulationDraft | null { return this.slots[index] ? structuredClone(this.slots[index]) : null; }
  get full(): boolean { return this.slots.every(Boolean); }
  save(draft: SimulationDraft): { index: number; persistent: boolean } {
    calculateSimulation(this.rows, draft);
    const index = this.active ?? this.slots.findIndex(slot => slot === null);
    if (index < 0) throw new Error('As quatro posições estão preenchidas. Selecione uma simulação para sobrescrever.');
    this.slots[index] = structuredClone(draft);
    try {
      if (!this.storage) return { index, persistent: false };
      this.storage.setItem(this.key, JSON.stringify(this.slots));
      return { index, persistent: true };
    } catch { return { index, persistent: false }; }
  }
}
