// =============================================================================
// METRE ÖLÇÜM KAYNAĞI — ortak gövde şeması + zayıf halka + Tambur kapıları (D4-B1, DALGA4 §3)
// =============================================================================
// Kurşun okuma gövdesi ile Tambur `measure` gövdesi kaynak alanlarını BURADAN alır (iki şema
// ayrışırsa iki uç iki farklı kaynak kümesi kabul eder). Sapmanın kaynağı "zayıf halka"dır:
// sıralama YALNIZ `weakestMeasureSource`te yaşar — ikinci sıralamayı `test_tambur_olcum_kaynagi`
// AST bölümü reddeder.
// `roll_meter_readings`e YAZIM (satır yaratma + damga) YALNIZ bu dosyadan geçer — kurşun IN/OUT
// okuması da Tambur CUT okuması da aynı boğazı kullanır (ikinci yazarı `test_tambur_olcum_kaynagi` §15 reddeder).
// =============================================================================
import { randomUUID } from "node:crypto";
import { MachineDataSource, MeterPhase, Prisma, type MeterApprovalMode, type MeterVarianceBasis, type RollMeterReading } from "@prisma/client";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { factoryDayEnd, factoryYmd } from "../../constants/time";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
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

type Tx = Prisma.TransactionClient;

/** Okuma satırı yaratan TEK çağrı (kurşun `writeMeterReadingTx` + Tambur `writeCutReadingsTx`). */
export async function insertMeterReadingTx(tx: Tx, args: { data: Prisma.RollMeterReadingUncheckedCreateInput }): Promise<RollMeterReading> {
  return tx.rollMeterReading.create(args);
}

/** Damga — ATOMİK: yalnız hâlâ aktif (`revokedAt: null`) satırlar; dönen sayı gerçekten damgalanandır. */
export async function stampMeterReadingsTx(
  tx: Tx,
  where: Prisma.RollMeterReadingWhereInput,
  stamp: { revokedAt: Date; revokedById: string | null; revokeReason: string },
): Promise<number> {
  const res = await tx.rollMeterReading.updateMany({ where: { AND: [where, { revokedAt: null }] }, data: stamp });
  return res.count;
}

/** Tambur kesiminde doğan çocuk + gövdedeki ölçüm beyanı (eski APK: `measure` yok → okuma yazılmaz). */
export interface CutReadingInput {
  rollId: string;
  meters: Prisma.Decimal | number;
  measure: MeterSourceInput | null | undefined;
}

/**
 * D4-B1b: Tambur CUT okumaları — çocuk doğduktan sonra AYNI tx'te. Token sunucu üretir (kesim
 * yolunun kendi idempotency'si replay'de tx'i hiç açmaz); politika alanları CUT'ta yok (CHECK izinli).
 */
export async function writeCutReadingsTx(
  tx: Tx,
  args: { stepId: string; machineId: string | null; userId: string | null; cuts: CutReadingInput[] },
): Promise<RollMeterReading[]> {
  const written: RollMeterReading[] = [];
  for (const c of args.cuts) {
    if (!c.measure) continue;
    written.push(await insertMeterReadingTx(tx, { data: {
      rollId: c.rollId,
      workOrderStepId: args.stepId,
      phase: MeterPhase.CUT,
      meters: new Prisma.Decimal(c.meters).toDecimalPlaces(3),
      rawCounter: c.measure.rawCounter == null ? null : new Prisma.Decimal(c.measure.rawCounter),
      source: MachineDataSource[c.measure.source],
      machineId: args.machineId,
      peripheralId: c.measure.peripheralId ?? null,
      clientToken: randomUUID(),
      createdById: args.userId,
    } }));
  }
  return written;
}

/** Geri alınan/iptal edilen kesim çocuklarının aktif CUT okumalarını damgalar (ters yol). Dönen: damgalanan id'ler. */
export async function revokeCutReadingsTx(
  tx: Tx,
  args: { rollIds: string[]; userId: string | null; reason: string },
): Promise<string[]> {
  if (args.rollIds.length === 0) return [];
  const where = { rollId: { in: args.rollIds }, phase: MeterPhase.CUT, revokedAt: null };
  const rows = await tx.rollMeterReading.findMany({ where, select: { id: true } });
  if (rows.length === 0) return [];
  const stamp = { revokedAt: new Date(), revokedById: args.userId, revokeReason: args.reason.slice(0, 300) };
  // Damga eşzamanlı bir tx'le yarışabilir: yalnız GERÇEKTEN bu çağrının damgaladığı id'ler döner (audit izi yanıltmasın).
  const stamped: string[] = [];
  for (const r of rows) {
    if ((await stampMeterReadingsTx(tx, { id: r.id }, stamp)) > 0) stamped.push(r.id);
  }
  return stamped;
}

/** Top iptalinin CUT damga sebebi — `restoreCancelledRoll` bu sebeple damgalananları yeniden kurar. */
export const ROLL_CANCEL_CUT_REASON = "ROLL_CANCEL";

/**
 * İPTALİ GERİ ALMA = iptal damgasının TERSİ: son iptalde damgalanan CUT okumaları YENİ satır olarak
 * yeniden yazılır (damgalı satır değişmez — defter silinmez). Dirilen top okumasız kalırsa hizmet
 * faturası `initialQty` tabanına düşer ve asıl SIMULATED kaynağı kaybolur (K4).
 */
