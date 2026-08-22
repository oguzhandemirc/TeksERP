// =============================================================================
// BENZER AD ARAMA — mükerrer kaydı OLUŞMADAN ÖNCE göster (2026-08-22)
// =============================================================================
// Kullanıcı isteği: "bayro" yazarken sistem "BAYROFLAM" kaydını göstersin ki
// aynı tanım ikinci kez açılmasın. Temizlemekten iyisi baştan engellemek.
//
// ⚠️ TEK KAYNAK: kural `ImportAdapter.nameGuard` beyanından okunur — yani bu
// uyarı tam olarak YAZMA yolundaki bekçinin (`assertNameNotDuplicate`) ve DB
// seddinin (`<tablo>_nameFold_key`) reddedeceği şeyi gösterir, artı yakın
// olanları. İkinci bir "benzer mi" kuralı yazmak, formun "sorun yok" deyip
// kaydetmede 409 alması demekti (`import-name-guard.ts` başlığındaki aynı
// ayrışma). `nameGuard` beyan etmeyen varlıkta uç 400 döner — sessizce boş
// liste DÖNMEZ, çünkü boş liste "benzer yok" diye okunur.
//
// ⚠️ DÖRT EŞLEŞME TÜRÜ, ÜÇÜ ALT-METİN BİRİ BENZERLİK. Alt-metin (`bayro` ⊂
// `bayroflam`) ile bulanık benzerlik FARKLI sorulardır: bulanık motor bu ikisini
// %50 verir (fazladan anlamlı kelime — `BOYER EMRE ≠ BOYER` kararı) ve tek
// başına kullanılsaydı kullanıcının istediği örnek HİÇ ÇIKMAZDI. Alt-metin
// eşleşmesi bulanık bayrağından BAĞIMSIZ koşar; bayrak yalnız FUZZY'yi kapatır.
import prisma from "../lib/prisma";
import { getImportAdapter } from "./import/import-registry";
import { foldColorNameForCompare, foldNameForCompare } from "./helpers/name-normalize.helper";
import { modelHasMergeLineage } from "./base.service";
import { FUZZY_NOISE_WORDS, FUZZY_PROFILE } from "../constants/duplicate-rules";
import { firmNameSimilarity, productNameSimilarity } from "../utils/string-similarity";
import {
  readDuplicatesFuzzyEnabled,
  readDuplicatesFuzzyThresholdPct,
} from "./system-setting.service";
import { MERGE_ENTITIES, type MergeEntity } from "../constants/merge-map";
import { AppError } from "../utils/app-error";
import type { NameGuardSpec } from "./import/import.types";

/** Kısa metin gürültü üretir ("a" her şeyle eşleşir); altında hiç aranmaz. */
const MIN_QUERY_LEN = 2;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;

export type SimilarMatchKind = "EXACT" | "PREFIX" | "CONTAINS" | "FUZZY";

export interface SimilarNameRow {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  match: SimilarMatchKind;
  /** Yalnız FUZZY'de dolu (0..1). */
  score: number | null;
  /** Operatöre gösterilecek tek satırlık gerekçe. */
  detail: string;
}

export interface SimilarNameResult {
  entity: string;
  label: string;
  rows: SimilarNameRow[];
  /**
   * Katlanmış ad BİREBİR tutuyor mu — `true` ise kaydetme 409 ile REDDEDİLİR.
   * Form bunu kırmızı, diğerlerini sarı gösterir.
   */
  exactBlocked: boolean;
  /** Taranan kayıt sayısı (panel "N kayıt arasında arandı" yazabilir). */
  scanned: number;
  fuzzyEnabled: boolean;
  thresholdPct: number;
}

type AnyDelegate = { findMany: (args: Record<string, unknown>) => Promise<unknown[]> };
const delegate = (model: string): AnyDelegate =>
  (prisma as unknown as Record<string, AnyDelegate>)[model] as AnyDelegate;

const foldOf = (spec: NameGuardSpec, value: string): string =>
  spec.fold === "color" ? foldColorNameForCompare(value) : foldNameForCompare(value);

/** Bulanık profil: 4 birleştirme varlığında katalogdan, diğerlerinde FIRM. */
function profileOf(entity: string): "FIRM" | "PRODUCT" {
  return (MERGE_ENTITIES as readonly string[]).includes(entity)
    ? FUZZY_PROFILE[entity as MergeEntity]
    : "FIRM";
}

