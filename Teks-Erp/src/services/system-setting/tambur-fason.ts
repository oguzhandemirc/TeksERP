// =============================================================================
// TeksERP - System Setting / tambur-fason
// =============================================================================
// Tambur · fason · makine duruşu · mükerrer okuyucuları.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { TAMBUR_PLAN_WIDTH_TOLERANCE_CM } from "../../constants/tambur-plan-gate";
import { DEFAULT_DUPLICATES_FUZZY_THRESHOLD_PCT, DUPLICATES_FUZZY_MIN_PCT } from "../../constants/duplicate-rules";
import { asBoolean, asNumber } from "./core";
import { DEFAULT_TAMBUR_CALIBRATION_CHECK, DEFAULT_TAMBUR_CHILD_WIDTH_SOURCE, DEFAULT_TAMBUR_LABEL_PRINT_TIMING, DEFAULT_TAMBUR_PLAN_WIDTH_CHECK, TAMBUR_CALIBRATION_CHECK_MODES, TAMBUR_CHILD_WIDTH_SOURCES, TAMBUR_LABEL_PRINT_TIMINGS, TAMBUR_PLAN_WIDTH_CHECKS, TAMBUR_PLAN_WIDTH_TOLERANCE_MAX_CM, type TamburCalibrationCheck, type TamburChildWidthSource, type TamburLabelPrintTiming, type TamburPlanWidthCheck } from "./defaults";
import { readServiceEnum } from "./finance";
import { SETTING_KEYS } from "./keys";


/**
 * Müşteri şubeleri (sevk noktaları) UI'da açık mı? Default TRUE (açık — mevcut
 * davranış). "Her şube = ayrı müşteri" düzenine geçen firma kapatır: Electron
 * müşteri formundaki Şubeler sekmesi/taslağı ve sipariş formundaki şube seçimi
 * gizlenir. Salt UI rehberi — backend ENFORCE ETMEZ (branchId taşıyan istekler
 * işlenmeye devam eder, mevcut veri korunur).
 */
export async function readCustomerBranchesEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.CUSTOMER_BRANCHES_ENABLED },
    select: { value: true },
  });
  // Default AÇIK: kayıt yoksa true döner (flag eklenmeden önceki davranış).
  if (!setting) return true;
  return asBoolean(setting.value);
}

/**
 * Tambur'da çıkan top metresi kayıtlı (giriş) metreyi aşabilsin mi? Default TRUE (açık).
 * Açıkken operatör (tambur asıl ölçüm noktası olduğu için) kayıtlıdan fazla ölçtüğünde
 * kabul edilir — aşımda parent top tamamen tüketilir (currentQty=0), negatif kalan oluşmaz.
 * Admin kapatırsa tambur kesim/finalize'de çıkış > giriş ise 400 ile reddedilir. Diğer
 * flag'lerin aksine backend ENFORCE eder: tambur guard'ları (finalize / cutOpenFabric /
 * cutWarehouseRoll) yalnız aşım anında okur.
 */
/**
 * Kısa kesim → otomatik A1 FABRİKA VARSAYILANI. Kayıt yoksa **false**.
 *
 * Yön gerekçesi (`readTamburUndoFullSameDayOnly` emsali): bu bayrak bir ÜRETİM
 * GERÇEĞİNİ kabul etmez, operatörün kalite seçimini DEĞİŞTİRİR — davranış
 * değiştiren kurallar sessizce açık doğmaz, fabrika bilerek açar.
 */
export async function readTamburShortCutA1Enabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_SHORT_CUT_A1_ENABLED },
    select: { value: true },
  });
  if (!setting) return false;
  return asBoolean(setting.value);
}

/**
 * Tambur listesi istasyon süzgeci (ister 2.8). Kayıt yoksa **false** — bugünkü
 * davranış (tablet tüm TAMBUR adımlarını listeler). Süzgeci tablet uygular
 * (`stationId` parametresi); backend parametresiz çağrıyı hep tam liste döndürür.
 */
export async function readTamburListByStationEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_LIST_BY_STATION_ENABLED },
    select: { value: true },
  });
  if (!setting) return false;
  return asBoolean(setting.value);
}

/**
 * Makine duruşu takibi (D4-A1). Kayıt yoksa **false** — bugünkü davranış (duruş yalnız dokumada).
 * Enforcement bu okuyucuyu DOĞRUDAN çağırmaz: rejim `services/helpers/machine-stop-regime.helper.ts`.
 */
export async function readMachineStopTrackingEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.MACHINE_STOP_TRACKING_ENABLED },
    select: { value: true },
  });
  if (!setting) return false;
  return asBoolean(setting.value);
}

/**
 * Açık duruş dokunuş uyarısı (D4-A2b). Kayıt yoksa **false** — sahadaki davranış (uyarı yok).
 */
export async function readMachineStopOpenWarningEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.MACHINE_STOP_OPEN_WARNING_ENABLED },
    select: { value: true },
  });
  if (!setting) return false;
  return asBoolean(setting.value);
}

