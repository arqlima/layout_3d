/** Dados derivados do CSV local e associados ao ID original do Rhino. */
export interface ObjectRecord {
  id: string;
  areaM2: number | null;
  use: string | null;
  elevationM: number | null;
  floorToFloorM?: number | null;
}

export interface ObjectSelection {
  id: string | null;
  name: string;
  mode?: 'name' | 'use' | 'group';
}

export const USAGE_CODES = ['COM', 'EST', 'PRIV', 'VAGAS', 'REP'] as const;
export type UsageCode = typeof USAGE_CODES[number];
export const DEFAULT_USAGES: readonly UsageCode[] = USAGE_CODES.filter(code => code !== 'REP');

export interface UsageTotal {
  count: number;
  areaM2: number;
}

export interface SelectionTotals {
  byUse: Record<UsageCode, UsageTotal>;
  areaM2: number;
  efficiencyRatio: number | null;
  objectCount: number;
  missingAreaCount: number;
}

export interface MarkedObject {
  use: UsageCode | null;
  layerName: string;
}

export interface AreaExclusions {
  excludeUncovered: boolean;
  excludeParking: boolean;
}
