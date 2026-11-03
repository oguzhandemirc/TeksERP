// Çok sayfalı taslakta üst üste binen çekim süzgeci (saf; DB yok) — taslak.ts'ten ayrıldı (dosya sınırı).
import type { DraftLine } from "./taslak";

/** Üst üste binen çekim denetimine giren mevcut satır (DB'den; sayılar ondalık metin). */
export interface ExistingLineForOverlap {
  senderRollNo: string | null;
  meters: string;
  weightKg: string | null;
  ocrRaw: unknown;
}

/** Top No anahtarı: yalnız Top No kolonundan okunmuş satırda (sıra no / ızgara sırası sayfa başına yeniden başlar). */
function overlapKey(l: { senderRollNo: string | null; ocrRaw: unknown }): string | null {
  const raw = l.ocrRaw as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || !raw.topNo) return null;
  const k = (l.senderRollNo ?? "").replace(/\s+/g, "").toUpperCase();
  return k || null;
}
const sameNum = (a: string | null, b: string | null): boolean => (a === null || b === null ? a === b : Number(a) === Number(b));

/**
 * Çok sayfalı taslakta üst üste binen çekim: yeni sayfanın satırı BAŞKA taramadan gelmiş satırla Top No + kg + metrede
 * birebir eşitse yazılmaz (her mevcut satır tek yeni satırı yutar); Top No aynı, sayılar farklıysa yazılır ama needsReview.
 * Aynı taramanın satırları birbiriyle karşılaştırılmaz (eşit metrajlı meşru toplar).
 */
export function dropOverlapDuplicates(lines: DraftLine[], existing: ExistingLineForOverlap[], pageNo: number): { lines: DraftLine[]; warnings: string[] } {
  const byKey = new Map<string, ExistingLineForOverlap[]>();
  for (const e of existing) {
    const k = overlapKey(e);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }
  const out: DraftLine[] = [];
  let skipped = 0;
  let conflicts = 0;
  for (const l of lines) {
    const k = overlapKey(l);
    const cands = k ? byKey.get(k) : undefined;
    if (!k || !cands) {
      out.push(l);
      continue;
    }
    const i = cands.findIndex((e) => sameNum(e.meters, l.meters) && sameNum(e.weightKg, l.weightKg));
    if (i >= 0) {
      cands.splice(i, 1);
      skipped++;
      continue;
    }
    conflicts++;
    out.push({ ...l, needsReview: true });
  }
  const warnings: string[] = [];
  if (skipped) warnings.push(`OVERLAP_DUPLICATE_SKIPPED: Sayfa ${pageNo}: ${skipped} satır başka sayfada zaten vardı (üst üste binen çekim) — atlandı`);
  if (conflicts) warnings.push(`OVERLAP_ROLL_NO_CONFLICT: Sayfa ${pageNo}: ${conflicts} satırın Top No'su başka sayfada farklı kg/metreyle var — gözden geçirin`);
  return { lines: out, warnings };
}
