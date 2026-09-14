// =============================================================================
// LEVENT SERVİSİ — devere Faz 1b: liste · detay · plan · düzenle · taslağı sil (④)
// (sarım ve sarım iptali: `warp-beam-wind.service.ts` — aynı tek yazar ailesi, lint tavanı için bölündü)
// =============================================================================
// Tasarım: docs/design/DEVERE-LEVENT-TARAMASI.md §4.7. Defter `WarpBeamEvent` append-only; ters yol
// tipli `WOUND_CANCEL` + `reversesEventId` (tek ters, DB'de imkânsız çift iptal). İplik BRÜT çıkar
// (`WARP_ISSUE`), dip AYRI satırla döner (`WARP_RETURN` + sebep zorunlu); iptalde ikisi kendi
// tersiyle NET geri gelir (§4.9-4: iki toplam ayrı ayrı sıfırlanır). Levent doğuşu ile iplik
// tüketimi AYNI tx'te (aynı sürüm — 1b kendi beşlisiyle tam defterdir).
// • Tek yazar `applyWarpBeamEventTx` — ilk ifadesi devere kapısı (route'ta ayrıca `requireDevereEnabled`).
// • Köken XOR'u `resolveOriginParty` (tek kapı); CHECK ikinci hat.
// • Kalan metre KOLON DEĞİL: Σ warpBeamLengthSign(kind) × lengthM.
// • Audit tx DIŞINDA, best-effort.
// =============================================================================
import { Prisma, WarpBeamOrigin, WarpBeamStatus, YarnMovementKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { CursorPaginatedResponse } from "./base.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { buildTextSearch } from "../utils/query-parser";
import { buildNextDynamicCursor, decodeDynamicCursor, dynamicCursorWhere } from "../utils/cursor";
import { AuditService } from "./audit.service";
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";
import { assertWarpBeamReplayAlive } from "./helpers/token-replay.helper";
import { WARP_BEAM_EVENT_KINDS } from "../constants/warp-beam";
import {
  WARP_BEAM_EVENT_SELECT,
  WARP_BEAM_SELECT,
  nextBeamNoTx,
  remainingByBeam,
  resolveOriginParty,
  warpBeamRemainingM,
} from "./helpers/warp-beam.helper";
import { toWarpBeamDto, toWarpBeamEventDto, type WarpBeamDto, type WarpBeamEventDto } from "./helpers/warp-beam-dto.helper";

const WARP_BEAM_TABLE = "WARP_BEAM";
const WARP_BEAM_EVENT_TABLE = "WARP_BEAM_EVENT";
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

// DTO ve eşleyiciler `helpers/warp-beam-dto.helper.ts`te; eski çağıranlar için buradan da dışa açılır.
export { toWarpBeamDto, toWarpBeamEventDto, warpBeamRemainingM, type WarpBeamDto, type WarpBeamEventDto };

// ── LİSTE / DETAY ──────────────────────────────────────────────────────────────
export interface WarpBeamListParams {
  status?: WarpBeamStatus[];
  warpSpecId?: string | null;
  originKind?: WarpBeamOrigin | null;
  search?: string | null;
  cursor?: string | null;
  limit?: number | null;
  withTotal?: boolean;
}

export async function listWarpBeams(params: WarpBeamListParams): Promise<CursorPaginatedResponse<WarpBeamDto>> {
  const limit = Math.min(Math.max(1, params.limit ?? 50), 100);
  const where: Prisma.WarpBeamWhereInput = {};
  if (params.status && params.status.length > 0) where.status = { in: params.status };
  if (params.warpSpecId) where.warpSpecId = params.warpSpecId;
  if (params.originKind) where.originKind = params.originKind;
  const term = params.search?.trim();
  if (term) {
    // `physicalBeamNo` KOD alanıdır (gövde numarası; `physical_live_uq` de tr_fold ile) → code listesi (foldCodeForCompare), fold gölge kolonu yok.
    where.OR = buildTextSearch<Prisma.WarpBeamWhereInput>(term, { text: ["warpSpec.name"], code: ["beamNo", "warpSpec.code", "physicalBeamNo"] });
  }
  const cur = decodeDynamicCursor(params.cursor ?? undefined);
  const pageWhere = cur ? { AND: [where, dynamicCursorWhere(cur, "createdAt", "desc")] } : where;
  const rows = await prisma.warpBeam.findMany({ where: pageWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, select: WARP_BEAM_SELECT });
  const totalEstimate = params.withTotal ? await prisma.warpBeam.count({ where }) : undefined;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1] as Record<string, unknown> | undefined;
  const remaining = await remainingByBeam(prisma, page.map((r) => r.id));
  return {
    success: true,
    data: page.map((r) => toWarpBeamDto(r, remaining.get(r.id))),
    pagination: { nextCursor: hasMore ? buildNextDynamicCursor(last, "createdAt") : null, hasMore, limit, ...(totalEstimate !== undefined ? { totalEstimate } : {}) },
  };
}

