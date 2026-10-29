import type { SelectionMode } from '../data/layerSelection';
import type { AreaExclusions, UsageCode } from './model';
import type { ProjectionMode } from './view';

export interface ViewerSnapshot {
  camera: {
    projection: ProjectionMode;
    position: [number, number, number];
    up: [number, number, number];
    target: [number, number, number];
    zoom: number;
    near: number;
    far: number;
    orthographicHeight: number;
    maxDistance: number;
    label: string;
  };
  layers: Array<{ name: string; visible: boolean }>;
  elevation: [number | null, number | null];
  selectionMode: SelectionMode;
  activeUsages: UsageCode[];
  hideUnchecked: boolean;
  selected: { id: string | null; index: number } | null;
  selectedObjects?: Array<{ id: string | null; index: number }>;
}

export interface SavedScene {
  version: 1;
  viewer: ViewerSnapshot;
  areaExclusions: AreaExclusions;
}