/**
 * Kısa kesim eşiği (metre). Kayıt yok / geçersiz / pozitif değilse **null** —
 * yani kural inert. `readLabelCopies` kırpma kalıbının null-varyantı: bozuk
 * ayar yüzünden istek DÜŞÜRÜLMEZ, kural sessizce devre dışı kalır (kalite
 * kararı zaten operatörde; fail-safe yön "otomatik yazma").
 */
export async function readTamburShortCutA1ThresholdM(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number | null> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_SHORT_CUT_A1_THRESHOLD_M },
    select: { value: true },
  });
  if (!setting) return null;
  const parsed = asNumber(setting.value);
  if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Fason kabulünde çekme uyarısı — default **TRUE (açık)**.
 *
 * Yön gerekçesi `readTamburShortCutA1Enabled`'ın TERSİ ve bilinçli: bu bayrak
 * operatörün kararını DEĞİŞTİRMEZ, yalnız görünür bir gerçeği (giden ↔ dönen
 * farkı) gösterir. Görünürlük varsayılan olarak açık doğar; sessizlik bilerek
 * seçilir. Kapatmak "farkı hiç gösterme" demektir — defter yine yazılır.
 */
export async function readFasonShrinkWarnEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FASON_SHRINK_WARN_ENABLED },
    select: { value: true },
  });
  if (!setting) return true;
  return asBoolean(setting.value);
}

/** Fason kabulünde hedef çeşit değeri doğan topa (D4-D3, K8). Kayıt yoksa **false** — bugünkü davranış. */
export async function readFasonReceiptApplyTargetVariant(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FASON_RECEIPT_APPLY_TARGET_VARIANT },
    select: { value: true },
  });
  if (!setting) return false;
  return asBoolean(setting.value);
}

/** Fabrika varsayılanı — boyahane çekmesi tipik olarak %8-12 bandındadır. */
export const DEFAULT_FASON_SHRINK_TOLERANCE_PCT = 10;

/** Tambur plan kapısı en eşiği (cm). Kayıt yok/çöp → 10 (bugünkü sabit). */
export async function readTamburPlanGateWidthToleranceCm(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_TOLERANCE_CM },
    select: { value: true },
  });
  if (!setting) return TAMBUR_PLAN_WIDTH_TOLERANCE_CM;
  const parsed = asNumber(setting.value);
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0 || parsed > TAMBUR_PLAN_WIDTH_TOLERANCE_MAX_CM) {
    return TAMBUR_PLAN_WIDTH_TOLERANCE_CM;
  }
  return parsed;
}

/** Tambur plan kapısı en kontrolü. Kayıt yok/çöp → ENFORCE (bugünkü davranış). */
export async function readTamburPlanGateWidthCheck(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<TamburPlanWidthCheck> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_CHECK },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && TAMBUR_PLAN_WIDTH_CHECKS.includes(v as TamburPlanWidthCheck)) {
    return v as TamburPlanWidthCheck;
  }
  return DEFAULT_TAMBUR_PLAN_WIDTH_CHECK;
}

/**
 * Tambur finalize çocuk en kaynağının TEK çözücüsü (D4-E3). Kayıt yok/çöp →
 * WO_TARGET_FIRST (bugünkü davranış). Ad `read*` — `test_feature_flag_contract` okuyucuyu getFeatureFlags gövdesinden çözer.
 */
export async function readTamburChildWidthSource(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<TamburChildWidthSource> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_CHILD_WIDTH_SOURCE },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && TAMBUR_CHILD_WIDTH_SOURCES.includes(v as TamburChildWidthSource)) {
    return v as TamburChildWidthSource;
  }
  return DEFAULT_TAMBUR_CHILD_WIDTH_SOURCE;
}

/**
 * Tambur etiket basım zamanının TEK çözücüsü (Gülkesim S5). Kayıt yok/çöp → EACH
 * (bugünkü davranış). Ad `read*` — `test_feature_flag_contract` okuyucuyu getFeatureFlags gövdesinden çözer.
 */
export async function readTamburLabelPrintTiming(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<TamburLabelPrintTiming> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_LABEL_PRINT_TIMING },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && TAMBUR_LABEL_PRINT_TIMINGS.includes(v as TamburLabelPrintTiming)) {
    return v as TamburLabelPrintTiming;
  }
  return DEFAULT_TAMBUR_LABEL_PRINT_TIMING;
}

/**
 * Tambur plan kapısı EN kolunun TEK çözücüsü (D4-E1). Kapı (`assertRollMatchesPlan`)
 * eşiği yalnız buradan okur; sabiti doğrudan okumak `test_tambur_plan_gate` AST
 * bölümünde kırmızıdır.
 */
