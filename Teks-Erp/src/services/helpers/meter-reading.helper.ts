// =============================================================================
// METRE ÖLÇÜM KAYNAĞI — ortak gövde şeması + zayıf halka + Tambur kapıları (D4-B1, DALGA4 §3)
// =============================================================================
// Kurşun okuma gövdesi ile Tambur `measure` gövdesi kaynak alanlarını BURADAN alır (iki şema
// ayrışırsa iki uç iki farklı kaynak kümesi kabul eder). Sapmanın kaynağı "zayıf halka"dır:
// sıralama YALNIZ `weakestMeasureSource`te yaşar — ikinci sıralamayı `test_tambur_olcum_kaynagi`
// AST bölümü reddeder.
// =============================================================================
import { MachineDataSource, type MeterApprovalMode, type MeterVarianceBasis, type RollMeterReading } from "@prisma/client";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { readTamburMeasureSourceRequired, readTamburSimulatedMeterEnabled } from "../system-setting.service";

/** İstemcinin beyan edebileceği kaynaklar (`INFERRED` sunucu türetimidir, gövdeden gelmez). */
export const MEASURE_SOURCES = ["MACHINE", "OPERATOR", "SUPERVISOR", "SIMULATED"] as const;
export type MeasureSource = (typeof MEASURE_SOURCES)[number];

/**
 * Ölçüm kaynağı gövdesi. Kurşun okuma gövdesi alanlarını `.shape` ile düz yayar (mesajlar bayt-aynı);
 * Tambur `measure` alanı bu katı nesnedir (tanınmayan anahtar 400 — sessiz eleme yok).
 */
export const meterSourceSchema = z.strictObject({
  source: z.enum(MEASURE_SOURCES),
  peripheralId: z.string().uuid("Geçersiz cihaz ID").nullish(),
  rawCounter: z.number().min(0).lt(1e11, "Sayaç değeri çok büyük").nullish(),
  cardSampleId: z.string().uuid("Geçersiz örnek ID").nullish(),
});
export type MeterSourceInput = z.infer<typeof meterSourceSchema>;

/** Zayıflık kademesi: yüksek = zayıf. OPERATOR ve SUPERVISOR aynı kademe (elle beyan). */
const WEAKNESS: Record<MeasureSource, number> = { MACHINE: 0, OPERATOR: 1, SUPERVISOR: 1, SIMULATED: 2 };

/**
 * Bir sapmayı doğuran ölçümlerin ZAYIF HALKASI: SIMULATED > OPERATOR/SUPERVISOR > MACHINE.
 * Herhangi biri kaynaksızsa (eski istemci) ya da liste boşsa NULL (bilinmiyor). Aynı kademede
 * OPERATOR kazanır — süpervizör beyanı tek başına kalmadıkça "elle" genel adıyla yazılır.
 */
export function weakestMeasureSource(sources: ReadonlyArray<MeasureSource | null | undefined>): MeasureSource | null {
  if (sources.length === 0) return null;
  let weakest: MeasureSource | null = null;
  for (const s of sources) {
    if (s == null) return null;
    if (weakest === null || WEAKNESS[s] > WEAKNESS[weakest] || (WEAKNESS[s] === WEAKNESS[weakest] && s === "OPERATOR")) {
      weakest = s;
    }
  }
  return weakest;
}

/** Prisma enum'una çevirir (kolon tipi `MachineDataSource?`). */
export function toMachineDataSource(s: MeasureSource | null): MachineDataSource | null {
  return s === null ? null : MachineDataSource[s];
}

/**
 * Tambur kesim gövdelerinin tx DIŞI ön kapısı (fail-closed; kurşun `assertMeterInputAllowed` emsali):
 * kart örneği modeli yok → 400 `CARD_SAMPLE_UNSUPPORTED`; SIMULATED + `tambur.simulatedMeterEnabled`
 * kapalı → 400 `SIMULATED_METER_DISABLED`; `tambur.olcumKaynagiZorunlu` açık ve ölçüm beyanı eksik →
 * 400 `MEASURE_SOURCE_REQUIRED`; bilinmeyen sayaç cihazı → 400 `METER_PERIPHERAL_NOT_FOUND`.
 * `measures` boşsa (kesimsiz istek) kapı bir şey sormaz.
 */
export async function assertTamburMeasuresAllowed(measures: ReadonlyArray<MeterSourceInput | null | undefined>): Promise<void> {
  if (measures.length === 0) return;
  const given = measures.filter((m): m is MeterSourceInput => m != null);
  if (given.some((m) => m.cardSampleId != null)) {
    throw AppError.badRequest("Kart sayaç örneği henüz desteklenmiyor — metreyi sayaçtan ya da elle girin", {
      code: "CARD_SAMPLE_UNSUPPORTED",
    });
  }
  if (given.some((m) => m.source === "SIMULATED") && !(await readTamburSimulatedMeterEnabled())) {
    throw AppError.badRequest("Simüle sayaç okuması kabul edilmiyor — gerçek sayaçtan okuyun ya da metreyi elle girin", {
      code: "SIMULATED_METER_DISABLED",
    });
  }
  if (given.length < measures.length && (await readTamburMeasureSourceRequired())) {
    throw AppError.badRequest("Kesim metresinin ölçüm kaynağı bildirilmedi — tablet uygulamasını güncelleyin", {
      code: "MEASURE_SOURCE_REQUIRED",
    });
  }
  const peripheralIds = [...new Set(given.map((m) => m.peripheralId).filter((id): id is string => id != null))];
  if (peripheralIds.length > 0) {
    const found = await prisma.peripheralDevice.count({ where: { id: { in: peripheralIds }, deletedAt: null } });
    if (found !== peripheralIds.length) throw AppError.badRequest("Sayaç cihazı bulunamadı", { code: "METER_PERIPHERAL_NOT_FOUND" });
  }
}

/**
 * IN/OUT okumasının politika kopyası. D4-B1'den beri kolonlar CUT için NULL olabilir; IN/OUT'ta DB CHECK
 * (`roll_meter_readings_policy_by_phase`) doluluğu garanti eder — NULL burada şema ihlalidir, sessizce varsayılana düşülmez.
 */
export function readingPolicyOf(
  reading: Pick<RollMeterReading, "basis" | "approvalMode">,
): { basis: MeterVarianceBasis; approvalMode: MeterApprovalMode } {
  if (reading.basis == null || reading.approvalMode == null) {
    throw new Error("Metre okumasında politika kopyası yok (IN/OUT satırı CHECK ihlali)");
  }
  return { basis: reading.basis, approvalMode: reading.approvalMode };
}
