/**
 * Görsel kaynak kapısı — tasarımcı şablonu yalnız GÖMÜLÜ görsel taşır (plan
 * §3.9, P-ek): `data:image/...` ve en çok 300 KB. Dış http(s) adres, göreli
 * yol ve `javascript:` reddedilir; backend sıkı temizleyicisi aynı kuralı
 * ikinci kez uygular, bu kapı kullanıcıya erken ve Türkçe söyler.
 */

export const MAX_IMAGE_BYTES = 300 * 1024;

/** Backend `template-html.css.ts` SAFE_DATA_IMAGE ile aynı tür listesi. */
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|svg\+xml)[;,]/i;

export type ImageSrcVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "external" | "type" | "size" | "empty"; readonly message: string };

export const ASSET_MESSAGES = {
  external: "Dış adresten görsel eklenemez — görseli bilgisayarınızdan yükleyin (en çok 300 KB).",
  type: "Bu dosya türü görsel olarak kabul edilmez — PNG, JPEG, GIF, WEBP, BMP ya da SVG yükleyin.",
  size: "Görsel 300 KB sınırını aşıyor — daha küçük bir dosya yükleyin.",
  empty: "Görsel kaynağı boş.",
} as const;

/** data: URI'nin çözülmüş bayt sayısı (base64 ise 3/4 oranı, değilse metin uzunluğu). */
export function dataUriBytes(src: string): number {
  const comma = src.indexOf(",");
  if (comma < 0) return src.length;
  const meta = src.slice(0, comma);
  const body = src.slice(comma + 1);
  if (/;base64$/i.test(meta)) {
    const pad = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
    return Math.floor((body.length * 3) / 4) - pad;
  }
  return decodeURIComponent(body).length;
}

export function checkImageSrc(raw: string | null | undefined): ImageSrcVerdict {
  const src = (raw ?? "").trim();
  if (!src) return { ok: false, reason: "empty", message: ASSET_MESSAGES.empty };
  if (!/^data:/i.test(src)) return { ok: false, reason: "external", message: ASSET_MESSAGES.external };
  if (!SAFE_DATA_IMAGE.test(src)) return { ok: false, reason: "type", message: ASSET_MESSAGES.type };
  if (dataUriBytes(src) > MAX_IMAGE_BYTES) return { ok: false, reason: "size", message: ASSET_MESSAGES.size };
  return { ok: true };
}

/** Yüklemeden ÖNCE dosya kapısı — FileReader'a hiç girmeden boyut ve tür. */
export function checkImageFile(file: { readonly size: number; readonly type: string }): ImageSrcVerdict {
  if (!/^image\/(?:png|jpeg|gif|webp|bmp|svg\+xml)$/i.test(file.type)) {
    return { ok: false, reason: "type", message: ASSET_MESSAGES.type };
  }
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: "size", message: ASSET_MESSAGES.size };
  return { ok: true };
}
