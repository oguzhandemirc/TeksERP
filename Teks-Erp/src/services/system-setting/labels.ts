// =============================================================================
// TeksERP - System Setting / labels
// =============================================================================
// Etiket · baskı · bildirim/belge bayrağı okuyucuları.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { isHostedInstallation } from "../helpers/install-class.helper";
import { asBoolean, asNumber } from "./core";
import { DEFAULT_LABEL_COPIES_SOURCE, DEFAULT_LABEL_CUSTOMER_CODE_AT, DEFAULT_LABEL_CUSTOMER_CODE_MISSING, LABEL_COPIES_SOURCES, LABEL_CUSTOMER_CODE_AT_MODES, LABEL_CUSTOMER_CODE_MISSING_MODES, type LabelCopiesSource, type LabelCustomerCodeAt, type LabelCustomerCodeMissing } from "./defaults";
import { readServiceEnum } from "./finance";
import { SETTING_KEYS } from "./keys";


/**
 * Saha #6: top etiketi kopya adedi (default 2 — topun üstüne + altına).
 * 1-5 aralığına kırpılır; geçersiz/yok → 2.
 */
export const DEFAULT_LABEL_COPIES = 2;
export async function readLabelCopies(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_COPIES },
    select: { value: true },
  });
  if (!setting) return DEFAULT_LABEL_COPIES;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 1) return DEFAULT_LABEL_COPIES;
  return Math.min(Math.floor(parsed), LABEL_COPIES_MAX);
}

/** Akış etiketinin en çok kopya adedi — genel ayar, istasyon varsayılanı ve istek aynı tavanı paylaşır. */
export const LABEL_COPIES_MAX = 5;

/** D4-F3: müşteri barkodu yoksa davranışı — tanınmayan değer varsayılana (`BLOCK`) düşer. */
export function readLabelCustomerCodeMissing(tx?: Pick<typeof prisma, "systemSetting">): Promise<LabelCustomerCodeMissing> {
  return readServiceEnum(SETTING_KEYS.LABEL_CUSTOMER_CODE_MISSING, LABEL_CUSTOMER_CODE_MISSING_MODES, DEFAULT_LABEL_CUSTOMER_CODE_MISSING, tx);
}

/** D4-F2: müşteri kodunun doğduğu yer — tanınmayan değer varsayılana (`NONE`) düşer. */
export function readLabelCustomerCodeAt(tx?: Pick<typeof prisma, "systemSetting">): Promise<LabelCustomerCodeAt> {
  return readServiceEnum(SETTING_KEYS.LABEL_CUSTOMER_CODE_AT, LABEL_CUSTOMER_CODE_AT_MODES, DEFAULT_LABEL_CUSTOMER_CODE_AT, tx);
}

/** Etiket adedi kaynağı. Çöp değer → varsayılan (`GLOBAL`, bugünkü davranış). */
export async function readLabelCopiesSource(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<LabelCopiesSource> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_COPIES_SOURCE },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && LABEL_COPIES_SOURCES.includes(v as LabelCopiesSource)) {
    return v as LabelCopiesSource;
  }
  return DEFAULT_LABEL_COPIES_SOURCE;
}

/** Sistem varsayılan etiket medyası (cihazsız baskı/önizleme/kartela). Kayıt yoksa
 *  100×148 / 203dpi / gap 2 / pay 3 (kod fallback). */
export interface DefaultLabelMedia {
  widthMm: number;
  heightMm: number;
  dpi: number;
  gapMm: number;
  marginMm: number;
}
export const CODE_DEFAULT_MEDIA: DefaultLabelMedia = {
  widthMm: 100, heightMm: 148, dpi: 203, gapMm: 2, marginMm: 3,
};
export async function readDefaultLabelMedia(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<DefaultLabelMedia> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_DEFAULT_MEDIA },
    select: { value: true },
  });
  const v = setting?.value as Record<string, unknown> | null | undefined;
  if (!v || typeof v !== "object") return CODE_DEFAULT_MEDIA;
  // width/height/dpi > 0 zorunlu; gap/margin 0 GEÇERLİ (sıfır boşluk/pay).
  const pos = (x: unknown, fb: number) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : fb);
  const nonNeg = (x: unknown, fb: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : fb);
  return {
    widthMm: pos(v.widthMm, CODE_DEFAULT_MEDIA.widthMm),
    heightMm: pos(v.heightMm, CODE_DEFAULT_MEDIA.heightMm),
    dpi: pos(v.dpi, CODE_DEFAULT_MEDIA.dpi),
    gapMm: nonNeg(v.gapMm, CODE_DEFAULT_MEDIA.gapMm),
    marginMm: nonNeg(v.marginMm, CODE_DEFAULT_MEDIA.marginMm),
  };
}


