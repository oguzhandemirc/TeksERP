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
 * (`customerNameOr`). Boş ürün adı taşıyan bir irsaliye hukuken sakattır.
 */
export interface DocNameMode {
  /** Ürün listesinde bizim adımızın kolonu çizilir mi. */
  showOurName: boolean;
  /** Ürün listesinde müşteri adının kolonu çizilir mi. */
  showCustomerName: boolean;
  /** Çeki listesinde bizim desen/varyantımız çizilir mi. */
  cekiShowOurName: boolean;
  /** Çeki listesinde müşterinin desen/varyantı çizilir mi. */
  cekiShowCustomerName: boolean;
  /**
   * Ürün listesinde müşteri RENGİ ayrı sütuna çıkar mı
   * (`shipping.docProductColorSplit`).
   *
   * ⚠️ Bu bir YERLEŞİM kararıdır, "hangi ad" kararı değil — ve yalnız MÜŞTERİYE
   * GİDEN belgeyi ilgilendirir (ayarın kendi açıklaması böyle diyor). Muhasebe
   * fişinin Excel'i bunu uygulamaz: orada müşteri adı tek birleşik hücrede
   * kalır. Ad seçimi ikisinde de AYNIdır; ayrışan yalnız kolon düzenidir.
   */
  productColorSplit: boolean;
}

/**
 * Ayar değerlerini "hangi kolon çizilecek" kararına çevirir.
 *
 * ⚠️ `cekiNameMode: "devral"` BURADA çözülür — çağıranların her biri kendi
 * çözseydi biri unutulduğunda çeki listesi sessizce genel rejimden ayrılırdı.
 */
export function resolveDocNameMode(settings: {
  itemNameMode?: ShippingDocItemNameMode;
  cekiNameMode?: ShippingDocCekiNameMode;
  productColorSplit?: boolean;
}): DocNameMode {
  const item = settings.itemNameMode ?? "bizdeki";
  const cekiRaw = settings.cekiNameMode ?? "devral";
  const ceki = cekiRaw === "devral" ? item : cekiRaw;
  return {
    showOurName: item !== "musterideki",
    showCustomerName: item !== "bizdeki",
    cekiShowOurName: ceki !== "musterideki",
    cekiShowCustomerName: ceki !== "bizdeki",
    productColorSplit: settings.productColorSplit === true,
  };
}

/** Müşteri adı yoksa bizimkine düş — fail-open kuralının tek gövdesi. */
export function customerNameOr(cust: string | null | undefined, ours: string): string {
  return (cust ?? "").trim() || ours;
}