export async function reinstateCancelledCutReadingsTx(
  tx: Tx,
  args: { rollId: string; userId: string | null },
): Promise<RollMeterReading[]> {
  const active = await tx.rollMeterReading.count({ where: { rollId: args.rollId, phase: MeterPhase.CUT, revokedAt: null } });
  if (active > 0) return [];
  const last = await tx.rollMeterReading.findFirst({
    where: { rollId: args.rollId, phase: MeterPhase.CUT, revokeReason: ROLL_CANCEL_CUT_REASON, revokedAt: { not: null } },
    orderBy: [{ revokedAt: "desc" }, { id: "desc" }],
    select: { revokedAt: true },
  });
  if (!last?.revokedAt) return [];
  const rows = await tx.rollMeterReading.findMany({
    where: { rollId: args.rollId, phase: MeterPhase.CUT, revokeReason: ROLL_CANCEL_CUT_REASON, revokedAt: last.revokedAt },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const written: RollMeterReading[] = [];
  for (const r of rows) {
    written.push(await insertMeterReadingTx(tx, { data: {
      rollId: r.rollId,
      workOrderStepId: r.workOrderStepId,
      phase: MeterPhase.CUT,
      meters: r.meters,
      rawCounter: r.rawCounter,
      source: r.source,
      machineId: r.machineId,
      peripheralId: r.peripheralId,
      cardSampleId: r.cardSampleId,
      clientToken: randomUUID(),
      createdById: args.userId,
    } }));
  }
  return written;
}

/**
 * Kalan sapmasının kaynağı: kesim çocuklarının aktif CUT okumalarının zayıf halkası. Okuması
 * olmayan tek çocuk (eski APK / adımsız depo kesimi) sonucu NULL yapar — bilinmeyen kaynak uydurulmaz.
 */
export async function cutChildrenMeasureSourceTx(tx: Tx, childIds: string[]): Promise<MachineDataSource | null> {
  if (childIds.length === 0) return null;
  const rows = await tx.rollMeterReading.findMany({
    where: { rollId: { in: childIds }, phase: MeterPhase.CUT, revokedAt: null },
    select: { rollId: true, source: true },
  });
  const byRoll = new Map(rows.map((r) => [r.rollId, r.source]));
  const sources = childIds.map((id) => {
    const s = byRoll.get(id);
    return s && (MEASURE_SOURCES as readonly string[]).includes(s) ? (s as MeasureSource) : null;
  });
  return toMachineDataSource(weakestMeasureSource(sources));
}

/** CUT okumalarının ayak izi (tx DIŞI, best-effort). Yükte fiyat yok. */
export async function auditCutReadings(
  userId: string | null | undefined,
  readings: Array<Pick<RollMeterReading, "id" | "rollId" | "workOrderStepId" | "meters" | "source" | "machineId">>,
  revoked: { ids: string[]; reason: string } | null = null,
): Promise<void> {
  for (const r of readings) {
    await AuditService.log({
      userId: userId ?? undefined, action: "CREATE", tableName: "ROLL_METER_READING", recordId: r.id,
      newData: { phase: "CUT", rollId: r.rollId, workOrderStepId: r.workOrderStepId, meters: Number(r.meters), source: r.source, machineId: r.machineId },
    });
  }
  for (const id of revoked?.ids ?? []) {
    await AuditService.log({
      userId: userId ?? undefined, action: "UPDATE", tableName: "ROLL_METER_READING", recordId: id,
      newData: { phase: "CUT", revoked: true, reason: revoked!.reason },
    });
  }
}

/**
 * D4-G2b: makine × fabrika günü ölçülen metre — kârlılıkta makine-saat maliyetini o günün metresine bölmenin paydası.
 * As-of: okuma, kaydedildiği günün SONUNDA damgasızsa sayılır (sonradan düzeltme geçmiş günü değiştirmez). Aynı top ×
 * adımın birden çok fazı tek iştir: CUT, yoksa OUT, yoksa IN (iki kez sayılmaz). Anahtar `${machineId}|${YYYY-MM-DD}`.
 */
export async function machineDailyMeters(machineIds: string[], start: Date, end: Date): Promise<Map<string, Prisma.Decimal>> {
  const out = new Map<string, Prisma.Decimal>();
  if (machineIds.length === 0) return out;
  const rows = await prisma.rollMeterReading.findMany({
    where: { machineId: { in: machineIds }, createdAt: { gte: start, lt: end } },
    select: { machineId: true, rollId: true, workOrderStepId: true, phase: true, meters: true, createdAt: true, revokedAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const rank: Record<MeterPhase, number> = { CUT: 3, OUT: 2, IN: 1 };
  const best = new Map<string, { day: string; machineId: string; phase: MeterPhase; meters: Prisma.Decimal }>();
  for (const r of rows) {
    if (r.machineId === null) continue;
    if (r.revokedAt !== null && r.revokedAt.getTime() <= factoryDayEnd(r.createdAt).getTime()) continue;
    const day = factoryYmd(r.createdAt);
    const k = `${r.machineId}|${day}|${r.rollId}|${r.workOrderStepId}`;
    const prev = best.get(k);
    if (!prev || rank[r.phase] > rank[prev.phase]) best.set(k, { day, machineId: r.machineId, phase: r.phase, meters: r.meters });
  }
  for (const b of best.values()) {
    const k = `${b.machineId}|${b.day}`;
    out.set(k, (out.get(k) ?? new Prisma.Decimal(0)).plus(b.meters));
  }
  return out;
}