/**
 * Faz-2 opt-in: native etiket komutları yazıcıya doğrudan (RAW TCP 9100) gönderilsin mi.
 * Default false (Faz-1 simülasyon — hiç socket açılmaz). Açıkken printer-transport
 * gerçek gönderim yapar; ENFORCE edilir.
 */
export async function readLabelNativeSendEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  // Barındırılan sunucu fabrika LAN'ındaki yazıcıya ulaşamaz; açık bayrak yalnız SSRF yüzeyidir (VDS D3).
  if (isHostedInstallation()) return false;
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_NATIVE_SEND_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Mobil (HC-06/BT) baskıda raster GW bitmap gönderilsin mi? Default FALSE (kayıt yoksa →
 * komut yolu). Electron raster'ından (PeripheralDevice.rasterMode) BAĞIMSIZ. Client (mobil)
 * ENFORCE eder: açıkken mobil `encoding=b64` ile raster ister, kapalıyken komut yolu.
 */
export async function readMobileRasterEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_MOBILE_RASTER_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * "Etiketsiz" işaretli kalitelerde (`QualityGrade.skipLabel` — sahada FİRE) de
 * OTOMATİK etiket basılsın mı? Default FALSE (kayıt yoksa → fire topa kâğıt ÇIKMAZ).
 *
 * ⚠️ Bu ayar TEK BAŞINA bir şey söylemez — hangi kalitenin "etiketsiz" olduğunu
 * kalite kataloğu (`skipLabel`) söyler. İkisi birlikte okunur; kural KALİTEDE
 * yaşıyor: etiket politikası dispozisyondan AYRI bir karardır (yarın A1_STOCK'a
 * inen ama etiketsiz bir kademe eklenebilir). Tasarım anında ayrıca ZORUNLUYDU —
 * FİRE o gün WAREHOUSE'a iniyordu; FIRE→SCRAP aynı gün ayrıca düzeltildi.
 */
export async function readScrapGradeLabelEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_SCRAP_GRADE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Patron bulutu olay güdümlü tur açık mı? Default FALSE (kayıt yoksa → bugünkü davranış: yalnız
 * kiradaki aralıkta tur). Açıkken bile ön koşul `cloudEligibility` tek kapıdır (fail-closed).
 */
export async function readPatronBulutOlayGudumluEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PATRON_BULUT_OLAY_GUDUMLU },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Bildirim gelen kutusu açık mı? Default FALSE (kayıt yok/çöp değer → bugünkü zil davranışı;
 * fail-closed). Modül anahtarı değil, davranış bayrağı (plan Karar Y1).
 */
export async function readNotificationInboxEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Patron telefonuna push (köprü P2) açık mı? Default FALSE (kayıt yok/çöp → bugünkü davranış: cihaz kaydı 409,
 * buluta istek yok). Davranış bayrağı, modül anahtarı değil.
 */
export async function readPatronPushEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.BILDIRIM_PATRON_PUSH_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Belge tasarımcısı açık mı? Default FALSE (kayıt yok/çöp → bugünkü Sistem tasarımı; fail-closed). */
export async function readDocumentDesignerEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DOCUMENTS_DESIGNER_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Şablon yayınında tasarlayan ≠ yayınlayan zorunlu mu? Default FALSE (bugünkü davranış). */
export async function readDocumentPublishSodEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DOCUMENTS_PUBLISH_SOD_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}