export async function effectiveTamburPlanWidthGate(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<{ check: TamburPlanWidthCheck; toleranceCm: number }> {
  return {
    check: await readTamburPlanGateWidthCheck(tx),
    toleranceCm: await readTamburPlanGateWidthToleranceCm(tx),
  };
}

/**
 * Çekme toleransı (yüzde). Kayıt YOKSA varsayılan (%10); kayıt VARSA `0` dahil
 * ne yazıldıysa o.
 *
 * ⚠️ `readTamburShortCutA1ThresholdM`'in `<= 0 → null` kalıbı BURADA YANLIŞ
 * OLURDU: orada 0 "eşik girilmemiş" demek, burada 0 "hiç tolerans yok" demek
 * ve ikisi zıt davranışlar üretir (kural inert ↔ kural her farkta ateşler).
 * Bozuk/negatif değer varsayılana düşer (fail-safe: uyarı susmasın diye değil,
 * bilinmeyen bir sayıyla operatörü şaşırtmamak için).
 */
export async function readFasonShrinkTolerancePct(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FASON_SHRINK_TOLERANCE_PCT },
    select: { value: true },
  });
  if (!setting) return DEFAULT_FASON_SHRINK_TOLERANCE_PCT;
  const parsed = asNumber(setting.value);
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return DEFAULT_FASON_SHRINK_TOLERANCE_PCT;
  }
  return parsed;
}

/** Mükerrer paneli — bulanık ad eşleştirme (default TRUE; kayıt yoksa açık). */
/**
 * Demo modu açık mı. KAYIT YOKSA **FALSE** — panel `defaultOn: false` ile
 * birebir (bekçi `test_feature_flag_contract` §12 bu eşitliği ölçer).
 *
 * ⚠️ Varsayılanın FALSE olması bu bayrağın en önemli özelliğidir: sürüme sızan
 * bir demo yardımcısı, fabrikada hiçbir şey yapılmadığı sürece ETKİSİZDİR.
 */
export async function readDemoModeEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEMO_MODE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

export async function readDuplicatesFuzzyEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DUPLICATES_FUZZY_ENABLED },
    select: { value: true },
  });
  if (!setting) return true;
  return asBoolean(setting.value);
}

/**
 * Mükerrer paneli — bulanık benzerlik eşiği (yüzde). Kayıt yoksa ya da aralık
 * dışıysa varsayılan (90). Alt sınır `DUPLICATES_FUZZY_MIN_PCT` (50).
 */
export async function readDuplicatesFuzzyThresholdPct(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DUPLICATES_FUZZY_THRESHOLD_PCT },
    select: { value: true },
  });
  if (!setting) return DEFAULT_DUPLICATES_FUZZY_THRESHOLD_PCT;
  const parsed = asNumber(setting.value);
  if (
    parsed === null ||
    !Number.isFinite(parsed) ||
    parsed < DUPLICATES_FUZZY_MIN_PCT ||
    parsed > 100
  ) {
    return DEFAULT_DUPLICATES_FUZZY_THRESHOLD_PCT;
  }
  return parsed;
}

export async function readTamburOverQuantityEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_OVER_QUANTITY_ENABLED },
    select: { value: true },
  });
  // Default AÇIK: kayıt yoksa true döner. Admin açıkça kapatırsa (value=false)
  // asBoolean false verir → guard'lar tekrar aşımı reddeder.
  if (!setting) return true;
  return asBoolean(setting.value);
}

/**
 * Tambur "TÜMDEN geri al" için aynı-gün sınırı açık mı.
 *
 * Default KAPALI (kayıt yoksa `false`) — `readTamburOverQuantityEnabled`'ın
 * TERSİ yönde varsayılan taşır ve bu bilinçlidir: aşım bayrağı bir ÜRETİM
 * gerçeğini kabul eder (tambur asıl ölçüm noktası), bu ise bir KISITTIR ve
 * kısıtlar sessizce açık doğmaz.
 */
export async function readTamburUndoFullSameDayOnly(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TAMBUR_UNDO_FULL_SAME_DAY_ONLY },
    select: { value: true },
  });
  if (!setting) return false;
  return asBoolean(setting.value);
}

/** D4-B1: Tambur simüle metre — satır yok = AÇIK (bugün tablet simüle değeri sessizce gönderiyor; ölçüldü). */
export async function readTamburSimulatedMeterEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.TAMBUR_SIMULATED_METER_ENABLED }, select: { value: true } });
  if (!setting) return true;
  return asBoolean(setting.value);
}

/** D4-B1: Tambur ölçüm kaynağı zorunluluğu — satır yok = KAPALI (eski APK `measure` göndermez; çıkışsız kapı olmasın). */
export async function readTamburMeasureSourceRequired(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.TAMBUR_MEASURE_SOURCE_REQUIRED }, select: { value: true } });
  return asBoolean(setting?.value);
}

/** D4-B5k: sayaç kalibrasyon kontrolü — satır yok / tanınmayan değer = KAPALI (bugünkü davranış). */
export function readTamburCalibrationCheck(tx?: Pick<typeof prisma, "systemSetting">): Promise<TamburCalibrationCheck> {
  return readServiceEnum(SETTING_KEYS.TAMBUR_CALIBRATION_CHECK, TAMBUR_CALIBRATION_CHECK_MODES, DEFAULT_TAMBUR_CALIBRATION_CHECK, tx);
}
