// =============================================================================
// FASON DEVERE — kusurlu levent ret FOTOĞRAFI (devere ek C1): doğrula · yaz · oku
// =============================================================================
// Emsal sertifika eki (`certificate-file.service`): tür beyana değil SİHİRLİ BAYTA bakılarak (yalnız JPEG/PNG), sınır
// 5 MB (DB CHECK ikizi) → 413, aynı dosya (sha256) aynı belgeye ikinci kez yazılmaz. Baytlar audit/log yüküne GİRMEZ.
// =============================================================================
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { detectCertificateMime, sanitizeCertificateFileName } from "../certificate-file.service";

type Tx = Prisma.TransactionClient;
export const WARPING_REJECT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** Bir istekte en çok fotoğraf (gövde sınırı `WARPING_REJECTION_BODY_LIMIT` bununla boyutlanır). */
export const WARPING_REJECT_PHOTOS_PER_REQUEST = 3;
export const WARPING_BEAM_REJECTION_TABLE = "WARPING_BEAM_REJECTION";

export interface RejectPhotoInput { fileName?: string | null; contentBase64: string }
export interface DecodedRejectPhoto { fileName: string; mimeType: string; sizeBytes: number; sha256: string; content: Uint8Array<ArrayBuffer> }

const tooLarge = () => new AppError("Fotoğraf 5 MB sınırını aşıyor; küçültüp yeniden ekleyin.", 413, true, { code: "WARPING_REJECT_PHOTO_TOO_LARGE" });

/** Katı base64 → baytlar; tür ve boy kapısı. Decode ÖNCESİ uzunluktan da sınar (5 MB üstü belleğe açılmaz). */
export function decodeRejectPhoto(input: RejectPhotoInput): DecodedRejectPhoto {
  if (Math.floor((input.contentBase64.length * 3) / 4) > WARPING_REJECT_PHOTO_MAX_BYTES + 4) throw tooLarge();
  const body = input.contentBase64.replace(/^data:[^,]*;base64,/, "").replace(/\s+/g, "");
  if (!body || body.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw AppError.badRequest("Fotoğraf içeriği geçerli base64 değil.", { code: "WARPING_REJECT_PHOTO_INVALID" });
  }
  const buf = Buffer.from(body, "base64");
  if (buf.length > WARPING_REJECT_PHOTO_MAX_BYTES) throw tooLarge();
  const kind = detectCertificateMime(buf);
  if (!kind || kind.mime === "application/pdf") {
    throw AppError.badRequest("Yalnız JPEG ya da PNG fotoğraf eklenebilir (dosya içeriği tanınmadı).", { code: "WARPING_REJECT_PHOTO_TYPE" });
  }
  const fileName = sanitizeCertificateFileName(input.fileName ?? "ret-fotografi", kind.ext);
  return { fileName, mimeType: kind.mime, sizeBytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), content: new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer) };
}

const PHOTO_SELECT = { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true } as const;
export type RejectPhotoMeta = Prisma.WarpingBeamRejectionPhotoGetPayload<{ select: typeof PHOTO_SELECT }>;

/** Tx içinde yaz; aynı sha256 zaten varsa atlanır (mevcut künye döner). */
export async function writeRejectPhotosTx(tx: Tx, rejectionId: string, photos: DecodedRejectPhoto[], userId: string): Promise<Array<RejectPhotoMeta & { duplicate: boolean }>> {
  const out: Array<RejectPhotoMeta & { duplicate: boolean }> = [];
  for (const p of photos) {
    const existing = await tx.warpingBeamRejectionPhoto.findUnique({ where: { rejectionId_sha256: { rejectionId, sha256: p.sha256 } }, select: PHOTO_SELECT });
    if (existing) { out.push({ ...existing, duplicate: true }); continue; }
    const row = await tx.warpingBeamRejectionPhoto.create({ data: { rejectionId, ...p, uploadedById: userId }, select: PHOTO_SELECT });
    out.push({ ...row, duplicate: false });
  }
  return out;
}

/** Var olan (iptal edilmemiş) ret belgesine fotoğraf ekle. */
export async function addRejectionPhotos(rejectionId: string, inputs: RejectPhotoInput[], userId: string) {
  if (inputs.length === 0) throw AppError.badRequest("En az bir fotoğraf gönderin.", { code: "WARPING_REJECT_PHOTO_INVALID" });
  if (inputs.length > WARPING_REJECT_PHOTOS_PER_REQUEST) throw AppError.badRequest(`Bir seferde en çok ${WARPING_REJECT_PHOTOS_PER_REQUEST} fotoğraf.`, { code: "WARPING_REJECT_PHOTO_TOO_MANY" });
  const decoded = inputs.map(decodeRejectPhoto);
  const rows = await prisma.$transaction(async (tx) => {
    // Başlık satırı kilitlenir: eşzamanlı iptal ile sıraya girer (iptal edilmiş belgeye ek yazılmaz).
    const head = await tx.$queryRaw<Array<{ docNo: string; cancelledAt: Date | null }>>`SELECT "docNo", "cancelledAt" FROM warping_beam_rejections WHERE id = ${rejectionId}::uuid FOR UPDATE`;
    if (!head[0]) throw AppError.notFound("Ret belgesi bulunamadı.", { code: "WARPING_REJECTION_NOT_FOUND" });
    if (head[0].cancelledAt) throw AppError.conflict(`${head[0].docNo} iptal edilmiş — fotoğraf eklenemez.`, { code: "WARPING_REJECTION_CANCELLED" });
    return writeRejectPhotosTx(tx, rejectionId, decoded, userId);
  });
  const added = rows.filter((r) => !r.duplicate);
  if (added.length > 0) {
    await AuditService.log({ userId, action: "UPDATE", tableName: WARPING_BEAM_REJECTION_TABLE, recordId: rejectionId, newData: { photosAdded: added.map((r) => ({ id: r.id, fileName: r.fileName, sizeBytes: r.sizeBytes })) } });
  }
  return rows;
}

export async function readRejectionPhoto(rejectionId: string, photoId: string) {
  const f = await prisma.warpingBeamRejectionPhoto.findFirst({ where: { id: photoId, rejectionId }, select: { fileName: true, mimeType: true, content: true } });
  if (!f) throw AppError.notFound("Fotoğraf bulunamadı.", { code: "WARPING_REJECT_PHOTO_NOT_FOUND" });
  return f;
}
