export interface ModelAppearanceSettings {
  overrideColor: boolean;
  color: string;
  overrideEdges: boolean;
  edgeColor: string;
}

export const DEFAULT_MODEL_APPEARANCE: Readonly<ModelAppearanceSettings> = Object.freeze({
  overrideColor: false, color: '#ffffff', overrideEdges: false, edgeColor: '#263238',
});

export function isModelAppearanceSettings(value: unknown): value is ModelAppearanceSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as ModelAppearanceSettings;
  const color = (value: unknown) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  return typeof settings.overrideColor === 'boolean' && typeof settings.overrideEdges === 'boolean'
    && color(settings.color) && color(settings.edgeColor);
}
