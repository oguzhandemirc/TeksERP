// =============================================================================
// TeksERP — TEZGAH KÜNYESİ (MachineSpec) yazma yüzeyi + GÖLGE MOD durum makinesi (B3)
// =============================================================================
// DOKUMA-TEZGAH-IZLEME-TASARIMI §2.3: izleme hâli TEK kolondur (`monitoringState`,
// OFF → SHADOW → LIVE), boolean değil; gölge mod bir KOLON + KAPIDIR.
//   • künye upsert: ALLOWLIST — `monitoringState` ve damgalar GÖVDEDEN YAZILAMAZ
//     (BaseController "yeni skaler = yazılabilir alan" tuzağı burada yok: alanlar adıyla).
//   • OFF→SHADOW: atomik claim (`updateMany WHERE monitoringState: OFF`), count 0 → 409.
//   • SHADOW→LIVE (`goLive`): ÜÇ ŞART, sıra ÖLÇÜLEBİLİRDEN ÖLÇÜLEMEYENE —
//       ② ≥ SHADOW_MIN_SHIFTS mühürlü ∧ donmuş `monitoringState=SHADOW` karne → 409 SHADOW_TOO_SHORT
//       ① kapsamdaki her aktif sinyal kabul damgalı → `PeripheralSignal` tablosu Faz 2'de;
//          bugün KANIT YOK ⇒ FAIL-CLOSED 409 SIGNAL_NOT_ACCEPTED ("sinyal kabulü Faz 2 ile açılır")
//          ⇒ LIVE bugün ERİŞİLEMEZ — beyanlı kapı, çıkışsız değil: SHADOW erişilir, karneler mühürlenir.
//       ③ anomali oranı → kaynak (`MachineCounterEvent`) Faz 2; ölçülemez, beyan.
//     Tasarım sırası ①②③; ① bugün her zaman 409 olduğu için ②'nin ölçülebilmesi adına ② önce.
//   • LIVE→SHADOW: SEBEPLİ demote; `acceptedAt` ASLA null'lanmaz (ileri damga), demote ayrı damga.
// Audit best-effort, tx dışında (`MACHINE_SPEC`).
// =============================================================================
import { LoomShedType, MachineMonitoringState, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import type { ApiResponse } from "../types/api.types";
import { SHADOW_MIN_SHIFTS } from "../constants/loom-shift";

const TABLE = "MACHINE_SPEC";

export const MACHINE_SPEC_SELECT = {
  id: true, machineId: true, shedType: true, monitoringState: true, acceptedAt: true, acceptedById: true, acceptedNote: true,
  demotedAt: true, demotedById: true, demoteReason: true, nominalUnitsPerMin: true, baselineRunHours: true, baselineAt: true, notes: true,
  createdAt: true, updatedAt: true,
  machine: { select: { code: true, name: true, isActive: true } },
} satisfies Prisma.MachineSpecSelect;
export type MachineSpecDto = Prisma.MachineSpecGetPayload<{ select: typeof MACHINE_SPEC_SELECT }>;

/** Gövdeden yazılabilen alanlar — ALLOWLIST (izleme hâli ve damgalar DIŞARIDA, kendi uçları var). */
export interface MachineSpecUpsertInput {
  shedType?: LoomShedType | null;
  nominalUnitsPerMin?: number | null;
  baselineRunHours?: number | null;
  baselineAt?: Date | null;
  notes?: string | null;
}
export const MACHINE_SPEC_WRITABLE = ["shedType", "nominalUnitsPerMin", "baselineRunHours", "baselineAt", "notes"] as const;

async function loadSpec(machineId: string): Promise<MachineSpecDto> {
  const s = await prisma.machineSpec.findUnique({ where: { machineId }, select: MACHINE_SPEC_SELECT });
  if (!s) throw AppError.notFound("Tezgah künyesi bulunamadı", { machineId });
  return s;
}

export async function getMachineSpec(machineId: string): Promise<ApiResponse<MachineSpecDto>> {
  return { success: true, data: await loadSpec(machineId) };
}

export async function upsertMachineSpec(machineId: string, input: MachineSpecUpsertInput, userId?: string): Promise<ApiResponse<MachineSpecDto>> {
  const machine = await prisma.machine.findUnique({ where: { id: machineId }, select: { id: true, isActive: true } });
  if (!machine) throw AppError.notFound("Makine bulunamadı", { machineId });
  if (!machine.isActive) throw AppError.badRequest("Pasif makineye künye yazılamaz.", { code: "MACHINE_INACTIVE" });
  const data: Partial<Record<(typeof MACHINE_SPEC_WRITABLE)[number], unknown>> = {};
  for (const k of MACHINE_SPEC_WRITABLE) if (input[k] !== undefined) data[k] = input[k];
  const before = await prisma.machineSpec.findUnique({ where: { machineId }, select: MACHINE_SPEC_SELECT });
  // Bakiye tarihsiz olamaz ("hangi güne kadar"): verilmediyse ve künyede yoksa bugün.
  if (input.baselineRunHours != null && input.baselineAt === undefined && !before?.baselineAt) data.baselineAt = new Date();
  const fields = data as Omit<Prisma.MachineSpecUncheckedCreateInput, "machineId">;
  const row = await prisma.machineSpec.upsert({
    where: { machineId },
    create: { machineId, ...fields, createdById: userId ?? null },
    update: { ...fields, updatedById: userId ?? null },
    select: MACHINE_SPEC_SELECT,
  });
  await AuditService.log({
    userId, action: before ? "UPDATE" : "CREATE", tableName: TABLE, recordId: row.id,
    ...(before ? { changes: MACHINE_SPEC_WRITABLE.filter((k) => input[k] !== undefined).map((k) => ({ field: k, old: before[k], new: row[k] })) } : { newData: { machineId } }),
  }).catch(() => undefined);
  return { success: true, data: row, message: before ? "Künye güncellendi" : "Künye oluşturuldu (izleme KAPALI)" };
}

// ─────────────────────────────────────────────────────────────────────────────
// GÖLGE MOD durum makinesi
// ─────────────────────────────────────────────────────────────────────────────
interface Transition {
  machineId: string;
  from: MachineMonitoringState;
  to: MachineMonitoringState;
  data: Prisma.MachineSpecUncheckedUpdateInput;
  /** count 0 → 409 kodu ve mesajı (taze durum `details.monitoringState`te). */
  conflict: { code: string; msg: string };
}

/** Atomik claim: `updateMany WHERE { machineId, monitoringState: from }`; count 0 → taze okuma → 409. */
async function transition(t: Transition): Promise<void> {
  const r = await prisma.machineSpec.updateMany({ where: { machineId: t.machineId, monitoringState: t.from }, data: { ...t.data, monitoringState: t.to } });
  if (r.count === 0) {
    const fresh = await prisma.machineSpec.findUnique({ where: { machineId: t.machineId }, select: { monitoringState: true } });
    if (!fresh) throw AppError.notFound("Tezgah künyesi bulunamadı", { machineId: t.machineId });
    throw AppError.conflict(t.conflict.msg, { code: t.conflict.code, machineId: t.machineId, monitoringState: fresh.monitoringState });
  }
}

/** OFF → SHADOW: gölge mod başlar — duruş/koşum/karne normal yazılır ve mühürlenir; DEFTER raporları süzer. */
export async function startShadow(machineId: string, userId?: string): Promise<ApiResponse<MachineSpecDto>> {
  await transition({ machineId, from: "OFF", to: "SHADOW", data: { updatedById: userId ?? null }, conflict: { code: "SPEC_NOT_OFF", msg: "Gölge mod yalnız izleme KAPALI künyede başlatılır." } });
  const row = await loadSpec(machineId);
  await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: row.id, changes: [{ field: "monitoringState", old: "OFF", new: "SHADOW" }] }).catch(() => undefined);
  return { success: true, data: row, message: "Gölge mod başladı — karneler mühürlenir, deftere yayınlanmaz" };
}

