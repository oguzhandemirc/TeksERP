// =============================================================================
// GELEN BELGE — belge taraması (D2): fotoğraf/PDF yükle · künye oku · ikili indir
// =============================================================================
// Tür beyana değil SİHİRLİ BAYTA bakılarak belirlenir (`certificate-file.service` ile aynı
// tespit — iki yerde imza listesi yazılmaz). Sınır 5 MB (DB CHECK `document_scans_size_ck` ikizi).
// Aynı fotoğraf (sha256) ikinci kez YAZILMAZ: mevcut kayıt döner (`duplicate: true`) — tabletin
// ağ kopmasında yeniden gönderdiği fotoğraf ikinci tarama üretmez. Baytlar ve ham OCR metni
// audit/log yüküne GİRMEZ — yalnız künye. OCR okuma işi D3b'de (status PENDING → READING).
// =============================================================================
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { detectCertificateMime } from "./certificate-file.service";

export const DOCUMENT_SCAN_MAX_BYTES = 5 * 1024 * 1024;
/** PDF arşivdir (K6): okuma kuyruğuna girmez, sidecar'a gitmez — claim süzgeci ve okut ucu bunu okur. */
export const PDF_MIME = "application/pdf";
const AUDIT_TABLE = "DOCUMENT_SCAN";

/** Künye — `content` ASLA bu seçimde değildir (liste/ayrıntı/audit hepsi buradan okur). */
export const SCAN_SELECT = {
  id: true, noteId: true, pageNo: true, regionNo: true, sha256: true, mimeType: true, sizeBytes: true,
  barcodeText: true, status: true, attempts: true, ocrEngine: true, ocrVersion: true, ocrDurationMs: true,
  capturedById: true, capturedAt: true, createdAt: true, updatedAt: true,
} as const;

export interface DocumentScanInput {
  contentBase64: string;
  noteId?: string | null;
  pageNo?: number | null;
  regionNo?: number | null;
  barcodeText?: string | null;
  /** İstemcinin hesapladığı özet (D7 tablet). Verilirse sunucu özetiyle eşleşmeli — yolda bozulan bayt kayda girmez. */
  sha256?: string | null;
}

function tooLarge(): AppError {
  return new AppError("Belge dosyası 5 MB sınırını aşıyor.", 413, true, { code: "DOCUMENT_SCAN_TOO_LARGE", maxBytes: DOCUMENT_SCAN_MAX_BYTES });
}

/** data-URL öneki ve boşluk soyulmuş ham base64 gövdesi. */
function base64Body(raw: string): string {
  return raw.replace(/^data:[^,]*;base64,/, "").replace(/\s+/g, "");
}

/** Katı base64; bozuk gövde 400. */
function decodeBase64(body: string): Buffer {
  if (!body || body.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw AppError.badRequest("Dosya içeriği geçerli base64 değil.", { code: "DOCUMENT_SCAN_INVALID" });
  }
  return Buffer.from(body, "base64");
}

