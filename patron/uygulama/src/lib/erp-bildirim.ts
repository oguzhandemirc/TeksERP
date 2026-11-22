// ERP gelen bildirimi görünüşü: fabrika tür kodu (`siparis.termin-gecti`) → ikon + alan rengi (ön ek grubundan).
// Ad/metin sunucuda render edilir; burada yalnız görünüş. Tanınmayan grup genel zil ikonuna düşer.
import type { KindLabel } from "./labels/diger";

/** Geçersizleştirme etiketi: liste, özet ve Diğer rozeti birlikte tazelenir (önde gelen telefon bildirimi de bunu tetikler). */
export const BILDIRIM_TAG = "bildirim-kutusu";

type Gorunus = Omit<KindLabel, "ad">;

/** Grup görünüşü — grup adları fabrika kataloğunun `grup` alanı, ikonlar panel `format.ts` `GROUP_LOOK` karşılığı
 *  (uygulamada modülü olan grupta modül ikonu). */
const GRUP_GORUNUS: Readonly<Record<string, Gorunus>> = {
  Sipariş: { domain: "siparisler", icon: "receipt-outline" },
  Satış: { domain: "siparisler", icon: "document-text-outline" },
  Üretim: { domain: "uretim", icon: "construct-outline" },
  Planlama: { domain: "uretim", icon: "calendar-outline" },
  Kalite: { domain: "uretim", icon: "ribbon-outline" },
  Dokuma: { domain: "uretim", icon: "layers-outline" },
  Sevkiyat: { domain: "sevkiyat", icon: "car-outline" },
  Fason: { domain: "fason", icon: "git-branch-outline" },
  Depo: { domain: "stok", icon: "cube-outline" },
  "Mal Kabul": { domain: "stok", icon: "archive-outline" },
  Satınalma: { domain: "stok", icon: "bag-handle-outline" },
  Finans: { domain: "finans", icon: "wallet-outline" },
  Bakım: { domain: "genel", icon: "build-outline" },
  Personel: { domain: "genel", icon: "people-circle-outline" },
  "Ana Veri": { domain: "genel", icon: "library-outline" },
  Yetki: { domain: "genel", icon: "key-outline" },
  Sistem: { domain: "genel", icon: "server-outline" },
};

/** Tür ön eki → katalog grubu (ön ekin baskın grubu; `brode` katalogda henüz yok, gelince Üretim). */
const ON_EK_GRUP: Readonly<Record<string, string>> = {
  siparis: "Sipariş",
  teklif: "Satış",
  isemri: "Üretim",
  uretim: "Üretim",
  kursun: "Üretim",
  tambur: "Üretim",
  brode: "Üretim",
  planlama: "Planlama",
  kalite: "Kalite",
  dokuma: "Dokuma",
  devere: "Dokuma",
  sevkiyat: "Sevkiyat",
  fason: "Fason",
  stok: "Depo",
  gelenbelge: "Mal Kabul",
  malkabul: "Mal Kabul",
  satinalma: "Satınalma",
  finans: "Finans",
  maliyet: "Finans",
  bakim: "Bakım",
  personel: "Personel",
  anaveri: "Ana Veri",
  yetki: "Yetki",
  sistem: "Sistem",
  yazici: "Sistem",
  cihaz: "Sistem",
  kimlik: "Sistem",
};

/** Grup içinde daha anlamlı ikonu olan ön ekler (cari türleri katalogda üç gruba dağılır; tek cari ikonu). */
const ON_EK_OZEL: Readonly<Record<string, Gorunus>> = {
  cari: { domain: "cariler", icon: "people-outline" },
  yazici: { domain: "genel", icon: "print-outline" },
  cihaz: { domain: "genel", icon: "hardware-chip-outline" },
  kimlik: { domain: "genel", icon: "shield-checkmark-outline" },
  // `genel.gun-sonu-ozeti` (#778): birden çok alanı özetler — tek gruba düşmez.
  genel: { domain: "genel", icon: "today-outline" },
};

const VARSAYILAN: Gorunus = { domain: "genel", icon: "notifications-outline" };

/** Ön ekin görünüşü (bilinmeyen ön ek → genel zil). Testler kapsama için kullanır. */
export function onEkGorunusu(onEk: string): Gorunus {
  if (Object.prototype.hasOwnProperty.call(ON_EK_OZEL, onEk)) return ON_EK_OZEL[onEk]!;
  const grup = Object.prototype.hasOwnProperty.call(ON_EK_GRUP, onEk) ? ON_EK_GRUP[onEk] : undefined;
  return (grup !== undefined ? GRUP_GORUNUS[grup] : undefined) ?? VARSAYILAN;
}

export function erpBildirimGorunusu(tur: unknown): KindLabel {
  const kod = typeof tur === "string" ? tur : "—";
  return { ad: kod, ...onEkGorunusu(kod.split(".")[0] ?? "") };
}

/** Okunmamış sayısı rozet metni (99 üstü kısaltılır); 0 → null. */
export function okunmamisRozeti(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n > 99 ? "99+" : String(Math.floor(n));
}
