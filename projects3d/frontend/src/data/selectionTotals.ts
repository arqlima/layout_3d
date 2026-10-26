import { USAGE_CODES, type UsageCode, type UsageTotal, type SelectionTotals, type ObjectRecord, type MarkedObject, type AreaExclusions } from '../types/model';

/** Um GUID conta uma única vez, mesmo quando possui várias malhas e arestas. */
export function summarizeSelection(
  objects: ReadonlyMap<string, MarkedObject>, records: ReadonlyMap<string, ObjectRecord>,
  exclusions: Partial<AreaExclusions> = {},
): SelectionTotals {
  const byUse = Object.fromEntries(USAGE_CODES.map(code => [code, { count: 0, areaM2: 0 }])) as Record<UsageCode, UsageTotal>;
  let missingAreaCount = 0;
  for (const [id, object] of objects) {
    const name = object.layerName.toUpperCase();
    const excluded = (exclusions.excludeUncovered && name.includes('DESC'))
      || (exclusions.excludeParking && name.includes('EST'));
    const record = records.get(id);
    const code = object.use ?? USAGE_CODES.find(code => code === record?.use?.trim().toUpperCase());
    if (!code) { if (!excluded) missingAreaCount++; continue; }
    byUse[code].count++;
    if (code === 'VAGAS' || excluded) continue;
    if (record?.areaM2 != null && Number.isFinite(record.areaM2)) byUse[code].areaM2 += record.areaM2;
    else missingAreaCount++;
  }
  const areaM2 = byUse.PRIV.areaM2 + byUse.COM.areaM2 + byUse.EST.areaM2;
  return {
    byUse,
    areaM2,
    efficiencyRatio: areaM2 > 0 ? byUse.PRIV.areaM2 / areaM2 : null,
    objectCount: objects.size,
    missingAreaCount,
  };
}
