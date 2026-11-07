// =============================================================================
// TeksERP - System Setting / packing-loom
// =============================================================================
// Paketleme · çuval sırası · tezgah alarmı okuyucuları.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { asBoolean, asNumber } from "./core";
import { DEFAULT_PACKAGE_NO_MODE, DEFAULT_PACKAGE_NUMBERING, DEFAULT_PACKING_GROUP_MODE, DEFAULT_PACKING_GROUP_NUMBERING, DEFAULT_PACKING_POOL_PACKAGE_NO, DEFAULT_SACK_DUMP_NAME_MODE, DEFAULT_SHIPPING_SACK_SEQ_START, DEFAULT_TEZGAH_ALARM_NO_SHIFT_MODE, DEFAULT_TEZGAH_ALARM_RENOTIFY_MINUTES, DEFAULT_TEZGAH_COLLECTOR_SILENCE_MINUTES, DEFAULT_TEZGAH_ESCALATION_GRACE_MINUTES, DEFAULT_TEZGAH_MAX_OPEN_STOP_HOURS, PACKAGE_NO_MODES, PACKAGE_NUMBERINGS, PACKING_GROUP_MODES, PACKING_GROUP_NUMBERINGS, PACKING_POOL_PACKAGE_NO_MODES, SACK_DUMP_NAME_MODES, SHIPPING_SACK_SEQ_START_MAX, TEZGAH_ALARM_NO_SHIFT_MODES, TEZGAH_ALARM_RENOTIFY_MINUTES_MAX, TEZGAH_ALARM_UNCLASSIFIED_TARGET_MAX, TEZGAH_COLLECTOR_SILENCE_MINUTES_MAX, TEZGAH_ESCALATION_GRACE_MINUTES_MAX, TEZGAH_MAX_OPEN_STOP_HOURS_MAX, sanitizeReturnFootnote, sanitizeSackSeqPrefix, type PackageNoMode, type PackageNumbering, type PackingGroupMode, type PackingGroupNumbering, type PackingPoolPackageNo, type SackDumpNameMode, type ShippingSackSeqPrefix, type TezgahAlarmNoShiftMode } from "./defaults";
import { SETTING_KEYS } from "./keys";
import { readTezgahEnabled } from "./modules";


/**
 * Kurşun bypass düzeni açık mı? Default FALSE (KAPALI). Fabrika kurşun istasyonlarına
 * tablet koymuyorsa açılır: kurşun fiziksel olarak yapılır, dijital izlenmez (hatalar
 * kâğıtta) ve yetkili personel kurşun adımındaki iş emrini fiziksel bir kurşun
 * istasyonuna ATAR; adım Tambur'da kart okutmasıyla (ya da kurşun son adımsa dağıtım
 * ekranından) COMPLETED olur.
 *
 * ENFORCE edilir ama kapsamı DAR — yalnız YENİ ATAMA OLUŞTURMAYI kapılar. Zaten
 * dağıtılmış iş emirleri bayrak sonradan kapansa da bypass rejiminde biter (iptal /
 * son-adım tamamlama / Tambur onayı çalışır): rejim ATAMA SATIRINDA kalıcıdır
 * (`KursunBypassAssignment`), ayarda değil. Aksi halde bayrağı kapatmak, kurşunu
 * fiziksel olarak görmüş ama dijital karşılığı açık kalmış işleri sahada kilitlerdi.
 *
 * UNCACHED (enforcement yolu — `getFeatureFlags` cache'i üzerinden okunmaz); kayıt
 * yoksa false. `getFeatureFlags` bu fonksiyonu in-memory client ile çağırır.
 */
/**
 * Paketleme grubu açık mı. Satır YOKSA `false` — yani bugünkü davranış: Paketleme
 * ekranı düz liste, "Hemen Sevk Et" içi dolu her çuvalı gönderir.
 */
export async function readPackingGroupsEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PACKING_GROUPS_ENABLE },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Grup numara rejimi. Satır yoksa / değer kümede değilse `artan` (saha kararı).
 * `includes` sigortası: elle SQL ya da eski dump çöp yazarsa sayaç sessizce
 * rejim değiştirmesin.
 */
/**
 * Döküm ad rejimi. Satır yoksa / değer kümede değilse `ikisi` (bugünkü çıktı).
 */
export async function readSackDumpNameMode(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<SackDumpNameMode> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SACK_DUMP_NAME_MODE },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && SACK_DUMP_NAME_MODES.includes(v as SackDumpNameMode)) {
    return v as SackDumpNameMode;
  }
  return DEFAULT_SACK_DUMP_NAME_MODE;
}

