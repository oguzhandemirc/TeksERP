// =============================================================================
// GELEN BELGE — onay kapılarının SAF yüklemleri (TEK kaynak): toplam kapısı + satır sorunları
// =============================================================================
// Onay ön kontrolü (`gelen-belge-onay.service.ts` precheck) ve detay yanıtı (`getDeliveryNote` →
// `totalsCheck` + satır `problems`) AYNI fonksiyonları çağırır: panel şeridi/süzgeci kapının uygulayacağı
// hükmü okur, istemcide ikinci hesap yoktur. DB okumaz, yazmaz (bekçi doğrudan sınar).
// =============================================================================
import { DeliveryNoteLineStatus, Prisma } from "@prisma/client";
import { v5 as uuidv5 } from "uuid";
import { SUSPECT_MARK } from "../lib/gelen-belge/taslak";
import { sayiMetni } from "./reports/anlati/sayi-bicim";
import type { DocumentTotalCheckMode, UnreviewedApprovalMode } from "./system-setting.service";

/** Beyan edilen kg/m ile satır toplamı arasındaki hoşgörü (OCR ondalık kaybı; adet HOŞGÖRÜSÜZ). */
export const TOTAL_TOLERANCE = 0.005;

// OCR beyanı sayıları METİN yazar (motor DeclaredTotals: string); elle girilen sayı olabilir — karşılaştırma Number() ile.
type DeclaredBlock = { blockNo?: number; count?: number | string | null; kg?: number | string | null; m?: number | string | null };
export type TotalLine = { blockNo: number; meters: Prisma.Decimal | number | string; weightKg: Prisma.Decimal | number | string | null; status: DeliveryNoteLineStatus; id?: string };

/** Belge → özet satırı kimlik uzayı (PER_DOCUMENT; sabit: yarıda kalan onay ikinci özet satırı, dolayısıyla ikinci top doğurmaz). */
const SUMMARY_LINE_NS = "b3e7c1d4-2a9f-4e6b-8c15-0f9d2e7a4b61";
/**
 * Belge başına tek kayıt (`gelenBelge.entryMode=PER_DOCUMENT`) özet satırının kimliği — belirlenimli, satır no'dan bağımsız.
 * Toplam kıyası belgenin kendi satırlarını sayar: özet satırı (= kurşun metresi) ikinci kez sayılmaz.
 */
export const summaryLineId = (noteId: string): string => uuidv5(`${noteId}|TEK`, SUMMARY_LINE_NS);
/** Toplam/adet kıyasına giren satırlar: atlanmamış ve özet satırı olmayan (INFO satırı belgenin satırıdır, sayılır). */
function linesForTotals<T extends TotalLine>(noteId: string | undefined, lines: ReadonlyArray<T>): T[] {
  const sid = noteId ? summaryLineId(noteId) : null;
  return lines.filter((l) => l.status !== "SKIPPED" && (sid === null || l.id !== sid));
}

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.001, Math.abs(b) * TOTAL_TOLERANCE);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const finite = (n: number): number | null => (Number.isFinite(n) ? n : null);
// Operatör metni Türkçe sayı yazar ("241", "241,5", "1.234,25"); `toFixed(3)` "241.000" basıp "241 bin" okunuyordu.
// Sayıya çevrilemeyen OCR beyanı olduğu gibi kalır. Yalnız metin içindir — JSON alanları (`diffs`, `lines`) ham sayıdır.
const sayi = (v: number | string): string => (v !== "" && Number.isFinite(Number(v)) ? sayiMetni(Number(v), 3) : String(v));

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
/** Başlıktaki belge geneli beyan (ör. "Müşteri MT") ↔ Σ bütün canlı satırlar; etiket alan başına belgedeki addır. */
export interface DocumentCheck extends Omit<BlockCheck, "blockNo"> {
  labels: Partial<Record<TotalField, string>>;
  /** Fark onayı engeller mi — `gelenBelge.documentTotalCheck=REQUIRE_REASON`ta true; INFO (varsayılan) farkı yalnız uyarıdır. */
  blocking: boolean;
}
export interface TotalsCheck {
  /** null = hiç beyan yok; false = kapı TOTAL_MISMATCH verir (gerekçesiz). */
  ok: boolean | null;
  tolerance: number;
  blocks: BlockCheck[];
  /** Belge geneli beyan kıyası (şablon `headerTotals`); beyan yoksa null. */
  document: DocumentCheck | null;
  /** Kapının 409 `TOTAL_MISMATCH` metinleri (bayt-aynı). */
  mismatches: string[];
  /** Başlık top adedi ↔ satır sayısı + INFO kipinde belge geneli fark — yalnız uyarı. */
  warnings: string[];
}

