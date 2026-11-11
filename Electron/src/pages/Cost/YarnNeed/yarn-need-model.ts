// İplik ihtiyaç planı (MAL-7) — sunucu zarfının istemci tipi + SAF görünüm yardımcıları.
// İstemci HESAP YAPMAZ: sayı, tablo ve "bilinmiyor" hücresi sunucudan (`yarn-need.sunum.ts`); burada yalnız etiket.
import type { RaporSunumu } from "@/pages/Reports/_v2/sunum";
import { MISSING_LABEL } from "../shared/labels";
import { fmtDec, fmtDecFull } from "../shared/format";

export const YARN_NEED_KEY = "maliyet/iplik-ihtiyaci";

export interface YarnNeedMeta {
  netle: boolean;
  leventDus: boolean;
  /** kg'ın çarpıldığı metre (K5): HAM = sipariş metresi çekme + dokuma firesiyle büyütülmüş; eski backend göndermez. */
  metreEsasi?: "HAM";
  /** Uygulanan dokuma firesi %; eski backend göndermez. */
  dokumaFiresiPct?: number;
  yapisiEksik: Array<{ urunId: string; urunKodu: string; urun: string; kalemSayisi: number; metre: string; eksikler: string[] }>;
  olculemeyen: Array<{ urunId: string; urunKodu: string; urun: string; birim: string; kalemSayisi: number; miktar: string }>;
  kaynaklar: { stok: boolean; emanet: boolean; acikAlis: boolean; leventDusumu: boolean };
  hesapZamani: string;
  /** SY-3 I1: yalnız iplik ayırma ayarı açıkken var (Ayrılan/Serbest sütunları sunucu tablosunda gelir). */
  ayirma?: { isSayisi: number; yapisiEksikIsler: Array<{ isId: string; isNo: string; eksikler: string[] }>; talepNetlendi: boolean; netlenenKumasM: string };
}

/** Özet metreleri (sunucu ondalık metni): dokunacak HAM metre ve aynı ürünlerin sipariş (mamul) metresi. */
export interface YarnNeedSummaryMeters {
  kumasMetre?: string;
  siparisMetre?: string;
}

/** Ham satırın ekranda okunan alt kümesi; `fireKaynagi` eski backend'de yok. */
export interface YarnNeedRowLite {
  iplikKodu: string;
  iplik: string;
  /** SY-3 I2: `IPLIK` = iplik kartındaki fire, `KART` = çözgü/atkı kartının fire zinciri. */
  fireKaynagi?: "IPLIK" | "KART";
}

export type YarnNeedPresentation = RaporSunumu & { detay?: { meta: YarnNeedMeta; ozet?: YarnNeedSummaryMeters; satirlar?: YarnNeedRowLite[] } };

const WASTE_LIST_MAX = 5;

/**
 * İplik kartındaki fireyle hesaplanan iplikler — küçük açıklama satırı. Hiç yoksa (ya da eski backend) null, çizilmez.
 */
export function wasteSourceText(rows: readonly YarnNeedRowLite[] | undefined): string | null {
  const own = (rows ?? []).filter((r) => r.fireKaynagi === "IPLIK").map((r) => r.iplikKodu || r.iplik);
  if (own.length === 0) return null;
  const shown = own.slice(0, WASTE_LIST_MAX).join(", ");
  const more = own.length > WASTE_LIST_MAX ? ` ve ${own.length - WASTE_LIST_MAX} iplik daha` : "";
  return `İplik kartındaki fire kullanıldı: ${shown}${more}. Ötekilerde çözgü/atkı kartının firesi geçerli.`;
}

/**
 * Metre esası açıklaması: kg'lar ham metreden; sipariş metresi geldiyse ikisi yan yana (karıştırılmasın).
 * Eski backend (`metreEsasi` yok) → null, satır çizilmez.
 */
export function rawBasisText(meta: Pick<YarnNeedMeta, "metreEsasi" | "dokumaFiresiPct">, ozet?: YarnNeedSummaryMeters): string | null {
  if (meta.metreEsasi !== "HAM") return null;
  const firePct = meta.dokumaFiresiPct != null && meta.dokumaFiresiPct > 0 ? `%${fmtDecFull(meta.dokumaFiresiPct, 2)}` : null;
  const dahil = firePct ? `çekme ve ${firePct} dokuma firesi dahil` : "çekme dahil";
  if (ozet?.siparisMetre && ozet.kumasMetre) {
    return `Kg'lar ham metreye göre: sipariş ${fmtDec(ozet.siparisMetre, 0)} m → dokunacak ham ${fmtDec(ozet.kumasMetre, 0)} m (${dahil}).`;
  }
  return `Kg'lar ham metreye göre hesaplanır (${dahil}).`;
}

/** Hesaba giren / girmeyen kaynak rozetleri — modül kapalıysa "bilinmiyor" diye AÇIKÇA söylenir. */
export function sourceBadges(k: YarnNeedMeta["kaynaklar"]): Array<{ key: string; label: string; on: boolean }> {
  return [
    { key: "stok", label: k.stok ? "Serbest stok düşüldü" : "Stok bilinmiyor (iplik modülü kapalı)", on: k.stok },
    { key: "emanet", label: k.emanet ? "Emanet ayrı gösterildi" : "Emanet takibi kapalı", on: k.emanet },
    { key: "acikAlis", label: k.acikAlis ? "Açık alış düşüldü" : "Açık alış bilinmiyor (ticaret modülü kapalı)", on: k.acikAlis },
    { key: "levent", label: k.leventDusumu ? "Hazır levent düşüldü" : "Hazır levent düşülmedi", on: k.leventDusumu },
  ];
}

/** Hesaba GİREMEYEN ürünlerin düğme metni (sayı sunucunun listesinden); ikisi de boşsa null (düğme çizilmez). */
export function excludedText(m: Pick<YarnNeedMeta, "yapisiEksik" | "olculemeyen">): string | null {
  const n = m.yapisiEksik.length + m.olculemeyen.length;
  return n > 0 ? `İhtiyaca girmeyen ürünler (${n}) — listeyi gör` : null;
}

/** Sunucunun eksik kodu → Türkçe (maliyet ekranlarıyla TEK sözlük); tanınmayan kod ham kalır. */
export function missingText(code: string): string {
  return MISSING_LABEL[code] ?? code;
}

/**
 * İplik ayırma açıkken kısa açıklama: kaç açık dokuma işine iplik ayrıldı, talepten ne kadar ham metre düşüldü.
 * Uyarılar (stoğu aşan, yapısı eksik iş) sunucunun `uyarilar` şeridinde — burada tekrar edilmez. Ayar kapalı → null.
 */
export function reservationText(meta: Pick<YarnNeedMeta, "ayirma">): string | null {
  const a = meta.ayirma;
  if (!a) return null;
  if (a.isSayisi === 0) return "İplik ayırma açık: açık dokuma işi yok, ayrılan iplik yok.";
  // Sunucunun ondalık metni; yalnız "sıfırdan büyük mü" bakılır (hesap yok).
  const cut = /^\d*\.?\d*$/.test(a.netlenenKumasM) && /[1-9]/.test(a.netlenenKumasM);
  const net = a.talepNetlendi && cut ? `; bu işlerin ${fmtDec(a.netlenenKumasM, 0)} m kalanı ihtiyaçtan düşüldü` : "";
  return `İplik ayırma açık: ${a.isSayisi} açık dokuma işinin kalan metresi için iplik ayrıldı${net}.`;
}
