// Gelen kutusu kuralları (istemci aynası; karar sunucuda): iptal yalnız YAZAR ve yalnız BEKLIYOR'da.
// Yönetici tesisin bütün mesajlarını görür; başkasının mesajında iptal düğmesi çıkmaz.
import type { InboxItem } from "../api/wire";

export function canCancel(m: Pick<InboxItem, "durum" | "hesapAdi">, me: { ad: string; admin: boolean }): boolean {
  return m.durum === "BEKLIYOR" && (!me.admin || m.hesapAdi === me.ad);
}

export const INBOX_KIND_LABEL: Readonly<Record<string, string>> = { SIPARIS: "Sipariş", CARI: "Cari" };

/** Sonuç özeti: fabrika belge no / ret iletisi. */
export function resultText(sonuc: unknown): string | null {
  if (typeof sonuc !== "object" || sonuc === null) return null;
  const s = sonuc as { belgeNo?: unknown; mesaj?: unknown; kod?: unknown };
  if (typeof s.belgeNo === "string") return `Fabrika no: ${s.belgeNo}`;
  if (typeof s.mesaj === "string") return s.mesaj;
  if (typeof s.kod === "string") return `Kod: ${s.kod}`;
  return null;
}