export interface WarpBeamYarnLineDto {
  id: string;
  kind: YarnMovementKind;
  qtyKg: number;
  warehouse: { id: string; name: string };
  /** Devere Faz 2: tedarikçi lotu — lotsuz sarılan levent lotsuz kalır (null). */
  lot: { id: string; lotNo: string } | null;
  reasonCode: string | null;
  createdAt: Date;
}

export async function getWarpBeam(id: string): Promise<ApiResponse<WarpBeamDto & { events: WarpBeamEventDto[]; yarnLines: WarpBeamYarnLineDto[] }>> {
  const row = await prisma.warpBeam.findUnique({ where: { id }, select: WARP_BEAM_SELECT });
  if (!row) throw AppError.notFound("Levent bulunamadı");
  const events = await prisma.warpBeamEvent.findMany({ where: { beamId: id }, orderBy: { createdAt: "asc" }, select: WARP_BEAM_EVENT_SELECT });
  const yarn = await prisma.yarnMovement.findMany({
    where: { warpBeamId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, qtyKg: true, reasonCode: true, createdAt: true, warehouse: { select: { id: true, name: true } }, lot: { select: { id: true, lotNo: true } } },
  });
  return {
    success: true,
    data: {
      ...toWarpBeamDto(row, warpBeamRemainingM(events)),
      events: events.map(toWarpBeamEventDto),
      yarnLines: yarn.map((y) => ({ id: y.id, kind: y.kind, qtyKg: Number(y.qtyKg), warehouse: y.warehouse, lot: y.lot, reasonCode: y.reasonCode, createdAt: y.createdAt })),
    },
  };
}

/** Devere makineleri — `Station.producesWarpBeam` istasyonlarının aktif makineleri (WOUND.machineId adayları). */
export async function listDevereMachines(): Promise<ApiResponse<Array<{ id: string; code: string; name: string; stationName: string }>>> {
  const rows = await prisma.machine.findMany({
    where: { isActive: true, station: { producesWarpBeam: true } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, station: { select: { name: true } } },
  });
  return { success: true, data: rows.map((m) => ({ id: m.id, code: m.code, name: m.name, stationName: m.station.name })) };
}

/** Levent BAĞLANABİLEN makineler — `Station.consumesWarpBeam` istasyonlarının aktif makineleri (yuva sayısıyla; Faz 3). */
export async function listLoomMachines(): Promise<ApiResponse<Array<{ id: string; code: string; name: string; stationName: string; warpBeamSlots: number }>>> {
  const rows = await prisma.machine.findMany({
    where: { isActive: true, station: { consumesWarpBeam: true } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, warpBeamSlots: true, station: { select: { name: true } } },
  });
  return { success: true, data: rows.map((m) => ({ id: m.id, code: m.code, name: m.name, stationName: m.station.name, warpBeamSlots: m.warpBeamSlots })) };
}

// ── PLAN (PLANNED) ──────────────────────────────────────────────────────────────
export interface WarpBeamCreateInput {
  warpSpecId: string;
  plannedLengthM: number | string;
  originKind: WarpBeamOrigin;
  subcontractorId?: string | null;
  supplierId?: string | null;
  physicalBeamNo?: string | null;
  notes?: string | null;
  clientToken?: string | null;
}

async function assertSpecActive(warpSpecId: string): Promise<void> {
  const n = await prisma.warpSpec.count({ where: { id: warpSpecId, isActive: true } });
  if (n === 0) throw AppError.badRequest("Çözgü kartı bulunamadı ya da pasif");
}

async function assertParties(p: { subcontractorId: string | null; supplierId: string | null }): Promise<void> {
  if (p.subcontractorId && (await prisma.subcontractor.count({ where: { id: p.subcontractorId, isActive: true } })) === 0) throw AppError.badRequest("Fasoncu bulunamadı ya da pasif");
  if (p.supplierId && (await prisma.customer.count({ where: { id: p.supplierId, isActive: true } })) === 0) throw AppError.badRequest("Tedarikçi (cari) bulunamadı ya da pasif");
}

function normalizePlanned(v: number | string): Prisma.Decimal {
  const d = D(v).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  if (!d.isFinite() || d.lte(0)) throw AppError.badRequest("Plan metresi sıfırdan büyük olmalı");
  return d;
}

