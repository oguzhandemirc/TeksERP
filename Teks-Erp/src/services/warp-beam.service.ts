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
import { physicalBeamPlanWarningsTx } from "./helpers/warp-beam-set.helper";
import { ApiResponse } from "../types/api.types";
import { CursorPaginatedResponse } from "./base.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { buildTextSearch } from "../utils/query-parser";
import { buildNextDynamicCursor, decodeDynamicCursor, dynamicCursorWhere } from "../utils/cursor";
import { AuditService } from "./audit.service";
import { assertWarpBeamPlanReplayAlive, tokenReplay } from "./helpers/token-replay.helper";
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
import { assertEmanetWritableTx } from "./helpers/emanet-owner.helper";
import { resolvePartyToCardTx } from "./helpers/party-card.helper";
import { assertWeavingOrderLinkableTx, warpSpecMismatchWarning } from "./helpers/production-chain-gates.helper";
import { p2002OnField } from "../utils/p2002";

const WARP_BEAM_TABLE = "WARP_BEAM";
const WARP_BEAM_EVENT_TABLE = "WARP_BEAM_EVENT";
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

// DTO ve eşleyiciler `helpers/warp-beam-dto.helper.ts`te; eski çağıranlar için buradan da dışa açılır.
export { toWarpBeamDto, toWarpBeamEventDto, warpBeamRemainingM, type WarpBeamDto, type WarpBeamEventDto };

// ── LİSTE / DETAY ──────────────────────────────────────────────────────────────
export interface WarpBeamListParams {
  status?: WarpBeamStatus[];
  warpSpecId?: string | null;
  /** Z1 (Y2): bu dokuma işi için sarılan/planlanan leventler. */
  weavingOrderId?: string | null;
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
  if (params.weavingOrderId) where.weavingOrderId = params.weavingOrderId;
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
  /** G3 emanet: sahibi olan müşteri — CONSIGNED'da zorunlu, öteki kökenlerde serbest; yalnız CREATE'te (E2b). */
  ownerCustomerId?: string | null;
  /** Z1 (Y2): bu levent hangi dokuma işi için — opsiyonel; açık + IN_HOUSE iş, çözgü kartı farklıysa uyarı. */
  weavingOrderId?: string | null;
  physicalBeamNo?: string | null;
  notes?: string | null;
  clientToken?: string | null;
}

async function assertSpecActive(warpSpecId: string): Promise<void> {
  const n = await prisma.warpSpec.count({ where: { id: warpSpecId, isActive: true } });
  if (n === 0) throw AppError.badRequest("Çözgü kartı bulunamadı ya da pasif");
}

/** PURCHASED: fasoncu bağlı bir profilse tedarikçi kimliği KARTTIR (`supplierId` = kart) — cari/alış ile aynı çözücü. */
async function resolvePurchasedPartyToCard<T extends { originKind: WarpBeamOrigin; subcontractorId: string | null; supplierId: string | null }>(p: T): Promise<T> {
  if (p.originKind !== WarpBeamOrigin.PURCHASED || !p.subcontractorId) return p;
  const card = await resolvePartyToCardTx(prisma, { subcontractorId: p.subcontractorId });
  return { ...p, supplierId: card.customerId, subcontractorId: card.subcontractorId };
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
  return warpBeamReplay(input).run(input.clientToken, () => createWarpBeamFresh(input, userId));
}

/**
 * Levent planı replay'i. Kimlik: çözgü kartı · köken · plan metresi · taraf (karta ÇÖZÜLMÜŞ) · dokuma işi · fiziksel
 * levent no. 4. durum: iptal → `WARP_BEAM_CANCELLED`, hurda → `WARP_BEAM_SCRAPPED`. Yalnız R: yarışı yeniden okuma kapatır.
 */
