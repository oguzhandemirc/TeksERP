// =============================================================================
// GELEN BELGE — parti no adayları + kurşun metresi: NOT DÜZEYİNDE canlı türetme (Gülkesim, 2026-11-02)
// =============================================================================
// Aday ve metre listesi SAKLANMAZ: ilk okunmuş taramanın zarfı (`ocrResult.regions[0]`) + `totalsDeclared` + canlı satırlardan
// saf helper'larla (`parti-no.ts`, `kursun-metre.ts`) türetilir. Taslak doldurma, detay ve okuma özeti BURADAN okur.
// Bu dosya tarama/taslak servislerini içe aktarmaz (değer döngüsü yok).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { batchNoCandidates, pickBatchNo, type BatchNoCandidate } from "../lib/gelen-belge/parti-no";
import { contradictsLineSum, resolveKursunMeters, type KursunMeterResult } from "../lib/gelen-belge/kursun-metre";
import { USER_TEMPLATE_PREFIX } from "./gelen-belge-sablon.service";
import { templateByCode } from "../lib/gelen-belge/sablon-bul";
import type { DocumentTemplate } from "../lib/gelen-belge/motor";

type Db = Prisma.TransactionClient | typeof prisma;

/** Zarftaki bölge özeti (yalnız okunan parçalar). */
export interface StoredRegion {
  templateId: string | null;
  fields: Record<string, string | null>;
}

/** Notun ilk okunmuş sayfasının ilk bölgesi; yalnız JSON alt yolu çekilir (ham OCR taşınmaz). Yoksa null. */
export async function readFirstRegion(db: Db, noteId: string): Promise<StoredRegion | null> {
  const rows = await db.$queryRaw<Array<{ region: unknown }>>(Prisma.sql`
    SELECT "ocrResult"->'regions'->0 AS region FROM "document_scans"
    WHERE "noteId" = ${noteId}::uuid AND "status" = 'READ' AND "ocrResult" IS NOT NULL
    ORDER BY "pageNo" ASC, "regionNo" ASC NULLS FIRST, "createdAt" ASC LIMIT 1`);
  return toRegion(rows[0]?.region);
}

/** Şema dışı zarf → null (FAIL-CLOSED: aday/metre önerisi yok, hata değil). */
export function toRegion(v: unknown): StoredRegion | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as { templateId?: unknown; fields?: unknown };
  const f = r.fields && typeof r.fields === "object" && !Array.isArray(r.fields) ? (r.fields as Record<string, unknown>) : {};
  const fields: Record<string, string | null> = {};
  for (const [k, x] of Object.entries(f)) fields[k] = typeof x === "string" ? x : null;
  return { templateId: typeof r.templateId === "string" ? r.templateId : null, fields };
}

export interface BatchAndMeters {
  batchNoCandidates: BatchNoCandidate[];
  kursun: KursunMeterResult;
}

/** `gelenBelge.tanitimGuveni` kipi (`gelen-belge-tanitim-guveni.service`): NORMAL bugünkü · TRUSTED sorusuz · BLIND tahmin yok. */
export type TrustMode = "NORMAL" | "TRUSTED" | "BLIND";

const BLIND_KURSUN: KursunMeterResult = { meters: null, source: null, review: false, candidates: { output: null, total: null, input: null, lineSum: null } };

/**
 * Saf: güven kipini adaylara uygular — okuma anı (kolon) ve okuma özeti (canlı) AYNI fonksiyondan geçer. TRUSTED yalnız
 * türetimin dayandığı şablon KULLANICI şablonuysa (`u-`) etkilidir (çok bölgede ilk bölge sistem/GENEL ise NORMAL): şablonda
 * parti no alanı atandıysa yalnız o alan aday (evrak/sipariş no ikincil aday düşer); metre şablonun çıkış/toplam alanından
 * geldiyse el yazısı (ızgara) doğrulaması beklemez, Σ satırla ÇELİŞKİ doğrulaması korunur. BLIND: GENEL sözlük tahmini
 * forma dolmaz (aday yok, metre yok). NORMAL: değişmez.
 */
export function applyTrust(d: BatchAndMeters, template: DocumentTemplate | undefined, trust: TrustMode): BatchAndMeters {
  if (trust === "NORMAL") return d;
  if (trust === "BLIND") return { batchNoCandidates: [], kursun: BLIND_KURSUN };
  if (!template?.id.startsWith(USER_TEMPLATE_PREFIX)) return d;
  const hasBatchField = (template.batchNoCandidates ?? []).some((c) => c.kind === "BATCH");
  const fromTemplate = d.kursun.source === "OUTPUT" || d.kursun.source === "TOTAL";
  return {
    batchNoCandidates: hasBatchField ? d.batchNoCandidates.filter((c) => c.kind === "BATCH") : d.batchNoCandidates,
    kursun: fromTemplate ? { ...d.kursun, review: contradictsLineSum(d.kursun) } : d.kursun,
  };
}

/** Tek türetme noktası: bölge + beyan + canlı satır metreleri → adaylar + kurşun metresi (güven kipi uygulanmış). */
export function deriveBatchAndMeters(region: StoredRegion | null, totalsDeclared: unknown, lineMeters: ReadonlyArray<{ toString(): string }>, trust: TrustMode = "NORMAL"): BatchAndMeters {
  const template = templateByCode(region?.templateId);
  const fields = region?.fields ?? {};
  return applyTrust({ batchNoCandidates: batchNoCandidates(template, fields), kursun: resolveKursunMeters({ template, fields, totalsDeclared, lineMeters }) }, template, trust);
}

/** Detay/okuma özeti yanıt parçası (eski istemci yok sayar). */
export async function noteBatchAndMeters(noteId: string, totalsDeclared: unknown, lineMeters: ReadonlyArray<{ toString(): string }>, trust: TrustMode = "NORMAL") {
  const d = deriveBatchAndMeters(await readFirstRegion(prisma, noteId), totalsDeclared, lineMeters, trust);
  return { batchNoCandidates: d.batchNoCandidates, kursunMeterCandidates: d.kursun.candidates };
}

/** Formun hatırlanan parti no anahtarı (`SenderTemplate.batchNoKey`); şablonsuz → null. */
export async function rememberedBatchKey(db: Db, templateId: string | null | undefined): Promise<string | null> {
  if (!templateId) return null;
  const t = await db.senderTemplate.findUnique({ where: { id: templateId }, select: { batchNoKey: true } });
  return t?.batchNoKey ?? null;
}

/** Taslak başlığına yazılacak parti no + kurşun kolonları (seçim `pickBatchNo`). */
export function batchAndMeterColumns(d: BatchAndMeters, rememberedKey: string | null) {
  const picked = pickBatchNo(d.batchNoCandidates, rememberedKey);
  return {
    ourBatchNo: picked?.value ?? null,
    ourBatchNoKey: picked?.key ?? null,
    kursunMeters: d.kursun.meters === null ? null : new Prisma.Decimal(d.kursun.meters),
    kursunMetersSource: d.kursun.source,
    kursunMetersReview: d.kursun.meters === null ? false : d.kursun.review,
  };
}
export type BatchAndMeterColumns = ReturnType<typeof batchAndMeterColumns>;
