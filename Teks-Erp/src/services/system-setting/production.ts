// =============================================================================
// TeksERP - System Setting / production
// =============================================================================
// Üretim · KK1 · parti · kartela okuyucuları.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { resolveSeriesFormat } from "../number-series.service";
import { asBoolean } from "./core";
import { SETTING_KEYS } from "./keys";


/**
 * İş emri "hedef metraj" alanı gösterilsin mi? Default false (proses-only
 * fabrika; üretim miktarını giren kumaş belirler). İleride örgü/üretim eklenirse açılır.
 */
export async function readTargetQuantityEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.WORKORDER_TARGET_QUANTITY_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** İş emri formunda hedef en kutusu çizilsin mi. Default AÇIK (kayıt yoksa true): bugünkü form hedef enini hep soruyor. */
export async function readTargetWidthEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.WORKORDER_TARGET_WIDTH_ENABLED },
    select: { value: true },
  });
  if (!setting) return true;
  return asBoolean(setting.value);
}

/**
 * KK1 ham kumaş girişinde "en (cm)" alanı gösterilsin mi? Default false
 * (müşteri: ham kumaşın eni önemsiz). Kapalıyken mobil KK1 en alanını gizler,
 * operatör isterse manuel override ile yine girebilir. Bitmiş topun eni KK1'den
 * değil WorkOrder.width'ten damgalanır (bkz. tambur.service finalize).
 */
export async function readRawWidthEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KK1_RAW_WIDTH_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * KK1 ham kumaş girişinde ağırlık (kg) alanı açık mı? Default false.
 * rawWidthEnabled'dan farkı: bu flag backend'de ENFORCE edilir — kapalıyken
 * gelen weightKg createInitialEntry'de 400 ile reddedilir (yalnız UI rehberi değil).
 */
export async function readKk1WeightEntryEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KK1_WEIGHT_ENTRY_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Ham girişte mükerrer top tuzağı açık mı? Default false.
 *
 * SAHA VAKASI (2026-08-03): sunucu restart edildi, operatör etiket çıkmayınca
 * "Kaydet ve Etiket Bas"a defalarca bastı; her basış yeni bir `clientToken`
 * ürettiği için sunucu N ayrı top yazdı. Asıl düzeltme istemcidedir (token artık
 * mantıksal denemeye bağlı) — bu bayrak İSTEMCİYE GÜVENMEYEN ikinci hattır:
 * farklı cihaz, yeniden kurulum, doğrudan API çağrısı da yakalanır.
 */
/** Hızlı iş emri kapsamı yalnız kendi başlattıkları mı? Default false (bugün: hepsi). */
export async function readWorkOrderQuickOwnOnlyEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.WORKORDER_QUICK_OWN_ONLY_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Destek talepleri yalnız sahibine mi görünür? Default false (bugün: herkese). */
export async function readSupportOwnTicketsOnlyEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SUPPORT_OWN_TICKETS_ONLY_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

export async function readKk1DuplicateGuardEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KK1_DUPLICATE_GUARD_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * KK1 ham giriş çevrimdışı kuyruksuz (online-only) rejimde mi? Default false.
 *
 * SAHA KARARI (2026-08-11): kesinti anında kuyruğa alınan kayıtların etiketi
 * sonradan basılamayınca operatör aynı topu YENİDEN giriyordu (07.08 vakası:
 * 4 top 34-52 dk sonra ikizlendi). Bayrak açıkken mobil KK1 çevrimdışı kayıt
 * hiç ALMAZ — kayıt + etiket tek nefeste yürür, "Sırada/Başarısız" listeleri
 * doğmaz. ENFORCE istemcidedir (kuyruk istemci kavramı); bu okuma yalnız
 * feature-flags yanıtını besler.
 */
export async function readKk1OnlineOnlyEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KK1_ONLINE_ONLY_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * KK1 etiket geri-okutma doğrulaması (scan-back) açık mı? Default false.
 *
 * Print & verify: "etiket çıktı" sinyali yazılımdan alınamaz (BT yazıcı baskı
 * onayı döndürmez) — tek güvenilir kanıt basılan barkodun GERİ OKUTULMASIDIR.
 * Açıkken mobil KK1, basılan her etiket için okutma ister ve okutulmadan yeni
 * top girişine izin vermez. ENFORCE istemcidedir; bu okuma yalnız
 * feature-flags yanıtını besler.
 */
