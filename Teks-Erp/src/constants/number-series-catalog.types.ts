// =============================================================================
// NUMARA SERİSİ KATALOĞU — kimlik koda, biçim veriye (2026-09-22)
// =============================================================================
// Bu dosya "hangi seriler VAR" sorusunu cevaplar; "bu serinin ön eki NE" sorusunu
// `number_series` tablosu cevaplar. Ayrım izin kataloğunun birebir emsalidir
// (`permission-catalog.ts` + boot uzlaştırması): katalog satırı ekler, DB'dekini
// DEĞİŞTİRMEZ — fabrikanın seçtiği ön ek bir daha koda dönmez.
//
// Kod-sahipli alanlar (her boot'ta katalogdan tazelenir): `label`, `kind`,
// `scanned`, `editable`. Veri-sahipli alanlar (yalnız panel yazar):
// `prefix`, `dateSegment`, `digits`, `separator`, `retiredPrefixes`.
//
// ⚠️ `seed*` değerleri BUGÜNKÜ ÜRETEÇLERDEN ÖLÇÜLDÜ; bekçi `test_number_series §1`
// her satırı gerçek üreteçle karşılaştırır. Buraya "olması gereken" yazma, OLANI yaz.
// =============================================================================
import type { NumberSeriesDateSegment } from "@prisma/client";

/** Barkod sınıflandırmasında kodun hangi varlığa çözüleceği (yalnız `scanned` seriler). */
export type NumberSeriesKind =
  | "ROLL"
  | "TRAVELER_CARD"
  | "SWATCH"
  | "SACK"
  | "SHIPMENT"
  | "DISPATCH_DOC";

