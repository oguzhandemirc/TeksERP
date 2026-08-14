// =============================================================================
// FİLTRE ŞERİDİNİN KAPSAMI — SAF KURAL
// =============================================================================
// NEDEN AYRI DOSYA: ekranın iki sekmesi İKİ FARKLI UÇTAN besleniyor ve ikisi
// aynı süzgeçleri tanımıyor.
//
//   • **Siparişler** → `GET /purchase-orders` — arama, durum, tarih aralığı,
//     tedarikçi.
//   • **Ne bekliyorum?** → `GET /purchase-orders/open-lines` — YALNIZ tedarikçi,
//     ürün ve "gecikmişler". Arama/durum/tarih o uçta YOKTUR.
//
// ⚠️ ÖLÜ FİLTRE ÇİZİLMEZ. Şerit iki sekmenin de üstünde durduğu için, kural
// olmasa arama ve tarih kutuları kalem sekmesinde de görünür ve HİÇBİR ŞEY
// yapmazdı: kullanıcı yazar, bekler, liste değişmez, ekran "bozuk" görünür.
// Projede adı konmuş bir arıza sınıfı bu (mobil Personel çipi kararı: *ölü
// filtre "bastım, olmadı" üretir*).
//
// ⚠️ KURAL BİLEŞENİN İÇİNDEKİ BİR `&&` ZİNCİRİ OLARAK DURAMAZ: öyle bırakılsaydı
// tersine çevrilmesi hiçbir testi kırmazdı ve bir gün "sekmede arama kutusu
// eksik" diye geri konurdu. Projenin yazılı deseni (`canQuickShip`,
// `resolveRollTabs`, `showPurchaseOrderFields`) bu dosyanın var oluş sebebidir.
// Bekçi: `filterScope.test.ts`.
// =============================================================================

export type PoFilterScope = "orders" | "open-lines";

export interface PoFilterControls {
  /** Serbest metin arama — yalnız sipariş ucunda var. */
  search: boolean;
  /** Durum daraltması — kalem ucu zaten yalnız OPEN/PARTIAL döner. */
  status: boolean;
  /** Sipariş tarihi aralığı — kalem ucunda karşılığı yok. */
  dateRange: boolean;
  /** Tedarikçi — İKİ uçta da var, bu yüzden iki sekmede de çizilir. */
  supplier: boolean;
}

/**
 * Hangi filtre kutusu hangi sekmede çizilir.
 *
 * ⚠️ `supplier` HER İKİ sekmede de `true` ve bu bilinçli: "şu tedarikçiden ne
 * bekliyorum" sorusu iki görünümde de AYNI soru, üstelik iki uç da o süzgeci
 * tanıyor. Sekme değiştirince daraltmanın kaybolması, kullanıcıyı aynı seçimi
 * iki kez yaptırırdı.
 */
export function poFilterControls(scope: PoFilterScope): PoFilterControls {
  const orders = scope === "orders";
  return { search: orders, status: orders, dateRange: orders, supplier: true };
}
