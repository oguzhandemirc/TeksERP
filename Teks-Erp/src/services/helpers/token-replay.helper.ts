// =============================================================================
// İDEMPOTENCY'NİN DÖRDÜNCÜ DURUMU — "yazıldı ama SONRADAN İPTAL EDİLDİ"
// =============================================================================
// `clientToken` replay'inin üç durumu zaten her yerde ele alınıyordu:
//   ① hiç yazılmadı        → normal akış
//   ② yazıldı, aynı yük    → cached kaydı dön (idempotent başarı)
//   ③ yazıldı, BAŞKA yük   → 409 `CLIENT_TOKEN_COLLISION`
// Dördüncüsü kaçırılıyordu:
//   ④ yazıldı, sonra İPTAL EDİLDİ → cached kaydı dönmek YANLIŞ CEVAPTIR.
//
// Saha senaryosu (ölçüldü, T1-006): operatör tablette 100 m top girer, ağ zaman
// aşımına düşer; çevrimdışı kuyruk sözleşme gereği AYNI token'ı saklar. Bu arada
// süpervizör topu "mükerrer giriş" diye İPTAL eder. Kuyruk boşalırken aynı token
// gider → sunucu HTTP 200 + "Top zaten kayıtlı" der. Ama top CANCELLED'dır:
// hiçbir envanter sekmesinde görünmez, iş emrine bağlanamaz. 100 m kumaş sistemde
// hiç var olmamış olur ve HİÇBİR EKRANDA hata görünmediği için kimse aramaz.
// Tespit ancak fiziksel sayımda olur.
//
// Ölçüm (saha kopyası, 2026-08-29): `clientToken` taşıyan 227 iptal/fire top =
// 227 canlı "yeniden oynatılabilir" token. 20'sinin iptal sebebi tam da bu
// sınıftan: mükerrer giriş (8) · yanlış metraj (3) · yanlış ürün/renk (9).
//
// ⚠️ NEDEN TEK DOSYA: kural 2026-08-04'te `tambur-manual` için yazıldı ve orada
// doğruydu; ama diğer ÜÇ replay okuyucusuna hiç uğramadı (KK1 ham giriş · açık
// kumaş · sipariş). Kuralın kendisi kopyalanabilir olduğu sürece bir sonraki
// token'lı uç da onsuz doğar. Yeni bir `clientToken` replay yolu yazan herkes
// buradan geçmeli.
// =============================================================================

