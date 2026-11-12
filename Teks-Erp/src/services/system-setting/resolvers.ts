// =============================================================================
// TeksERP - System Setting / resolvers
// =============================================================================
// Modül-altı bayrakların ETKİN değer çözücüleri (resolve*).
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { readGoodsReceiptRequirePriceEnabled, readGoodsReceiptYarnQualityHoldEnabled, readProductionCancelReasonRequired, readPurchaseBlockOverReceiptEnabled } from "./cost-purchase";
import { DEFAULT_DOKUMA_ROLL_BIRTH, DEFAULT_KURSUN_METER_CAPTURE, type DokumaRollBirth, type KursunMeterCapture, type PackingGroupMode } from "./defaults";
import { readFinanceChequeNoteMovementEnabled, readFinanceEnabled, readFinanceInvoiceMatchTolerance } from "./finance";
import { readBatchShortNumberEnabled, readKursunBypassEnabled, readKursunMeterCapture } from "./kursun-batch";
import { readDevereBeamWeavingLinkRequired, readDevereEnabled, readDokumaEnabled, readDokumaOrderLineLinkRequired, readDokumaRollBirth, readDokumaRunWeavingOrderRequired, readDokumaWeavingWastePct, readDokumaYarnReservationEnabled, DEFAULT_DOKUMA_WEAVING_WASTE_PCT, readIplikEnabled, readProductionEnabled, readTicaretEnabled } from "./modules";
import { readPackingGroupMode, readPackingGroupsEnabled } from "./packing-loom";
import { readTamburOverQuantityEnabled, readTamburUndoFullSameDayOnly } from "./tambur-fason";


// =============================================================================
// §3.6 — MODÜL ALTI BAYRAKLARIN TEK RESOLVER'LARI (D8, 2026-09-03)
// =============================================================================
// SORUN: alt bayrak okuyucuları HAM değer döndürüyor ve enforcement noktaları
// onları doğrudan çağırıyordu → modül KAPALIYKEN de alt bayrağın kuralı
// koşmaya devam ediyordu. Ölçüldü (Dilim 2 keşfi): `requireProductionEnabled`
// kapısı olmayan route'lardan 443 kaynak dosyanın 350'sine hâlâ ulaşılıyor,
// yani "route kapısı zaten var" cümlesi bu bayraklar için YETERLİ DEĞİL.
//
// KALIP (emsal `resolveYarnOutOnInvoiceEnabled`): resolver okuyucu katmanında
// yaşar, gövde sırası ANLAMLIDIR — en dıştaki modül şalterinden içeri; kapalı
// modülde alt bayrağın DEĞERİ HİÇ SORULMAZ.
//
// ⚠️ `getFeatureFlags` HAM okuyucuyu çağırmaya DEVAM EDER (P1/K4 dersi): panel
// kendi yazdığı değeri geri okumak zorunda. Etkin değeri döndürseydik, modülü
// kapalı bir kurulumda kullanıcı bayrağı açar ve toggle kapalı görünmeye devam
// ederdi.
//
// ⚠️ KAPSAM: yalnız EBEVEYNİ OLAN ve modül kapalıyken çalışması ANLAMSIZ olan
// bayraklar. ÇEKİRDEK kalanlar (resolver YOK, gerekçeli): `kk1.*` (stok-giriş
// motoru) · sevkiyat/depo · ana veri · sipariş · sistem/kimlik/belge ·
// `quality.gradeRequiredEnabled` + `batch.autoCreateEnabled` (yukarıdaki iki
// okuyucunun notları) · `fason.*` ve `kartela.*` (ait oldukları `modul.fason` /
// `modul.kartela` ANAHTARLARI P1'de YAZILMADI — ebeveyni olmayan bayrağa
// resolver kurulamaz; anahtarlar doğduğunda buraya taşınırlar).
//
// ⚠️ `workorder.defaultPlanDurationDays` BİLİNÇLİ MUAF ve gerekçe TEK CÜMLE:
// bu bir SAYISAL VARSAYILAN (plan bitiş tarihi boş bırakılırsa +N gün), enforce
// edilen bir KURAL değil — resolver'ın işi "modül kapalıysa kuralı koşturma"dır
// ve burada koşacak kural yok ("modül kapalıyken hangi sayı" sorusunun anlamlı
// bir cevabı da yok: 0 gün planı bozar, null kolonun tipini bozar).
//
// ⚠️ "Router zaten kapılı" GEREKÇE DEĞİLDİR — ölçüldü ve YANLIŞ olurdu:
// `workorder.routes` `requireProductionEnabled` taşıyor ama tek tüketici
// `workorder.service`e kapısız yoldan da ulaşılıyor
// (`routes/order.routes.ts → services/order.service.ts → services/workorder.service.ts`;
// 80 route'un 70'i üretim kapısı taşımıyor, ulaşılan dosya 329). Bu bayrağın
// muafiyeti bu yüzden ULAŞILABİLİRLİĞE değil, bayrağın CİNSİNE dayanır.
// =============================================================================