const RANK: Record<SimilarMatchKind, number> = { EXACT: 0, PREFIX: 1, CONTAINS: 2, FUZZY: 3 };

export async function findSimilarNames(
  entity: string,
  rawName: string,
  opts: { scopeId?: string | null; excludeId?: string | null; limit?: number } = {},
): Promise<SimilarNameResult> {
  const adapter = getImportAdapter(entity); // bilinmeyen varlıkta kendisi 400 atar
  const spec = adapter.nameGuard;
  if (!spec) {
    throw AppError.badRequest(
      `'${adapter.label}' için ad benzerlik kontrolü tanımlı değil.`,
    );
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIMIT)));
  const name = rawName.trim();
  const q = name ? foldOf(spec, name) : "";

  const [fuzzyEnabled, thresholdPct] = await Promise.all([
    readDuplicatesFuzzyEnabled(),
    readDuplicatesFuzzyThresholdPct(),
  ]);
  const empty: SimilarNameResult = {
    entity: adapter.entity,
    label: adapter.label,
    rows: [],
    exactBlocked: false,
    scanned: 0,
    fuzzyEnabled,
    thresholdPct,
  };
  if (q.length < MIN_QUERY_LEN) return empty;

  // Kapsam: makine → istasyon, şube → müşteri. Kapsam BEYAN EDİLMİŞ ama
  // değeri GELMEMİŞSE tüm tabloda aranır — "henüz istasyon seçmedim" hâlinde
  // uyarıyı susturmak, tam da önlenmek istenen kaydı doğurur.
  const where: Record<string, unknown> = {};
  if (spec.scope && opts.scopeId) where[spec.scope.column] = opts.scopeId;
  if (modelHasMergeLineage(spec.model)) where.mergedIntoId = null;

  const select: Record<string, boolean> = { id: true, isActive: true, [spec.field]: true };
  if (spec.codeField) select[spec.codeField] = true;

  const rows = (await delegate(spec.model).findMany({ where, select })) as Array<
    Record<string, unknown>
  >;

  const profile = profileOf(adapter.entity);
  const threshold = thresholdPct / 100;
  const out: SimilarNameRow[] = [];
  let exactBlocked = false;

  for (const r of rows) {
    const id = String(r.id);
    if (opts.excludeId && id === opts.excludeId) continue;
    const value = String(r[spec.field] ?? "");
    if (!value) continue;
    const folded = foldOf(spec, value);
    if (!folded) continue;

    let match: SimilarMatchKind | null = null;
    let score: number | null = null;
    let detail = "";

    if (folded === q) {
      match = "EXACT";
      detail = "Bu ad zaten kayıtlı (büyük/küçük harf ve Türkçe karakter farkı sayılmaz)";
      exactBlocked = true;
    } else if (folded.startsWith(q)) {
      match = "PREFIX";
      detail = `Yazdığınla başlıyor: "${value}"`;
    } else if (folded.includes(q)) {
      match = "CONTAINS";
      detail = `Yazdığını içeriyor: "${value}"`;
    } else if (fuzzyEnabled) {
      const s =
        profile === "FIRM"
          ? firmNameSimilarity(q, folded, FUZZY_NOISE_WORDS)
          : productNameSimilarity(q, folded);
      if (s >= threshold) {
        match = "FUZZY";
        score = s;
        detail = `Benzerlik %${Math.round(s * 100)}: "${value}"`;
      }
    }
    if (!match) continue;
    out.push({
      id,
      name: value,
      code: spec.codeField ? ((r[spec.codeField] as string | null) ?? null) : null,
      isActive: Boolean(r.isActive),
      match,
      score,
      detail,
    });
  }

  out.sort((a, b) => {
    if (RANK[a.match] !== RANK[b.match]) return RANK[a.match] - RANK[b.match];
    if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
    // Aktif kayıt önce: operatörün ilgilendiği neredeyse hep odur.
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.name.localeCompare(b.name, "tr");
  });

  return {
    entity: adapter.entity,
    label: adapter.label,
    rows: out.slice(0, limit),
    exactBlocked,
    scanned: rows.length,
    fuzzyEnabled,
    thresholdPct,
  };
}
