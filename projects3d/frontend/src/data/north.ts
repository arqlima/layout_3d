export type GroundProjection = readonly [number, number, number, number];

export function normalizeNorthAngle(angle: number): number {
  return ((Math.round(angle) % 360) + 360) % 360;
}

/** Bearing measured clockwise from the model's original north (-Z). */
export function northScreenAngle(angle: number, projection: GroundProjection): number {
  const radians = angle * Math.PI / 180;
  const x = Math.sin(radians);
  const z = -Math.cos(radians);
  const screenX = projection[0] * x + projection[1] * z;
  const screenUp = projection[2] * x + projection[3] * z;
  return Math.atan2(screenX, screenUp) * 180 / Math.PI;
}

export function northPointerAngle(x: number, y: number, projection: GroundProjection): number {
  const [rightX, rightZ, upX, upZ] = projection;
  const determinant = rightX * upZ - rightZ * upX;
  // At an edge-on view the ground projection collapses to a line. Use a
  // plan-like dial relative to the visible original north in that case.
  if (Math.abs(determinant) < 0.0001) {
    return normalizeNorthAngle(Math.atan2(x, -y) * 180 / Math.PI - northScreenAngle(0, projection));
  }
  const worldX = (upZ * x + rightZ * y) / determinant;
  const worldZ = (-upX * x - rightX * y) / determinant;
  return normalizeNorthAngle(Math.atan2(worldX, -worldZ) * 180 / Math.PI);
}