export async function readPackingGroupNumbering(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<PackingGroupNumbering> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PACKING_GROUP_NUMBERING },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && PACKING_GROUP_NUMBERINGS.includes(v as PackingGroupNumbering)) {
    return v as PackingGroupNumbering;
  }
  return DEFAULT_PACKING_GROUP_NUMBERING;
}

/** Grup davranış modu (HAM okuyucu; enforcement `effectivePackingGroupMode` kullanır). Satır yoksa / değer kümede değilse `grup`. */
export async function readPackingGroupMode(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<PackingGroupMode> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PACKING_GROUP_MODE },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && PACKING_GROUP_MODES.includes(v as PackingGroupMode)) {
    return v as PackingGroupMode;
  }
  return DEFAULT_PACKING_GROUP_MODE;
}

/** Ambalaj no 0'dan mı başlar. Satır yoksa false (1'den). */
export async function readPackageNoStartsAtZero(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PACKAGE_NO_STARTS_AT_ZERO },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Ambalaj no atama modu. Satır yoksa / değer kümede değilse `otomatik-ezilebilir`. */
export async function readPackageNoMode(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<PackageNoMode> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PACKAGE_NO_MODE },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && PACKAGE_NO_MODES.includes(v as PackageNoMode)) {
    return v as PackageNoMode;
  }
  return DEFAULT_PACKAGE_NO_MODE;
}

/** Ambalaj no sayaç rejimi. Satır yoksa / değer kümede değilse `artan`. */
export async function readPackageNumbering(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<PackageNumbering> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PACKAGE_NUMBERING },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && PACKAGE_NUMBERINGS.includes(v as PackageNumbering)) {
    return v as PackageNumbering;
  }
  return DEFAULT_PACKAGE_NUMBERING;
}

/** Partisiz çuval açma yasak mı. Satır yoksa false. */
export async function readPackingLotRequired(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PACKING_LOT_REQUIRED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Kısmi sevk serbest mi. Satır yoksa TRUE (bugünkü davranış: sevk serbest). */
export async function readPackingLotPartialDispatch(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PACKING_LOT_PARTIAL_DISPATCH },
    select: { value: true },
  });
  if (!setting) return true;
  return asBoolean(setting.value);
}

/** Belgede parti adı + ambalaj no kolonu. Satır yoksa false (bugünkü belge). */
export async function readShippingDocPackingLot(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.SHIPPING_DOC_PACKING_LOT },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

