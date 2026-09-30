// Dışa aktarılan dosyayı kaydetme (Ek-6/A §4.2) — yalnız WEB sürümü: tarayıcının indirme mekanizması (Blob + geçici
// bağlantı). Telefon uygulamasında dosya sistemi/paylaşım paketi YOK (yeni paket eklenmedi): ekran web sürümünü gösterir.
import type { DownloadedFile } from "../api/client";

/** Tarayıcı yüzeyinin kullanılan parçası (test sahte verir). */
export interface BrowserLike {
  readonly document?: {
    createElement(tag: "a"): { href: string; download: string; rel: string; click(): void; remove(): void };
    readonly body: { appendChild(el: unknown): unknown };
  };
  readonly URL?: { createObjectURL(b: Blob): string; revokeObjectURL(u: string): void };
}

export function canSaveFiles(os: string, w: BrowserLike | undefined): boolean {
  return os === "web" && !!w?.document && typeof w.URL?.createObjectURL === "function";
}

/** Dosyayı indirir; web değilse `false` (çağıran kullanıcıyı web sürümüne yönlendirir). */
export function saveDownloadedFile(file: DownloadedFile, os: string, w: BrowserLike | undefined): boolean {
  if (!canSaveFiles(os, w)) return false;
  const url = w!.URL!.createObjectURL(new Blob([file.data], { type: file.contentType }));
  const a = w!.document!.createElement("a");
  a.href = url;
  a.download = file.fileName;
  a.rel = "noopener";
  w!.document!.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => w!.URL!.revokeObjectURL(url), 30_000);
  return true;
}
