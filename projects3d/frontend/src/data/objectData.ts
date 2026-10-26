import type { ObjectRecord } from '../types/model';
import { projectConfig } from './config';

/** Consulta os registros do CSV do projeto pelo endpoint autenticado do Django. */
export async function loadObjectData(): Promise<Map<string, ObjectRecord>> {
  const response = await fetch(projectConfig.objectDataUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Dados de objetos indisponíveis (${response.status}).`);
  const records: unknown = await response.json();
  if (!Array.isArray(records)) throw new Error('Formato dos dados de objetos inválido.');

  const byId = new Map<string, ObjectRecord>();
  for (const record of records) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string') continue;
    byId.set(record.id.toLowerCase(), record as ObjectRecord);
  }
  return byId;
}