export interface NumberSeriesCatalogEntry {
  key: string;
  label: string;
  seedPrefix: string;
  seedDateSegment: NumberSeriesDateSegment;
  seedDigits: number;
  seedSeparator: string;
  seedRetiredPrefixes?: string[];
  /**
   * SAYAÇ TOHUMLARI — üst sınır ve sarma. İkisi de yalnız BUGÜNKÜ davranışı
   * veriye taşımak için var: bir serinin sınırı/sarması KODDA yaşıyorsa fabrika
   * onu panelden göremez ve değiştiremez. Alan yoksa sınır yok ve sarma yok,
   * yani 52 serinin 51'i bugünküyle bayt bayt aynı kalır.
   *
   * ⚠️ `seedWrap` `seedMaxValue`SIZ anlamsızdır (sarılacak sınır yoktur) ve bu
   * bekçiyle ölçülür — beyansız bir sarma ayarı panelde "açık" görünüp hiçbir
   * şey yapmazdı.
   */
  seedMaxValue?: number;
  seedWrap?: boolean;
  /** Okutulan kod mu? Küresel ön ek tekilliği YALNIZ bu kümede aranır. */
  kind?: NumberSeriesKind;
  /**
   * Panelden biçimi değiştirilemeyen seri + GEREKÇESİ. Gerekçe zorunlu: "kilitli"
   * demek bir karardır ve karar gerekçesiz yazılmaz.
   */
  lockedReason?: string;
  /**
   * Tarih ile sıra ARASINDA duran sabit parça (regex parçası). Serinin YAPISAL
   * özelliğidir, biçim AYARI değil — fabrika panelden değiştiremez, bu yüzden
   * `number_series` tablosunda değil burada, kodda yaşar.
   */
  infix?: { re: string; aciklama: string };
  /**
   * ÜRETEÇ BAĞI — bu satır üreteci SÜRÜYOR mu, yoksa yalnız TARİF mi ediyor?
   *
   * Normalde katalog satırı üreteci SÜRER: üreteç biçimi `resolveSeriesFormat`
   * ile bir kez okur, ön eki `seriesPrefix`ten, haneyi `formatSeriesCode`tan
   * alır. Alan VARSA bu bağ YOKTUR — üreteç kodu
   * kendi literalleriyle kurar ve katalog satırı yalnız sınıflandırma/tarif
   * içindir. Beyan ZORUNLU çünkü beyansız hâli SESSİZ BİR YALANDIR: panel
   * satırı gösterir, fabrika biçimi değiştirdiğini sanır, üreteç eski kodu
   * yazmaya devam ederdi.
   *
   * ⚠️ Beyanlı satır `lockedReason` da taşımalı (bekçi `test_number_series §11c`):
   * sürmediğimiz bir biçimi panelden düzenlemeye AÇAMAYIZ.
   *
   * `uretec` üreteç dosyasının `src/` göreli yoludur — §11b'nin literal taraması
   * muafiyetini BURADAN okur, kendi içine gömülü bir listeden değil.
   */
  uretecBagi?: { durum: "tarif"; uretec: string; not: string };
  /**
   * KENDİ SAYAÇ MEKANİZMASI olan seri — sırası "mevcut kodların SAYISAL max'ı"
   * ile bulunmaz. Sayaç ayarları (başlangıç · adım · üst sınır) bu serilerde
   * FAIL-CLOSED reddedilir (400), çünkü ayar hiçbir şey yapmazdı ve bu SESSİZ
   * olurdu — kullanıcı "adımı 10 yaptım" der, üreteç 1'er artmaya devam ederdi.
   *
   * ⚠️ Biçim kilidiyle (`lockedReason`) AYRI BİR SORU: `workOrder` biçimi kilitli
   * ama sayacı max-türetilmiş, yani sayaç ayarları ORADA anlamlıdır. İki kilit
   * iki farklı gün kalkar.
   */
  ownCounter?: { not: string };
  /**
   * ELLE NUMARA YOLU olan seri — `numberSource` ayarı YALNIZ burada anlamlıdır.
   * Ölçüldü 2026-09-23: 52 serinin yalnız DÖRDÜNDE elle değer kabul eden bir yol
   * var. Kalan 48'de ayarı açmak, OLMAYAN bir kabul yolunu inşa etmek demek
   * olurdu; panel orada alanı hiç çizmez, uç 400 döner (`ownCounter` kalıbı).
   *
   * `path` yolun yeri — bekçi burayı okuyup gerçekten var olduğunu ölçer.
   */
  manualEntry?: { path: string; not: string };
  /**
   * SAYACIN KAPSAMI BİÇİM DEĞİŞİMİNE HAZIR MI? (Faz C ön koşulu C0)
   *
   * ⚠️ KONFİGÜRASYON SINIRI, üretim sınırı DEĞİL: bu alan yoksa serinin biçimi
   * PANELDEN DEĞİŞTİRİLEMEZ (`updateSeriesFormat` 400
   * `NUMBER_SERIES_COUNTER_NOT_SCOPED`), ama numara üretimi bugünkü gibi sürer.
   * Ters kurgu — üretimde fail-closed — çuvalı açılamaz hâle getirirdi; asıl
   * engellenmesi gereken RİSKLİ AYAR DEĞİŞİKLİĞİDİR.
   *
   * Alan YOKSA üçüncü sonuç geçerlidir: *ölçülmedi / çağrı yeri hazır değil.*
   * `durum` iki hazır hâli ayırır ve `not` GEREKÇEYİ taşır — beyan burada yaşar,
   * commit mesajında değil, çünkü okunması gereken yer burasıdır.
   */
  scopedCounter?: {
    durum: "hazir" | "sayac-yok";
    not: string;
    /**
     * ÜRETECİN YERİ — `src/` göreli yol. Beyanın ÖLÇÜLEBİLİR ayağı: bekçi bu
     * dosyayı açıp C0 yolundan (`nextSeriesNo`) geçtiğini doğrular.
     *
     * ⚠️ NEDEN YOL, "anahtarla çağrı arayalım" DEĞİL: on master veri serisi TEK
     * yoldan (`BaseService.nextAutoCode`) üretiliyor ve çağrı anahtarı DEĞİŞKEN
     * (`cfg.series`) — anahtar metnini arayan bir kapı orada hiçbir şey bulamaz
     * ve "beyan yalan" der (ölçüldü 2026-09-23). Beyan yeri söyler, kapı orayı ölçer.
     *
     * ⚠️ LİSTE OLABİLİR ve bu ölçülmüş bir ihtiyaç: bir serinin İKİ üreteci
     * olabiliyor (`workOrder` → `workorder.service` + `helpers/workorder-clone.helper`;
     * `subcontractorDispatch` → `subcontractor.service` + `helpers/batch-dispatch-surgery.helper`).
     * Tek yol beyan edilseydi kapı İKİNCİ üreteci hiç açmazdı ve o yol eski
     * literal hesapta kalsa bile beyan YEŞİL görünürdü.
     */
    uretec?: string | readonly string[];
  };
  /**
   * Panelde hangi bölümde görünür. ZORUNLU (bekçi `test_number_series_panel §4d`):
   * etiketsiz seri ekrandan DÜŞER ve "çuval numarası neden burada yok?"
   * sorusunun ekranda cevabı olmaz. Kilitli seriler de çizilir — gerekçeleriyle.
   */
  panelGroup: NumberSeriesPanelGroup;
  /**
   * ETKİ CÜMLESİNİN kaynağı: bu seriyle numaralanmış şeyin sayısı nereden
   * okunur. Panel "bugüne kadarki N …nin numarası değişmez" derken bu sayıyı
   * kullanır ve sayı UYDURULMAZ — ölçülür. Alan yoksa panel sayı YAZMAZ
   * (üçüncü sonuç: "ölçülmedi"), "0" demez.
   *
   * ⚠️ `birim` BEYAN ZORUNLUDUR çünkü SATIR ile BELGE aynı şey değildir: iade
   * numarası çok kalemli iadede ÜYE satırlara da kopyalanır, yani `count(*)`
   * üç satırı üç belge sayardı ve cümle yalan olurdu ("1.314 iade" ≠ "438
   * iade belgesi"). Ekrandaki cümle bu birimden kurulur.
   *
   * ⚠️ `field` ZORUNLU bir kolon OLMALI, ya da `where` ile null'lar ELENMELİ —
   * nullable bir kolonda "satır sayısı" ile "numaralanmış sayı" ayrışır.
   * Şart `test_number_series_panel §4`te şema METNİNDEN ölçülür (çalışma
   * anında yapılamıyor: Prisma 7 DMMF alanı `isRequired` taşımıyor).
   */
  countTable?: {
    model: string;
    field: string;
    birim: "kayıt" | "belge";
    /**
     * Sayım yüklemi — KAPALI KÜME, serbest `where` nesnesi DEĞİL.
     *
     * ⚠️ Katalog bir SABİTLER dosyasıdır ve prisma'ya bağlanamaz; oysa belge
     * çapası yüklemi kolon-kolon karşılaştırma ister (`returnGroupId = id`) ve
     * o ancak prisma'nın alan referansıyla kurulur (ölçüldü: Prisma 7
     * `p.rollReturn.fields.id` DESTEKLİYOR). Bu yüzden katalog yüklemin ADINI
     * yazar, gerçek yüklemi servis kurar. Serbest nesne olsaydı, katalogda
     * çalışmayan bir `where` sessizce yanlış sayı üretirdi.
     *
     * · `belge-capasi` — tekil kayıt ya da grup lideri (iade belgesi).
     * · `seri-onekli`  — AYNI TABLOYU BİRDEN ÇOK SERİ paylaşıyor; sayım yalnız
     *   BU serinin ön ekiyle (emekli ön ekler dahil) başlayan kodları sayar.
     *   Beyansız bırakılırsa düz `count(*)` dört fatura serisinin TOPLAMINI
     *   basar ve cümle "bugüne kadarki N satış faturası" derken yalan söyler —
     *   `null` değil, YANLIŞ bir sayı; bu yüzden ölçüldüğü yerde (bekçi
     *   `test_number_series_panel §4`) paylaşım varsa beyan ZORUNLUDUR.
     */
    kapsam?: "belge-capasi" | "seri-onekli";
  };
  /**
   * AYNI KOLONU PAYLAŞAN AMA BİRBİRİNİ DIŞLAYAN İKİZ SERİ (2026-09-23).
   *
   * ⚠️ Paylaşılan kolonda ön ek tekilliği kapısı (`assertSharedTablePrefixUnique`)
   * normalde DOĞRUDUR: iki seri aynı kolona yazıyorsa aynı numarayı üretebilir.
   * Ama parti numarasının iki REJİMİ var ve bir anda YALNIZ BİRİ çalışıyor
   * (`batch.shortNumberEnabled`). Kapıyı beyansız bırakmak ikisini de panelden
   * düzenlenemez yapardı — ikisi de `P` ile başlıyor.
   *
   * ⚠️ BEYAN ÇİFT YÖNLÜ OLMALI (bekçi ölçer): tek yönlü beyan, kapının hangi
   * seriden çağrıldığına göre bir açılıp bir kapanmasına yol açardı.
   */
  exclusiveWith?: { key: string; not: string };
}

/**
 * PANEL BÖLÜMLERİ — sıra ve ETİKET burada, tek kaynak.
 *
 * ⚠️ Etiket panelde KOPYALANMAZ, satırla birlikte gider (`countBirim` emsali):
 * iki yerde yaşayan bir etiket bayatlar ve yeni bir grup eklendiğinde panel onu
 * SESSİZCE düşürürdü — "kaydedilen ama görünmeyen kayıt" sınıfı.
 */
export const NUMBER_SERIES_PANEL_GROUPS = [
  { key: "uretim", label: "Üretim" },
  { key: "sevkiyat", label: "Sevkiyat" },
  { key: "depo-ticaret", label: "Depo ve ticaret" },
  { key: "fason-kartela", label: "Fason ve kartela" },
  { key: "finans", label: "Finans" },
  { key: "master-veri", label: "Master veri kodları" },
] as const;

export type NumberSeriesPanelGroup = (typeof NUMBER_SERIES_PANEL_GROUPS)[number]["key"];

export function numberSeriesPanelGroupLabel(g: NumberSeriesPanelGroup): string {
  return NUMBER_SERIES_PANEL_GROUPS.find((x) => x.key === g)!.label;
}
