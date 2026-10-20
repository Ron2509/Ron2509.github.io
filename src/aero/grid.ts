// The wind-tunnel flow field is baked around the car once (src/aero/bake.ts, dev only) into public/models/aero.bin.
// The grid sits in car-rig space: nose to +X, floor at y = 0, centreline on z = 0.

export const AERO = {
  url: '/models/aero.bin',
  /** cells along x, y, z */
  n: [128, 32, 56] as const,
  min: [-2.95, 0, -1.3] as const,
  max: [2.95, 1.4, 1.3] as const,
  /** distance to the bodywork stored in R: 0..255 maps to 0..DIST_MAX metres (unsigned, clamped) */
  DIST_MAX: 0.6,
}

export const aeroIndex = (x: number, y: number, z: number) => (z * AERO.n[1] + y) * AERO.n[0] + x
