// =============================================================================
// SUNUCU NOTLARI — `ApiResponse.message` ve `ApiResponse.warnings`in TEK kaynağı
// =============================================================================
// Engel olmayan sunucu notu (`warnings`) her mutation yanıtında GENEL olarak basılır
// (`App.tsx` → `createServerNotesMutationCache` → `showMutationWarnings`); site site
// hatırlanmaz. Uyarıyı sayfa İÇİNDE gösteren (liste, form satırı) ya da başka
// biçimde sunan mutation `meta: SERVER_WARNINGS_HANDLED` taşır — çift gösterim hatadır.
// Bekçi: Teks-Erp/scripts/test_sunucu_notlari.ts.
import { MutationCache } from "@tanstack/react-query";
import { toast, type ExternalToast } from "sonner";

/** Servislerin bir kısmı zarfı kendi tipine daraltır; okuma bilerek GEVŞEK. */
type ServerResponseLike = { message?: unknown; warnings?: unknown } | null | undefined;

/** Uyarıyı kendisi gösteren mutation'ın işareti — genel basım atlanır. */
export const SERVER_WARNINGS_HANDLED = { serverWarnings: "handled" } as const;

// Aynı yanıt nesnesi iki kez basılmaz (genel basım + sitedeki açık çağrı).
const shown = new WeakSet<object>();

/** Engel olmayan notlar başarı tostunun YANINDA ayrı uyarı olarak basılır (her not 8 sn). */
export function showServerWarnings(res: ServerResponseLike): void {
  if (!res || typeof res !== "object" || shown.has(res)) return;
  shown.add(res);
  const w = res.warnings;
  if (!Array.isArray(w)) return;
  for (const note of w) if (typeof note === "string" && note.trim()) toast.warning(note, { duration: 8000 });
}

/**
 * Genel basım (MutationCache): yalnız gerçek ZARF (`success` alanı olan yanıt) —
 * `warnings` adlı alanı olan başka bir nesne (ör. süpürme sonucu) uyarı sayılmaz.
 */
export function showMutationWarnings(data: unknown, meta: Record<string, unknown> | undefined): void {
  if (meta?.serverWarnings === SERVER_WARNINGS_HANDLED.serverWarnings) return;
  if (!data || typeof data !== "object" || !("success" in data)) return;
  showServerWarnings(data as ServerResponseLike);
}

/** Uygulamanın (ve kanca testlerinin) QueryClient'ı için genel basım — tek kurulum yeri. */
export function createServerNotesMutationCache(): MutationCache {
  return new MutationCache({
    onSuccess: (data, _vars, _res, mutation) => showMutationWarnings(data, mutation.meta),
  });
}

/**
 * Anlamlı mesaj: uç kendi sonuç cümlesini yazdıysa (belge no · sayı · "zaten güncel" ·
 * otomatik taslak notu) o basılır, yoksa istemcinin `fallback` cümlesi.
 */
export function serverSuccessText(res: ServerResponseLike, fallback: string): string {
  const m = res?.message;
  return typeof m === "string" && m.trim() ? m : fallback;
}

/** Başarı tostu — text `serverSuccessText`ten; uyarılar genel basımdan gelir. */
export function toastServerSuccess(res: ServerResponseLike, fallback: string, opts?: ExternalToast): void {
  const text = serverSuccessText(res, fallback);
  if (opts) toast.success(text, opts);
  else toast.success(text);
}