function warpBeamReplay(input: WarpBeamCreateInput) {
  type Beam = Prisma.WarpBeamGetPayload<{ select: typeof WARP_BEAM_SELECT }>;
  type Party = Awaited<ReturnType<typeof resolveCreateParty>>;
  return tokenReplay<{ beam: Beam; party: Party; plannedLengthM: Prisma.Decimal }, ApiResponse<WarpBeamDto>>({
    find: async (db, clientToken) => {
      const beam = await db.warpBeam.findUnique({ where: { clientToken }, select: WARP_BEAM_SELECT });
      return beam ? { beam, party: await resolveCreateParty(input), plannedLengthM: normalizePlanned(input.plannedLengthM) } : null;
    },
    alive: (p) => assertWarpBeamPlanReplayAlive(p.beam),
    identity: (p) => [
      { ad: "warpSpecId", mevcut: p.beam.warpSpecId, gelen: input.warpSpecId },
      { ad: "originKind", mevcut: p.beam.originKind, gelen: p.party.originKind },
      { ad: "plannedLengthM", mevcut: p.beam.plannedLengthM, gelen: p.plannedLengthM },
      { ad: "subcontractorId", mevcut: p.beam.subcontractorId, gelen: p.party.subcontractorId },
      { ad: "supplierId", mevcut: p.beam.supplierId, gelen: p.party.supplierId },
      { ad: "ownerCustomerId", mevcut: p.beam.ownerCustomerId, gelen: p.party.ownerCustomerId },
      { ad: "weavingOrderId", mevcut: p.beam.weavingOrderId, gelen: input.weavingOrderId ?? null },
      { ad: "physicalBeamNo", mevcut: p.beam.physicalBeamNo, gelen: input.physicalBeamNo?.trim() || null },
    ],
    collision: "Bu istemci anahtarı BAŞKA bir leventle kullanılmış — formu yenileyip yeniden deneyin.",
    collisionEk: (p) => ({ beamId: p.beam.id }),
    respond: (p) => ({ success: true, data: toWarpBeamDto(p.beam), message: "Levent zaten planlanmış" }),
  });
}

function resolveCreateParty(input: WarpBeamCreateInput) {
  return resolvePurchasedPartyToCard(
    resolveOriginParty({ originKind: input.originKind, subcontractorId: input.subcontractorId ?? null, supplierId: input.supplierId ?? null, ownerCustomerId: input.ownerCustomerId ?? null }),
  );
}

async function createWarpBeamFresh(input: WarpBeamCreateInput, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  const party = await resolvePurchasedPartyToCard(
    resolveOriginParty({ originKind: input.originKind, subcontractorId: input.subcontractorId ?? null, supplierId: input.supplierId ?? null, ownerCustomerId: input.ownerCustomerId ?? null }),
  );
  const plannedLengthM = normalizePlanned(input.plannedLengthM);
  await assertSpecActive(input.warpSpecId);
  await assertParties(party);
  const weavingOrderId = input.weavingOrderId ?? null;
  const wo = weavingOrderId ? await assertWeavingOrderLinkableTx(prisma, weavingOrderId) : null;
  const warnings = wo ? [warpSpecMismatchWarning({ warpSpecId: input.warpSpecId }, wo)].filter((w): w is string => w !== null) : [];
  const created = await withBarcodeRetry(
    () =>
      prisma.$transaction(async (tx) => {
        // G3: owner verildiyse emanet modülü açık olmalı (gövde kapısı, 403) — köken CONSIGNED de owner ister.
        await assertEmanetWritableTx(tx, party.ownerCustomerId, "levent");
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
            weavingOrderId,
            clientToken: input.clientToken ?? null,
            createdById: userId ?? null,
            updatedById: userId ?? null,
          },
          select: WARP_BEAM_SELECT,
        });
      }),
    undefined,
    // Yalnız numara çakışması retry'a girer (hedef pg adaptöründe `meta.target`te değil — tek yardımcı); token P2002'si boğaza.
    (err) => p2002OnField(err, "beamNo"),
  );
  await AuditService.log({ userId, action: "CREATE", tableName: WARP_BEAM_TABLE, recordId: created.id, newData: { beamNo: created.beamNo, warpSpecId: created.warpSpecId, originKind: created.originKind, plannedLengthM: Number(created.plannedLengthM) } });
  // K5b: plan = rezervasyon, RED YOK — gövde doluysa/çift planlıysa UYARI (sarımda çıkacak 409 şimdiden söylenir); Z1 çözgü kartı uyarısıyla aynı dizide.
  warnings.push(...(await physicalBeamPlanWarningsTx(prisma, created.id, created.physicalBeamNo)));
  return { success: true, data: toWarpBeamDto(created), message: `${created.beamNo} planlandı`, ...(warnings.length > 0 ? { warnings } : {}) };
}

