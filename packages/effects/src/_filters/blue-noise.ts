/** Ulichney-style toroidal void/cluster ranking of a relaxed minority binary pattern. */
export function blueNoiseRanks(size = 32, seed = 7): Uint8Array {
  if (!Number.isInteger(size) || size < 4 || size > 64)
    throw new RangeError('Blue-noise tile size must be 4..64');
  const n = size * size,
    minority = Math.floor(n * 0.1),
    pattern = new Uint8Array(n),
    energy = new Float64Array(n),
    ranks = new Uint32Array(n);
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const kernel: Array<[number, number, number]> = [];
  for (let y = -5; y <= 5; y++)
    for (let x = -5; x <= 5; x++) kernel.push([x, y, Math.exp(-(x * x + y * y) / (2 * 1.5 ** 2))]);
  const adjust = (index: number, sign: number, field: Float64Array) => {
    const px = index % size,
      py = Math.floor(index / size);
    for (const [x, y, w] of kernel)
      field[((py + y + size) % size) * size + ((px + x + size) % size)]! += sign * w;
  };
  const pick = (occupied: boolean, bits: Uint8Array, field: Float64Array) => {
    let best = -1,
      value = occupied ? -Infinity : Infinity;
    for (let i = 0; i < n; i++)
      if (Boolean(bits[i]) === occupied && (occupied ? field[i]! > value : field[i]! < value)) {
        best = i;
        value = field[i]!;
      }
    return best;
  };
  let filled = 0;
  while (filled < minority) {
    const i = Math.floor(random() * n) % n;
    if (pattern[i]) continue;
    pattern[i] = 1;
    adjust(i, 1, energy);
    filled++;
  }
  for (let k = 0; k < n * 4; k++) {
    const dense = pick(true, pattern, energy);
    pattern[dense] = 0;
    adjust(dense, -1, energy);
    const voidIndex = pick(false, pattern, energy);
    pattern[voidIndex] = 1;
    adjust(voidIndex, 1, energy);
    if (voidIndex === dense) break;
  }
  const lower = pattern.slice(),
    lowerEnergy = energy.slice();
  for (let rank = minority - 1; rank >= 0; rank--) {
    const i = pick(true, lower, lowerEnergy);
    ranks[i] = rank;
    lower[i] = 0;
    adjust(i, -1, lowerEnergy);
  }
  const upper = pattern.slice(),
    upperEnergy = energy.slice();
  for (let rank = minority; rank < n; rank++) {
    const i = pick(false, upper, upperEnergy);
    ranks[i] = rank;
    upper[i] = 1;
    adjust(i, 1, upperEnergy);
  }
  return Uint8Array.from(ranks, (r) => Math.floor((r * 256) / n));
}
