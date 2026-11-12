// =============================================================================
// İPLİK İHTİYAÇ PLANI — sözleşme tipleri (seçenek, satır, özet, rapor zarfı)
// =============================================================================
// Hesap `yarn-need.report.service.ts`te; o dosya 300 satır tavanını aşınca tipler buraya ayrıldı.
// Servis hepsini yeniden dışa verir, çağıranların import yolu değişmez. Burada hesap YOK.
// =============================================================================
import type { YarnWasteSource } from "../helpers/yarn-waste.helper";

export interface YarnNeedOptions {
  /** true (varsayılan): talep − depo − üretimde (üretim dengesi); false: brüt kalan (istenen − sevk). */
  netle?: boolean;
  /** true (varsayılan): devere açıksa hazır leventlerin kalanı çözgü ihtiyacından düşülür. */
  leventDus?: boolean;
  musteriId?: string;
  urunId?: string;
}

export interface YarnNeedRow {
  iplikId: string;
  iplikKodu: string;
  iplik: string;
  cozguKg: string;
  atkiKg: string;
  ihtiyacKg: string;
  serbestStokKg: string | null;
  emanetKg: string | null;
  acikAlisKg: string | null;
  eksikKg: string;
  eksikBelirsiz: boolean;
  /** SY-3 I2: kg'a uygulanan firenin kaynağı — `IPLIK` iplik kartı firesi, `KART` çözgü/atkı fire zinciri. */
  fireKaynagi: YarnWasteSource;
  /** SY-3 I1 (YALNIZ ayar açıkken anahtar var): açık kendi dokuma işlerinin kalan ham metresine ayrılan kg. */
  ayrilanKg?: string;
  /** SY-3 I1: serbest stok − ayrılan (eksiye inebilir = ayrılan stoğu aşıyor); stok bilinmiyorsa null. Eksik buna göre. */
  serbestKg?: string | null;
}

export interface YarnNeedSummary {
  iplikSayisi: number;
  cozguKg: string;
  atkiKg: string;
  ihtiyacKg: string;
  eksikKg: string;
  /** Dokunacak HAM kumaş metresi (yapısı tam ürünler; çekme + dokuma firesiyle; hazır levent düşümünden ÖNCE). */
  kumasMetre: string;
  /** Aynı ürünlerin sipariş (mamul) metresi — ham metreye çevrilmeden önce. */
  siparisMetre: string;
  /** SY-3 I1 (yalnız ayar açıkken): Σ ayrılan kg. */
  ayrilanKg?: string;
}

export interface YarnNeedReport {
  satirlar: YarnNeedRow[];
  ozet: YarnNeedSummary;
  meta: {
    netle: boolean;
    leventDus: boolean;
    /** kg'ın çarpıldığı metre: HAM (sipariş metresi ÷ (1 − çekme) ÷ (1 − dokuma firesi)). */
    metreEsasi: "HAM";
    /** Uygulanan dokuma firesi % (etkin ayar; dokuma kapalıyken 0). */
    dokumaFiresiPct: number;
    yapisiEksik: Array<{ urunId: string; urunKodu: string; urun: string; kalemSayisi: number; metre: string; eksikler: string[] }>;
    olculemeyen: Array<{ urunId: string; urunKodu: string; urun: string; birim: string; kalemSayisi: number; miktar: string }>;
    leventler: Array<{ cozguKartiId: string; leventSayisi: number; kalanCozguM: string; dusulenKumasM: string }>;
    kaynaklar: { stok: boolean; emanet: boolean; acikAlis: boolean; leventDusumu: boolean };
    hesapZamani: string;
    /** Süzgeç seçenekleri: talebi olan müşteriler ve ürünler (süzme sunucuda). */
    secenekler: { musteriler: Array<{ id: string; ad: string }>; urunler: Array<{ id: string; ad: string }> };
    /**
     * SY-3 I1 (yalnız ayar açıkken anahtar var). Açıkken `cozguKg/atkiKg/ihtiyacKg` PLANLANMAMIŞ talebin kg'ıdır:
     * ürünün talep ham metresinden açık işlerin kalan ham metresi düşülür (`talepNetlendi`; müşteri süzgecinde düşülmez).
     */
    ayirma?: {
      isSayisi: number;
      yapisiEksikIsler: Array<{ isId: string; isNo: string; eksikler: string[] }>;
      talepNetlendi: boolean;
      /** Talepten düşülen ham metre (Σ ürün başına min(talep ham, işlerin kalanı)). */
      netlenenKumasM: string;
    };
  };
}