/** Claim düşünce nedeni söyler: 404 (yok) ya da 409 (taslak değil). */
async function notDraftScan(noteId: string): Promise<never> {
  const note = await prisma.customerDeliveryNote.findUnique({ where: { id: noteId }, select: { status: true, noteNo: true } });
  if (!note) throw AppError.notFound("Gelen belge taslağı bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  throw AppError.conflict(`${note.noteNo} taslak değil; tarama yalnız taslağa eklenir.`, { code: "DELIVERY_NOTE_NOT_DRAFT", status: note.status });
}

/** Tarama bağlama ATOMİK CLAIM: başlık `WHERE {id, status: DRAFT}` ile kilitlenir (count 0 → 404/409); D4 onayı araya giremez. */
async function claimDraftTx(tx: Prisma.TransactionClient, noteId: string, userId: string): Promise<void> {
  const c = await tx.customerDeliveryNote.updateMany({ where: { id: noteId, status: "DRAFT" }, data: { updatedById: userId } });
  if (c.count === 0) await notDraftScan(noteId);
}

type ScanRow = Prisma.DocumentScanGetPayload<{ select: typeof SCAN_SELECT }>;

/**
 * Aynı sha256 mevcutsa istemcinin istediği bağlam SESSİZCE YUTULMAZ: serbest kayıt istenen taslağa bağlanır (claim'li),
 * başka taslağa bağlıysa 409 `DOCUMENT_SCAN_NOT_FREE`. Yanıt `boundTo` ile hangi taslağa bağlı olduğunu söyler.
 */
async function reuseExisting(existing: ScanRow, noteId: string | null | undefined, userId: string) {
  if (noteId && existing.noteId && existing.noteId !== noteId) {
    throw AppError.conflict("Bu fotoğraf başka bir taslağa bağlı; önce oradan çözün.", { code: "DOCUMENT_SCAN_NOT_FREE", boundTo: existing.noteId });
  }
  if (!noteId || existing.noteId === noteId) return { scan: existing, duplicate: true, boundTo: existing.noteId };
  await prisma.$transaction(async (tx) => {
    await claimDraftTx(tx, noteId, userId);
    const bound = await tx.documentScan.updateMany({ where: { id: existing.id, noteId: null }, data: { noteId } });
    if (bound.count === 0) throw AppError.conflict("Bu fotoğraf bu arada başka bir taslağa bağlandı.", { code: "DOCUMENT_SCAN_NOT_FREE" });
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: AUDIT_TABLE, recordId: existing.id, oldData: { noteId: null }, newData: { noteId, sha256: existing.sha256 } });
  const scan = await prisma.documentScan.findUniqueOrThrow({ where: { id: existing.id }, select: SCAN_SELECT });
  return { scan, duplicate: true, boundTo: noteId };
}

export async function uploadDocumentScan(input: DocumentScanInput, userId: string) {
  // Boy, decode ÖNCESİ base64 uzunluğundan da sınanır — 5 MB üstü gövde belleğe açılmadan reddedilir.
  // Tahmin önek/boşluk soyulmuş gövde üstünde: tam 5 MB'lık meşru dosya data-URL önekiyle gelse de 413 almaz.
  const body = base64Body(input.contentBase64);
  if (Math.floor((body.length * 3) / 4) > DOCUMENT_SCAN_MAX_BYTES + 4) throw tooLarge();
  const content = decodeBase64(body);
  if (content.length > DOCUMENT_SCAN_MAX_BYTES) throw tooLarge();
  const kind = detectCertificateMime(content);
  if (!kind) {
    throw AppError.badRequest("Yalnız JPEG, PNG ya da PDF belge yüklenebilir (dosya içeriği tanınmadı).", { code: "DOCUMENT_SCAN_TYPE" });
  }
  const sha256 = createHash("sha256").update(content).digest("hex");
  if (input.sha256 && input.sha256.toLowerCase() !== sha256) {
    throw AppError.badRequest("Fotoğraf yolda bozuldu (özet tutmuyor); yeniden gönderin.", { code: "DOCUMENT_SCAN_HASH_MISMATCH" });
  }
  const existing = await prisma.documentScan.findUnique({ where: { sha256 }, select: SCAN_SELECT });
  if (existing) return reuseExisting(existing, input.noteId, userId);
  const data = {
    noteId: input.noteId ?? null,
    pageNo: input.pageNo ?? 1,
    regionNo: input.regionNo ?? null,
    barcodeText: input.barcodeText?.trim() || null,
    mimeType: kind.mime,
    sizeBytes: content.length,
    sha256,
    capturedById: userId,
    // K6: PDF doğrudan READ_FAILED (deneme 0) — PENDING'de kalsa "kuyrukta" sayılır ve hiç bitmezdi; enum değişmez.
    ...(kind.mime === PDF_MIME ? { status: "READ_FAILED" as const } : {}),
  };
  let scan;
  try {
    // Taslağa bağlanıyorsa claim + create aynı tx'te (TOCTOU yok); serbest taramada tx'e gerek yok.
    scan = await prisma.$transaction(async (tx) => {
      if (input.noteId) await claimDraftTx(tx, input.noteId, userId);
      return tx.documentScan.create({ data: { ...data, content: new Uint8Array(content) }, select: SCAN_SELECT });
    });
  } catch (err) {
    // Eşzamanlı aynı yükleme: kaybeden mevcut kaydı alır (unique seddi).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await prisma.documentScan.findUnique({ where: { sha256 }, select: SCAN_SELECT });
      if (again) return reuseExisting(again, input.noteId, userId);
    }
    throw err;
  }
  await AuditService.log({ userId, action: "CREATE", tableName: AUDIT_TABLE, recordId: scan.id, newData: data });
  return { scan, duplicate: false, boundTo: scan.noteId };
}

export async function getDocumentScan(id: string) {
  const scan = await prisma.documentScan.findUnique({ where: { id }, select: SCAN_SELECT });
  if (!scan) throw AppError.notFound("Belge taraması bulunamadı.", { code: "DOCUMENT_SCAN_NOT_FOUND" });
  return scan;
}

/** İkili içerik — yalnız indirme ucu okur; audit/log yoluna girmez. */
export async function readDocumentScanContent(id: string): Promise<{ mimeType: string; content: Buffer }> {
  const scan = await prisma.documentScan.findUnique({ where: { id }, select: { mimeType: true, content: true } });
  if (!scan) throw AppError.notFound("Belge taraması bulunamadı.", { code: "DOCUMENT_SCAN_NOT_FOUND" });
  return { mimeType: scan.mimeType, content: Buffer.from(scan.content) };
}
