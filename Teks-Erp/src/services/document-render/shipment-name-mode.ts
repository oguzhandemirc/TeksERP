import type {
  ShippingDocCekiNameMode,
  ShippingDocItemNameMode,
} from "../system-setting.service";

/**
 * SEVK BELGESİNDE HANGİ AD BASILIR — TEK KARAR YERİ.
 *
 * ⚠️ NEDEN AYRI DOSYA (2026-09-10 saha bulgusu): aynı sevkiyatın PDF'i müşterinin
 * adını (`BS-6650 EKRU`), Excel'i bizim adımızı (`LİNEN EKRU`) basıyordu. İkisi
 * de AYNI donmuş belgeden besleniyor ve snapshot iki adı da taşıyor —
 * ayrışan şey KARARdı: rejimi yalnız HTML renderer biliyordu, muhasebe fişinin
 * Excel'i hiç sormuyordu. Ayarın kendi açıklaması ise "kapsam sevk irsaliyesi +
 * MUHASEBE FİŞİDİR" diyordu; yani vaat edilen davranış yerine gelmiyordu.
 *
 * Bu repoda o sınıfın adı "ayrışan yüzey": aynı soruyu cevaplayan koşul TEK
 * helper'da yaşar. Karar burada verilir; renderer da, rapor ucu da buradan sorar.
 *
 * ⚠️ `musterideki` FAIL-OPEN: karşılığı olmayan üründe BİZİM adımız basılır
 * (`musteriAdiVeya`). Boş ürün adı taşıyan bir irsaliye hukuken sakattır.
 */
export interface AdRejimi {
  /** Ürün listesinde bizim adımızın kolonu çizilir mi. */
  urunBizdeki: boolean;
  /** Ürün listesinde müşteri adının kolonu çizilir mi. */
  urunMusterideki: boolean;
  /** Çeki listesinde bizim desen/varyantımız çizilir mi. */
  cekiBizdeki: boolean;
  /** Çeki listesinde müşterinin desen/varyantı çizilir mi. */
  cekiMusterideki: boolean;
  /**
   * Ürün listesinde müşteri RENGİ ayrı sütuna çıkar mı
   * (`shipping.docProductColorSplit`).
   *
   * ⚠️ Bu bir YERLEŞİM kararıdır, "hangi ad" kararı değil — ve yalnız MÜŞTERİYE
   * GİDEN belgeyi ilgilendirir (ayarın kendi açıklaması böyle diyor). Muhasebe
   * fişinin Excel'i bunu uygulamaz: orada müşteri adı tek birleşik hücrede
   * kalır. Ad seçimi ikisinde de AYNIdır; ayrışan yalnız kolon düzenidir.
   */
  renkAyriSutun: boolean;
}

/**
 * Ayar değerlerini "hangi kolon çizilecek" kararına çevirir.
 *
 * ⚠️ `cekiNameMode: "devral"` BURADA çözülür — çağıranların her biri kendi
 * çözseydi biri unutulduğunda çeki listesi sessizce genel rejimden ayrılırdı.
 */
export function cozAdRejimi(ayar: {
  itemNameMode?: ShippingDocItemNameMode;
  cekiNameMode?: ShippingDocCekiNameMode;
  productColorSplit?: boolean;
}): AdRejimi {
  const urun = ayar.itemNameMode ?? "bizdeki";
  const cekiHam = ayar.cekiNameMode ?? "devral";
  const ceki = cekiHam === "devral" ? urun : cekiHam;
  return {
    urunBizdeki: urun !== "musterideki",
    urunMusterideki: urun !== "bizdeki",
    cekiBizdeki: ceki !== "musterideki",
    cekiMusterideki: ceki !== "bizdeki",
    renkAyriSutun: ayar.productColorSplit === true,
  };
}

/** Müşteri adı yoksa bizimkine düş — fail-open kuralının tek gövdesi. */
export function musteriAdiVeya(cust: string | null | undefined, ours: string): string {
  return (cust ?? "").trim() || ours;
}