/**
 * Başlık top adedi ↔ canlı satır sayısı — UYARI (tasarım §4: `declaredTopCount` yalnız uyarı; motor onu blok 1'den
 * okur, çok bloklu belgede sert kapı her onayı 409'a düşürürdü).
 */
export function totalWarnings(note: { id?: string; declaredTopCount: number | null }, lines: ReadonlyArray<TotalLine>): string[] {
  const live = linesForTotals(note.id, lines).length;
  return note.declaredTopCount != null && note.declaredTopCount !== live ? [`Belgede ${note.declaredTopCount} top yazıyor, satır sayısı ${live}.`] : [];
}

function sumBlock(live: ReadonlyArray<TotalLine>, blockNo: number) {
  const bl = live.filter((l) => l.blockNo === blockNo);
  return { count: bl.length, m: bl.reduce((s, l) => s + Number(l.meters), 0), kg: bl.reduce((s, l) => s + Number(l.weightKg ?? 0), 0) };
}

/** Bir beyanı (blok ya da belge geneli) satır toplamıyla kıyaslar; `head(alan)` mesaj öneki ("Blok 1" · "Belge geneli (Müşteri MT)"). */
function compareDeclared(b: DeclaredBlock, s: { count: number; m: number; kg: number }, head: (f: TotalField) => string, out: string[]): Omit<BlockCheck, "blockNo"> {
  const hasCount = b.count != null && b.count !== "";
  const declared = { count: hasCount ? finite(Number(b.count)) : null, m: b.m != null ? finite(Number(b.m)) : null, kg: b.kg != null ? finite(Number(b.kg)) : null };
  const diffs: TotalDiff[] = [];
  const add = (field: TotalField, actual: number, d: number | null) => diffs.push({ field, declared: d, actual: round3(actual), diff: d === null ? null : round3(actual - d) });
  if (hasCount && Number(b.count) !== s.count) {
    out.push(`${head("count")}: beyan ${sayi(b.count!)} top, satır ${sayi(s.count)}.`);
    add("count", s.count, declared.count);
  }
  if (b.m != null && !near(s.m, Number(b.m))) {
    out.push(`${head("m")}: beyan ${sayi(b.m)} m, satır toplamı ${sayi(s.m)} m.`);
    add("m", s.m, declared.m);
  }
  if (b.kg != null && !near(s.kg, Number(b.kg))) {
    out.push(`${head("kg")}: beyan ${sayi(b.kg)} kg, satır toplamı ${sayi(s.kg)} kg.`);
    add("kg", s.kg, declared.kg);
  }
  const any = hasCount || b.m != null || b.kg != null;
  return { lines: { count: s.count, m: round3(s.m), kg: round3(s.kg) }, declared: any ? declared : null, diffs, ok: any ? diffs.length === 0 : null };
}

function checkDeclaredBlock(b: DeclaredBlock, live: ReadonlyArray<TotalLine>, out: string[]): BlockCheck {
  const blockNo = b.blockNo ?? 1;
  return { blockNo, ...compareDeclared(b, sumBlock(live, blockNo), () => `Blok ${blockNo}`, out) };
}

