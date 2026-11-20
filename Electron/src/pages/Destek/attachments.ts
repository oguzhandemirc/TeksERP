// Gönderilecek ekler — saf yardımcılar. Sınırlar sözleşme §3 ile birebir (sunucu da doğrular; buradaki
// kontrol kullanıcıya 70 MB'lık isteği yolladıktan SONRA değil, dosyayı seçtiği AN söylemek içindir).
import type { OutgoingFile } from "./types";

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"] as const;
export const ACCEPT_ATTR = ALLOWED_TYPES.join(",");

export interface DraftAttachment {
  id: string;
  name: string;
  contentType: string;
  /** Düz base64 (önek yok). */
  base64: string;
  size: number;
  /** Ekran görüntüsü yeniden düzenlenebilir; dosya eki düzenlenebilir değil. */
  source: "screenshot" | "file";
}

export function base64Size(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

export function dataUrlOf(a: Pick<DraftAttachment, "contentType" | "base64">): string {
  return `data:${a.contentType};base64,${a.base64}`;
}

export const isImage = (mime: string): boolean => mime.startsWith("image/");

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Eklenmek istenen dosyalardan kabul edilenler + her ret için Türkçe sebep. */
export function screenFiles(existing: number, files: readonly File[]): { accepted: File[]; errors: string[] } {
  const accepted: File[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (!(ALLOWED_TYPES as readonly string[]).includes(f.type)) {
      errors.push(`${f.name}: yalnız PNG, JPEG, WebP, GIF ya da PDF eklenebilir.`);
    } else if (f.size > MAX_FILE_BYTES) {
      errors.push(`${f.name}: dosya 10 MB'tan büyük.`);
    } else if (f.size === 0) {
      errors.push(`${f.name}: dosya boş.`);
    } else if (existing + accepted.length >= MAX_FILES) {
      errors.push(`En çok ${MAX_FILES} dosya eklenebilir; ${f.name} eklenmedi.`);
    } else {
      accepted.push(f);
    }
  }
  return { accepted, errors };
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Dosya okunamadı"));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

let seq = 0;
export function newAttachmentId(): string {
  seq += 1;
  return `ek-${Date.now().toString(36)}-${seq}`;
}

export async function fileToDraft(file: File): Promise<DraftAttachment> {
  const base64 = await readFileAsBase64(file);
  return { id: newAttachmentId(), name: file.name, contentType: file.type, base64, size: file.size, source: "file" };
}

export function screenshotDraft(base64: string, name = "ekran-goruntusu.png"): DraftAttachment {
  return { id: newAttachmentId(), name, contentType: "image/png", base64, size: base64Size(base64), source: "screenshot" };
}

export function toOutgoing(list: readonly DraftAttachment[]): OutgoingFile[] {
  return list.map((a) => ({ name: a.name, contentType: a.contentType, dataBase64: a.base64 }));
}
