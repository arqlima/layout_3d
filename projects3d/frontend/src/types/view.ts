export type StandardView = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';
export type ProjectionMode = 'perspective' | 'orthographic';

export interface ViewState {
  cubeTransform: string;
  projection: ProjectionMode;
  label: string;
  /** Horizontal world axes projected onto camera right/up. */
  groundProjection?: readonly [number, number, number, number];
}
