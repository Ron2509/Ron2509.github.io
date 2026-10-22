// The grid the CFD streamlines are solved on (scripts/bake-flow.mjs), in car-rig space: nose to +X, floor at
// y = 0, centreline on z = 0. Nodes sit at min + i * h.
export const FLOW_GRID = {
  h: 0.04,
  min: [-5.6, 0, -1.6] as const,
  n: [281, 41, 81] as const,
}