export async function readShippingSackSeqOnDoc(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.SHIPPING_SACK_SEQ_ON_DOC }, select: { value: true } });
  return asBoolean(setting?.value);
}
export async function readShippingSackSeqShowTotal(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.SHIPPING_SACK_SEQ_SHOW_TOTAL }, select: { value: true } });
  return asBoolean(setting?.value);
}
export async function readShippingSackSeqPrefix(tx?: Pick<typeof prisma, "systemSetting">): Promise<ShippingSackSeqPrefix> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.SHIPPING_SACK_SEQ_PREFIX }, select: { value: true } });
  return sanitizeSackSeqPrefix(setting?.value);
}
export async function readShippingSackSeqPrefixLive(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.SHIPPING_SACK_SEQ_PREFIX_LIVE }, select: { value: true } });
  return asBoolean(setting?.value);
}
export async function readShippingReturnFootnote(tx?: Pick<typeof prisma, "systemSetting">): Promise<string> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.SHIPPING_RETURN_FOOTNOTE }, select: { value: true } });
  return sanitizeReturnFootnote(setting?.value);
}
export async function readShippingSackSeqStart(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.SHIPPING_SACK_SEQ_START }, select: { value: true } });
  if (!setting) return DEFAULT_SHIPPING_SACK_SEQ_START;
  const n = asNumber(setting.value);
  return n === null || !Number.isInteger(n) || n < 0 || n > SHIPPING_SACK_SEQ_START_MAX ? DEFAULT_SHIPPING_SACK_SEQ_START : n;
}
export async function readTezgahEscalationGraceMinutes(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES }, select: { value: true } });
  if (!setting) return DEFAULT_TEZGAH_ESCALATION_GRACE_MINUTES;
  const n = asNumber(setting.value);
  return n === null || !Number.isInteger(n) || n < 0 || n > TEZGAH_ESCALATION_GRACE_MINUTES_MAX ? DEFAULT_TEZGAH_ESCALATION_GRACE_MINUTES : n;
}
/** Dokuma alarm motoru HAM değeri — panel geri-okuması; enforcement `resolveTezgahAlarmEnabled`. Default FALSE. */
export async function readTezgahAlarmEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.TEZGAH_ALARM_ENABLED }, select: { value: true } });
  return asBoolean(setting?.value);
}
/** §3.6 tek resolver: alarm yalnız tezgah modülü (lisans tavanı dahil) ∧ bayrak açıkken çalışır. */
export async function resolveTezgahAlarmEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  if (!(await readTezgahEnabled(tx))) return false;
  return readTezgahAlarmEnabled(tx);
}
/** Sebepsiz duruş ortak hedefi (dk) — satır yok / 0 / bozuk → null (izlenmez). */
export async function readTezgahAlarmUnclassifiedTargetMinutes(tx?: Pick<typeof prisma, "systemSetting">): Promise<number | null> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_TARGET_MINUTES }, select: { value: true } });
  if (!setting) return null;
  const n = asNumber(setting.value);
  return n === null || !Number.isInteger(n) || n < 1 || n > TEZGAH_ALARM_UNCLASSIFIED_TARGET_MAX ? null : n;
}
/** Sebepsiz duruşta alarm — satır yok → süreden türer (boş = kapalı, sayı = açık; bugünkü davranış). */
export async function readTezgahAlarmUnclassifiedEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_ENABLED }, select: { value: true } });
  if (!setting) return (await readTezgahAlarmUnclassifiedTargetMinutes(tx)) !== null;
  return asBoolean(setting.value);
}
/** Motor ve salonun okuduğu TEK etkin sebepsiz hedef: tezgah modülü ya da sebepsiz anahtar kapalıysa null (izlenmez). */
export async function resolveTezgahAlarmUnclassifiedTarget(tx?: Pick<typeof prisma, "systemSetting">): Promise<number | null> {
  if (!(await readTezgahEnabled(tx))) return null;
  if (!(await readTezgahAlarmUnclassifiedEnabled(tx))) return null;
  return readTezgahAlarmUnclassifiedTargetMinutes(tx);
}
/** Üstlenilmiş alarm da K2'ye çıkar mı — satır yok = AÇIK (tasarım kararı: üstlenmek iletimi durdurmaz). */
export async function readTezgahAlarmEscalateWhenAcked(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.TEZGAH_ALARM_ESCALATE_WHEN_ACKED }, select: { value: true } });
  if (!setting) return true;
  return asBoolean(setting.value);
}
/** Vardiyasız zamanda alarm kipi — satır yok / çöp → `WARN` (bugünkü davranış). */
export async function readTezgahAlarmNoShiftMode(tx?: Pick<typeof prisma, "systemSetting">): Promise<TezgahAlarmNoShiftMode> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.TEZGAH_ALARM_NO_SHIFT_MODE }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && TEZGAH_ALARM_NO_SHIFT_MODES.includes(v as TezgahAlarmNoShiftMode) ? (v as TezgahAlarmNoShiftMode) : DEFAULT_TEZGAH_ALARM_NO_SHIFT_MODE;
}
export async function readTezgahAlarmRenotifyMinutes(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.TEZGAH_ALARM_RENOTIFY_MINUTES }, select: { value: true } });
  if (!setting) return DEFAULT_TEZGAH_ALARM_RENOTIFY_MINUTES;
  const n = asNumber(setting.value);
  return n === null || !Number.isInteger(n) || n < 1 || n > TEZGAH_ALARM_RENOTIFY_MINUTES_MAX ? DEFAULT_TEZGAH_ALARM_RENOTIFY_MINUTES : n;
}
export async function readTezgahMaxOpenStopHours(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.TEZGAH_MAX_OPEN_STOP_HOURS }, select: { value: true } });
  if (!setting) return DEFAULT_TEZGAH_MAX_OPEN_STOP_HOURS;
  const n = asNumber(setting.value);
  return n === null || !Number.isInteger(n) || n < 1 || n > TEZGAH_MAX_OPEN_STOP_HOURS_MAX ? DEFAULT_TEZGAH_MAX_OPEN_STOP_HOURS : n;
}
export async function readTezgahCollectorSilenceMinutes(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.TEZGAH_COLLECTOR_SILENCE_MINUTES }, select: { value: true } });
  if (!setting) return DEFAULT_TEZGAH_COLLECTOR_SILENCE_MINUTES;
  const n = asNumber(setting.value);
  return n === null || !Number.isInteger(n) || n < 1 || n > TEZGAH_COLLECTOR_SILENCE_MINUTES_MAX ? DEFAULT_TEZGAH_COLLECTOR_SILENCE_MINUTES : n;
}
export async function readPackingPoolPackageNo(tx?: Pick<typeof prisma, "systemSetting">): Promise<PackingPoolPackageNo> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.PACKING_POOL_PACKAGE_NO }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && PACKING_POOL_PACKAGE_NO_MODES.includes(v as PackingPoolPackageNo) ? (v as PackingPoolPackageNo) : DEFAULT_PACKING_POOL_PACKAGE_NO;
}
