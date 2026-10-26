// =============================================================================
// ÖLÇÜ TANIM SÖZLÜĞÜ — Raporlar v2 (R0-TANIM)
// =============================================================================
// Bir ölçünün ADI ve GÜNLÜK DİL açıklaması yalnız burada yazılır: 36 raporda üç ayrı
// "fire", iki "iptal oranı", üç termin ölçüsü vardı (plan §1). Temel raporlar, anlatı
// motoru ve semantik katman (R1) bu sözlükten okur; ölçü adı başka yerde uydurulmaz.
//
// ⚠️ Açıklama FORMÜL İÇERMEZ (sembol, yüzdelik kısaltması, "medyan" gibi istatistik
// sözcükleri yok) — okuyan patron/şef; bekçi `test_rapor_katalogu §9` yasak listeyi ölçer.
// ⚠️ `kaynak` ölçülmüştür: dosya bugün o alanı taşır (bekçi her parçayı dosyada arar).
// `null` = bugün tek alanla okunamıyor; neden satırın yorumunda, R0-RAP dilimi tamamlar.
// =============================================================================

export type OlcuBirimi = "metre" | "kg" | "yuzde" | "adet" | "gun" | "dakika" | "para";
/** Sayının hangi yöne gitmesi iyidir — anlatı motoru "iyileşti/kötüleşti" der. */
export type OlcuIyiYon = "artis" | "azalis" | "notr";

export interface OlcuTanimi {
  kimlik: string;
  ad: string;
  aciklama: string;
  birim: OlcuBirimi;
  iyiYon: OlcuIyiYon;
  /** Bugünkü değerin okunduğu servis dosyası (`Teks-Erp/` köküne göre) ve alan yolu. */
  kaynak: { dosya: string; alan: string } | null;
}

const R = "src/services/reports";

