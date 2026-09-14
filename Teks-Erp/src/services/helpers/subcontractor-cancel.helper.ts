// =============================================================================
// FASON SEVK İPTALİ — uygunluk yüklemi, TEK KAYNAK
// =============================================================================
// Ekran ("bu sevk iptal edilebilir mi") ile uç (`SubcontractorService.cancel`) AYNI
// fonksiyonu çağırır. Kopyalansaydı klasik çıkmaz doğardı: arayüz "İptal Et" butonunu
// çizer, uç 409 verir ve operatör sebebi hiçbir yerde okuyamaz.
// Emsal sözleşme: `resolveUndoBlockReason` · `resolveRollRestoreBlockReason` ·
// `resolveBypassBlockReason`.
//
// Saf tutuldu (DB yok) ki yüklem sorgu kurmadan birim testlenebilsin —
// `duplicate-guard.helper` emsali.
// =============================================================================

/** Kararı vermek için gereken TÜM sinyaller. Çağıran bunları sorgudan toplar. */
export interface DispatchCancelSignals {
  /** Sevk zaten iptal edilmiş mi. */
  cancelledAt: Date | null;
  /** İptal EDİLMEMİŞ bir mal kabulün belge numarası (varsa) — yoksa null. */
  activeReceiptNo: string | null;
  /**
   * Bu sevkten fasondan MÜŞTERİYE yapılmış doğrudan sevkin (DSK) belge numarası.
   * Kısmi/alt küme sevkte `directShippedAt` damgalanmaz ve kalan top fasonda
   * kaldığı için `movedRollCount` de 0'dır — yani DSK'yı yalnız bu sinyal görür.
   */
  directShipmentNo: string | null;
  /**
   * Sevkten sonra taşınmış / statüsü değişmiş top sayısı (AT_SUBCONTRACTOR değil ya
   * da artık bu adımda değil). Savunma derinliği: kabul kontrolü çoğu durumu yakalar,
   * bu ise manuel müdahale / iptal-edilmiş-kabul-sonrası-taşıma gibi egzotik halleri.
   */
  movedRollCount: number;
  /**
   * F1: bu sevkten DÖNMÜŞ (açık `RETURNED_IN`) levent sayısı — LIFO: dönüş stornosu iptalden önce gelir.
   * Opsiyonel: top-yalnız yollar (önizleme dahil) 0 sayar.
   */
  returnedBeamCount?: number;
}

/**
 * İptal engeli — yoksa `null`.
 *
 * Sıra anlamlıdır: daha SOMUT olan önce sorulur. "Zaten iptal edilmiş" bir sevkte
 * kabul/taşıma mesajı vermek operatörü var olmayan bir işe yönlendirirdi.
 */
export function resolveDispatchCancelBlockReason(s: DispatchCancelSignals): string | null {
  if (s.cancelledAt) {
    return "Bu sevk zaten iptal edilmiş";
  }
  // Mal müşteriye çıktı: sevki iptal etmek "hiç sevk edilmedi" demektir ve
  // DSK ile tahsisleri iptal edilmiş bir sevke bağlı bırakır (fason karnesinde
  // teslim metresinin atfı da düşer). Geri alınamaz olan iptal değil, sevkin
  // kendisidir.
  if (s.directShipmentNo) {
    return (
      `Bu sevkten müşteriye doğrudan sevk yapılmış (${s.directShipmentNo}) — sevk iptal edilemez. ` +
      "Fasonda kalan mal için 'kalan gelmeyecek' kapaması ya da mal kabulü kullanın."
    );
  }
  if (s.activeReceiptNo) {
    return (
      `Mal kabul yapılmış sevk iptal edilemez (kabul: ${s.activeReceiptNo}). ` +
      "Önce kabul iptal edilmeli."
    );
  }
  if (s.movedRollCount > 0) {
    return (
      `${s.movedRollCount} top fason sevkten sonra taşınmış veya statüsü değişmiş — ` +
      "sevk iptal edilemez. Önce ilgili işlemleri (mal kabul / hareket) geri al."
    );
  }
  if ((s.returnedBeamCount ?? 0) > 0) {
    return (
      `${s.returnedBeamCount} levent bu sevkten dönmüş görünüyor — sevk iptal edilemez. ` +
      "Önce levent dönüşünü iptal edin."
    );
  }
  return null;
}
