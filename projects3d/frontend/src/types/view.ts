export type StandardView = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';
export type ProjectionMode = 'perspective' | 'orthographic';

export interface ViewState {
  cubeTransform: string;
  projection: ProjectionMode;
  label: string;
}
