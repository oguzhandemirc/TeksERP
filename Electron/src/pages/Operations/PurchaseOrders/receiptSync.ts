// =============================================================================
// MAL KABUL YANITINDAKİ SİPARİŞ UYARILARI
// =============================================================================
// Fiş uçları (`POST /goods-receipts`, `POST /goods-receipts/:id/lines`) yanıtta
// `purchaseOrder` alanıyla karşılanma senkronunun sonucunu döndürür. İçinde iki
// gerçek bilgi var ve İKİSİ DE YUTULMAMALI:
//
//   ① `overReceiptLines` — sipariş miktarı AŞILDI. Bu bir HATA DEĞİL, bir OLGU:
//      fiziksel olarak fazla mal gelir ve backend bilinçli olarak engellemez
//      (engelleseydi depocu geleni sisteme HİÇ giremez, mal kayıt dışı kalırdı).
//      Bu yüzden ton BİLGİdir, kırmızı hata değil.
//   ② `unmatchedItemIds` — fişte gelen ama SİPARİŞTE HİÇ OLMAYAN ürün. Mal
//      depoya girdi ve kaydı doğru; yanlış olan yalnız BAĞ. En olası sebep,
//      açılır listeden YANLIŞ siparişin seçilmiş olması. Sessizce düşürmek
//      karşılanma rakamını sebebi yazılmadan eksik bırakırdı.
//
// ⚠️ NEDEN AYRI (SAF) DOSYA: backend bu iki uyarıyı `message` kuyruğuna da
// ekliyor, ama fiş formu atlanan satır olduğunda `message` yerine kendi uyarı
// toast'ını basıyor — yani tam da bir şeylerin ters gittiği anda sipariş uyarısı
// EKRANA HİÇ ÇIKMIYOR. Uyarıyı bileşenin içindeki bir `if`e gömmek aynı hatayı
// bir sonraki yüzeyde tekrarlardı; kural burada, bekçisi `receiptSync.test.ts`.
//
// ⚠️ TOAST YETMEZ: toast birkaç saniyede kaybolur, fazla kabul ise fişi kapatan
// kişinin GÖRMESİ gereken bir bilgidir. Çağıran bunu kalıcı bir banda basmalı
// (`PurchaseOrderSyncBand`).
// =============================================================================

/** Backend `PurchaseOrderSyncResult`in JSON aynası (Decimal alanlar string düşer). */
export interface ReceiptPurchaseOrderSync {
  id: string;
  orderNo: string;
  status: "OPEN" | "PARTIAL" | "CLOSED" | "CANCELLED";
  /** Senkron gerçekten bir şey değiştirdi mi (idempotent tekrarda `false`). */
  changed: boolean;
  /** Sipariş miktarı aşılan kalemlerin sıra numaraları. */
  overReceiptLines: number[];
  /** Fişte gelen ama siparişte olmayan ürünlerin id'leri. */
  unmatchedItemIds: string[];
}

export type SyncNoticeTone = "info" | "warning" | "success";

export interface SyncNotice {
  tone: SyncNoticeTone;
  text: string;
}

/**
 * Yanıttaki senkron sonucunu ekranda basılacak cümlelere çevirir.
 *
 * Sipariş bağı yoksa (`null`) BOŞ dizi döner — fabrika/serbest mal kabul
 * akışında tek bayt fazladan çizilmez.
 */
export function receiptSyncNotices(sync: ReceiptPurchaseOrderSync | null | undefined): SyncNotice[] {
  if (!sync) return [];
  const out: SyncNotice[] = [];

  if (sync.overReceiptLines.length > 0) {
    out.push({
      // ⚠️ BİLGİ tonu: fazla mal gelmek bir hata değildir, bir olgudur. Kırmızı
      // basmak depocuya "yanlış yaptın" der ve düzeltmeye çalıştığı şey yoktur.
      tone: "info",
      text:
        `${sync.orderNo}: ${sync.overReceiptLines.length} kalemde sipariş miktarından FAZLA mal geldi ` +
        `(kalem ${sync.overReceiptLines.join(", ")}). Kayıt doğru — fazlalık siparişte fazla olarak görünür.`,
    });
  }

  if (sync.unmatchedItemIds.length > 0) {
    out.push({
      tone: "warning",
      text:
        `${sync.orderNo}: ${sync.unmatchedItemIds.length} ürün bu siparişte YOK. Mal depoya girdi ve ` +
        `kaydı doğru; ama bu ürünler siparişin karşılanmasına yazılamadı — yanlış sipariş seçilmiş olabilir.`,
    });
  }

  if (sync.status === "CLOSED" && sync.changed) {
    out.push({ tone: "success", text: `${sync.orderNo} tamamlandı — tüm kalemler karşılandı.` });
  }

  return out;
}

/** Tek satırlık toast metni — kalıcı bandın YERİNE geçmez, ona ek. */
export function receiptSyncSummary(sync: ReceiptPurchaseOrderSync | null | undefined): string {
  const notices = receiptSyncNotices(sync);
  return notices.map((n) => n.text).join(" ");
}
