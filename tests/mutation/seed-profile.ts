const MAX_PROFILE_SEEDS = 64;
const UINT32_MAX = 0xffff_ffff;

/**
 * Resolve the committed mutation profile exported by the matrix runner.
 *
 * Individual fuzz files retain their historical seeds when they are run on
 * their own. Matrix runs, however, must consume the exact exported profile so
 * a release invocation cannot accidentally report eight seeds while executing
 * only a hard-coded subset.
 */
export function mutationSeeds(
  fallback: readonly number[]
): readonly number[] {
  const encoded = process.env.AVL_MUTATION_SEEDS;
  if (encoded === undefined) return freezeValidated(fallback, "fallback");
  if (encoded.length === 0 || encoded.length > 1_024) {
    throw new Error("AVL_MUTATION_SEEDS has an invalid encoded length");
  }
  const fields = encoded.split(",");
  if (fields.length > MAX_PROFILE_SEEDS) {
    throw new Error(`AVL_MUTATION_SEEDS exceeds ${String(MAX_PROFILE_SEEDS)} seeds`);
  }
  const seeds = fields.map((field) => {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(field)) {
      throw new Error(`AVL_MUTATION_SEEDS contains a non-canonical uint32: ${field}`);
    }
    return Number(field);
  });
  return freezeValidated(seeds, "AVL_MUTATION_SEEDS");
}

function freezeValidated(
  seeds: readonly number[],
  source: string
): readonly number[] {
  if (seeds.length === 0 || seeds.length > MAX_PROFILE_SEEDS) {
    throw new Error(`${source} must contain 1 through ${String(MAX_PROFILE_SEEDS)} seeds`);
  }
  const unique = new Set<number>();
  for (const seed of seeds) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > UINT32_MAX) {
      throw new Error(`${source} contains an invalid uint32 seed: ${String(seed)}`);
    }
    if (unique.has(seed)) {
      throw new Error(`${source} contains duplicate seed ${String(seed)}`);
    }
    unique.add(seed);
  }
  return Object.freeze([...seeds]);
}