/** Alış siparişi aşımı bloklansın mı — ETKİN değer (`ticaret && bayrak`). */
export async function resolvePurchaseBlockOverReceiptEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (!(await readTicaretEnabled(tx))) return false;
  return readPurchaseBlockOverReceiptEnabled(tx);
}

/** n irsaliye → 1 fatura: tolerans kontrolü ETKİN mi (`finance && bayrak`); eşikler ham okunur. */
export async function resolveInvoiceMatchToleranceEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  if (!(await readFinanceEnabled(tx))) return false;
  return readFinanceInvoiceMatchTolerance(tx);
}

/** Çek teslim bordrosu hareket fişi ETKİN mi (`finance && bayrak`). Ters yol bunu değil kaydın bağını okur. */
export async function resolveChequeNoteMovementEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  if (!(await readFinanceEnabled(tx))) return false;
  return readFinanceChequeNoteMovementEnabled(tx);
}

/** İptalde sebep zorunluluğu ETKİN mi (`üretim && bayrak`) — top iptal kapısı ve önizleme `reasonRequired` bunu okur. */
export async function resolveCancelReasonRequired(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  if (!(await readProductionEnabled(tx))) return false;
  return readProductionCancelReasonRequired(tx);
}

/** İplik lotu kalite bekletme ETKİN mi (`ticaret && iplik && bayrak`) — doğuş ON_HOLD + çıkış kapısı bunu okur. */
export async function resolveYarnQualityHoldEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  if (!(await readTicaretEnabled(tx))) return false;
  if (!(await readIplikEnabled(tx))) return false;
  return readGoodsReceiptYarnQualityHoldEnabled(tx);
}

/** Mal kabulde fiyat zorunlu mu — ETKİN değer (`ticaret && bayrak`). */
export async function resolveGoodsReceiptRequirePriceEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (!(await readTicaretEnabled(tx))) return false;
  return readGoodsReceiptRequirePriceEnabled(tx);
}

/** Kurşun bypass düzeni — ETKİN değer (`üretim && bayrak`). */
/** Z1 — levent sarımında iş bağı zorunlu mu — ETKİN değer (`ticaret && iplik && devere && bayrak`; devere modülü
 *  ticaret+ipliğe bağlıdır, `requireDevereEnabled` ile aynı ön koşul zinciri). */
export async function resolveBeamWeavingLinkRequired(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  if (!(await readTicaretEnabled(tx))) return false;
  if (!(await readIplikEnabled(tx))) return false;
  if (!(await readDevereEnabled(tx))) return false;
  return readDevereBeamWeavingLinkRequired(tx);
}

/** Z1 — koşumda iş zorunlu mu — ETKİN değer (`üretim && dokuma && bayrak`). */
export async function resolveRunWeavingOrderRequired(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  if (!(await readProductionEnabled(tx)) || !(await readDokumaEnabled(tx))) return false;
  return readDokumaRunWeavingOrderRequired(tx);
}

