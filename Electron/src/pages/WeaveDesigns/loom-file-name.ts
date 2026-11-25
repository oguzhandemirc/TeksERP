// Tezgâh desen dosyası adı 8+3 uyarısı (K9): eski tezgâh denetleyicileri DOS biçimi kısa adı okur.
// Yalnız uyarı — kayıt reddedilmez (yeni tezgâhlar uzun adı okur).
export const LOOM_FILE_NAME_WARNING = "Bazı eski tezgâhlar uzun dosya adını okuyamaz (8 karakter ad + 3 karakter uzantı).";

/** Ad son noktadan bölünür; ad 8'den ya da uzantı 3'ten uzunsa true. Boş ad uyarı vermez. */
export function loomFileNameTooLong(raw: string | null | undefined): boolean {
  const name = (raw ?? "").trim();
  if (name === "") return false;
  const dot = name.lastIndexOf(".");
  const base = dot < 0 ? name : name.slice(0, dot);
  const ext = dot < 0 ? "" : name.slice(dot + 1);
  return base.length > 8 || ext.length > 3;
}
