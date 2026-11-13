import type { PatronAdresRet } from "@shared/patron-karekod";

/**
 * Karekodun varsayılan adresi: panelin bağlandığı API adresi. Backend'de "dışarıdan erişilen adres" ayarı yok; web
 * panelinde adres göreli olabilir (aynı köken), o zaman sayfanın kökeni kullanılır. Yönetici alanı düzeltebilir.
 */
export function varsayilanPatronAdresi(apiBase: string | undefined, origin: string | undefined): string {
  const base = (apiBase ?? "").trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) return base;
  return origin && /^https?:\/\//i.test(origin) ? origin : base;
}

/** Karekod neden üretilmedi — yöneticiye düz dille. */
export const ADRES_RET_METNI: Record<PatronAdresRet, string> = {
  bos: "Sunucunun internetten erişilen https adresini yazın.",
  sifresiz: "Adres şifresiz (http). Parola açık ağdan geçmesin diye patron uygulaması yalnız https adresine bağlanır; karekod üretilmedi.",
  gecersiz: "Adres geçerli değil. Yalnız alan adı ve isteğe bağlı port yazın (ör. https://erp.fabrikaniz.com).",
  yerel: "Bu adres yalnız fabrika ağından erişilen yerel bir adres; patron telefonu dışarıdan ulaşamaz, karekod üretilmedi.",
};
