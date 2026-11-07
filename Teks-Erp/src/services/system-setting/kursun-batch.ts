// =============================================================================
// TeksERP - System Setting / kursun-batch
// =============================================================================
// Kurşun · rota · parti · kalite okuyucuları.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { asBoolean, asNumber } from "./core";
import { DEFAULT_KURSUN_MACHINE_ASSIGN_MODE, DEFAULT_KURSUN_METER_CAPTURE, DEFAULT_KURSUN_METER_STOCK_MODE, DEFAULT_KURSUN_METER_VARIANCE_APPROVAL, DEFAULT_KURSUN_METER_VARIANCE_BASIS, DEFAULT_PRODUCTION_ROUTE_MODE, DEFAULT_PRODUCTION_SCAN_ROUTE_STATIONS, KURSUN_MACHINE_ASSIGN_MODES, KURSUN_METER_CAPTURE_MODES, KURSUN_METER_STOCK_MODES, KURSUN_METER_VARIANCE_APPROVALS, KURSUN_METER_VARIANCE_BASES, PRODUCTION_ROUTE_MODES, PRODUCTION_SCAN_ROUTE_STATIONS_VALUES, type KursunMachineAssignMode, type KursunMeterCapture, type KursunMeterStockMode, type KursunMeterVarianceApproval, type KursunMeterVarianceBasis, type ProductionRouteMode, type ProductionScanRouteStations } from "./defaults";
import { SETTING_KEYS } from "./keys";


/** H1: kurşun metre ölçümü — HAM okuyucu; tanınmayan değer varsayılana (`OFF`) düşer. */
export async function readKursunMeterCapture(tx?: Pick<typeof prisma, "systemSetting">): Promise<KursunMeterCapture> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.KURSUN_METER_CAPTURE }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && KURSUN_METER_CAPTURE_MODES.includes(v as KursunMeterCapture) ? (v as KursunMeterCapture) : DEFAULT_KURSUN_METER_CAPTURE;
}

/** H1: SIMULATED metre okuması — HAM okuyucu; kayıt yok → KAPALI. */
export async function readKursunSimulatedMeterEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.KURSUN_SIMULATED_METER_ENABLED }, select: { value: true } });
  return asBoolean(setting?.value);
}

/** H2: sapma eşiği okuyucusu — kayıt yok / ≤0 / sayı değil → null (eşik yok). */
async function readPositiveOrNull(key: string, tx?: Pick<typeof prisma, "systemSetting">): Promise<number | null> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key }, select: { value: true } });
  const parsed = setting ? asNumber(setting.value) : null;
  return parsed === null || !Number.isFinite(parsed) || parsed <= 0 ? null : parsed;
}

export async function readKursunMeterVarianceThresholdM(tx?: Pick<typeof prisma, "systemSetting">): Promise<number | null> {
  return readPositiveOrNull(SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_M, tx);
}

export async function readKursunMeterVarianceThresholdPct(tx?: Pick<typeof prisma, "systemSetting">): Promise<number | null> {
  return readPositiveOrNull(SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_PCT, tx);
}

/** H2: sapma tabanı — tanınmayan değer varsayılana (`DECLARED_IN`) düşer. */
export async function readKursunMeterVarianceBasis(tx?: Pick<typeof prisma, "systemSetting">): Promise<KursunMeterVarianceBasis> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.KURSUN_METER_VARIANCE_BASIS }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && KURSUN_METER_VARIANCE_BASES.includes(v as KursunMeterVarianceBasis) ? (v as KursunMeterVarianceBasis) : DEFAULT_KURSUN_METER_VARIANCE_BASIS;
}

/** H2: sapma onay kipi — tanınmayan değer varsayılana (`NONE` = bugün) düşer. */
export async function readKursunMeterVarianceApproval(tx?: Pick<typeof prisma, "systemSetting">): Promise<KursunMeterVarianceApproval> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && KURSUN_METER_VARIANCE_APPROVALS.includes(v as KursunMeterVarianceApproval) ? (v as KursunMeterVarianceApproval) : DEFAULT_KURSUN_METER_VARIANCE_APPROVAL;
}

/** K29: rota uygulaması — tanınmayan değer varsayılana (`SEQUENTIAL` = bugün) düşer. */
export async function readProductionRouteMode(tx?: Pick<typeof prisma, "systemSetting">): Promise<ProductionRouteMode> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.PRODUCTION_ROUTE_MODE }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && PRODUCTION_ROUTE_MODES.includes(v as ProductionRouteMode) ? (v as ProductionRouteMode) : DEFAULT_PRODUCTION_ROUTE_MODE;
}

/** K29: okutmayla rota kapsamı — tanınmayan değer `SELECTED`e düşer. */
export async function readProductionScanRouteStations(tx?: Pick<typeof prisma, "systemSetting">): Promise<ProductionScanRouteStations> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.PRODUCTION_SCAN_ROUTE_STATIONS }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && PRODUCTION_SCAN_ROUTE_STATIONS_VALUES.includes(v as ProductionScanRouteStations)
    ? (v as ProductionScanRouteStations)
    : DEFAULT_PRODUCTION_SCAN_ROUTE_STATIONS;
}

