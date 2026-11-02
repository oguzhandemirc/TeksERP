// =============================================================================
// GELEN BELGE — onay kapılarının SAF yüklemleri (TEK kaynak): toplam kapısı + satır sorunları
// =============================================================================
// Onay ön kontrolü (`gelen-belge-onay.service.ts` precheck) ve detay yanıtı (`getDeliveryNote` →
// `totalsCheck` + satır `problems`) AYNI fonksiyonları çağırır: panel şeridi/süzgeci kapının uygulayacağı
// hükmü okur, istemcide ikinci hesap yoktur. DB okumaz, yazmaz (bekçi doğrudan sınar).
// =============================================================================
import { DeliveryNoteLineStatus, Prisma } from "@prisma/client";

/** Beyan edilen kg/m ile satır toplamı arasındaki hoşgörü (OCR ondalık kaybı; adet HOŞGÖRÜSÜZ). */
export const TOTAL_TOLERANCE = 0.005;

// OCR beyanı sayıları METİN yazar (motor DeclaredTotals: string); elle girilen sayı olabilir — karşılaştırma Number() ile.
type DeclaredBlock = { blockNo?: number; count?: number | string | null; kg?: number | string | null; m?: number | string | null };
export type TotalLine = { blockNo: number; meters: Prisma.Decimal | number | string; weightKg: Prisma.Decimal | number | string | null; status: DeliveryNoteLineStatus };

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.001, Math.abs(b) * TOTAL_TOLERANCE);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const finite = (n: number): number | null => (Number.isFinite(n) ? n : null);

export type TotalField = "count" | "m" | "kg";
export interface TotalDiff {
  field: TotalField;
  /** Beyan (sayıya çevrilemeyen OCR metni → null; yine de uyuşmazlıktır). */
  declared: number | null;
  actual: number;
  /** satır − beyan (beyan okunamazsa null). */
  diff: number | null;
}
export interface BlockCheck {
  blockNo: number;
  lines: { count: number; m: number; kg: number };
  /** Beyansız blok → null (doğrulanamaz). */
  declared: { count: number | null; m: number | null; kg: number | null } | null;
  diffs: TotalDiff[];
  /** null = beyan yok; true/false = kapı bu blokta geçer/geçmez. */
  ok: boolean | null;
}
export interface TotalsCheck {
  /** null = hiç beyan yok; false = kapı TOTAL_MISMATCH verir (gerekçesiz). */
  ok: boolean | null;
  tolerance: number;
  blocks: BlockCheck[];
  /** Kapının 409 `TOTAL_MISMATCH` metinleri (bayt-aynı). */
  mismatches: string[];
  /** Başlık top adedi ↔ satır sayısı — yalnız uyarı. */
  warnings: string[];
}

/**
 * Başlık top adedi ↔ canlı satır sayısı — UYARI (tasarım §4: `declaredTopCount` yalnız uyarı; motor onu blok 1'den
 * okur, çok bloklu belgede sert kapı her onayı 409'a düşürürdü).
 */
export function totalWarnings(note: { declaredTopCount: number | null }, lines: ReadonlyArray<TotalLine>): string[] {
  const live = lines.filter((l) => l.status !== "SKIPPED").length;
  return note.declaredTopCount != null && note.declaredTopCount !== live ? [`Belgede ${note.declaredTopCount} top yazıyor, satır sayısı ${live}.`] : [];
}

function sumBlock(live: ReadonlyArray<TotalLine>, blockNo: number) {
  const bl = live.filter((l) => l.blockNo === blockNo);
  return { count: bl.length, m: bl.reduce((s, l) => s + Number(l.meters), 0), kg: bl.reduce((s, l) => s + Number(l.weightKg ?? 0), 0) };
}