export async function createWarpBeam(input: WarpBeamCreateInput, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  const party = resolveOriginParty({ originKind: input.originKind, subcontractorId: input.subcontractorId ?? null, supplierId: input.supplierId ?? null });
  const plannedLengthM = normalizePlanned(input.plannedLengthM);
  if (input.clientToken) {
    const replay = await prisma.warpBeam.findUnique({ where: { clientToken: input.clientToken }, select: WARP_BEAM_SELECT });
    if (replay) {
      assertReplayPayloadMatches(
        [
          { ad: "warpSpecId", mevcut: replay.warpSpecId, gelen: input.warpSpecId },
          { ad: "originKind", mevcut: replay.originKind, gelen: party.originKind },
          { ad: "plannedLengthM", mevcut: replay.plannedLengthM, gelen: plannedLengthM },
        ],
        "Bu istemci anahtarı BAŞKA bir leventle kullanılmış — formu yenileyip yeniden deneyin.",
      );
      assertWarpBeamReplayAlive(replay);
      return { success: true, data: toWarpBeamDto(replay), message: "Levent zaten planlanmış" };
    }
  }
  await assertSpecActive(input.warpSpecId);
  await assertParties(party);
  const created = await withBarcodeRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const beamNo = await nextBeamNoTx(tx, new Date());
        return tx.warpBeam.create({
          data: {
            beamNo,
            warpSpecId: input.warpSpecId,
            status: WarpBeamStatus.PLANNED,
            plannedLengthM,
            physicalBeamNo: input.physicalBeamNo?.trim() || null,
            notes: input.notes?.trim() || null,
            ...party,
            clientToken: input.clientToken ?? null,
            createdById: userId ?? null,
            updatedById: userId ?? null,
          },
          select: WARP_BEAM_SELECT,
        });
      }),
    undefined,
    (err) => Array.isArray(err.meta?.target) && (err.meta.target as string[]).includes("beamNo"),
  );
  await AuditService.log({ userId, action: "CREATE", tableName: WARP_BEAM_TABLE, recordId: created.id, newData: { beamNo: created.beamNo, warpSpecId: created.warpSpecId, originKind: created.originKind, plannedLengthM: Number(created.plannedLengthM) } });
  return { success: true, data: toWarpBeamDto(created), message: `${created.beamNo} planlandı` };
}

export type WarpBeamUpdateInput = Partial<Omit<WarpBeamCreateInput, "clientToken">>;

async function throwNotPlannedTx(tx: Prisma.TransactionClient, id: string, eylem: string): Promise<never> {
  const fresh = await tx.warpBeam.findUnique({ where: { id }, select: { status: true, beamNo: true } });
  if (!fresh) throw AppError.notFound("Levent bulunamadı");
  throw AppError.conflict(`${fresh.beamNo} artık planda değil (${fresh.status}) — ${eylem}`, { code: "WARP_BEAM_NOT_PLANNED", status: fresh.status });
}

/** Yalnız PLANNED düzenlenir; sarılmış levent salt-okunurdur (defter donar). */
export async function updateWarpBeam(id: string, input: WarpBeamUpdateInput, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  const current = await prisma.warpBeam.findUnique({ where: { id }, select: WARP_BEAM_SELECT });
  if (!current) throw AppError.notFound("Levent bulunamadı");
  const party = resolveOriginParty({
    originKind: input.originKind ?? current.originKind,
    subcontractorId: input.subcontractorId === undefined ? current.subcontractorId : input.subcontractorId,
    supplierId: input.supplierId === undefined ? current.supplierId : input.supplierId,
  });
  if (input.warpSpecId) await assertSpecActive(input.warpSpecId);
  await assertParties(party);
  const data: Prisma.WarpBeamUpdateManyMutationInput = {
    ...(input.warpSpecId ? { warpSpecId: input.warpSpecId } : {}),
    ...(input.plannedLengthM !== undefined ? { plannedLengthM: normalizePlanned(input.plannedLengthM) } : {}),
    ...(input.physicalBeamNo !== undefined ? { physicalBeamNo: input.physicalBeamNo?.trim() || null } : {}),
    ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
    ...party,
    updatedById: userId ?? null,
  };
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.warpBeam.updateMany({ where: { id, status: WarpBeamStatus.PLANNED }, data });
    if (r.count === 0) await throwNotPlannedTx(tx, id, "düzenlenemez");
    return tx.warpBeam.findUniqueOrThrow({ where: { id }, select: WARP_BEAM_SELECT });
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: WARP_BEAM_TABLE, recordId: id, oldData: { plannedLengthM: Number(current.plannedLengthM), originKind: current.originKind }, newData: { plannedLengthM: Number(updated.plannedLengthM), originKind: updated.originKind } });
  return { success: true, data: toWarpBeamDto(updated), message: `${updated.beamNo} güncellendi` };
}

/** ④ sınıfı hard delete: deftere HİÇ yazmamış taslak (PLANNED — hiç olayı, hiç iplik satırı yok). Atomik claim. */
export async function deleteWarpBeamDraft(id: string, userId?: string): Promise<ApiResponse<{ id: string }>> {
  const beamNo = await prisma.$transaction(async (tx) => {
    const cur = await tx.warpBeam.findUnique({ where: { id }, select: { beamNo: true } });
    if (!cur) throw AppError.notFound("Levent bulunamadı");
    const r = await tx.warpBeam.deleteMany({ where: { id, status: WarpBeamStatus.PLANNED } });
    if (r.count === 0) await throwNotPlannedTx(tx, id, "silinemez (sarılmış levent iptal edilir, silinmez)");
    return cur.beamNo;
  });
  await AuditService.log({ userId, action: "DELETE", tableName: WARP_BEAM_TABLE, recordId: id, oldData: { beamNo, status: WarpBeamStatus.PLANNED } });
  return { success: true, data: { id }, message: `${beamNo} plandan silindi` };
}

export { WARP_BEAM_EVENT_KINDS };
