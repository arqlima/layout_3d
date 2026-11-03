import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { DEFAULT_SECTION_LINES, type SectionLineSettings } from '../types/section';

export { DEFAULT_SECTION_LINES };

/** Cap triangles are coplanar, so EdgesGeometry keeps boundaries and holes only.
 * LineSegments2 updates its pixel resolution for each renderer (screen or PNG).
 */
export function createSectionOutline(cap: THREE.BufferGeometry, settings: SectionLineSettings): LineSegments2 {
  const edges = new THREE.EdgesGeometry(cap);
  const geometry = new LineSegmentsGeometry().fromEdgesGeometry(edges);
  edges.dispose();
  const material = new LineMaterial({
    color: settings.color, linewidth: settings.width, worldUnits: false,
    transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const line = new LineSegments2(geometry, material);
  line.name = 'Contorno do corte';
  line.userData.isSectionOutline = true;
  line.visible = settings.visible;
  line.renderOrder = 3;
  // Helpers do not participate in object selection or vertex measurements.
  line.raycast = () => {};
  return line;
}

export function applySectionOutlineSettings(line: LineSegments2, settings: SectionLineSettings): void {
  line.visible = settings.visible;
  line.material.color.set(settings.color);
  line.material.linewidth = settings.width;
}
