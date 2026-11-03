// =============================================================================
// GELEN BELGE — çok partili belgenin PARTİ ÖZETİ (S1, saf, TEK kaynak): satırlar + bölüm beyanı → parti listesi + canlı uyarılar
// =============================================================================
// Parti = bölüm (blok). Kimlik (parti no, sipariş no, yazan top) okumada `totalsDeclared.blocks[]`e yazılır; satır sayısı/metre
// CANLI satırlardan sayılır — operatör eksik satırı girince uyarı kendiliğinden düşer (kayıtlı OCR uyarısı bayatlar, gösterilmez).
// =============================================================================
export interface PartyLineInput {
  blockNo: number;
  meters: { toString(): string } | number | string;
  weightKg: { toString(): string } | number | string | null;
}

export interface NoteParty {
  blockNo: number;
  batchNo: string | null;
  orderNo: string | null;
  /** Belgede yazan top adedi ("4 TOP"); okunmadıysa null. */
  declaredTopCount: number | null;
  /** Bölüm ara toplamı (m); okunmadıysa null. */
  declaredMeters: number | null;
  lineCount: number;
  meters: number;
  weightKg: number | null;
  warnings: string[];
}

const TOL = 0.005;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** OCR'ın okuduğu sayfa damgasının toplamı (`totalsDeclared.pages`; "1/2" → 2) — yalnız uyarı kaynağı, onay kapısı değil. */
export function declaredPageCount(totalsDeclared: unknown): number | null {
  const v = totalsDeclared && typeof totalsDeclared === "object" ? (totalsDeclared as { pages?: unknown }).pages : undefined;
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

/** Beyana sayfa damgasını ekler (null → olduğu gibi). */
export function withDeclaredPages<T>(totalsDeclared: T, pages: number | null): T {
  if (pages === null || !totalsDeclared || typeof totalsDeclared !== "object") return totalsDeclared;
  return { ...totalsDeclared, pages };
}

/** Beyan bloklarından bölüm kimliği taşıyanlar (parti no ya da sipariş no ya da yazan top) — bölümsüz belgede boş. */
function sectionBlocks(totalsDeclared: unknown): Array<Record<string, unknown> & { blockNo: number }> {
  const blocks = totalsDeclared && typeof totalsDeclared === "object" ? (totalsDeclared as { blocks?: unknown }).blocks : undefined;
  if (!Array.isArray(blocks)) return [];
  return blocks.filter((b): b is Record<string, unknown> & { blockNo: number } =>
    !!b && typeof b === "object" && typeof (b as { blockNo?: unknown }).blockNo === "number" && ("batchNo" in b || "orderNo" in b || "topCount" in b));
}

/**
 * Parti listesi: bölüm beyanı olan bloklar + satırı olan bloklar (birleşik, blok sırasıyla). Tek bölümlü/bölümsüz belgede 0–1 parti.
 * `pages`: belgenin beyan ettiği sayfa sayısı ve taranan sayfalar → eksik sayfa uyarısı belge düzeyinde.
 */
export function noteParties(lines: ReadonlyArray<PartyLineInput>, totalsDeclared: unknown, pages?: { pageCount: number | null; scannedPages: ReadonlyArray<number> }): { parties: NoteParty[]; warnings: string[] } {
  const decl = new Map(sectionBlocks(totalsDeclared).map((b) => [b.blockNo, b]));
  const byBlock = new Map<number, PartyLineInput[]>();
  for (const l of lines) byBlock.set(l.blockNo, [...(byBlock.get(l.blockNo) ?? []), l]);
  const blockNos = [...new Set([...decl.keys(), ...(decl.size ? byBlock.keys() : [])])].sort((a, b) => a - b);
  const parties = blockNos.map((blockNo): NoteParty => {
    const d = decl.get(blockNo);
    const ls = byBlock.get(blockNo) ?? [];
    const meters = r3(ls.reduce((s, l) => s + (num(l.meters) ?? 0), 0));
    const kgs = ls.map((l) => num(l.weightKg)).filter((x): x is number => x !== null);
    const p: NoteParty = {
      blockNo,
      batchNo: str(d?.batchNo),
      orderNo: str(d?.orderNo),
      declaredTopCount: num(d?.topCount),
      declaredMeters: num(d?.m),
      lineCount: ls.length,
      meters,
      weightKg: kgs.length ? r3(kgs.reduce((s, x) => s + x, 0)) : null,
      warnings: [],
    };
    const name = p.batchNo ?? `${blockNo}. parti`;
    if (p.declaredTopCount !== null && p.declaredTopCount !== p.lineCount) p.warnings.push(`Parti ${name}: belgede ${p.declaredTopCount} TOP yazıyor, ${p.lineCount} satır var.`);
    if (p.declaredMeters !== null && Math.abs(p.declaredMeters - meters) > Math.max(0.001, p.declaredMeters * TOL)) p.warnings.push(`Parti ${name}: ara toplam ${p.declaredMeters} m, satırların toplamı ${meters} m.`);
    return p;
  });
  const warnings: string[] = [];
  if (pages?.pageCount && pages.pageCount > 1) {
    const have = new Set(pages.scannedPages);
    const missing = Array.from({ length: pages.pageCount }, (_, i) => i + 1).filter((n) => !have.has(n));
    if (missing.length) warnings.push(`Belge ${pages.pageCount} sayfa; eksik sayfa: ${missing.join(", ")} — diğer sayfaları aynı belgeye okutun.`);
  }
  return { parties, warnings };
}