export const OLCU_TANIMLARI: readonly OlcuTanimi[] = [
  // ── SİPARİŞ ve SEVK ──────────────────────────────────────────────────────
  { kimlik: "siparis.metre", ad: "Alınan sipariş",
    aciklama: "Dönemde alınan siparişlerde istenen toplam kumaş metresi; sonradan iptal edilen siparişler sayılmaz.",
    birim: "metre", iyiYon: "artis", kaynak: { dosya: `${R}/order-intake.report.service.ts`, alan: "OrderIntakeSummary.totalQty" } },
  // R0-RAPA: Sipariş Karnesi'ne EK alan (`amounts`, para birimi başına; fiyatsız satır sayısı ayrı).
  { kimlik: "siparis.tutar", ad: "Sipariş tutarı",
    aciklama: "Dönemde alınan siparişlerin fiyatı girilmiş satırlarının tutarı, her para birimi ayrı; fiyatı girilmemiş satır sıfır sayılmaz, ayrıca gösterilir.",
    birim: "para", iyiYon: "artis", kaynak: { dosya: `${R}/order-intake.report.service.ts`, alan: "OrderIntakeSummary.amounts" } },
  { kimlik: "sevk.brutMetre", ad: "Sevk edilen",
    aciklama: "Dönemde sevk edilen kumaş metresi; sonradan iade gelse de bu rakam düşmez, iade ayrı sayılır.",
    birim: "metre", iyiYon: "artis", kaynak: { dosya: `${R}/_shipped.ts`, alan: "ShippedCell.qty" } },
  { kimlik: "sevk.tutar", ad: "Sevk tutarı",
    aciklama: "Sevk edilen malın sipariş fiyatıyla tutarı, her para birimi ayrı; TL karşılığı yalnız sevk gününün kuru kayıtlıysa verilir.",
    birim: "para", iyiYon: "artis", kaynak: { dosya: `${R}/_destination-mix-money.ts`, alan: "MoneyAgg.amounts" } },

  // ── TERMİN (tek termin ölçüsü + iki süre) ─────────────────────────────────
  { kimlik: "termin.zamanindaYuzde", ad: "Zamanında teslim",
    aciklama: "Termini olan siparişlerden zamanında gidenlerin payı; termini olmayanlar orana girmez, ayrıca sayılır. Dönemde tamamlanan siparişler üzerinden bakılır.",
    birim: "yuzde", iyiYon: "artis", kaynak: { dosya: `${R}/shipment-scorecard.report.service.ts`, alan: "ShipmentScorecardSummary.onTimePct" } },
  { kimlik: "termin.yariSureGun", ad: "Teslim süresi",
    aciklama: "Siparişlerin yarısı bu kadar günde tamamen gitti; tek tük çok geç kalan sipariş bu sayıyı bozmaz.",
    birim: "gun", iyiYon: "azalis", kaynak: { dosya: `${R}/order-leadtime.report.service.ts`, alan: "OrderLeadTimeReport.fullClose.medianDays" } },
  { kimlik: "termin.dokuzdaDokuzGun", ad: "Geç kalanlar dahil teslim süresi",
    aciklama: "10 siparişten 9'u bu kadar gün içinde tamamen gitti; en yavaş siparişlerin ne kadar beklettiğini gösterir.",
    birim: "gun", iyiYon: "azalis", kaynak: { dosya: `${R}/order-leadtime.report.service.ts`, alan: "OrderLeadTimeReport.fullClose.p90Days" } },

  // ── VAZGEÇİLEN İŞ (tek iptal oranı + iade) ────────────────────────────────
  { kimlik: "siparis.iptalOrani", ad: "İptal oranı",
    aciklama: "Dönemde iptal edilen siparişlerin, aynı dönemde açılan siparişlere oranı; iptal, siparişin alındığı aya değil iptal edildiği aya yazılır.",
    birim: "yuzde", iyiYon: "azalis", kaynak: { dosya: `${R}/order-cancellation.report.service.ts`, alan: "OrderCancellationSummary.cancelRatePct" } },
  { kimlik: "iade.oran", ad: "İade oranı",
    aciklama: "Dönemde iade gelen metrenin, aynı dönemde sevk edilen metreye oranı; sevk rakamı iade düşülmeden alınır.",
    birim: "yuzde", iyiYon: "azalis", kaynak: { dosya: `${R}/return-scorecard.report.service.ts`, alan: "ReturnScorecardSummary.returnPct" } },

  // ── FİRE (tek tanım, üç kaynak) ───────────────────────────────────────────
  // Üç kaynağın toplamı: temel rapor `kayip.temel.ts` aşağıdaki üç alanı toplar (ölçülmeyen kaynak düşer, 0 sayılmaz).
  { kimlik: "fire.metre", ad: "Fire",
    aciklama: "Satılabilir olmaktan çıkan kumaş metresi. Üç kaynaktan gelir: hurdaya ayrılan top, fasona gidenle dönen arasındaki fark (yalnız işi kapanmış partiler) ve leventten beklenenle dokunan arasındaki fark (yalnız biten levent). Her kaynağın oranı kendi satırında verilir; kaynaklar farklı şeylere oranlandığı için toplam oran verilmez.",
    birim: "metre", iyiYon: "azalis", kaynak: { dosya: `${R}/temel/kayip.temel.ts`, alan: "totalLoss" } },
  { kimlik: "fire.hurdaMetre", ad: "Hurda",
    aciklama: "Dönemde hurdaya ayrılan topların metresi; oranı aynı dönemde üretilen metreye göre verilir.",
    birim: "metre", iyiYon: "azalis", kaynak: { dosya: `${R}/scrap-scorecard.report.service.ts`, alan: "ScrapScorecardSummary.scrapQty" } },
  { kimlik: "fire.fasonMetre", ad: "Fason farkı",
    aciklama: "Fasona gönderilen ile geri dönen metre arasındaki fark; yalnız işi kapanmış partiler sayılır, oranı gönderilen metreye göre verilir.",
    birim: "metre", iyiYon: "azalis", kaynak: { dosya: `${R}/subcontract-scorecard.report.service.ts`, alan: "SubcontractScorecard.summary.fireQty" } },
  { kimlik: "fire.leventMetre", ad: "Levent farkı",
    aciklama: "Biten leventlerden beklenen kumaş ile gerçekten dokunan kumaş arasındaki fark; oranı beklenen metreye göre verilir.",
    birim: "metre", iyiYon: "azalis", kaynak: { dosya: `${R}/levent-sonucu.report.service.ts`, alan: "BeamResultSummary.fireM" } },

  // ── KALİTE ────────────────────────────────────────────────────────────────
  { kimlik: "kalite.birinciYuzde", ad: "Birinci kalite payı",
    aciklama: "Dönemde çıkan kumaşın, metre olarak ne kadarının birinci kalite olduğu; iptal edilmiş ya da artık var olmayan toplar sayılmaz, hurdaya ayrılanlar sayılır.",
    birim: "yuzde", iyiYon: "artis", kaynak: { dosya: `${R}/quality-scorecard.report.service.ts`, alan: "QualityScorecardSummary.topGrade.pct" } },
  // Fire Karnesi'nin EK alanı (R0-RAPB): tespit adedi üretilen metreye bölünür; üretim yoksa null.
  { kimlik: "kalite.binMetredeHata", ad: "Bin metrede hata",
    aciklama: "Her 1.000 metre kumaşta bulunan hata sayısı; az ya da çok üretilen dönemleri aynı terazide tartmayı sağlar.",
    birim: "adet", iyiYon: "azalis", kaynak: { dosya: `${R}/scrap-scorecard.report.service.ts`, alan: "ScrapScorecardSummary.defectsPerThousandM" } },
  // R1-SEMKUP: Kalite temel raporunun yan sayısı (`kalite.bitenMetre`) ve oranın payı/paydası.
  { kimlik: "kalite.bitenMetre", ad: "Biten kumaş",
    aciklama: "Dönemde kalite kararı verilen kumaş metresi; iptal edilen ya da başka toplara bölünerek tükenen toplar sayılmaz, hurdaya ayrılanlar sayılır.",
    birim: "metre", iyiYon: "artis", kaynak: { dosya: `${R}/quality-scorecard.report.service.ts`, alan: "QualityScorecardSummary.totalQty" } },
  { kimlik: "kalite.birinciMetre", ad: "Birinci kalite kumaş",
    aciklama: "Dönemde biten kumaşın birinci kalite çıkan metresi.",
    birim: "metre", iyiYon: "artis", kaynak: { dosya: `${R}/quality-scorecard.report.service.ts`, alan: "QualityScorecardSummary.topGrade.qty" } },
  { kimlik: "kalite.hataAdedi", ad: "Bulunan hata",
    aciklama: "Dönemde kumaşta bulunan hata sayısı; sahada ve muayenede bulunanlar birlikte sayılır, her hata bulunduğu güne yazılır.",
    birim: "adet", iyiYon: "azalis", kaynak: { dosya: `${R}/scrap-scorecard.report.service.ts`, alan: "ScrapScorecardSummary.defectsDetected" } },
  // K4P-RAPOR: 4 puan muayene küpü; kaynak Muayeneler ekranının özet şeridi (`listInspections` summary).
  { kimlik: "kalite.muayeneAdedi", ad: "Muayene edilen top",
    aciklama: "Dönemde 4 puan muayenesi yapılan top sayısı; her topun geçerli muayenesi sayılır, düzeltilen ya da iptal edilen muayene sayılmaz.",
    birim: "adet", iyiYon: "notr", kaynak: { dosya: "src/services/quality-inspection-query.service.ts", alan: "listInspections.summary.total" } },
  { kimlik: "kalite.muayeneOrtalamaPuan", ad: "Ortalama muayene puanı",
    aciklama: "Muayene edilen toplarda 100 metrekareye düşen ortalama hata puanı; düşük olması iyidir. Eni bilinmeyen toplar ortalamaya girmez.",
    birim: "adet", iyiYon: "azalis", kaynak: { dosya: "src/services/quality-inspection-query.service.ts", alan: "listInspections.summary.avgPointsPer100M2" } },
  { kimlik: "kalite.muayenePuanToplami", ad: "Muayene puanlarının toplamı",
    aciklama: "Ortalama muayene puanının hesap parçası: toplarda 100 metrekareye düşen puanların toplamı; tek başına yorumlanmaz.",
    birim: "adet", iyiYon: "notr", kaynak: null },
  { kimlik: "kalite.puanliMuayeneAdedi", ad: "Puanı hesaplanan muayene",
    aciklama: "Eni bilindiği için puanı hesaplanabilen muayene sayısı; ortalama muayene puanı bu sayıya bölünür.",
    birim: "adet", iyiYon: "notr", kaynak: null },

  // ── ÜRETİM ve STOK ────────────────────────────────────────────────────────
  { kimlik: "uretim.bekleyenTop", ad: "Bekleyen top",
    aciklama: "Şu an istasyonlarda işlenmeyi bekleyen top sayısı; tarih aralığından bağımsız, bugünün durumudur.",
    birim: "adet", iyiYon: "azalis", kaynak: { dosya: `${R}/wip-scorecard.report.service.ts`, alan: "WipScorecard.summary.waitingCount" } },
  // Nerede Takıldı'nın EK alanı (R0-RAPB): dönemde kapanan hareketlerin metresi (bekleyenle aynı kolon).
  { kimlik: "uretim.gecenMetre", ad: "İstasyondan geçen",
    aciklama: "Dönemde istasyonlardaki işi bitip bir sonraki adıma ilerleyen kumaş metresi.",
    birim: "metre", iyiYon: "artis", kaynak: { dosya: `${R}/wip-scorecard.report.service.ts`, alan: "WipScorecard.summary.passedQty" } },
  { kimlik: "uretim.gecenTop", ad: "İstasyondan geçen top",
    aciklama: "Dönemde istasyonlardaki işi bitip bir sonraki adıma ilerleyen top sayısı.",
    birim: "adet", iyiYon: "artis", kaynak: { dosya: `${R}/wip-scorecard.report.service.ts`, alan: "WipScorecard.summary.passedCount" } },
  { kimlik: "stok.oluMetre", ad: "Ölü stok",
    aciklama: "90 günden uzun süredir depoda bekleyen ve hiçbir siparişe ayrılmamış bitmiş kumaş metresi.",
    birim: "metre", iyiYon: "azalis", kaynak: { dosya: `${R}/stock-scorecard.report.service.ts`, alan: "StockScorecard.summary.deadQty" } },
  { kimlik: "stok.yasiBilinmeyenMetre", ad: "Yaşı bilinmeyen stok",
    aciklama: "Depoya ne zaman girdiği bilinmeyen kumaş metresi; yaş gruplarına dağıtılmaz, toplam stokta sayılır.",
    birim: "metre", iyiYon: "azalis", kaynak: { dosya: `${R}/stock-scorecard.report.service.ts`, alan: "StockScorecard.summary.unagedQty" } },
  { kimlik: "stok.bitmisMetre", ad: "Depodaki bitmiş kumaş",
    aciklama: "Şu an depoda duran bitmiş kumaş metresi; tarih aralığından bağımsız, bugünün durumudur.",
    birim: "metre", iyiYon: "notr", kaynak: { dosya: `${R}/stock-scorecard.report.service.ts`, alan: "StockScorecard.summary.finishedQty" } },
  { kimlik: "iplik.ihtiyacKg", ad: "İplik ihtiyacı",
    aciklama: "Açık siparişlerin kalan kumaşını dokumak için gereken çözgü ve atkı ipliği kilogramı; bugünün durumudur.",
    birim: "kg", iyiYon: "notr", kaynak: { dosya: `${R}/yarn-need.report.service.ts`, alan: "YarnNeedSummary.ihtiyacKg" } },
  { kimlik: "iplik.eksikKg", ad: "Eksik iplik",
    aciklama: "İhtiyaçtan serbest stok, açık alış ve hazır leventler düşüldükten sonra kalan, tedarik edilmesi gereken iplik kilogramı.",
    birim: "kg", iyiYon: "azalis", kaynak: { dosya: `${R}/yarn-need.report.service.ts`, alan: "YarnNeedSummary.eksikKg" } },
  { kimlik: "fason.ortalamaDonusGun", ad: "Ortalama dönüş süresi",
    aciklama: "Dönemde işi kapanan fason partilerinin gönderildiği günden döndüğü güne kadar geçen ortalama gün.",
    birim: "gun", iyiYon: "azalis", kaynak: { dosya: `${R}/subcontract-scorecard.report.service.ts`, alan: "SubcontractScorecard.summary.avgTurnaroundDays" } },
  { kimlik: "fason.gonderilenMetre", ad: "Fasona giden",
    aciklama: "Dönemde fasona gönderilen kumaş metresi.",
    birim: "metre", iyiYon: "notr", kaynak: { dosya: `${R}/subcontract-scorecard.report.service.ts`, alan: "SubcontractScorecard.summary.dispatchedQty" } },
  { kimlik: "fason.bekleyenMetre", ad: "Fasonda bekleyen",
    aciklama: "Fasona gönderilmiş ama henüz dönmemiş kumaş metresi.",
    birim: "metre", iyiYon: "azalis", kaynak: { dosya: `${R}/subcontract-scorecard.report.service.ts`, alan: "SubcontractScorecard.summary.openQty" } },
  // null (R0-RAPB ölçtü, K-FASON): söz verilen dönüş günü HİÇBİR tabloda yok (`SubcontractorDispatch`te alan
  // yok) — oran türetilemez; temel rapor bu yüzden ortalama dönüş süresini ana sayı yapar. Alan ayrı dilim.
  { kimlik: "fason.zamanindaDonusYuzde", ad: "Fasondan zamanında dönüş",
    aciklama: "Fasona giden partilerden söz verilen günde ya da daha önce dönenlerin payı.",
    birim: "yuzde", iyiYon: "artis", kaynak: null },

  // ── DOKUMA ────────────────────────────────────────────────────────────────
  { kimlik: "dokuma.randimanYuzde", ad: "Randıman",
    aciklama: "Tezgahların, çalışması planlanan sürede dokuyabileceği kumaşın ne kadarını dokuduğu; düşüşün nedeni duruş mu yavaş çalışma mı, açıklamada ayrıca söylenir.",
    birim: "yuzde", iyiYon: "artis", kaynak: { dosya: `${R}/dokuma.report.service.ts`, alan: "EfficiencyReport.toplam.effectivenessPct" } },
  // Kaynak saniye verir (`stopSec`); gösterim dakika.
  { kimlik: "dokuma.durusSure", ad: "Duruş süresi",
    aciklama: "Tezgahların dönem içinde durduğu toplam süre.",
    birim: "dakika", iyiYon: "azalis", kaynak: { dosya: `${R}/dokuma.report.service.ts`, alan: "ParetoReport.toplam.stopSec" } },
  { kimlik: "dokuma.durusSayisi", ad: "Duruş sayısı",
    aciklama: "Tezgahların dönem içinde kaç kez durduğu; birkaç dakikalık kısa duruşlar da sayılır.",
    birim: "adet", iyiYon: "azalis", kaynak: { dosya: `${R}/dokuma.report.service.ts`, alan: "ParetoReport.toplam.stopCount" } },
  // Kaynak saniye verir (`ustlenmeOrtSn`); gösterim dakika.
  { kimlik: "dokuma.mudahaleDakika", ad: "Müdahale süresi",
    aciklama: "Tezgah alarmı çaldıktan sonra birinin işi üstlenmesine kadar geçen ortalama süre.",
    birim: "dakika", iyiYon: "azalis", kaynak: { dosya: `${R}/alarm-response.report.service.ts`, alan: "AlarmResponseCell.ustlenmeOrtSn" } },
  // Levent Sonucu oranı alan olarak vermez (`firePct` farkın oranıdır); R0-RAPC satırlarından türetir.
  { kimlik: "levent.dengeYuzde", ad: "Levent dengesi",
    aciklama: "Biten leventlerden beklenen kumaşın yüzde kaçının gerçekten dokunduğu; ölçülemeyen levent orana girmez, ayrıca sayılır.",
    birim: "yuzde", iyiYon: "artis", kaynak: { dosya: `${R}/temel/levent-dengesi.temel.ts`, alan: "BeamBalance.balancePct" } },

  // ── PARA ──────────────────────────────────────────────────────────────────
  { kimlik: "alacak.vadesiGecmis", ad: "Vadesi geçmiş alacak",
    aciklama: "Vadesi bugün itibarıyla geçmiş, henüz tahsil edilmemiş alacak; her para birimi ayrı.",
    birim: "para", iyiYon: "azalis", kaynak: { dosya: "src/services/reports/finance-aging.report.ts", alan: "AgingCurrencyBlock.totals.overdueTotal" } },
  { kimlik: "alacak.acikToplam", ad: "Açık alacak",
    aciklama: "Henüz tahsil edilmemiş alacağın tamamı, vadesi gelmemiş olanlar dahil; her para birimi ayrı.",
    birim: "para", iyiYon: "notr", kaynak: { dosya: "src/services/reports/finance-aging.report.ts", alan: "AgingCurrencyBlock.totals.openTotal" } },
  { kimlik: "cek.yaklasanVade", ad: "Vadesi yaklaşan çek",
    aciklama: "Önümüzdeki günlerde vadesi gelecek, portföyde ya da bankada bekleyen çeklerin tutarı; her para birimi ayrı.",
    birim: "para", iyiYon: "notr", kaynak: { dosya: "src/services/cheque.service.ts", alan: "ChequeDueSummary.buckets" } },
] as const;

/** Kimlik → tanım. Bilinmeyen kimlik `undefined` (çağıran fail-closed davranır). */
export const OLCU_BY_KIMLIK = new Map(OLCU_TANIMLARI.map((o) => [o.kimlik, o]));
