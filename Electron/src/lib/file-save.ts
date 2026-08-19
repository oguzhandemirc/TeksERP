// Dosya kaydetme — TEK kapı. Electron'da kaydet-dialoğu (pencereye bağlı: arka plan
// kararır ve kullanıcı ONAYLAYINCA döner → toast doğru zamanda atılır), yoksa tarayıcı
// indirmesi. xlsx / csv / json / txt hepsi buradan geçer; her biri kendi base64
// dönüşümünü yazarsa biri UTF-8'i bozar (btoa ham binary ister, TR karakterler kırılır).

/** Blob → base64 (chunk'lı; büyük dosyada `String.fromCharCode(...bytes)` stack taşırır). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Blob'u kaydet-dialoğuyla yazar. Döner: gerçekten kaydedildi mi (iptal → false). */
export async function saveBlobAs(blob: Blob, filename: string): Promise<boolean> {
  const filesApi = typeof window !== "undefined" ? window.api?.files : undefined;
  if (!filesApi?.save) {
    downloadBlob(blob, filename);
    return true;
  }
  const res = await filesApi.save({ name: filename, base64: await blobToBase64(blob) });
  return res.saved;
}

/**
 * Metni dosya olarak kaydeder. ⚠️ `text` UTF-8'e TextEncoder ile çevrilir (Blob zaten
 * öyle yapar); BOM gerekiyorsa ÇAĞIRAN metnin başına U+FEFF koyar — burada eklemek
 * JSON gibi BOM istemeyen tüketicileri bozar.
 */
export async function saveTextAs(
  text: string,
  filename: string,
  mime = "text/plain;charset=utf-8",
): Promise<boolean> {
  return saveBlobAs(new Blob([text], { type: mime }), filename);
}

/** Tarayıcı indirmesi (dialogsuz fallback). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
