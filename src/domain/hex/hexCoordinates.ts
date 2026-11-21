/**
 * Pure axial hexagonal coordinate mathematics (pointy-top orientation).
 */

export interface AxialCoord {
  readonly q: number;
  readonly r: number;
}

export type HexKey = string;

export const HEX_RADIUS = 1.0;

const SQRT_3 = Math.sqrt(3);

export const HEX_DIRECTIONS: readonly AxialCoord[] = [
  {q: 1, r: 0},
  {q: 1, r: -1},
  {q: 0, r: -1},
  {q: -1, r: 0},
  {q: -1, r: 1},
  {q: 0, r: 1},
];

export function hexKey(q: number, r: number): HexKey {
  return `${q},${r}`;
}

export function parseHexKey(key: HexKey): AxialCoord {
  const [qStr, rStr] = key.split(',');
  return {q: Number(qStr), r: Number(rStr)};
}

export function getNeighborCoords(coord: AxialCoord): AxialCoord[] {
  return HEX_DIRECTIONS.map((dir) => ({
    q: coord.q + dir.q,
    r: coord.r + dir.r,
  }));
}

export function getNeighborKeys(key: HexKey): HexKey[] {
  const {q, r} = parseHexKey(key);
  return HEX_DIRECTIONS.map((dir) => hexKey(q + dir.q, r + dir.r));
}

export function hexDistance(a: AxialCoord, b: AxialCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -a.q - a.r - (-b.q - b.r);
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

export function axialToWorld(
  q: number,
  r: number,
  radius: number = HEX_RADIUS,
): {x: number; z: number} {
  const x = radius * SQRT_3 * (q + r / 2);
  const z = radius * 1.5 * r;
  return {x, z};
}

/**
 * O(1) inverse projection from world XZ plane to cube-rounded axial hex coordinate.
 */
export function worldToAxial(
  x: number,
  z: number,
  radius: number = HEX_RADIUS,
): AxialCoord {
  const rf = (2 / 3) * (z / radius);
  const qf = (SQRT_3 / 3) * (x / radius) - (1 / 3) * (z / radius);
  const sf = -qf - rf;

  let rq = Math.round(qf);
  let rr = Math.round(rf);
  const rs = Math.round(sf);

  const dq = Math.abs(rq - qf);
  const dr = Math.abs(rr - rf);
  const ds = Math.abs(rs - sf);

  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }

  return {q: rq, r: rr};
}
