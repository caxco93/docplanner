export interface FuzzyMatch {
  score: number;
  /** Positions in the text of the matched query characters, for highlighting. */
  indices: number[];
}

const CHAR = 16;
const CONSECUTIVE = 12;
const WORD_START = 8;
const PREFIX = 14;
const GAP = 1;
const LEADING_GAP = 0.5;
const EXACT = 1000;

const isAlnum = (c: string) => /[\p{L}\p{N}]/u.test(c);

function positionBonus(text: string, i: number): number {
  if (i === 0) return WORD_START;
  const prev = text[i - 1];
  const camelHump = prev === prev.toLowerCase() && text[i] !== text[i].toLowerCase();
  return !isAlnum(prev) || camelHump ? WORD_START : 0;
}

/**
 * Case-insensitive subsequence match, scored by how tight the match is: consecutive runs, word
 * starts and a match at the very start score higher; gaps cost. Dynamic programming over
 * (query char, text position) with a running maximum keeps it O(query x text).
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const m = q.length;
  const n = t.length;
  if (m === 0) return { score: 0, indices: [] };
  if (m > n) return null;
  if (q === t) return { score: EXACT, indices: [...Array(n).keys()] };

  // score[i][j]: best score with q[i] matched at t[j]; from[i][j]: where q[i-1] matched.
  const score = Array.from({ length: m }, () => new Float64Array(n).fill(-Infinity));
  const from = Array.from({ length: m }, () => new Int32Array(n).fill(-1));

  for (let i = 0; i < m; i++) {
    // Best previous match at k < j, discounted for the gap up to j: prev[k] + k*GAP.
    let runBest = -Infinity;
    let runFrom = -1;
    for (let j = 0; j < n; j++) {
      if (i > 0 && j > 0) {
        const candidate = score[i - 1][j - 1] + (j - 1) * GAP;
        if (candidate > runBest) {
          runBest = candidate;
          runFrom = j - 1;
        }
      }
      if (t[j] !== q[i]) continue;
      const bonus = CHAR + positionBonus(text, j);
      if (i === 0) {
        score[0][j] = bonus - j * LEADING_GAP + (j === 0 ? PREFIX : 0);
        continue;
      }
      let best = runBest - (j - 1) * GAP;
      let origin = runFrom;
      if (j > 0 && score[i - 1][j - 1] + CONSECUTIVE > best) {
        best = score[i - 1][j - 1] + CONSECUTIVE;
        origin = j - 1;
      }
      if (best === -Infinity) continue;
      score[i][j] = best + bonus;
      from[i][j] = origin;
    }
  }

  let end = -1;
  for (let j = 0; j < n; j++) if (score[m - 1][j] > (end < 0 ? -Infinity : score[m - 1][end])) end = j;
  if (end < 0) return null;

  const indices = new Array<number>(m);
  for (let i = m - 1, j = end; i >= 0; j = from[i][j], i--) indices[i] = j;
  return { score: score[m - 1][end], indices };
}

export interface Ranked<T> extends FuzzyMatch {
  item: T;
}

/** Items matching `query`, closest first; ties go to the shorter, then alphabetically earlier text. */
export function rank<T>(query: string, items: readonly T[], textOf: (item: T) => string): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, textOf(item));
    if (match) out.push({ item, ...match });
  }
  return out.sort(
    (a, b) =>
      b.score - a.score ||
      textOf(a.item).length - textOf(b.item).length ||
      textOf(a.item).localeCompare(textOf(b.item)),
  );
}