function checkDeclaredBlock(b: DeclaredBlock, live: ReadonlyArray<TotalLine>, out: string[]): BlockCheck {
  const blockNo = b.blockNo ?? 1;
  const s = sumBlock(live, blockNo);
  const hasCount = b.count != null && b.count !== "";
  const declared = { count: hasCount ? finite(Number(b.count)) : null, m: b.m != null ? finite(Number(b.m)) : null, kg: b.kg != null ? finite(Number(b.kg)) : null };
  const diffs: TotalDiff[] = [];
  const add = (field: TotalField, actual: number, d: number | null) => diffs.push({ field, declared: d, actual: round3(actual), diff: d === null ? null : round3(actual - d) });
  if (hasCount && Number(b.count) !== s.count) {
    out.push(`Blok ${blockNo}: beyan ${b.count} top, satır ${s.count}.`);
    add("count", s.count, declared.count);
  }
  if (b.m != null && !near(s.m, Number(b.m))) {
    out.push(`Blok ${blockNo}: beyan ${b.m} m, satır toplamı ${s.m.toFixed(3)} m.`);
    add("m", s.m, declared.m);
  }
  if (b.kg != null && !near(s.kg, Number(b.kg))) {
    out.push(`Blok ${blockNo}: beyan ${b.kg} kg, satır toplamı ${s.kg.toFixed(3)} kg.`);
    add("kg", s.kg, declared.kg);
  }
  const any = hasCount || b.m != null || b.kg != null;
  return { blockNo, lines: { count: s.count, m: round3(s.m), kg: round3(s.kg) }, declared: any ? declared : null, diffs, ok: any ? diffs.length === 0 : null };
}

/**
 * Toplam kapısı (SERT) — Σ satır ↔ blok başına beyan (T.Adet/kg/m), SKIPPED sayılmaz. Beyanlı bloklar beyan
 * sırasıyla, satırı olup beyanı olmayan bloklar (doğrulanamaz) sonra gelir. `mismatches` boşsa kapı geçer.
 */
export function totalsCheck(note: { totalsDeclared: unknown; declaredTopCount: number | null }, lines: ReadonlyArray<TotalLine>): TotalsCheck {
  const live = lines.filter((l) => l.status !== "SKIPPED");
  const mismatches: string[] = [];
  const raw = (note.totalsDeclared as { blocks?: DeclaredBlock[] } | null)?.blocks;
  const declaredBlocks = Array.isArray(raw) ? raw : [];
  const blocks = declaredBlocks.map((b) => checkDeclaredBlock(b, live, mismatches));
  const seen = new Set(blocks.map((b) => b.blockNo));
  for (const blockNo of [...new Set(live.map((l) => l.blockNo))].sort((a, b) => a - b)) {
    if (seen.has(blockNo)) continue;
    const s = sumBlock(live, blockNo);
    blocks.push({ blockNo, lines: { count: s.count, m: round3(s.m), kg: round3(s.kg) }, declared: null, diffs: [], ok: null });
  }
  const ok = blocks.some((b) => b.ok === false) ? false : blocks.some((b) => b.ok === true) ? true : null;
  return { ok, tolerance: TOTAL_TOLERANCE, blocks, mismatches, warnings: totalWarnings(note, lines) };
}

/** Kapının uyuşmazlık listesi — `totalsCheck`ten türer (ikinci hesap yok). */
export function totalMismatches(note: { totalsDeclared: unknown }, lines: ReadonlyArray<TotalLine>): string[] {
  return totalsCheck({ totalsDeclared: note.totalsDeclared, declaredTopCount: null }, lines).mismatches;
}

// ── Satır sorunları ─────────────────────────────────────────────────────────

/** Onayın işleyeceği "açık" satır: PENDING | FAILED | ENTERING (yarıda kalmış). */
const OPEN_FOR_APPROVAL: ReadonlySet<DeliveryNoteLineStatus> = new Set([DeliveryNoteLineStatus.PENDING, DeliveryNoteLineStatus.FAILED, DeliveryNoteLineStatus.ENTERING]);
export const isOpenForApproval = (l: { status: DeliveryNoteLineStatus }): boolean => OPEN_FOR_APPROVAL.has(l.status);

/** Satır sorun kodu: FAILED girişi düşmüş · ITEM_UNRESOLVED ürün eşlenmemiş · NEEDS_REVIEW hücre gözden geçirilmemiş (düşük güven). */
export type LineProblem = "FAILED" | "ITEM_UNRESOLVED" | "NEEDS_REVIEW";

/** Gözden geçirmenin "sorunlu satır" yüklemi — onay ön kontrolünün ürünsüz/gözden geçirilmemiş kümesi de BUNDAN. */
export function lineProblems(l: { status: DeliveryNoteLineStatus; itemId: string | null; needsReview: boolean }): LineProblem[] {
  const out: LineProblem[] = [];
  if (l.status === DeliveryNoteLineStatus.FAILED) out.push("FAILED");
  if (!isOpenForApproval(l)) return out;
  if (!l.itemId) out.push("ITEM_UNRESOLVED");
  if (l.needsReview) out.push("NEEDS_REVIEW");
  return out;
}
