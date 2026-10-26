import type { LayerInfo } from '../types/layers';

export type SelectionMode = 'name' | 'use' | 'group';

const usageNames: Record<string, string> = {
  COM: 'Comum', PRIV: 'Privativo', EST: 'Estacionamento', VAGAS: 'Vagas', REP: 'REP',
};

/** Convenção Rhino: grupo-nome-uso. O nome pode conter hífens ou sublinhados. */
export function parseLayerName(name: string): { group: string; name: string; use: string } {
  const parts = name.split('-').map(part => part.trim());
  if (parts.length < 3 || parts.some(part => !part)) {
    return { group: 'Sem grupo', name, use: 'Sem uso' };
  }
  return { group: parts[0].toUpperCase(), name: parts.slice(1, -1).join('-'), use: parts.at(-1)!.toUpperCase() };
}

export function layerKey(layer: LayerInfo, mode: SelectionMode): string {
  if (mode === 'name') return String(layer.index);
  return parseLayerName(layer.name)[mode];
}

export function isRepLayer(name: string): boolean {
  const parsed = parseLayerName(name);
  return parsed.group === 'REP' || parsed.use === 'REP' || name.trim().toUpperCase() === 'REP';
}

export function layerLabel(layer: LayerInfo, mode: SelectionMode): string {
  if (mode === 'name') return layer.name;
  const key = layerKey(layer, mode);
  return mode === 'use' ? usageNames[key] ?? key : key === 'Sem grupo' ? key : `Grupo ${key}`;
}

export function matchingLayers(layers: LayerInfo[], index: number, mode: SelectionMode): LayerInfo[] {
  const layer = layers.find(item => item.index === index);
  return layer ? layers.filter(item => layerKey(item, mode) === layerKey(layer, mode)) : [];
}
