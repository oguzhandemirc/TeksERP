// =============================================================================
// İPTALİ GERİ ALMA (storno'nun storno'su) — uygunluk yüklemi, TEK KAYNAK
// =============================================================================
// `inventory.softDelete` bir topu `CANCELLED`'a çeker ve açık hareketlerini
// **`qtyOut = 0`** ile kapatır — yani "mal bu istasyondan HİÇ geçmedi" (storno).
// Bu semantik zaten geri alınabilir olacak şekilde seçilmişti; eksik olan tek şey
// geri dönüş yoluydu. Yol olmayınca saha kendi çözümünü buldu ve o çözüm yanlıştı:
// aynı fiziksel top için İKİNCİ bir kayıt + ikinci bir barkod açmak (2026-08-05,
// T050826H0033 öldü → T050826H0072 doğdu → topun üstünde iki etiket).
//
// ⚠️ KAPSAM BİLİNÇLİ OLARAK DAR: yalnız "hiç yaşamamış" kayıt geri alınır.
// Hareket görmüş / kesilmiş / partiye girmiş / çuvallanmış bir topun iptalini geri
// almak, kapatılmış hareketleri ve yeniden hesaplanmış adım durumlarını da geri
// sarmayı gerektirir — o AYRI ve çok daha riskli bir iştir. Emsal: elle eklenen
// topun geri alınması (`TamburUndoService` MANUAL modu) da tam bu daralmayı yapar.
//
// ⚠️ SEBEP HER ZAMAN SÖYLENİR. Kapsam dışıysa mesaj operatöre ne yapacağını da
// söyler; sessiz 409, yanlış işlem yaptırmaktan sonra en kötüsüdür. Bu dosya saf
// tutuldu (DB yok) ki yüklem kilit/sorgu kurmadan birim testlenebilsin —
// `duplicate-guard.helper` emsali.
//
// ⚠️⚠️ `movementCount > 0` KURALI GÖRÜNENDEN FAZLA İŞ YAPIYOR (2026-08-15).
// `WorkOrderStep.status` türetilen bir alandır ve `recomputeStepStatus` onu topun
// statüsünden hesaplar — AÇIK hareketten de, KAPALI hareketten de. Yani bir topun
// statüsünü değiştirmek, o topun geçtiği adımların (ve aynı iş emrindeki kardeş
// adımların) değerini de değiştirir. `softDelete`/`hardDelete` bu yüzden iptalden
// sonra kapsamı `collectRollStepScopeTx` ile çözüp recompute koşuyor.
// `restoreCancelledRoll` bunu YAPMIYOR ve YAPMASI GEREKMİYOR — çünkü bu guard
// hareketi olan topu zaten reddediyor, hareketsiz top ise hiçbir adım sayacına
// girmiyor. Guard gevşetilirse (örn. "süpervizör hareketli topu da geri alsın")
// adım durumları SESSİZCE bayat kalır: `restoreCancelledRoll` tx bile açmıyor.
// O gün recompute EKLENMEK ZORUNDA — reçete `inventory.restoreCancelledRoll`
// docstring'inde yazılı.
// =============================================================================

import { RollStatus } from "@prisma/client";
import { TAMBUR_UNDO_CANCEL_CODE } from "../../constants/reason-presets";

/**
 * Geri alınabilirlik kararı için gereken TÜM sinyaller. Çağıran bunları tek
 * sorguda toplar; yüklem hiçbir şey okumaz.
 */
export interface RollRestoreSignals {
  status: RollStatus;
  /** İptalden önceki statü (`preCancelStatus`). NULL = bu karardan önceki iptal. */
  preCancelStatus: RollStatus | null;
  batchId: string | null;
  sackId: string | null;
  shipmentId: string | null;
  currentStepId: string | null;
  /** TÜM hareketler (açık + kapalı). Kapalı olanlar da "bu top üretime girdi" der. */
  movementCount: number;
  /** İstasyon işlem log'u satırları (kurşun/QC2/tambur…). */
  operationCount: number;
  /** Bu toptan doğmuş çocuk toplar (kesim). */
  childCount: number;
  /** Fason sevk kalemi (iptal edilmiş sevkler dahil — iz varsa dokunma). */
  dispatchItemCount: number;
  /** Kartela sevk kalemi. */
  kartelaItemCount: number;
  /**
   * İptalin SEBEP KODU. Sistem kaynaklı iptaller (bugün: Tambur geri alması)
   * buradan tanınır — kararın izi kaydın KENDİ satırında.
   */
  cancelReasonCode: string | null;
}

/**
 * Geri alma engeli — yoksa `null`. Ekran ve uç AYNI fonksiyonu çağırır: kopyalanırsa
 * arayüz "Geri Al" butonunu çizerken uç 409 döner ve operatör çıkmaza girer
 * (`resolveUndoBlockReason` / `resolveBypassBlockReason` ile aynı sözleşme).
 */
