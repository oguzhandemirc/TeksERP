// ERP gelen bildirimi görünüşü: fabrika tür kodu (`siparis.termin-gecti`) → ikon + alan rengi (ön ek grubundan).
// Ad/metin sunucuda render edilir; burada yalnız görünüş. Tanınmayan grup genel zil ikonuna düşer.
import type { KindLabel } from "./labels/diger";

const GRUP: Readonly<Record<string, Omit<KindLabel, "ad">>> = {
  siparis: { domain: "siparisler", icon: "receipt-outline" },
  sevkiyat: { domain: "sevkiyat", icon: "cube-outline" },
  cari: { domain: "cariler", icon: "people-outline" },
  isemri: { domain: "uretim", icon: "construct-outline" },
  dokuma: { domain: "uretim", icon: "construct-outline" },
  kalite: { domain: "uretim", icon: "ribbon-outline" },
  fason: { domain: "fason", icon: "swap-horizontal-outline" },
  sistem: { domain: "genel", icon: "server-outline" },
  yazici: { domain: "genel", icon: "print-outline" },
  cihaz: { domain: "genel", icon: "hardware-chip-outline" },
  kimlik: { domain: "genel", icon: "shield-checkmark-outline" },
};

export function erpBildirimGorunusu(tur: unknown): KindLabel {
  const kod = typeof tur === "string" ? tur : "—";
  const g = GRUP[kod.split(".")[0] ?? ""];
  return { ad: kod, ...(g ?? { domain: "genel", icon: "notifications-outline" }) };
}

/** Okunmamış sayısı rozet metni (99 üstü kısaltılır); 0 → null. */
export function okunmamisRozeti(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n > 99 ? "99+" : String(Math.floor(n));
}