/** K16: atanan kurşun makinesi kipi — tanınmayan değer varsayılana (`SUGGEST` = bugün) düşer. */
export async function readKursunMachineAssignMode(tx?: Pick<typeof prisma, "systemSetting">): Promise<KursunMachineAssignMode> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.KURSUN_MACHINE_ASSIGN_MODE }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && KURSUN_MACHINE_ASSIGN_MODES.includes(v as KursunMachineAssignMode) ? (v as KursunMachineAssignMode) : DEFAULT_KURSUN_MACHINE_ASSIGN_MODE;
}

/** H1b: çıkış metresi stok kipi — tanınmayan değer varsayılana (`RECORD` = bugün) düşer. */
export async function readKursunMeterStockMode(tx?: Pick<typeof prisma, "systemSetting">): Promise<KursunMeterStockMode> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.KURSUN_METER_STOCK_MODE }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && KURSUN_METER_STOCK_MODES.includes(v as KursunMeterStockMode) ? (v as KursunMeterStockMode) : DEFAULT_KURSUN_METER_STOCK_MODE;
}

/** D4-F1: okutmada müşteri kodu araması — kayıt yoksa KAPALI (bugünkü davranış: yalnız iç barkod). */
export async function readScanCustomerCodeLookupEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.SCAN_CUSTOMER_CODE_LOOKUP }, select: { value: true } });
  if (!setting) return false;
  return asBoolean(setting.value);
}

export async function readKursunBypassEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Parti no KISA ve DÖNEN mi (P01…P99, 99'dan sonra P01)? Default TRUE/AÇIK.
 *
 * UNCACHED (enforcement yolu) — `generateBatchNumberTx` her parti doğuşunda tx
 * İÇİNDE okur. Maliyeti önemsiz: parti doğuşu günde onlarca kez olur, binlerce değil.
 *
 * ⚠️ Kayıt YOKSA `true` döner. Diğer çoğu bayraktan farklı olarak varsayılan AÇIK
 * (2026-08-05 kullanıcı kararı: "bayrak varsayılan olarak açık gelsin") — yani
 * deploy edildiği an panele hiç dokunulmadan yeni biçime geçilir. Bu satır aynı
 * zamanda ACİL KAPATMA anahtarıdır: kısa numara sahada sorun çıkarırsa tek geri
 * dönüş yolu bayrağı kapatmaktır (eski `P + GGAAYY + sıra` kalıbına düşülür).
 */
export async function readBatchLastNumberHintEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.BATCH_LAST_NUMBER_HINT_ENABLED },
    select: { value: true },
  });
  // Default AÇIK: talebi eden fabrika, kayıt yoksa görsün.
  if (!setting) return true;
  return asBoolean(setting.value);
}

export async function readBatchShortNumberEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.BATCH_SHORT_NUMBER_ENABLED },
    select: { value: true },
  });
  // Default AÇIK: kayıt yoksa true.
  if (!setting) return true;
  return asBoolean(setting.value);
}

/**
 * TOP KALİTESİ ZORUNLU MU (D6)? Default FALSE = bugünkü davranış.
 *
 * ⚠️ DÜZ OKUYUCU, `resolve*` DEĞİL — ve bu bilinçli bir karardır. Bayrağın KK1
 * dalı `createInitialEntry` motorunda yaşar; o motor ÇEKİRDEKTİR (tasarım
 * karar #2: "motor çekirdek, sunum modülde") ve üretim modülü kapalı bir
 * toptancı kurulumunda da aynı Roll'ları doğuracaktır. Üretim şalterine
 * bağlansaydı, üretim kapalıyken kalite kuralı SESSİZCE yok olurdu.
 *
 * Kapsam listesi ve kapsam DIŞI bırakılanların gerekçesi `SETTING_KEYS`
 * yorumunda; bekçi `scripts/test_quality_batch_flags.ts`.
 */
export async function readQualityGradeRequiredEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.QUALITY_GRADE_REQUIRED_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * AÇIK PARTİ YOKKEN SUNUCU PARTİYİ KENDİSİ AÇSIN MI (D7)? Default FALSE.
 *
 * ⚠️ Düz okuyucu (`resolve*` YOK): parti nesnesi üretim modülüne ait olsa da
 * bu bayrağın tek tüketicisi `tambur-manual.service` ve o servis üretim kapılı
 * router'ların (`tambur.routes`, `mobile` Tambur uçları) arkasında yaşıyor —
 * ikinci bir şalter, aynı kapıyı iki kez kilitlemek olurdu. Bayrağın adı
 * "zorunlu" DEĞİL "otomatik": gerekçe `SETTING_KEYS` yorumunda.
 *
 * ⚠️ Bu cümle VARSAYIM DEĞİL, ÖLÇÜM (2026-09-03): kapısız 70 route'tan başlayan
 * ulaşım grafiği 329 dosyaya varıyor ve `tambur-manual.service.ts` o kümede
 * YOK. Aynı cümlenin `workorder.defaultPlanDurationDays` için kurulan hâli
 * YANLIŞTI (bkz. §3.6 başlığı) — "router kapılı" demek "servise kapısız yoldan
 * ulaşılamaz" demek DEĞİLDİR ve her seferinde ölçülmesi gerekir. Yeni bir
 * çağıran eklenirse (örn. panelden elle top ekleme) bu ölçüm YENİLENİR.
 */
export async function readBatchAutoCreateEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.BATCH_AUTO_CREATE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}