/**
 * Sevk partisi — paketleme grubunun ETKİN davranış modu: `packing.groupsEnabled`
 * kapalıyken daima `grup` (parti kolonları boş durur, ayar sessiz kalır). Parti moduna
 * bağlı altı ayarın enforcement noktaları ÖNCE bunu sorar. ⚠️ Adı `resolve*` DEĞİL:
 * ebeveyni bir MODÜL şalteri değil davranış bayrağıdır (`packing.groupsEnabled`),
 * §8b'nin modül-altı resolver tablosuna girmez.
 */
export async function effectivePackingGroupMode(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<PackingGroupMode> {
  if (!(await readPackingGroupsEnabled(tx))) return "grup";
  return readPackingGroupMode(tx);
}

/** Z1 — dokuma işinde sipariş satırı bağı zorunlu mu — ETKİN değer (`üretim && dokuma && bayrak`). */
export async function resolveOrderLineLinkRequired(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  if (!(await readProductionEnabled(tx)) || !(await readDokumaEnabled(tx))) return false;
  return readDokumaOrderLineLinkRequired(tx);
}

/** Dokuma firesi % — ETKİN değer: dokuma (üretim ∧ lisans tavanı) kapalıyken 0 (eski ayar sessizce çarpmasın). */
export async function resolveDokumaWeavingWastePct(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  if (!(await readProductionEnabled(tx)) || !(await readDokumaEnabled(tx))) return DEFAULT_DOKUMA_WEAVING_WASTE_PCT;
  return readDokumaWeavingWastePct(tx);
}

/** SY-3 I1 iplik ayırma — ETKİN değer (`üretim && dokuma && bayrak`); kapalıyken yanıtlar bugünküyle bayt-aynı. */
export async function resolveDokumaYarnReservationEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  if (!(await readProductionEnabled(tx)) || !(await readDokumaEnabled(tx))) return false;
  return readDokumaYarnReservationEnabled(tx);
}

/** S1 — top doğuş yolu — ETKİN değer: dokuma (üretim ∧ lisans tavanı) kapalıyken daima `TABLET_DOFF` (KK1 bugünküyle birebir). */
export async function resolveDokumaRollBirth(tx?: Pick<typeof prisma, "systemSetting">): Promise<DokumaRollBirth> {
  if (!(await readProductionEnabled(tx)) || !(await readDokumaEnabled(tx))) return DEFAULT_DOKUMA_ROLL_BIRTH;
  return readDokumaRollBirth(tx);
}

/** H1 — kurşun metre ölçümü — ETKİN değer: üretim kapalıyken daima `OFF` (bugünkü davranış). */
export async function resolveKursunMeterCapture(tx?: Pick<typeof prisma, "systemSetting">): Promise<KursunMeterCapture> {
  if (!(await readProductionEnabled(tx))) return DEFAULT_KURSUN_METER_CAPTURE;
  return readKursunMeterCapture(tx);
}

export async function resolveKursunBypassEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (!(await readProductionEnabled(tx))) return false;
  return readKursunBypassEnabled(tx);
}

/**
 * Tambur metraj aşımı serbest mi — ETKİN değer (`üretim && bayrak`).
 *
 * ⚠️ HAM VARSAYILAN AÇIK, ETKİN DEĞER ÜRETİM KAPALIYKEN KAPALI. Yön bilinçli:
 * aşımı kabul etmek bir ÜRETİM gerçeğidir (tambur asıl ölçüm noktası); üretim
 * modülü kullanılmayan bir kurulumda o gerçeğin karşılığı yoktur ve "kayıtlıdan
 * fazla metraj" sessizce kabul edilmemelidir.
 */
export async function resolveTamburOverQuantityEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (!(await readProductionEnabled(tx))) return false;
  return readTamburOverQuantityEnabled(tx);
}

/** Tambur "tümden geri al" aynı-gün sınırı — ETKİN değer (`üretim && bayrak`). */
export async function resolveTamburUndoFullSameDayOnly(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (!(await readProductionEnabled(tx))) return false;
  return readTamburUndoFullSameDayOnly(tx);
}

/** Parti no kısa/dönen biçimi — ETKİN değer (`üretim && bayrak`). */
export async function resolveBatchShortNumberEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (!(await readProductionEnabled(tx))) return false;
  return readBatchShortNumberEnabled(tx);
}
