/**
 * Fuzzy matching for branch names.
 *
 * Matches characters in order, skipping hyphens/underscores/slashes in the
 * candidate so users can type "featadd" to match "feat/add-thing".
 * Returns a score (lower is better) or null if no match.
 */

/** Strip separator characters that users shouldn't need to type. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[-_/]/g, "");
}

/**
 * Check if `query` is a fuzzy subsequence match of `candidate`.
 * Returns a score (lower = better match) or null if no match.
 *
 * Scoring favours:
 *  - Prefix matches (query matches start of candidate)
 *  - Consecutive character runs
 *  - Shorter candidates (exact-ish matches rank higher)
 */
export function fuzzyMatch(query: string, candidate: string): number | null {
  if (query.length === 0) return 0;

  const nq = normalize(query);
  const nc = normalize(candidate);

  if (nq.length === 0) return 0;
  if (nq.length > nc.length) return null;

  // Check subsequence match and compute score
  let qi = 0;
  let consecutive = 0;
  let maxConsecutive = 0;
  let firstMatchIndex = -1;

  for (let ci = 0; ci < nc.length && qi < nq.length; ci++) {
    if (nc[ci] === nq[qi]) {
      if (firstMatchIndex === -1) firstMatchIndex = ci;
      consecutive++;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
      qi++;
    } else {
      consecutive = 0;
    }
  }

  if (qi < nq.length) return null; // not all query chars matched

  // Score: lower is better
  // Bonus for prefix match, consecutive runs, and shorter candidates
  const prefixBonus = firstMatchIndex === 0 ? 0 : firstMatchIndex * 5;
  const lengthPenalty = nc.length - nq.length;
  const consecutiveBonus = (nq.length - maxConsecutive) * 3;

  return prefixBonus + lengthPenalty + consecutiveBonus;
}

/**
 * Filter and rank candidates by fuzzy match against `query`.
 * Returns candidates sorted by relevance (best first).
 */
export function fuzzyFilter(query: string, candidates: string[]): string[] {
  if (query.length === 0) return [...candidates].sort();

  const scored: { candidate: string; score: number }[] = [];
  for (const candidate of candidates) {
    const score = fuzzyMatch(query, candidate);
    if (score !== null) {
      scored.push({ candidate, score });
    }
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.candidate);
}
