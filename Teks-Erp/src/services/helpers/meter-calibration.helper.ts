// =============================================================================
// SAYAÇ KALİBRASYON UYARISI — D4-B5k (B-3, kullanıcı kararı 2026-10-31: kayıt isteğe bağlı, zorunluluk yok)
// =============================================================================
// `tambur.kalibrasyonKontrolu` = UYAR iken vadesi geçmiş METER cihazıyla MACHINE ölçümü yanıta
// `warnings` notu ekler; ölçüm ENGELLENMEZ, kaynak MACHINE kalır. KAPALI (varsayılan) → yanıt bayt-aynı.
// Vade karşılaştırması YALNIZ `isCalibrationExpired`te yaşar (`test_sayac_kalibrasyon` sınar).
// =============================================================================
import { PeripheralKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { uyari } from "../../lib/logger";
import { factoryDateTr, factoryYmd } from "../../constants/time";
import { readTamburCalibrationCheck } from "../system-setting.service";

/** Ölçüm gövdesinin kalibrasyonu ilgilendiren iki alanı (kurşun okuma + Tambur `measure` ortak). */
export interface CalibrationProbe {
  source?: string | null;
  peripheralId?: string | null;
}

/** Vade GÜNÜ dahil geçerli: fabrika günü vadeden SONRAYSA süresi geçmiştir. Vadesiz kayıt hiç geçmez. */
export function isCalibrationExpired(dueAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!dueAt) return false;
  return factoryYmd(now) > factoryYmd(dueAt);
}

/** Tek metin kaynağı — tablet ve panel bu cümleyi aynen gösterir. */
export function calibrationExpiredNotice(device: { name: string; code: string }, dueAt: Date): string {
  return `Sayaç ${device.name} (${device.code}) kalibrasyon süresi ${factoryDateTr(dueAt)} tarihinde doldu — ölçüm kaydedildi, sayacı kalibre ettirin.`;
}

/**
 * Ölçüm(ler)in kalibrasyon notları. Yalnız MACHINE kaynaklı + cihazlı ölçüm sorulur; ayar KAPALI ise
 * DB'ye hiç gidilmez. Not ölçüm YAZILDIKTAN sonra hesaplanır: okuma hatası yanıtı düşürmez (uyarı best-effort).
 */
export async function meterCalibrationWarnings(
  probes: ReadonlyArray<CalibrationProbe | null | undefined>,
  now: Date = new Date(),
): Promise<string[]> {
  const ids = [...new Set(probes.filter((p) => p?.source === "MACHINE" && p.peripheralId).map((p) => p!.peripheralId!))];
  if (ids.length === 0) return [];
  try {
    if ((await readTamburCalibrationCheck()) !== "UYAR") return [];
    const rows = await prisma.peripheralDevice.findMany({
      where: { id: { in: ids }, kind: PeripheralKind.METER, calibrationDueAt: { not: null } },
      select: { name: true, code: true, calibrationDueAt: true },
      orderBy: { code: "asc" },
    });
    return rows.filter((r) => isCalibrationExpired(r.calibrationDueAt, now)).map((r) => calibrationExpiredNotice(r, r.calibrationDueAt!));
  } catch (err) {
    uyari("kalibrasyon", "uyarı hesaplanamadı", (err as Error).message);
    return [];
  }
}

/** Notları yanıt köküne (`ApiResponse.warnings`) ekler; not yoksa AYNI nesne döner (yanıt bayt-aynı). */
export function withResponseWarnings<T extends object>(res: T, warnings: readonly string[]): T {
  if (warnings.length === 0) return res;
  const prior = (res as { warnings?: unknown }).warnings;
  return { ...res, warnings: [...(Array.isArray(prior) ? (prior as string[]) : []), ...warnings] };
}