export function resolveRollRestoreBlockReason(s: RollRestoreSignals): string | null {
  if (s.status !== RollStatus.CANCELLED) {
    return "Bu top iptal edilmemiş — geri alınacak bir şey yok.";
  }
  if (s.movementCount > 0) {
    return (
      "Bu top bir istasyona girmişti (hareket kaydı var) — iptali buradan geri alınamaz. " +
      "Süpervizöre başvurun."
    );
  }
  if (s.operationCount > 0) {
    return "Bu topa istasyon işlemi işlenmiş — iptali buradan geri alınamaz. Süpervizöre başvurun.";
  }
  if (s.childCount > 0) {
    return "Bu top kesilmiş (alt topları var) — iptali buradan geri alınamaz. Süpervizöre başvurun.";
  }
  // ⚠️ `batchId` ENGELİ 2026-08-25'te KALDIRILDI (kullanıcı kararı: "SAP'taki gibi yap").
  //
  // Sektör ölçütü şudur: bir mal hareketinin iptali, o maldan SONRA hareket
  // olduysa / mal tüketildiyse / sevk edildiyse reddedilir. SAP'ta parti
  // (Charge/Batch) bir ANA VERİ nesnesidir — bir belgenin partili olması ters
  // kaydı engellemez; engelleyen şey partinin sonradan hareket etmesi ya da
  // tüketilmesidir ve onu yukarıdaki kurallar zaten yakalıyor.
  //
  // Ölçüm (canlı kopya, 2026-08-25): 231 iptalin 86'sı YALNIZ bu kural yüzünden
  // kilitliydi ve **85'i Tambur çıktısıydı** — sıfır hareket, sıfır istasyon
  // işlemi, sıfır çocuk. Parti kaydı onların üretimden geçtiğini değil, hangi
  // grupta DOĞDUKLARINI söylüyordu.
  //
  // Kuralın gerekçesi olarak gösterilen adım-durumu riski de burada yok:
  // `recomputeStepStatus` partiye HİÇ BAKMAZ (üç sayacı da hareket üzerinden
  // çalışır) → hareketsiz bir topu diriltmek hiçbir adım sayacını değiştiremez.
  // O riski taşıyan tek kural `movementCount > 0` ve o BUNDAN ÖNCE kontrol
  // ediliyor. Geri koymadan önce bu paragrafı çürüt.
  if (s.currentStepId) {
    return "Bu top bir iş emri adımına bağlı — iptali buradan geri alınamaz.";
  }
  if (s.sackId || s.shipmentId) {
    return "Bu top bir çuvala/sevkiyata bağlı — iptali buradan geri alınamaz.";
  }
  if (s.dispatchItemCount > 0 || s.kartelaItemCount > 0) {
    return "Bu top bir fason/kartela sevkine girmiş — iptali buradan geri alınamaz.";
  }
  // ⚠️ ALTINCI SİNYAL (2026-08-29 / BULGU-T1-011): iptal bir GERİ ALMANIN ürünü
  // mü? Tambur geri alması parçayı iptal ederken metrajını KAYNAK TOPA İADE
  // eder; parça diriltilirse aynı metraj iki yerde sayılır ve hiçbir ekranda
  // uyarı çıkmaz — fark ancak fiziksel sayımda görülür. Yukarıdaki beş sinyal
  // bunu göremiyordu: böyle bir parçanın hareketi, istasyon işlemi, çocuğu,
  // çuvalı, sevki YOKTUR (hepsi 0) — tam da "hiç yaşamamış" gibi görünür.
  if (s.cancelReasonCode === TAMBUR_UNDO_CANCEL_CODE) {
    return (
      "Bu parça bir Tambur geri almasıyla iptal edilmiş ve metrajı kaynak topa " +
      "iade edilmiş — geri alınamaz. Aynı metrajı yeniden elde etmek için kaynak " +
      "topu tekrar kesin."
    );
  }
  return null;
}

/**
 * Geri almanın döneceği raf. `preShipStatus` emsalinin aynısı: körlemesine `STOCK`
 * yazmak 2. kalite (`A1_STOCK`) ya da bitmiş depo (`WAREHOUSE`) topunu sessizce
 * yanlış rafa koyardı.
 *
 * ⚠️ Beyaz liste DAR ve bu bilinçli: kapsam guard'ı zaten hareketsiz/partisiz topa
 * daraltıyor, yani buraya ancak serbest envanter statüleri gelebilir. Tanımadığı
 * bir değer gelirse (eski kayıt, veri tuhaflığı) `STOCK`'a düşer — ham stok, bir
 * topun girebileceği en KISITSIZ raftır; oraya düşmek "satılabilir depo malı" diye
 * işaretlemekten güvenlidir.
 */
export function resolveRestoreTargetStatus(preCancelStatus: RollStatus | null): RollStatus {
  switch (preCancelStatus) {
    case RollStatus.WAREHOUSE:
    case RollStatus.A1_STOCK:
    case RollStatus.STOCK:
      return preCancelStatus;
    default:
      return RollStatus.STOCK;
  }
}