export async function readKk1LabelScanVerifyEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KK1_LABEL_SCAN_VERIFY_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * KK1 "Tüm Girişler" listesi tüm operatörleri kapsasın mı? Default false.
 *
 * Kapalıyken (varsayılan) mobil KK1'in "Tüm Girişler" modalı yalnız oturumdaki
 * operatörün KENDİ girdiği topları listeler; sağdaki "Son Kayıtlar" listesi
 * bayraktan bağımsız HER ZAMAN kişiye özeldir. ENFORCE istemcidedir (istemci
 * kendi createdById filtresini gönderir) — bu bir yetki duvarı DEĞİL, saha
 * ekranı sadeleştirmesidir; paneldeki roll:read aynı veriyi zaten görür.
 */
export async function readKk1HistoryAllEntriesEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KK1_HISTORY_ALL_ENTRIES_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Simüle kantardan gelen çuval tartısı kaydedilebilir mi? Default false = ENFORCE.
 * Backend `weighSack`'te zorlanır (yalnız UI rehberi DEĞİL) — çuval kg'si sevk
 * irsaliyesine/çeki listesine basıldığı için uydurulmuş sayı oraya girmemeli.
 * Demo/eğitim kurulumu açar; sahada gerçek MAC eşleştirilince `peripheral.service`
 * cihazın `simulate`'ini zaten `false` yapar.
 */
export async function readSimulatedWeightEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_SIMULATED_WEIGHT_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * İş emri "Parti Kodu" (batchNumber) otomatik mi üretilsin? Default false (manuel).
 * Sadece UI rehberi — backend ENFORCE ETMEZ: batchNumber boş gelirse her iki modda
 * da otomatik üretir. Flag yalnızca formun manuel/otomatik davranışını belirler.
 */
export async function readPartyCodeAuto(
  _tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  // ⚠️ ARTIK TÜRETİLMİŞ: tek kaynak `workOrder` serisinin `numberSource`u
  // (D3③). Eski `workorder.partyCodeAuto` satırı OKUNMAZ — göç bir kez koştu ve
  // damgalandı. İki ayar aynı soruyu cevaplarken biri mutlaka bayatlar ve
  // bayatlayan hep EKRANDA olan taraf olur.
  //
  // Eşleme: FREE → true (otomatik, elle de yazılabilir) · SYSTEM → true
  // (otomatik; elle yazılan değer sunucuda 400 alır) · MANUAL → false (elle
  // zorunlu). SYSTEM'de eski panel (1.3.1) alanı tıklanabilir gösterir; kullanıcı
  // elle bir değer yazarsa kaydetmede 400 görür — BEYANLI bir kabul, çünkü eski
  // panelin üç hâli gösterecek bir yüzeyi yok.
  const mode = resolveSeriesFormat("workOrder").numberSource ?? "FREE";
  return mode !== "MANUAL";
}

/**
 * İade kabulünde personel topun kalitesini değiştirebilsin mi? Default false.
 * Kapalıyken mobil İade ekranı kalite (derecelendirme) kontrolünü gizler; ayrıca
 * backend `createReturn`'de gönderilen qualityGradeId override'ı YOK SAYILIR
 * (top çıktığı kaliteyle döner) — flag fiziksel etiketi belirlediği için sadece
 * UI rehberi değil, enforce edilir.
 */
export async function readReturnGradingEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.RETURN_GRADING_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Kartela kabulünde cm/kg ölçü alanlarının + kartela listelerinde ölçü
 * gösteriminin açık olup olmadığı. Default false (yalnız ADET). Diğer UI
 * flag'leri gibi backend ENFORCE etmez; frontend gizler.
 */
export async function readKartelaMeasurementEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KARTELA_MEASUREMENT_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Fason Sevk'te fason talimatını sahadaki operatör telefondan girebilsin mi?
 * Default false (kapalı). Kapalıyken mobil Fason Sevk ekranında fason talimatı
 * alanı gizli; talimat yalnızca sevk edilen adımın notundan gelir. Sadece
 * UI rehberi — backend ENFORCE ETMEZ.
 */
export async function readFasonNoteMobileEntry(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.FASON_NOTE_MOBILE_ENTRY },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}
