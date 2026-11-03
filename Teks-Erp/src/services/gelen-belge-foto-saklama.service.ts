// =============================================================================
// GELEN BELGE — belge fotoğrafı SAKLAMA (K28, Gülkesim S13b): onaydan/sevkten sonra bayt küçültülür ya da silinir
// =============================================================================
// Fotoğraf baytı DEFTER DEĞİLDİR (satır silinse raporlanan sayı değişmez): bayt küçülür/silinir, SATIR (sha256, okuma
// zarfı `ocrResult`, künye) KALIR. Kip `gelenBelge.photoRetention`; iş (`jobs/gelen-belge-foto-saklama.job.ts`) onay/sevk
// tx'i bittikten SONRA, tx DIŞINDA koşar ve ayarı her turda okur → geçmiş onaylı belgelere de uygulanır.
// Geçiş ATOMİK CLAIM (`updateMany WHERE {id, contentState}`): iki tur aynı taramayı iki kez küçültemez. Küçültme okuma
// servisinde (`POST /kucult`); servis yok/eski → tarama TAM kalır, sonraki tur yeniden dener (fail-safe).
// PDF (arşiv, K6), okunmakta olan (READING; okuyucu varken PENDING de) ve belgeye bağlı olmayan taramaya dokunulmaz.
// KÜÇÜK'te OCR kutu çerçevesi satıra yazılır (`rectFrameWidth/Height`): kutular okuma çerçevesinde kalır. Audit yalnız künye.
// =============================================================================
import { DeliveryNoteStatus, DocumentScanContentState, DocumentScanStatus, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { bilgi, uyari } from "../lib/logger";
import { readerShrink } from "../lib/gelen-belge/okuma-istemcisi";
import { photoFrameSize } from "../lib/gelen-belge/taslak-foto-cerceve";
import { AuditService } from "./audit.service";
import { readPhotoRetention, type PhotoRetentionMode } from "./system-setting.service";
import { membershipSql } from "./ready-works.service";
import { readinessClassSql } from "./helpers/ship-readiness.helper";

const AUDIT_TABLE = "DOCUMENT_SCAN";
/** Saklama ayarının uygulandığı görüntü türleri — PDF arşivdir (K6), dokunulmaz. */
export const RETENTION_IMAGE_MIMES: readonly string[] = ["image/jpeg", "image/png"];
/** Okuması bitmiş tarama (okunmakta olanın baytı okuma işine lazım). Okuyucu yoksa PENDING hiç okunmayacak → o da aday. */
function retentionScanStatuses(readerUrl: string | null): DocumentScanStatus[] {
  const done = [DocumentScanStatus.READ, DocumentScanStatus.READ_FAILED];
  return readerUrl ? done : [...done, DocumentScanStatus.PENDING];
}
/** Sevk kipinde tek turda bakılan en çok belge (sayfa başına). */
const NOTE_PAGE = 200;

export const PHOTO_PURGED_MESSAGE = "Fotoğraf saklama ayarı gereği silindi.";

/** SİLİNDİ taramanın baytını/okumasını isteyen uç: 410 + Türkçe açıklama (eski istemci genel hata görür). */
export function photoPurgedError(): AppError {
  return new AppError(`${PHOTO_PURGED_MESSAGE} Belgenin okunan bilgileri ve satırları duruyor; fotoğraf yeniden açılamaz.`, 410, true, {
    code: "DOCUMENT_SCAN_PURGED",
  });
}

/** Kipin hedef bayt durumu ve kaynak durum kümesi; FULL → iş yok. */
function plan(mode: PhotoRetentionMode): { target: DocumentScanContentState; from: DocumentScanContentState[] } | null {
  switch (mode) {
    case "FULL":
      return null;
    case "SHRINK_ON_APPROVAL":
      return { target: DocumentScanContentState.REDUCED, from: [DocumentScanContentState.FULL] };
    case "DELETE_ON_APPROVAL":
    case "DELETE_ON_DISPATCH":
      return { target: DocumentScanContentState.PURGED, from: [DocumentScanContentState.FULL, DocumentScanContentState.REDUCED] };
  }
}

/** Kipin dokunacağı tarama kümesi (belge APPROVED; PARTIAL yeniden onaylanabilir → fotoğrafı lazım, beklenir). */
function candidateWhere(from: DocumentScanContentState[], readerUrl: string | null, noteIds?: readonly string[]): Prisma.DocumentScanWhereInput {
  return {
    contentState: { in: from },
    mimeType: { in: [...RETENTION_IMAGE_MIMES] },
    status: { in: retentionScanStatuses(readerUrl) },
    note: { status: DeliveryNoteStatus.APPROVED },
    ...(noteIds ? { noteId: { in: [...noteIds] } } : { noteId: { not: null } }),
  };
}

/**
 * Bütün topları sevk edilmiş belgeler: üyelik sevke-hazır birimiyle AYNI (`membershipSql("deliveryNote")` — satır topları
 * + tambur aşağı soyu), sınıf `readinessClassSql` (GİTTİ = SHIPPED). Canlı (HAZIR/İŞLEMDE) top yok ve en az bir top GİTTİ.
 */
export async function fullyShippedNoteIds(noteIds: readonly string[]): Promise<Set<string>> {
  if (noteIds.length === 0) return new Set();
  const rows = await prisma.$queryRaw<Array<{ unit_id: string }>>(Prisma.sql`
    WITH members AS (${membershipSql("deliveryNote", undefined, noteIds)}),
    classed AS (SELECT m.unit_id, ${readinessClassSql("r")} AS cls FROM members m JOIN rolls r ON r.id = m.roll_id)
    SELECT unit_id FROM classed WHERE cls IS NOT NULL
    GROUP BY unit_id
    HAVING COUNT(*) FILTER (WHERE cls IN ('READY', 'IN_PROCESS')) = 0 AND COUNT(*) FILTER (WHERE cls = 'GONE') > 0`);
  return new Set(rows.map((r) => r.unit_id));
}

/** Sevk kipi: aday taramaları olan onaylı belgelerden bütün topları gitmiş olanlar (sayfalı, hepsi taranır). */
async function shippedCandidateNoteIds(from: DocumentScanContentState[], readerUrl: string | null): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.customerDeliveryNote.findMany({
      where: { status: DeliveryNoteStatus.APPROVED, scans: { some: candidateWhere(from, readerUrl) } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: NOTE_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    const shipped = await fullyShippedNoteIds(page.map((n) => n.id));
    out.push(...page.map((n) => n.id).filter((id) => shipped.has(id)));
    if (page.length < NOTE_PAGE) break;
    cursor = page[page.length - 1].id;
  }
  return out;
}

/** Kipe göre işlenecek tarama kimlikleri (en eski önce, en çok `limit`; `skipIds` bu süreçte kalıcı düşenler). */
export async function findRetentionCandidates(mode: PhotoRetentionMode, limit: number, readerUrl: string | null, skipIds: readonly string[] = []): Promise<string[]> {
  const p = plan(mode);
  if (!p) return [];
  let noteIds: string[] | undefined;
  if (mode === "DELETE_ON_DISPATCH") {
    noteIds = await shippedCandidateNoteIds(p.from, readerUrl);
    if (noteIds.length === 0) return [];
  }
  const rows = await prisma.documentScan.findMany({
    where: { ...candidateWhere(p.from, readerUrl, noteIds), ...(skipIds.length ? { id: { notIn: [...skipIds] } } : {}) },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Okuma zarfındaki OCR çerçevesi, fotoğraf yönünde; okunmamış/eksik → null (kutu da yok, ölçek gerekmez). */
function ocrPhotoFrame(env: Prisma.JsonValue): { width: number; height: number } | null {
  const ocr = env !== null && typeof env === "object" && !Array.isArray(env) ? (env as Record<string, unknown>).ocr : undefined;
  if (ocr === null || typeof ocr !== "object" || Array.isArray(ocr)) return null;
  const { imageWidth: w, imageHeight: h, rotation } = ocr as Record<string, unknown>;
  if (!Number.isInteger(w) || !Number.isInteger(h) || (w as number) <= 0 || (h as number) <= 0) return null;
  return photoFrameSize(typeof rotation === "number" ? rotation : undefined, w as number, h as number);
}

export type RetentionOutcome = "REDUCED" | "PURGED" | "RETRY" | "FAILED" | "LOST";

export interface RetentionDeps {
  readerUrl: string | null;
  shrink?: typeof readerShrink;
}

/**
 * Tek taramaya kipi uygular. Claim WHERE'i aday koşulunu yeniden taşır (durum + belge APPROVED + tür): arada başka tur ya da
 * kip değişimi olduysa count 0 → LOST. Küçültme servisi yoksa RETRY (bayt TAM kalır); çözülemeyen görüntü FAILED (iş atlar).
 */
export async function applyRetention(scanId: string, mode: PhotoRetentionMode, deps: RetentionDeps): Promise<RetentionOutcome> {
  const p = plan(mode);
  if (!p) return "LOST";
  const scan = await prisma.documentScan.findFirst({
    where: { id: scanId, ...candidateWhere(p.from, deps.readerUrl) },
    select: { id: true, noteId: true, mimeType: true, sizeBytes: true, contentState: true, content: true, sha256: true, ocrResult: true },
  });
  if (!scan || !scan.content) return "LOST";
  const now = new Date();
  const claimWhere: Prisma.DocumentScanWhereInput = { id: scanId, contentState: scan.contentState, ...candidateWhere(p.from, deps.readerUrl) };

  if (p.target === DocumentScanContentState.PURGED) {
    const c = await prisma.documentScan.updateMany({ where: claimWhere, data: { content: null, contentState: DocumentScanContentState.PURGED, contentStateAt: now } });
    if (c.count === 0) return "LOST";
    await AuditService.log({
      userId: undefined, action: "UPDATE", tableName: AUDIT_TABLE, recordId: scanId,
      oldData: { contentState: scan.contentState, storedBytes: scan.content.length, mimeType: scan.mimeType },
      newData: { contentState: "PURGED", noteId: scan.noteId, sha256: scan.sha256, reason: "PHOTO_RETENTION", mode },
    });
    return "PURGED";
  }

  if (!deps.readerUrl) return "RETRY";
  const r = await (deps.shrink ?? readerShrink)(deps.readerUrl, Buffer.from(scan.content));
  if (!r.ok) {
    if (r.kind === "UNAVAILABLE") return "RETRY";
    uyari("gelen-belge", `fotoğraf küçültülemedi (${r.code}) — tarama TAM kalır, bu süreçte yeniden denenmez`);
    return "FAILED";
  }
  // Küçülmeyen fotoğraf (zaten küçük): bayt aynen kalır, durum KÜÇÜK — iş her turda yeniden denemesin.
  const smaller = r.content.length < scan.content.length;
  const content = smaller ? new Uint8Array(r.content) : scan.content;
  const mimeType = smaller ? "image/jpeg" : scan.mimeType;
  const frame = ocrPhotoFrame(scan.ocrResult);
  const c = await prisma.documentScan.updateMany({
    where: claimWhere,
    data: { content, mimeType, contentState: DocumentScanContentState.REDUCED, contentStateAt: now, rectFrameWidth: frame?.width ?? null, rectFrameHeight: frame?.height ?? null },
  });
  if (c.count === 0) return "LOST";
  await AuditService.log({
    userId: undefined, action: "UPDATE", tableName: AUDIT_TABLE, recordId: scanId,
    oldData: { contentState: scan.contentState, storedBytes: scan.content.length, mimeType: scan.mimeType },
    newData: { contentState: "REDUCED", storedBytes: content.length, mimeType, width: r.width, height: r.height, rectFrame: frame, noteId: scan.noteId, reason: "PHOTO_RETENTION", mode },
  });
  return "REDUCED";
}

export interface RetentionRunResult {
  mode: PhotoRetentionMode;
  outcomes: RetentionOutcome[];
  failedIds: string[];
}

/** Tek tur: ayarı oku → adayları bul → uygula (bir taramanın hatası diğerlerini durdurmaz; servis yoksa tur erken biter). */
export async function runPhotoRetention(limit: number, deps: RetentionDeps, skipIds: readonly string[] = []): Promise<RetentionRunResult> {
  const mode = await readPhotoRetention();
  const outcomes: RetentionOutcome[] = [];
  const failedIds: string[] = [];
  if (mode === "FULL") return { mode, outcomes, failedIds };
  for (const id of await findRetentionCandidates(mode, limit, deps.readerUrl, skipIds)) {
    const o = await applyRetention(id, mode, deps);
    outcomes.push(o);
    if (o === "FAILED") failedIds.push(id);
    if (o === "RETRY") break;
  }
  const done = outcomes.filter((o) => o === "REDUCED" || o === "PURGED").length;
  if (done) bilgi("gelen-belge", `fotoğraf saklama (${mode}): ${done} tarama işlendi`);
  return { mode, outcomes, failedIds };
}