/** E2b: `ownerCustomerId` DOĞUM niteliğidir — PATCH gövdesinden yazılamaz (route şeması strict, burada da tip dışı). */
export type WarpBeamUpdateInput = Partial<Omit<WarpBeamCreateInput, "clientToken" | "ownerCustomerId">>;

async function throwNotPlannedTx(tx: Prisma.TransactionClient, id: string, eylem: string): Promise<never> {
  const fresh = await tx.warpBeam.findUnique({ where: { id }, select: { status: true, beamNo: true } });
  if (!fresh) throw AppError.notFound("Levent bulunamadı");
  throw AppError.conflict(`${fresh.beamNo} artık planda değil (${fresh.status}) — ${eylem}`, { code: "WARP_BEAM_NOT_PLANNED", status: fresh.status });
}

/** Yalnız PLANNED düzenlenir; sarılmış levent salt-okunurdur (defter donar). */
export async function updateWarpBeam(id: string, input: WarpBeamUpdateInput, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  const current = await prisma.warpBeam.findUnique({ where: { id }, select: WARP_BEAM_SELECT });
  if (!current) throw AppError.notFound("Levent bulunamadı");
  const party = await resolvePurchasedPartyToCard(
    resolveOriginParty({
      originKind: input.originKind ?? current.originKind,
      subcontractorId: input.subcontractorId === undefined ? current.subcontractorId : input.subcontractorId,
      supplierId: input.supplierId === undefined ? current.supplierId : input.supplierId,
      // Sahip DEĞİŞMEZ (doğum niteliği); köken CONSIGNED'a çevrilirken sahipsizse resolveOriginParty 400 verir.
      ownerCustomerId: current.ownerCustomerId,
    }),
  );
  if (input.warpSpecId) await assertSpecActive(input.warpSpecId);
  await assertParties(party);
  // Z1 (Y2): iş bağı yalnız PLANNED'da düzenlenir; verilirse açık + IN_HOUSE olmalı (400), çözgü kartı farkı uyarı.
  const weavingOrderId = input.weavingOrderId === undefined ? current.weavingOrderId : input.weavingOrderId;
  const wo = weavingOrderId && weavingOrderId !== current.weavingOrderId ? await assertWeavingOrderLinkableTx(prisma, weavingOrderId) : null;
  const warnings = wo ? [warpSpecMismatchWarning({ warpSpecId: input.warpSpecId ?? current.warpSpecId }, wo)].filter((w): w is string => w !== null) : [];
  const data: Prisma.WarpBeamUpdateManyMutationInput = {
    ...(input.warpSpecId ? { warpSpecId: input.warpSpecId } : {}),
    ...(input.plannedLengthM !== undefined ? { plannedLengthM: normalizePlanned(input.plannedLengthM) } : {}),
    ...(input.physicalBeamNo !== undefined ? { physicalBeamNo: input.physicalBeamNo?.trim() || null } : {}),
    ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
    ...party,
    ...(input.weavingOrderId !== undefined ? { weavingOrderId } : {}),
    updatedById: userId ?? null,
  };
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.warpBeam.updateMany({ where: { id, status: WarpBeamStatus.PLANNED }, data });
    if (r.count === 0) await throwNotPlannedTx(tx, id, "düzenlenemez");
    return tx.warpBeam.findUniqueOrThrow({ where: { id }, select: WARP_BEAM_SELECT });
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: WARP_BEAM_TABLE, recordId: id, oldData: { plannedLengthM: Number(current.plannedLengthM), originKind: current.originKind }, newData: { plannedLengthM: Number(updated.plannedLengthM), originKind: updated.originKind } });
  warnings.push(...(await physicalBeamPlanWarningsTx(prisma, id, updated.physicalBeamNo)));
  return { success: true, data: toWarpBeamDto(updated), message: `${updated.beamNo} güncellendi`, ...(warnings.length > 0 ? { warnings } : {}) };
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