import { OrderStatus, Prisma, RollStatus, WeavingOrderStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/**
 * Token başına replay serileştirmesinin advisory uzayı (2 argümanlı form).
 * Envanter TEK KAYNAK: `period-guard.helper.ts` başlığı — bu uzay **8036**.
 */
export const CLIENT_TOKEN_LOCK_NS: number = 8036;

/**
 * Aynı `clientToken`lı eşzamanlı denemeleri serileştirir; token okumasından ÖNCE yapılır. Kilitsiz
 * ön-okumada kaybeden deneme token'ı kaçırıp kazananın commit'ini iş kuralında görür (ör. "zaten
 * aktif bordroda") ve replay yerine yanlış 409 döner.
 * 8036 alınıyorsa tx'in İLK ifadesidir. K′ yolları 8036 ALMAZ; token okumasını yolun mevcut kilidinin arkasına koyar.
 * `hashtext` çakışması iki farklı token'ı yalnız serileştirir, yanlış sonuç üretmez.
 */
export async function lockClientTokenTx(tx: Prisma.TransactionClient, clientToken: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLIENT_TOKEN_LOCK_NS}::int, hashtext(${clientToken}))`;
}

/**
 * Replay'i GEÇERSİZ kılan top statüleri.
 *
 * `CANCELLED` ("hiç olmamalıydı") ve `SCRAP` ("vardı, gitti") ayrı kararlardır
 * ve stok etkileri farklıdır — ama replay açısından ikisi de aynı şeyi söyler:
 * bu deneme KAPANMIŞTIR, cevabı "başarılı" olamaz.
 */
export const REPLAY_DEAD_ROLL_STATUSES: readonly RollStatus[] = [
  RollStatus.CANCELLED,
  RollStatus.SCRAP,
];

/**
 * Token'la bulunan top hâlâ canlı mı — değilse 409 `ENTRY_CANCELLED`.
 *
 * Mesaj operatöre NE YAPACAĞINI söyler: "tekrar dene" demek işe yaramaz (aynı
 * token aynı duvara çarpar), doğru hamle formu yeniden açmaktır — çünkü yeni
 * form yeni bir deneme kimliği üretir.
 */
export function assertRollReplayAlive(existing: {
  id: string;
  status: RollStatus;
  barcode: string | null;
}): void {
  if (!REPLAY_DEAD_ROLL_STATUSES.includes(existing.status)) return;
  throw AppError.conflict(
    "Bu kayıt daha önce oluşturulup iptal edilmiş — yeniden eklemek için formu " +
      "yeniden açın (aynı işlem tekrar gönderilemez).",
    { code: "ENTRY_CANCELLED", rollId: existing.id, barcode: existing.barcode },
  );
}

/**
 * Token'la bulunan sipariş hâlâ canlı mı — değilse 409 `ORDER_CANCELLED`.
 *
 * Topun ikizi ama ayrı bir kod: istemci "girişi yenile" ile "siparişi yeniden
 * oluştur" arasında farklı davranır ve tek koda indirmek o ayrımı siler.
 */
export function assertOrderReplayAlive(existing: {
  id: string;
  status: OrderStatus;
  orderNumber: string | null;
}): void {
  if (existing.status !== OrderStatus.CANCELLED) return;
  throw AppError.conflict(
    `Bu form daha önce kaydedilmiş ve sipariş İPTAL edilmiş (${existing.orderNumber ?? "-"}) — ` +
      "aynı gönderim tekrar edilemez. Yeni sipariş için formu kapatıp yeniden açın.",
    { code: "ORDER_CANCELLED", orderId: existing.id, orderNumber: existing.orderNumber },
  );
}

/**
 * Token'la bulunan dokuma işi hâlâ canlı mı — değilse 409 `WEAVING_ORDER_CANCELLED`.
 *
 * Üçüncü ayrı kod: dokuma işi ne top ne sipariştir; istemci "formu yeniden aç"
 * hamlesini kendi ekranında verir. COMPLETED canlı SAYILIR — kapanmış bir işi
 * yeniden göndermek "zaten var" cevabını hak eder, iptal edilmiş iş ise etmez.
 */
export function assertWeavingOrderReplayAlive(existing: {
  id: string;
  status: WeavingOrderStatus;
  weavingOrderNumber: string;
}): void {
  if (existing.status !== WeavingOrderStatus.CANCELLED) return;
  throw AppError.conflict(
    `Bu form daha önce kaydedilmiş ve dokuma işi İPTAL edilmiş (${existing.weavingOrderNumber}) — ` +
      "aynı gönderim tekrar edilemez. Yeni iş için formu kapatıp yeniden açın.",
    { code: "WEAVING_ORDER_CANCELLED", weavingOrderId: existing.id, weavingOrderNumber: existing.weavingOrderNumber },
  );
}

/**
 * Token'la bulunan tezgah koşumu hâlâ canlı mı — geri alınmışsa 409 `RUN_REVOKED`.
 *
 * Koşumun "ölü" hâli statü değil DAMGADIR (`revokedAt`); geri alınmış koşumu
 * "zaten açık" diye döndürmek, randımanın paydasından çıkarılmış bir kaydı
 * tablete canlıymış gibi gösterirdi.
 */
export function assertMachineRunReplayAlive(existing: {
  id: string;
  revokedAt: Date | null;
}): void {
  if (!existing.revokedAt) return;
  throw AppError.conflict(
    "Bu koşum daha önce açılıp geri alınmış — yeniden açmak için formu yeniden açın " +
      "(aynı gönderim tekrar edilemez).",
    { code: "RUN_REVOKED", runId: existing.id, revokedAt: existing.revokedAt },
  );
}

/** Token'la bulunan levent hâlâ canlı mı — sarımı iptal edilmişse 409 `WARP_BEAM_CANCELLED` (iptal edilen yeniden sarılmaz, yeni levent açılır). */
export function assertWarpBeamReplayAlive(existing: { id: string; beamNo: string; status: string }): void {
  if (existing.status !== "CANCELLED") return;
  throw AppError.conflict(`${existing.beamNo} sarımı iptal edilmiş — yeniden planlamak için formu yeniden açın (aynı gönderim tekrar edilemez).`, { code: "WARP_BEAM_CANCELLED", beamId: existing.id });
}

/** Token'la bulunan levent tüketimi geri alınmışsa (`CONSUMED_CANCEL` ters bağı) 409 `WARP_BEAM_CONSUME_REVOKED` — ölü hâl ters bağdır. */
export function assertWarpBeamConsumeReplayAlive(existing: { reversal: { id: string } | null }): void {
  if (!existing.reversal) return;
  throw AppError.conflict("Bu tüketim daha önce kaydedilip geri alınmış — yeniden kaydetmek için formu yeniden açın (aynı gönderim tekrar edilemez).", { code: "WARP_BEAM_CONSUME_REVOKED" });
}

/**
 * Token'la bulunan top indirmesi hâlâ canlı mı — geri alınmışsa 409 `DOFF_REVOKED`.
 * `assertMachineRunReplayAlive` ikizi: "ölü" hâl statü değil DAMGADIR.
 */
export function assertDoffReplayAlive(existing: { id: string; revokedAt: Date | null }): void {
  if (!existing.revokedAt) return;
  throw AppError.conflict(
    "Bu indirme daha önce kaydedilip geri alınmış — yeniden kaydetmek için formu yeniden açın " +
      "(aynı gönderim tekrar edilemez).",
    { code: "DOFF_REVOKED", doffEventId: existing.id, revokedAt: existing.revokedAt },
  );
}

/**
 * Token'la bulunan çek teslim bordrosu hâlâ geçerli mi — iptal edilmişse 409
 * `DELIVERY_NOTE_CANCELLED`. İptal edilmiş BRD'yi "düzenlendi" diye döndürmek,
 * kullanıcıya geçersiz bir belgenin numarasını imzalatırdı.
 */
export function assertChequeDeliveryNoteReplayAlive(existing: {
  id: string;
  docNo: string;
  status: string;
}): void {
  if (existing.status !== "CANCELLED") return;
  throw AppError.conflict(
    `Bu form daha önce kaydedilmiş ve bordro İPTAL edilmiş (${existing.docNo}) — aynı gönderim ` +
      "tekrar edilemez. Yeni bordro için formu kapatıp yeniden açın.",
    { code: "DELIVERY_NOTE_CANCELLED", noteId: existing.id, docNo: existing.docNo },
  );
}
