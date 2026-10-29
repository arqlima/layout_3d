export interface ViewerConfig {
  name: string;
  description: string;
  location?: { latitude: number | null; longitude: number | null; locked: boolean };
  modelUrl: string | null;
  objectDataUrl: string;
  simulationExportUrl: string;
  csrfToken: string;
  iconSpriteUrl: string;
  videoUrl: string | null;
  rhinoLibraryUrl: string;
  listUrl: string;
  editUrl: string;
  importUrl: string;
  coverUrl: string | null;
  summary: Array<{ label: string; value: string }>;
  guidelines: string[][];
  images: Array<{ url: string; name: string; position: number }>;
}

const element = document.getElementById('viewer-config');
if (!element?.textContent) throw new Error('Configuração do projeto indisponível.');
export const projectConfig = JSON.parse(element.textContent) as ViewerConfig;