type DeclaredDocument = DeclaredBlock & { labels?: Partial<Record<TotalField, string>> };

/** Belge geneli beyan ↔ Σ BÜTÜN canlı satırlar (bloklardan bağımsız); beyan yoksa null. Fark metni `out`a (kipe göre mismatches ya da warnings). */
function checkDocument(d: DeclaredDocument | null | undefined, live: ReadonlyArray<TotalLine>, out: string[], blocking: boolean): DocumentCheck | null {
  if (!d || typeof d !== "object") return null;
  const labels = d.labels && typeof d.labels === "object" ? d.labels : {};
  const s = { count: live.length, m: live.reduce((a, l) => a + Number(l.meters), 0), kg: live.reduce((a, l) => a + Number(l.weightKg ?? 0), 0) };
  const r = compareDeclared(d, s, (f) => `Belge geneli${labels[f] ? ` (${labels[f]})` : ""}`, out);
  return r.declared ? { ...r, labels, blocking } : null;
}

/** Belge geneli beyan var mı — çağıran kip ayarını YALNIZ o zaman okur (beyansız belgede DB turu yok). */
export function hasDocumentDeclared(totalsDeclared: unknown): boolean {
  const d = (totalsDeclared as { document?: unknown } | null)?.document;
  return !!d && typeof d === "object";
}

export interface TotalsCheckOptions {
  /** Belge geneli beyan farkı: INFO (varsayılan = bugünkü; uyarı, kapı geçer) | REQUIRE_REASON (mismatches → 409). */
  documentMode?: DocumentTotalCheckMode;
}

/**
 * Toplam kapısı (SERT) — Σ satır ↔ blok başına beyan (T.Adet/kg/m) + belge geneli başlık beyanı (`document`), SKIPPED sayılmaz. Beyanlı bloklar beyan
 * sırasıyla, satırı olup beyanı olmayan bloklar (doğrulanamaz) sonra gelir. `mismatches` boşsa kapı geçer. Belge geneli fark
 * yalnız `documentMode=REQUIRE_REASON`ta kapıdır; INFO'da `warnings`e düşer ve `ok`u bozmaz.
 */
export function totalsCheck(note: { id?: string; totalsDeclared: unknown; declaredTopCount: number | null }, lines: ReadonlyArray<TotalLine>, opts: TotalsCheckOptions = {}): TotalsCheck {
  const live = linesForTotals(note.id, lines);
  const blocking = opts.documentMode === "REQUIRE_REASON";
  const mismatches: string[] = [];
  const docNotes: string[] = [];
  const decl = note.totalsDeclared as { blocks?: DeclaredBlock[]; document?: DeclaredDocument } | null;
  const raw = decl?.blocks;
  const declaredBlocks = Array.isArray(raw) ? raw : [];
  const blocks = declaredBlocks.map((b) => checkDeclaredBlock(b, live, mismatches));
  const document = checkDocument(decl?.document, live, blocking ? mismatches : docNotes, blocking);
  const seen = new Set(blocks.map((b) => b.blockNo));
  for (const blockNo of [...new Set(live.map((l) => l.blockNo))].sort((a, b) => a - b)) {
    if (seen.has(blockNo)) continue;
    const s = sumBlock(live, blockNo);
    blocks.push({ blockNo, lines: { count: s.count, m: round3(s.m), kg: round3(s.kg) }, declared: null, diffs: [], ok: null });
  }
  // INFO'da belge beyanı kapı hükmüne yalnız "beyan var, geçer" olarak girer (ok=null "beyan yok" demesin).
  const docGate = document && !blocking && document.ok === false ? { ...document, ok: true } : document;
  const all = docGate ? [...blocks, docGate] : blocks;
  const ok = all.some((b) => b.ok === false) ? false : all.some((b) => b.ok === true) ? true : null;
  return { ok, tolerance: TOTAL_TOLERANCE, blocks, document, mismatches, warnings: [...totalWarnings(note, lines), ...docNotes] };
}

