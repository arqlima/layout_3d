/** X/Y refer to the plan (Rhino); the viewer uses Y as its vertical axis. */
export interface SectionState {
  axis: 'x' | 'y';
  coordinate: number;
  side: 1 | -1;
  mode: 'orthographic' | '3d';
}

export interface SectionLineSettings {
  visible: boolean;
  color: string;
  width: number;
}

export const DEFAULT_SECTION_LINES: Readonly<SectionLineSettings> = Object.freeze({ visible: true, color: '#3f4a4d', width: 1 });

export function isSectionLineSettings(value: unknown): value is SectionLineSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as SectionLineSettings;
  return typeof settings.visible === 'boolean' && typeof settings.color === 'string' && /^#[\da-f]{6}$/i.test(settings.color)
    && Number.isFinite(settings.width) && settings.width >= .5 && settings.width <= 8 && Number.isInteger(settings.width * 2);
}

export function isSectionState(value: unknown): value is SectionState {
  if (!value || typeof value !== 'object') return false;
  const state = value as SectionState;
  return (state.axis === 'x' || state.axis === 'y') && Number.isFinite(state.coordinate)
    && (state.side === 1 || state.side === -1)
    && (state.mode === 'orthographic' || state.mode === '3d');
}
