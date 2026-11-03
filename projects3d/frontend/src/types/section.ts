/** X/Y refer to the plan (Rhino); the viewer uses Y as its vertical axis. */
export interface SectionState {
  axis: 'x' | 'y';
  coordinate: number;
  side: 1 | -1;
  mode: 'orthographic' | '3d';
}

export function isSectionState(value: unknown): value is SectionState {
  if (!value || typeof value !== 'object') return false;
  const state = value as SectionState;
  return (state.axis === 'x' || state.axis === 'y') && Number.isFinite(state.coordinate)
    && (state.side === 1 || state.side === -1)
    && (state.mode === 'orthographic' || state.mode === '3d');
}
