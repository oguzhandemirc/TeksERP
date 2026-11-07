// =============================================================================
// TeksERP - System Setting / general
// =============================================================================
// Firma adı · fabrika dilimi · sipariş/iş emri gün varsayılanları.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { DEFAULT_COMPANY_NAME } from "../../constants/company";
import { factoryTimezoneWarning, getFactoryTimezone } from "../../constants/time";
import { applyFactoryTimezoneRows } from "../helpers/factory-timezone-state.helper";
import { uyari } from "../../lib/logger";
import { asNumber } from "./core";
import { DEFAULT_DEADLINE_DAYS } from "./defaults";
import { SETTING_KEYS } from "./keys";


/**
 * ERP'nin kurulduğu firmanın adını okur (yoksa/boşsa default'a düşer). Panel
 * marka başlığı + uygulama geneli kullanır. Refakat kartının kendi firma adından
 * bağımsızdır (kart snapshot'ı ayrı saklanır, geçmiş kartlar değişmez).
 */
export async function readCompanyName(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<string> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.COMPANY_NAME },
    select: { value: true },
  });
  const v = setting?.value;
  return typeof v === "string" && v.trim() ? v : DEFAULT_COMPANY_NAME;
}

export function publicTimezoneWarning(): { factoryTimezoneWarning?: { code: string; message: string } } {
  const w = factoryTimezoneWarning();
  return w ? { factoryTimezoneWarning: { code: w.code, message: w.message } } : {};
}

/**
 * Ayar önbelleği tazelenirken süreç içi dönem listesini dönem defteriyle (+ eski tek değerli `company.timezone`
 * yorumu) hizalar ve ŞU ANKİ dilimi döner. Tek yazar dışı değişiklik de böylece görünür.
 */
export async function readFactoryTimezonePeriods(valueByKey: Map<string, unknown>): Promise<string> {
  const rows = await prisma.factoryTimezonePeriod.findMany({
    select: { id: true, timeZone: true, validFrom: true, createdAt: true, reversesPeriodId: true },
    orderBy: [{ validFrom: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const legacyKey = SETTING_KEYS.COMPANY_TIMEZONE;
  const { storedInvalid } = applyFactoryTimezoneRows(rows, { present: valueByKey.has(legacyKey), value: valueByKey.get(legacyKey) });
  if (storedInvalid) uyari("saat-dilimi", `kayıtlı saat dilimi geçersiz — o dönem varsayılanla yorumlanıyor (şu an ${getFactoryTimezone()})`);
  return getFactoryTimezone();
}

/**
 * Pozitif tamsayı setting okuyucu — yoksa veya geçersizse default döner.
 * 0/negatif/NaN/Infinity → default. Float verilirse Math.floor uygulanır.
 */
async function readPositiveIntSetting(
  key: string,
  fallback: number,
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key },
    select: { value: true },
  });
  if (!setting) return fallback;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 1) return fallback;
  return Math.floor(parsed);
}

/**
 * Sipariş termini default gün sayısı. Order.create'de deadline verilmediyse
 * orderDate + N gün hesaplanır. Yoksa/geçersizse 7.
 */
export async function readOrderDefaultDeadlineDays(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  return readPositiveIntSetting(
    SETTING_KEYS.ORDER_DEFAULT_DEADLINE_DAYS,
    DEFAULT_DEADLINE_DAYS,
    tx,
  );
}

/**
 * İş emri planlama default süresi (gün). WorkOrder.create/update'de
 * plannedEndDate verilmediyse plannedStartDate + N gün hesaplanır.
 * Yoksa/geçersizse 7.
 */
export async function readWorkOrderDefaultPlanDurationDays(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  return readPositiveIntSetting(
    SETTING_KEYS.WORKORDER_DEFAULT_PLAN_DURATION_DAYS,
    DEFAULT_DEADLINE_DAYS,
    tx,
  );
}
