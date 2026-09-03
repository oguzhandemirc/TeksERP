// =============================================================================
// SEVKİYAT ↔ SİPARİŞ BAĞI — TEK KARAR NOKTASI (`shipping.orderRequirement`)
// =============================================================================
// ÜÇ REJİM ve üçü de AYNI iki soruyu cevaplar: "bu sevkiyat kurulabilir mi" ve
// "kullanıcıya ne söylenir".
//
//   off   → siparişsizlik SESSİZ. ⚠️ YALNIZ O uyarı susar: `previewCreateShipment`
//           `warnings[]` dizisi ÜÇ FARKLI soru taşıyor (siparişsizlik · seçili
//           siparişlere yazılamayan fazla mal · başka açık sevkiyatta bekleyen
//           mükerrer tahsis). Diziyi topluca susturmak, mükerrer sevk uyarısını
//           da öldürürdü — o kırmızı tonlu uyarı bambaşka bir arızanın sinyali.
//   warn  → BUGÜNKÜ davranış (varsayılan): sevkiyat kurulur, yanıt `warnings`
//           taşır. `orderless: true` beyanı uyarıyı susturur (niyet BEYAN
//           edilmiştir; kural "sipariş seç" değil "ne yaptığını söyle"dir).
//   block → sipariş bağı ZORUNLU → 400 `ORDER_REQUIRED`. `orderless: true` yine
//           MUAF: numune/fazla mal sevki meşru bir iştir ve `block` rejiminin
//           amacı KAZARA siparişsiz sevki durdurmaktır, bilinçli olanı değil.
//
// ⚠️ KAPI YALNIZ KURULUMDA. `dispatchShipment`e KONMAZ ve bu bilinçli bir
// boşluktur: bayrak `block`a çevrildiğinde ZATEN KURULMUŞ PLANNED sevkiyatlar
// siparişsizdir (Sevk Kapısı rejimi). Çıkış kapısına guard konsaydı o mallar
// bina içinde kilitlenirdi — tasarım §11 "geçmişe etki eden bayrak yok".
// Sonuç: `block` rejiminde de bir süre siparişsiz sevkiyat ÇIKABİLİR; kabul
// edilmiş bir boşluktur.
//
// ⚠️ FASON DOĞRUDAN SEVK **KAPSAMDA** (2026-09-03). Mal fabrikaya hiç girmeden
// fasondan müşteriye çıkar ve sevkiyat servisinden GEÇMEZ — `createShipment`e
// konan kapı oraya uzanmıyordu ve `block` rejimi bu yoldan sessizce
// atlatılabiliyordu (canlı ölçüm: 110 m, 0 sipariş bağı, 200). Kapı artık
// `subcontractor.service.executeDirectShip` içinde, tahsis doğrulamasından
// SONRA / tx'ten ÖNCE; kaçış kapısı aynı `orderless` beyanıdır. Bu yüzden
// yukarıdaki "yalnız kurulumda" cümlesi ÜÇ kurulum yolunu kapsar: normal
// sevkiyat · Hızlı Sevk · fason doğrudan sevk.
//
// ⚠️ EBEVEYNSİZ — Sevkiyat & Depo çekirdek bloktur, arkasında modül anahtarı
// YOK. §3.6'nın tek-resolver kuralı (etkin = modülAçık && bayrak) BURAYA
// UYGULANMAZ; mekanik uygulayan biri ölü bir `modulAcik` sabiti icat eder.
//
// ⚠️ KURAL "EN AZ BİR SİPARİŞ SEÇİLDİ"dir, "en az bir metre TAHSİS EDİLDİ"
// DEĞİL. Bugünkü kod seçili siparişe 0 m yazabiliyor (önizlemenin fazlalık
// uyarısı tam bunu ölçer) ve tahsis hesabını tx öncesine taşımak hem pahalı hem
// yarışa açıktır. Bilinçli kabul: kapı niyeti ölçer, sonucu değil.
// =============================================================================
import { AppError } from "../../utils/app-error";
import {
  readShippingOrderRequirement,
  type ShipmentOrderRequirement,
} from "../system-setting.service";

/**
 * Etkin rejim. DÜZ okuyucu (ebeveyn modül YOK — yukarıdaki gerekçe).
 * Enforcement yolunda ÖNBELLEKSİZ çağrılır: bayrak aynı zamanda acil geri
 * dönüş anahtarıdır, kapatıldığı an geçerli olmalıdır.
 */
export async function resolveOrderRequirement(): Promise<ShipmentOrderRequirement> {
  return readShippingOrderRequirement();
}

/**
 * Sevkiyat KURULUM kapısı. `block` + sipariş yok + beyan yok → 400.
 *
 * `mode` DIŞARIDAN geçirilir: çağıran zaten bir kez okumuştur (uyarı metnini de
 * aynı değerden üretecek) ve iki ayrı okuma, aradaki milisaniyede değişen bir
 * bayrakta "engelledi ama uyarmadı" gibi tutarsız bir yanıt üretebilirdi.
 */
export function assertOrderLinkAllowed(
  mode: ShipmentOrderRequirement,
  p: { orderIds: string[]; orderless?: boolean },
): void {
  if (mode !== "block") return;
  if (p.orderIds.length > 0) return;
  if (p.orderless === true) return;
  throw AppError.badRequest(
    "Bu kurulumda sevkiyat bir siparişe bağlanmalı. Siparişi seçin — ya da mal " +
      'gerçekten siparişsiz gidiyorsa (numune/fazla mal) "Siparişsiz devam et" ' +
      "kutusunu işaretleyin.",
    { code: "ORDER_REQUIRED" },
  );
}

/**
 * Siparişsizlik UYARISI — `warn` rejiminde metin, diğerlerinde `null`.
 *
 * ⚠️ TEK KAYNAK: `createShipment` ve `createShipmentFromRolls` (Hızlı Sevk) İKİSİ
 * de buradan besleniyor. Ayrışması 2026-09-03'e kadar GERÇEKTİ — Hızlı Sevk hiç
 * uyarı üretmiyordu, yani "varsayılan = bugünkü davranış" cümlesi uygulamada
 * "uyarının bir kısmı hiç görünmüyor" demekti.
 *
 * `block` rejiminde `null` döner ve bu doğru: oraya gelindiyse ya sipariş
 * seçilmiştir ya niyet beyan edilmiştir — ikisinde de söylenecek bir şey yok.
 */
export function orderlessWarning(
  mode: ShipmentOrderRequirement,
  p: { orderIds: string[]; orderless?: boolean },
): string | null {
  if (mode !== "warn") return null;
  if (p.orderIds.length > 0) return null;
  if (p.orderless === true) return null;
  return (
    "Bu sevkiyat hiçbir siparişe yazılmadı — mal sipariş defterine işlenmedi ve " +
    "karşılanma/açık talep ekranlarında görünmez. Siparişe yazmak için sevkiyat " +
    'detayından "Siparişe Bağla" kullanın.'
  );
}
