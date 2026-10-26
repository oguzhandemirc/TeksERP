// Sürüm karşılaştırmasının satır farkı — kendi küçük LCS'imiz (plan §4: "paket yok").
// Ortak baş/son önce kırpılır; kalan çekirdek LCS tablosuna sığmazsa (çok büyük kaynak)
// çekirdek bütünüyle "silindi + eklendi" gösterilir — yanlış eşleme yerine kaba ama doğru fark.

export type DiffKind = "same" | "del" | "add";

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** Eski metindeki satır no (1 tabanlı); eklenen satırda null. */
  oldNo: number | null;
  /** Yeni metindeki satır no; silinen satırda null. */
  newNo: number | null;
}

export const DIFF_CELL_LIMIT = 4_000_000;

const splitLines = (s: string): string[] => (s === "" ? [] : s.replace(/\r\n?/g, "\n").split("\n"));

function lcsCore(a: string[], b: string[], ao: number, bo: number): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i..] ile b[j..] arasındaki LCS uzunluğu (tek boyutlu dizide).
  const dp = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = a[i] === b[j] ? dp[at(i + 1, j + 1)]! + 1 : Math.max(dp[at(i + 1, j)]!, dp[at(i, j + 1)]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]!, oldNo: ao + i + 1, newNo: bo + j + 1 });
      i++;
      j++;
    } else if (dp[at(i + 1, j)]! >= dp[at(i, j + 1)]!) {
      out.push({ kind: "del", text: a[i]!, oldNo: ao + i + 1, newNo: null });
      i++;
    } else {
      out.push({ kind: "add", text: b[j]!, oldNo: null, newNo: bo + j + 1 });
      j++;
    }
  }
  for (; i < n; i++) out.push({ kind: "del", text: a[i]!, oldNo: ao + i + 1, newNo: null });
  for (; j < m; j++) out.push({ kind: "add", text: b[j]!, oldNo: null, newNo: bo + j + 1 });
  return out;
}

export function lineDiff(oldText: string, newText: string, cellLimit = DIFF_CELL_LIMIT): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const head: DiffLine[] = a.slice(0, pre).map((t, k) => ({ kind: "same", text: t, oldNo: k + 1, newNo: k + 1 }));
  const tail: DiffLine[] = a.slice(a.length - suf).map((t, k) => ({
    kind: "same",
    text: t,
    oldNo: a.length - suf + k + 1,
    newNo: b.length - suf + k + 1,
  }));
  const ca = a.slice(pre, a.length - suf);
  const cb = b.slice(pre, b.length - suf);
  const core =
    (ca.length + 1) * (cb.length + 1) <= cellLimit
      ? lcsCore(ca, cb, pre, pre)
      : [
          ...ca.map((t, k): DiffLine => ({ kind: "del", text: t, oldNo: pre + k + 1, newNo: null })),
          ...cb.map((t, k): DiffLine => ({ kind: "add", text: t, oldNo: null, newNo: pre + k + 1 })),
        ];
  return [...head, ...core, ...tail];
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "add") added++;
    else if (l.kind === "del") removed++;
  }
  return { added, removed };
}

/** Uzun ortak blokları katlar: değişikliğin çevresinde `context` satır kalır. */
export function foldUnchanged(lines: DiffLine[], context = 3): Array<DiffLine | { kind: "fold"; count: number }> {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.kind === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: Array<DiffLine | { kind: "fold"; count: number }> = [];
  let folded = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (folded) out.push({ kind: "fold", count: folded });
      folded = 0;
      out.push(l);
    } else folded++;
  });
  if (folded) out.push({ kind: "fold", count: folded });
  return out;
}
