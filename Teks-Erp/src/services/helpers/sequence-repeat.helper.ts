// =============================================================================
// Dizi kodunda tekrar kısaltması: "10x(A2 B2 C1) D4" = parantez içi 10 kez, ardından D4 (Seyitoğlu, 2026-11-25)
// =============================================================================
// Desen programlarındaki "DO 10 … NEXT" döngüsünün karşılığı. Atkı sırası (`weft-sequence.helper`) ve çözgü
// dizilimi (`warp-sequence.helper`) bu bölücüyü paylaşır; panel aynası `Electron/src/components/weave/sequence-edit.ts`.
// Yazımlar: "10x(…)", "(…)x10", "10*(…)"; iç içe parantez YOK. Girdi BÜYÜK HARFE çevrilmiş gelir. SAF.
// =============================================================================

export interface RepeatPart {
  /** Parçanın ham metni (grup ise parantez içi). */
  text: string;
  /** Tekrar sayısı (grup dışı parça 1). */
  times: number;
  group: boolean;
}

export type RepeatError = "unclosed" | "nested" | "noCount" | "zero" | "empty";
export type RepeatSplit = { ok: true; parts: RepeatPart[] } | { ok: false; reason: RepeatError };

const GROUP = /(\d{1,4})\s*[X*]\s*\(([^()]*)\)|\(([^()]*)\)\s*[X*]\s*(\d{1,4})/g;

/** Kodu grup dışı / tekrar grubu parçalarına böler; parantez hatası sebebiyle döner. */
export function splitRepeatGroups(upper: string): RepeatSplit {
  let depth = 0;
  for (const ch of upper) {
    if (ch === "(") {
      depth++;
      if (depth > 1) return { ok: false, reason: "nested" };
    } else if (ch === ")") {
      depth--;
      if (depth < 0) return { ok: false, reason: "unclosed" };
    }
  }
  if (depth !== 0) return { ok: false, reason: "unclosed" };
  const parts: RepeatPart[] = [];
  let last = 0;
  for (const m of upper.matchAll(GROUP)) {
    if (m.index > last) parts.push({ text: upper.slice(last, m.index), times: 1, group: false });
    const times = Number(m[1] ?? m[4]);
    const text = (m[2] ?? m[3])!;
    if (times <= 0) return { ok: false, reason: "zero" };
    if (text.trim() === "") return { ok: false, reason: "empty" };
    parts.push({ text, times, group: true });
    last = m.index + m[0].length;
  }
  if (last < upper.length) parts.push({ text: upper.slice(last), times: 1, group: false });
  if (parts.some((p) => !p.group && /[()]/.test(p.text))) return { ok: false, reason: "noCount" };
  return { ok: true, parts };
}
