export interface SimulationLayer {
  key: string;
  name: string;
  group: string;
  use: string;
  areaM2: number;
  missingAreas: number;
}

export interface SimulationDraft {
  land: string;
  grant: string;
  years: string;
  costs: Record<string, string>;
  sales: Record<string, string>;
  includedCosts: string[];
  includedSales: string[];
}

export interface SimulationLine extends SimulationLayer {
  included: boolean;
  price: number;
  total: number;
}

export interface SimulationResult {
  land: number;
  grant: number;
  years: number;
  costLines: SimulationLine[];
  saleLines: SimulationLine[];
  fixedTotal: number;
  investment: number;
  vgv: number;
  vgvRatio: number | null;
  annualRatio: number | null;
}
