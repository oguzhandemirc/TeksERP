// =============================================================================
// SUNUCU NOTLARI — `ApiResponse.message` ve `ApiResponse.warnings`in TEK kaynağı
// =============================================================================
// Engel olmayan sunucu notu (`warnings`) her başarılı YAZIM yanıtında (POST/PUT/PATCH/
// DELETE) apiClient'ın yanıt interceptor'ında GENEL olarak basılır — servis zarfı soysa,
// istek mutation dışında gitse de. Uyarıyı ekranda kendi gösteren ya da kullanıcı
// eylemi olmadan giden istek `serverWarnings: "handled" | "silent"` taşır.
// Bekçi: Teks-Erp/scripts/test_sunucu_notlari.ts.
import { toast, type ExternalToast } from "sonner";

/** Servislerin bir kısmı zarfı kendi tipine daraltır; okuma bilerek GEVŞEK. */
type ServerResponseLike = { message?: unknown; warnings?: unknown } | null | undefined;

// Aynı yanıt nesnesi iki kez basılmaz (genel basım + sitedeki açık çağrı).
const shown = new WeakSet<object>();
// Aynı METİN 5 sn içinde ikinci kez basılmaz (yeniden deneme · çift tıklama tost seli).
const REPEAT_WINDOW_MS = 5000;
const lastShownAt = new Map<string, number>();

/** Engel olmayan notlar başarı tostunun YANINDA ayrı uyarı olarak basılır (her not 8 sn). */
export function showServerWarnings(res: ServerResponseLike, now: number = Date.now()): void {
  if (!res || typeof res !== "object" || shown.has(res)) return;
  shown.add(res);
  const w = res.warnings;
  if (!Array.isArray(w)) return;
  for (const note of w) {
    if (typeof note !== "string" || !note.trim()) continue;
    const prev = lastShownAt.get(note);
    if (prev !== undefined && now - prev < REPEAT_WINDOW_MS) continue;
    lastShownAt.set(note, now);
    toast.warning(note, { duration: 8000 });
  }
}

/** Yazım yanıtı genel basıma girer mi: yöntem yazım, bayrak yok, gövde zarf (`success` alanı). */
export function shouldToastWarnings(
  config: { method?: string; serverWarnings?: "handled" | "silent" } | undefined,
  body: unknown,
): boolean {
  const method = (config?.method ?? "get").toLowerCase();
  if (!["post", "put", "patch", "delete"].includes(method)) return false;
  if (config?.serverWarnings) return false;
  return !!body && typeof body === "object" && "success" in body;
}

/**
 * Anlamlı mesaj: uç kendi sonuç cümlesini yazdıysa (belge no · sayı · "zaten güncel" ·
 * otomatik taslak notu) o basılır, yoksa istemcinin `fallback` cümlesi.
 */
export function serverSuccessText(res: ServerResponseLike, fallback: string): string {
  const m = res?.message;
  return typeof m === "string" && m.trim() ? m : fallback;
}

/** Başarı tostu — text `serverSuccessText`ten; uyarılar apiClient interceptor'ında basılır. */
export function toastServerSuccess(res: ServerResponseLike, fallback: string, opts?: ExternalToast): void {
  const text = serverSuccessText(res, fallback);
  if (opts) toast.success(text, opts);
  else toast.success(text);
}