export interface GoLiveGates {
  /** ② mühürlü gölge karne sayısı / eşik. */
  sealedShadowShifts: number;
  requiredShifts: number;
  /** ① `PeripheralSignal` tablosu Faz 2'de — kanıt ölçülemez ⇒ fail-closed. */
  signalAcceptanceMeasurable: false;
  /** ③ anomali kaynağı Faz 2'de — ölçülemez, beyan. */
  anomalyMeasurable: false;
}

/** Üç şartın bugünkü ölçümü — `goLive` ve bekçi aynı fonksiyonu okur. */
export async function measureGoLiveGates(machineId: string): Promise<GoLiveGates> {
  const sealedShadowShifts = await prisma.machineShiftStat.count({ where: { machineId, sealState: "SEALED", monitoringState: "SHADOW" } });
  return { sealedShadowShifts, requiredShifts: SHADOW_MIN_SHIFTS, signalAcceptanceMeasurable: false, anomalyMeasurable: false };
}

/** SHADOW → LIVE: üç şart; sıra ölçülebilirden ölçülemeyene (başlıktaki gerekçe). */
export async function goLive(machineId: string, userId?: string, note?: string | null): Promise<ApiResponse<MachineSpecDto>> {
  const cur = await prisma.machineSpec.findUnique({ where: { machineId }, select: { monitoringState: true } });
  if (!cur) throw AppError.notFound("Tezgah künyesi bulunamadı", { machineId });
  if (cur.monitoringState !== "SHADOW") {
    throw AppError.conflict("LIVE'a yalnız gölge moddaki künye geçer (önce OFF → SHADOW).", { code: "SPEC_NOT_SHADOW", machineId, monitoringState: cur.monitoringState });
  }
  const g = await measureGoLiveGates(machineId);
  if (g.sealedShadowShifts < g.requiredShifts) {
    throw AppError.conflict(`Gölge mod kısa: ${g.sealedShadowShifts}/${g.requiredShifts} mühürlü gölge vardiya.`, { code: "SHADOW_TOO_SHORT", machineId, ...g });
  }
  if (!g.signalAcceptanceMeasurable) {
    throw AppError.conflict(
      "Kanal kabulü ölçülemiyor: sinyal tablosu (PeripheralSignal) ve kabul ucu Faz 2 ile açılır — kabul damgası olmayan kanalla LIVE'a geçilmez.",
      { code: "SIGNAL_NOT_ACCEPTED", machineId, missingSignals: [], reason: "PERIPHERAL_SIGNAL_NOT_AVAILABLE", ...g },
    );
  }
  // ③ anomali — kaynak Faz 2; buraya ancak ① ölçülebilir olunca gelinir.
  await transition({
    machineId, from: "SHADOW", to: "LIVE",
    data: { acceptedAt: new Date(), acceptedById: userId ?? null, acceptedNote: note?.slice(0, 300) ?? null, updatedById: userId ?? null },
    conflict: { code: "SPEC_NOT_SHADOW", msg: "LIVE'a yalnız gölge moddaki künye geçer." },
  });
  const row = await loadSpec(machineId);
  await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: row.id, changes: [{ field: "monitoringState", old: "SHADOW", new: "LIVE" }] }).catch(() => undefined);
  return { success: true, data: row, message: "Tezgah yayında (LIVE)" };
}

/** LIVE → SHADOW: sebepli demote; `acceptedAt` KALIR (ileri damga null'lanmaz), demote ayrı damga. */
export async function demoteToShadow(machineId: string, reason: string, userId?: string): Promise<ApiResponse<MachineSpecDto>> {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length < 3) throw AppError.badRequest("Demote gerekçesi en az 3 karakter olmalı.", { code: "DEMOTE_REASON_REQUIRED" });
  await transition({
    machineId, from: "LIVE", to: "SHADOW",
    data: { demotedAt: new Date(), demotedById: userId ?? null, demoteReason: trimmed.slice(0, 300), updatedById: userId ?? null },
    conflict: { code: "SPEC_NOT_LIVE", msg: "Demote yalnız LIVE künyede." },
  });
  const row = await loadSpec(machineId);
  await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: row.id, changes: [{ field: "monitoringState", old: "LIVE", new: "SHADOW" }, { field: "demoteReason", old: null, new: trimmed.slice(0, 300) }] }).catch(() => undefined);
  return { success: true, data: row, message: "Tezgah gölge moda alındı (sebepli)" };
}