/** Kapının uyuşmazlık listesi — `totalsCheck`ten türer (ikinci hesap yok). */
export function totalMismatches(note: { totalsDeclared: unknown }, lines: ReadonlyArray<TotalLine>, opts: TotalsCheckOptions = {}): string[] {
  return totalsCheck({ totalsDeclared: note.totalsDeclared, declaredTopCount: null }, lines, opts).mismatches;
}

// ── Satır sorunları ─────────────────────────────────────────────────────────

/** Onayın işleyeceği "açık" satır: PENDING | FAILED | ENTERING (yarıda kalmış). */
const OPEN_FOR_APPROVAL: ReadonlySet<DeliveryNoteLineStatus> = new Set([DeliveryNoteLineStatus.PENDING, DeliveryNoteLineStatus.FAILED, DeliveryNoteLineStatus.ENTERING]);
export const isOpenForApproval = (l: { status: DeliveryNoteLineStatus }): boolean => OPEN_FOR_APPROVAL.has(l.status);

/**
 * Satır sorun kodu: FAILED girişi düşmüş · ITEM_UNRESOLVED ürün eşlenmemiş · NEEDS_REVIEW hücre gözden geçirilmemiş
 * (düşük güven) · SUSPECT_VALUE el yazısı metresi şüpheli (harf / medyandan çok küçük-büyük; yalnız etiket, kapı değil).
 */
export type LineProblem = "FAILED" | "ITEM_UNRESOLVED" | "NEEDS_REVIEW" | "SUSPECT_VALUE";

/** Okuma işinin şüpheli işareti (`ocrRaw._suspect`) — metre düzeltilince/gözden geçirilince needsReview ile birlikte düşer. */
const suspectMarked = (ocrRaw: unknown): boolean =>
  !!ocrRaw && typeof ocrRaw === "object" && !Array.isArray(ocrRaw) && typeof (ocrRaw as Record<string, unknown>)[SUSPECT_MARK] === "string";

/** Onayın ürünsüz satıra uygulayacağı KULLANILABİLİR varsayılan (müşteri > fabrika; `usableDefaultItem`ten). */
export interface ItemFallback { id: string; name: string; source: "CUSTOMER" | "FACTORY" }
type ProblemLineInput = { status: DeliveryNoteLineStatus; itemId: string | null; needsReview: boolean; ocrRaw?: unknown };

/** Bu satır onayda varsayılan ürünle mi doğacak? Açık + ürünsüz + kullanılabilir varsayılan → o ürün; aksi null. */
export const lineItemFallback = (l: ProblemLineInput, fallback: ItemFallback | null | undefined): ItemFallback | null =>
  fallback && !l.itemId && isOpenForApproval(l) ? fallback : null;

/**
 * Gözden geçirmenin "sorunlu satır" yüklemi — onay ön kontrolünün ürünsüz/gözden geçirilmemiş kümesi de BUNDAN.
 * `fallback`: onayın uygulayacağı kullanılabilir varsayılan ürün — onunla doğacak satır ITEM_UNRESOLVED DEĞİLDİR (kapı geçer).
 */
export function lineProblems(l: ProblemLineInput, fallback?: ItemFallback | null): LineProblem[] {
  const out: LineProblem[] = [];
  if (l.status === DeliveryNoteLineStatus.FAILED) out.push("FAILED");
  if (!isOpenForApproval(l)) return out;
  if (!l.itemId && !lineItemFallback(l, fallback)) out.push("ITEM_UNRESOLVED");
  if (l.needsReview) out.push("NEEDS_REVIEW");
  if (l.needsReview && suspectMarked(l.ocrRaw)) out.push("SUSPECT_VALUE");
  return out;
}

// ── İnceleme kapısı (fabrika ayarı `gelenBelge.unreviewedApproval`) ──────────

