// =============================================================================
// DESTEK TALEBİ EKLERİ — base64 çözme ve doğrulama (saf, I/O yok)
// =============================================================================
// Panel ve saha uygulaması ekleri JSON içinde base64 yollar (yeni npm paketi yok:
// multer/busboy kurulmadı). Merkez aynı sınırları kendisi de uygular; burada
// önden denetlenir ki 60 MB'lık bir istek merkeze hiç gitmeden Türkçe ve kodlu
// 400 alsın. Bildirilen tür dosyanın İLK BAYTLARIYLA da doğrulanır: uzantısı
// değiştirilmiş bir dosya "görsel" diye merkeze iletilmez.
// =============================================================================

import type { DestekFile } from "../../integrations/destek";
import { AppError } from "../../utils/app-error";

export const SUPPORT_MAX_FILES = 5;
export const SUPPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
/** 10 MB'ın base64 uzunluğu (4/3) + dolgu payı — çözmeden önce kaba eleme. */
export const SUPPORT_MAX_BASE64_CHARS = Math.ceil(SUPPORT_MAX_FILE_BYTES / 3) * 4 + 4;

export const SUPPORT_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"] as const;
export type SupportFileType = (typeof SUPPORT_ALLOWED_TYPES)[number];

export interface SupportFileInput {
  name: string;
  contentType: string;
  dataBase64: string;
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function startsWith(buf: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** Dosyanın ilk baytları bildirilen türle uyuşuyor mu. */
export function matchesSignature(type: SupportFileType, buf: Buffer): boolean {
  switch (type) {
    case "image/png":
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return startsWith(buf, ascii("GIF87a")) || startsWith(buf, ascii("GIF89a"));
    case "image/webp":
      return startsWith(buf, ascii("RIFF")) && startsWith(buf, ascii("WEBP"), 8);
    case "application/pdf":
      return startsWith(buf, ascii("%PDF-"));
  }
}

function invalid(message: string, index: number): AppError {
  return AppError.badRequest(message, { code: "ATTACHMENT_INVALID", index });
}

/** Dosya adından yol ayırıcılarını ve denetim karakterlerini atar; boşsa "ek". */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return cleaned || "ek";
}

function decodeOne(f: SupportFileInput, index: number): DestekFile {
  const type = f.contentType.trim().toLowerCase();
  if (!(SUPPORT_ALLOWED_TYPES as readonly string[]).includes(type)) {
    throw invalid(`${index + 1}. ek desteklenmeyen türde: yalnız PNG, JPEG, WebP, GIF ve PDF eklenebilir.`, index);
  }
  const b64 = f.dataBase64.replace(/\s+/g, "");
  if (b64.length > SUPPORT_MAX_BASE64_CHARS) {
    throw AppError.badRequest(`${index + 1}. ek 10 MB sınırını aşıyor.`, { code: "ATTACHMENT_TOO_LARGE", index });
  }
  if (b64.length === 0 || b64.length % 4 !== 0 || !BASE64_RE.test(b64)) {
    throw invalid(`${index + 1}. ekin içeriği okunamadı (geçerli base64 değil).`, index);
  }
  const data = Buffer.from(b64, "base64");
  if (data.length === 0) throw invalid(`${index + 1}. ek boş.`, index);
  if (data.length > SUPPORT_MAX_FILE_BYTES) {
    throw AppError.badRequest(`${index + 1}. ek 10 MB sınırını aşıyor.`, { code: "ATTACHMENT_TOO_LARGE", index });
  }
  if (!matchesSignature(type as SupportFileType, data)) {
    throw invalid(`${index + 1}. ekin içeriği bildirilen türle (${type}) uyuşmuyor.`, index);
  }
  return { name: cleanFileName(f.name), contentType: type, data };
}

/** Ekleri çözer ve doğrular; hata kodları merkezinkiyle aynı adı taşır. */
export function decodeAttachments(files: readonly SupportFileInput[] | undefined): DestekFile[] {
  if (!files || files.length === 0) return [];
  if (files.length > SUPPORT_MAX_FILES) {
    throw AppError.badRequest(`En çok ${SUPPORT_MAX_FILES} dosya eklenebilir.`, { code: "TOO_MANY_ATTACHMENTS" });
  }
  return files.map((f, i) => decodeOne(f, i));
}
