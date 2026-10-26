/** Dados derivados do CSV local e associados ao ID original do Rhino. */
export interface ObjectRecord {
  id: string;
  areaM2: number | null;
  use: string | null;
  elevationM: number | null;
}

export interface ObjectSelection {
  id: string | null;
  name: string;
}

export const USAGE_CODES = ['COM', 'EST', 'PRIV', 'VAGAS', 'REP'] as const;
export type UsageCode = typeof USAGE_CODES[number];

export interface UsageTotal {
  count: number;
  areaM2: number;
}
