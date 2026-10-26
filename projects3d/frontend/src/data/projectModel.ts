import type * as THREE from 'three';
import type { ObjectRecord } from '../types/model';
import { projectConfig } from './config';
import { loadObjectData } from './objectData';

interface ProjectModel { model: THREE.Object3D; records: Map<string, ObjectRecord>; dataError: boolean }
let pending: Promise<ProjectModel> | null = null;
export function loadProjectModel(): Promise<ProjectModel> {
  if (!pending) pending = (async () => {
    if (!projectConfig.modelUrl) throw new Error('Cadastre um modelo e sua tabela de áreas para simular.');
    const { loadModel } = await import('../viewer/loadModel');
    let dataError = false;
    const [model, records] = await Promise.all([
      loadModel(projectConfig.modelUrl, projectConfig.rhinoLibraryUrl),
      loadObjectData().catch(error => {
        console.warn('Tabela de áreas indisponível.', error);
        dataError = true;
        return new Map<string, ObjectRecord>();
      }),
    ]);
    return { model, records, dataError };
  })().catch(error => { pending = null; throw error; });
  return pending;
}
