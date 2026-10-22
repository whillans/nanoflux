/** Token pairs scoring below this count as unrelated (0) in the assignment. */
const MIN_TOKEN_SIMILARITY = 0.5;

/**
 * CJK scripts, where one character changes the meaning ("美国" vs "中国"),
 * so their tokens match exactly only. Fuzzy matching is for alphabetic words
 * (plurals, spelling variants).
 */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Edit distance over code points. */
function levenshtein(a: string[], b: string[]): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length]!;
}

/** Normalized edit similarity of two lowercase tokens, in [0, 1]. */
function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (CJK.test(a) || CJK.test(b)) return 0;
  const x = [...a];
  const y = [...b];
  const score = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  return score >= MIN_TOKEN_SIMILARITY ? score : 0;
}

/**
 * Hungarian algorithm (Kuhn–Munkres, O(n²m)) on a rows ≤ cols matrix.
 * Returns the maximum total weight of a one-to-one row→column assignment.
 */
export function maxWeightAssignment(weights: number[][]): number {
  const n = weights.length;
  if (n === 0) return 0;
  const m = weights[0]!.length;
  if (m < n) throw new Error("maxWeightAssignment expects rows <= cols");

  // Minimize cost = -weight, using 1-based potentials u/v and column matches p.
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      const row = weights[i0 - 1]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = -row[j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else {
          minv[j]! -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }

  let total = 0;
  for (let j = 1; j <= m; j++) {
    const i = p[j]!;
    if (i) total += weights[i - 1]![j - 1]!;
  }
  return total;
}

/**
 * Title similarity in [0, 1]: best one-to-one token matching (Hungarian),
 * normalized as 2·matched / (|a| + |b|).
 */
export function tokensSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const [rows, cols] = a.length <= b.length ? [a, b] : [b, a];
  const weights = rows.map((x) => cols.map((y) => tokenSimilarity(x, y)));
  return (2 * maxWeightAssignment(weights)) / (a.length + b.length);
}

/** Split a stored `title_tokens` value into lowercase tokens. */
export function splitTokens(value: string | null | undefined): string[] {
  return (value ?? "").toLocaleLowerCase().split(" ").filter(Boolean);
}
