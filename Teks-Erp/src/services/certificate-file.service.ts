// =============================================================================
// K4P-SERT — sertifika belge eki (yükle · indir · sil)
// =============================================================================
// Tür beyana değil SİHİRLİ BAYTA bakılarak belirlenir (`%PDF`, `FFD8FF`, `89504E47`); istemcinin
// beyan ettiği mime HİÇ okunmaz. Sınır 5 MB (DB CHECK ikizi). Aynı dosya (sha256) aynı sertifikaya
// ikinci kez yazılmaz, mevcut kayıt döner. Baytlar audit/log yüküne GİRMEZ — yalnız künye.
// =============================================================================
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";

export const CERTIFICATE_FILE_MAX_BYTES = 5 * 1024 * 1024;
export type CertificateMime = "application/pdf" | "image/jpeg" | "image/png";

const SIGNATURES: ReadonlyArray<{ mime: CertificateMime; ext: string; magic: readonly number[] }> = [
  { mime: "application/pdf", ext: ".pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  { mime: "image/jpeg", ext: ".jpg", magic: [0xff, 0xd8, 0xff] },
  { mime: "image/png", ext: ".png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/** Baytların ilk imzasından tür; tanınmayan → null (beyan edilen mime'a güvenilmez). */
export function detectCertificateMime(buf: Uint8Array): { mime: CertificateMime; ext: string } | null {
  const hit = SIGNATURES.find((s) => buf.length >= s.magic.length && s.magic.every((b, i) => buf[i] === b));
  return hit ? { mime: hit.mime, ext: hit.ext } : null;
}

/** Yol ayırıcısı ve kontrol karakteri atılır; uzantı tespit edilen türe uymuyorsa eklenir. */
export function sanitizeCertificateFileName(raw: string | null | undefined, ext: string): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  let name = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").replace(/^\.+/, "").trim();
  if (!name) name = "belge";
  const lower = name.toLowerCase();
  const okExt = ext === ".jpg" ? lower.endsWith(".jpg") || lower.endsWith(".jpeg") : lower.endsWith(ext);
  if (!okExt) name = `${name}${ext}`;
  if (name.length > 200) name = name.slice(0, 200 - ext.length) + ext;
  return name;
}

/** Katı base64 (data URL öneki kabul); bozuk gövde 400. */
function decodeBase64(raw: string): Buffer {
  const body = raw.replace(/^data:[^,]*;base64,/, "").replace(/\s+/g, "");
  if (!body || body.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw AppError.badRequest("Dosya içeriği geçerli base64 değil.", { code: "CERTIFICATE_FILE_INVALID" });
  }
  return Buffer.from(body, "base64");
}

const FILE_SELECT = { id: true, certificateId: true, fileName: true, mimeType: true, sizeBytes: true, sha256: true, createdAt: true } as const;

export async function uploadCertificateFile(certificateId: string, input: { fileName?: string | null; contentBase64: string }, userId: string) {
  // Boy, decode ÖNCESİ base64 uzunluğundan da sınanır — 5 MB üstü gövde belleğe açılmadan reddedilir.
  if (Math.floor((input.contentBase64.length * 3) / 4) > CERTIFICATE_FILE_MAX_BYTES + 4) throw tooLarge();
  const content = decodeBase64(input.contentBase64);
  if (content.length > CERTIFICATE_FILE_MAX_BYTES) throw tooLarge();
  const kind = detectCertificateMime(content);
  if (!kind) {
    throw AppError.badRequest("Yalnız PDF, JPEG ya da PNG belge yüklenebilir (dosya içeriği tanınmadı).", { code: "CERTIFICATE_FILE_TYPE" });
  }
  const cert = await prisma.certificate.findUnique({ where: { id: certificateId }, select: { id: true, revokedAt: true } });
  if (!cert) throw AppError.notFound("Sertifika bulunamadı.", { code: "CERTIFICATE_NOT_FOUND" });
  if (cert.revokedAt) throw AppError.conflict("İptal edilmiş sertifikaya belge eklenemez.", { code: "CERTIFICATE_NOT_ACTIVE" });
  const sha256 = createHash("sha256").update(content).digest("hex");
  const existing = await prisma.certificateFile.findUnique({ where: { certificateId_sha256: { certificateId, sha256 } }, select: FILE_SELECT });
  if (existing) return { file: existing, duplicate: true };
  const fileName = sanitizeCertificateFileName(input.fileName, kind.ext);
  let file;
  try {
    file = await prisma.certificateFile.create({
      data: { certificateId, fileName, mimeType: kind.mime, sizeBytes: content.length, sha256, content: new Uint8Array(content), uploadedById: userId },
      select: FILE_SELECT,
    });
  } catch (err) {
    // Eşzamanlı aynı yükleme: kaybeden mevcut kaydı alır (unique seddi).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await prisma.certificateFile.findUnique({ where: { certificateId_sha256: { certificateId, sha256 } }, select: FILE_SELECT });
      if (again) return { file: again, duplicate: true };
    }
    throw err;
  }
  await AuditService.log({
    userId, action: "CREATE", tableName: "CERTIFICATE_FILE", recordId: file.id,
    newData: { certificateId, fileName, mimeType: kind.mime, sizeBytes: content.length, sha256 },
  });
  return { file, duplicate: false };
}

function tooLarge(): AppError {
  return AppError.badRequest("Dosya 5 MB sınırını aşıyor; küçültüp yeniden yükleyin.", { code: "CERTIFICATE_FILE_TOO_LARGE" });
}

export async function readCertificateFile(certificateId: string, fileId: string) {
  const f = await prisma.certificateFile.findFirst({ where: { id: fileId, certificateId }, select: { fileName: true, mimeType: true, content: true } });
  if (!f) throw AppError.notFound("Belge bulunamadı.", { code: "CERTIFICATE_FILE_NOT_FOUND" });
  return f;
}

/**
 * Tek belgeyi kaldırır — plan §3.4: CertificateFile DURUM ebeveynin parçasıdır ve deftere yazmaz
 * (silinince raporlanan sayı değişmez); yalnız iptal edilmemiş sertifikada. Atomik: koşul WHERE'de.
 */
export async function deleteCertificateFile(certificateId: string, fileId: string, userId: string) {
  const before = await prisma.certificateFile.findFirst({ where: { id: fileId, certificateId }, select: FILE_SELECT });
  if (!before) throw AppError.notFound("Belge bulunamadı.", { code: "CERTIFICATE_FILE_NOT_FOUND" });
  const removed = await prisma.certificateFile.deleteMany({ where: { id: fileId, certificateId, certificate: { revokedAt: null } } });
  if (removed.count === 0) throw AppError.conflict("İptal edilmiş sertifikanın belgesi silinemez.", { code: "CERTIFICATE_NOT_ACTIVE" });
  await AuditService.log({
    userId, action: "DELETE", tableName: "CERTIFICATE_FILE", recordId: fileId,
    oldData: { certificateId, fileName: before.fileName, mimeType: before.mimeType, sizeBytes: before.sizeBytes, sha256: before.sha256 },
  });
  return before;
}
