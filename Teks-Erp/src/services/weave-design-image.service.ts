// =============================================================================
// DESEN GÖRSELİ (2026-11-25) — kart başına tek görsel (yükle · göster · kaldır)
// =============================================================================
// `certificate-file.service` emsali: tür beyana değil SİHİRLİ BAYTA bakılarak (JPEG/PNG), sınır 5 MB (DB CHECK
// ikizi). Yeni yükleme satırı YERİNDE günceller (kart başına tek). Kaldırma saf yapılandırma ekidir: deftere
// yazmaz, satır silinince raporlanan sayı değişmez. Baytlar audit/log yüküne GİRMEZ — yalnız künye.
// =============================================================================
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { detectCertificateMime, sanitizeCertificateFileName } from "./certificate-file.service";

export const WEAVE_DESIGN_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_SELECT = { id: true, weaveDesignId: true, fileName: true, mimeType: true, sizeBytes: true, sha256: true, updatedAt: true } as const;

function tooLarge(): AppError {
  return AppError.badRequest("Görsel 5 MB sınırını aşıyor; küçültüp yeniden yükleyin.", { code: "WEAVE_DESIGN_IMAGE_TOO_LARGE" });
}

function decodeBase64(raw: string): Buffer {
  const body = raw.replace(/^data:[^,]*;base64,/, "").replace(/\s+/g, "");
  if (!body || body.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw AppError.badRequest("Görsel içeriği geçerli base64 değil.", { code: "WEAVE_DESIGN_IMAGE_INVALID" });
  }
  return Buffer.from(body, "base64");
}

export async function uploadWeaveDesignImage(weaveDesignId: string, input: { fileName?: string | null; contentBase64: string }, userId?: string) {
  if (Math.floor((input.contentBase64.length * 3) / 4) > WEAVE_DESIGN_IMAGE_MAX_BYTES + 4) throw tooLarge();
  const content = decodeBase64(input.contentBase64);
  if (content.length > WEAVE_DESIGN_IMAGE_MAX_BYTES) throw tooLarge();
  const kind = detectCertificateMime(content);
  if (!kind || kind.mime === "application/pdf") {
    throw AppError.badRequest("Yalnız JPEG ya da PNG görsel yüklenebilir (dosya içeriği tanınmadı).", { code: "WEAVE_DESIGN_IMAGE_TYPE" });
  }
  const design = await prisma.weaveDesign.findUnique({ where: { id: weaveDesignId }, select: { id: true } });
  if (!design) throw AppError.notFound("Desen kartı bulunamadı.");
  const sha256 = createHash("sha256").update(content).digest("hex");
  const fileName = sanitizeCertificateFileName(input.fileName, kind.ext);
  const before = await prisma.weaveDesignImage.findUnique({ where: { weaveDesignId }, select: IMAGE_SELECT });
  if (before?.sha256 === sha256) return { image: before, duplicate: true };
  const data = { fileName, mimeType: kind.mime, sizeBytes: content.length, sha256, content: new Uint8Array(content), uploadedById: userId ?? null };
  let image;
  try {
    image = await prisma.weaveDesignImage.upsert({ where: { weaveDesignId }, create: { weaveDesignId, ...data }, update: data, select: IMAGE_SELECT });
  } catch (err) {
    // Eşzamanlı ilk yükleme: kaybeden mevcut satırı günceller (unique seddi).
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    image = await prisma.weaveDesignImage.update({ where: { weaveDesignId }, data, select: IMAGE_SELECT });
  }
  const meta = { weaveDesignId, fileName, mimeType: kind.mime, sizeBytes: content.length, sha256 };
  await AuditService.log({
    userId, action: before ? "UPDATE" : "CREATE", tableName: "WEAVE_DESIGN_IMAGE", recordId: image.id,
    ...(before ? { oldData: { fileName: before.fileName, sizeBytes: before.sizeBytes, sha256: before.sha256 } } : {}), newData: meta,
  });
  return { image, duplicate: false };
}

export async function readWeaveDesignImage(weaveDesignId: string) {
  const f = await prisma.weaveDesignImage.findUnique({ where: { weaveDesignId }, select: { fileName: true, mimeType: true, content: true } });
  if (!f) throw AppError.notFound("Desen görseli yok.", { code: "WEAVE_DESIGN_IMAGE_NOT_FOUND" });
  return f;
}

/** Görseli kaldırır — saf yapılandırma eki (deftere yazmaz); atomik: koşul WHERE'de. */
export async function deleteWeaveDesignImage(weaveDesignId: string, userId?: string) {
  const before = await prisma.weaveDesignImage.findUnique({ where: { weaveDesignId }, select: IMAGE_SELECT });
  if (!before) throw AppError.notFound("Desen görseli yok.", { code: "WEAVE_DESIGN_IMAGE_NOT_FOUND" });
  const removed = await prisma.weaveDesignImage.deleteMany({ where: { id: before.id, weaveDesignId } });
  if (removed.count === 0) throw AppError.conflict("Desen görseli zaten kaldırılmış.", { code: "WEAVE_DESIGN_IMAGE_NOT_FOUND" });
  await AuditService.log({
    userId, action: "DELETE", tableName: "WEAVE_DESIGN_IMAGE", recordId: before.id,
    oldData: { weaveDesignId, fileName: before.fileName, mimeType: before.mimeType, sizeBytes: before.sizeBytes, sha256: before.sha256 },
  });
  return { id: before.id };
}