/** Kapı kipi — ayarın kendi tipi (tek küme `UNREVIEWED_APPROVAL_VALUES`). */
export type ReviewGateMode = UnreviewedApprovalMode;
export interface ReviewGate {
  /** Onayı durduran satır no'ları (boş = geçer). */
  blocked: number[];
  /** Kapı kodu (409); geçerse null. */
  code: "DELIVERY_NOTE_REVIEW_PENDING" | "DELIVERY_NOTE_SUSPECT_PENDING" | null;
  /** Geçen ama gözden geçirilmemiş satırlar — onay uyarısı. */
  warned: number[];
}

/**
 * Gözden geçirilmemiş satır kapısı — satır kümeleri YALNIZ `lineProblems`ten: WARN hepsi uyarı · BLOCK_SUSPECT yalnız
 * SUSPECT_VALUE satırları durdurur, kalanı uyarı · BLOCK her NEEDS_REVIEW satırı durdurur. Panel ön kontrolü aynı kümeyi okur.
 */
export function reviewGate(lines: ReadonlyArray<Parameters<typeof lineProblems>[0] & { lineNo: number }>, mode: ReviewGateMode): ReviewGate {
  const pick = (code: LineProblem) => lines.filter((l) => lineProblems(l).includes(code)).map((l) => l.lineNo);
  const unreviewed = pick("NEEDS_REVIEW");
  if (mode === "BLOCK" && unreviewed.length) return { blocked: unreviewed, code: "DELIVERY_NOTE_REVIEW_PENDING", warned: [] };
  const suspect = mode === "BLOCK_SUSPECT" ? pick("SUSPECT_VALUE") : [];
  if (suspect.length) return { blocked: suspect, code: "DELIVERY_NOTE_SUSPECT_PENDING", warned: [] };
  return { blocked: [], code: null, warned: unreviewed };
}

// ── Belge başına tek kayıt kapısı (`gelenBelge.entryMode=PER_DOCUMENT`) ─────

/** Kurşun metresinin kaynağı (DB CHECK `customer_delivery_notes_kursun_source_ck` ile aynı küme). */
export type KursunMetersSource = "OUTPUT" | "TOTAL" | "LINE_SUM" | "MANUAL";
export interface PerDocumentGate {
  /** Onayı durduran kod (409); geçerse null. */
  code: "KURSUN_METERS_REQUIRED" | "KURSUN_METERS_REVIEW_PENDING" | null;
  /** Geçen ama gözden geçirilmemiş kurşun metresi — onay uyarısı. */
  warnings: string[];
  /** Toplam uyuşmazlığı kapı mı (yalnız kaynak Σ satır iken); değilse uyarıdır. */
  totalsBlocking: boolean;
}

/**
 * PER_DOCUMENT onay kapısı — onay ön kontrolü ve detay yanıtı AYNI yüklemi okur. Satır kapıları (ürün/inceleme) bu kipte
 * uygulanmaz: satırlar bilgidir, kayıt kurşun metresinden doğar. İnceleme kipi `unreviewedApproval`: WARN geçer, ötekiler 409.
 */
export function perDocumentGate(note: { kursunMeters: Prisma.Decimal | number | string | null; kursunMetersSource: string | null; kursunMetersReview: boolean }, mode: UnreviewedApprovalMode): PerDocumentGate {
  const totalsBlocking = note.kursunMetersSource === "LINE_SUM";
  if (note.kursunMeters == null || !(Number(note.kursunMeters) > 0)) return { code: "KURSUN_METERS_REQUIRED", warnings: [], totalsBlocking };
  if (!note.kursunMetersReview) return { code: null, warnings: [], totalsBlocking };
  if (mode !== "WARN") return { code: "KURSUN_METERS_REVIEW_PENDING", warnings: [], totalsBlocking };
  return { code: null, warnings: [`Kurşun metresi (${sayi(String(note.kursunMeters))} m) gözden geçirilmeden onaylandı.`], totalsBlocking };
}
