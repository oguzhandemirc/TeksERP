// =============================================================================
// DOKUMA İŞİ — girdi normalizasyonu, saf doğrulama, DTO (tx'siz parça)
// =============================================================================
// `weaving-order.service.ts`in tx'siz yarısı: burada DB YOK. Kilit ve numara
// üreteci `weaving-order.helper.ts`te (uzayın tek sahibi), referans doğrulama
// ve yazma serviste. Ayrıldı çünkü servis dosyası 300 satır tavanını aşıyordu.
// =============================================================================

import { Prisma, WeavingExecutionKind, WeavingOrderStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/** Açık koşum yüklemi — `machine_runs` sedinin (`endedAt`+`revokedAt`) aynası. */
export const OPEN_RUN_WHERE = { endedAt: null, revokedAt: null } as const;

export const WEAVING_ORDER_SELECT = {
  id: true,
  weavingOrderNumber: true,
  itemId: true,
  colorId: true,
  warpSpecId: true,
  plannedM: true,
  executionKind: true,
  subcontractorId: true,
  status: true,
  plannedStartDate: true,
  plannedEndDate: true,
  notes: true,
  closedAt: true,
  closedById: true,
  cancelledAt: true,
  cancelledById: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  item: { select: { id: true, code: true, name: true } },
  color: { select: { id: true, code: true, name: true } },
  warpSpec: { select: { id: true, code: true, name: true } },
  subcontractor: { select: { id: true, code: true, name: true } },
  _count: { select: { machineRuns: { where: OPEN_RUN_WHERE } } },
} satisfies Prisma.WeavingOrderSelect;

export type WeavingOrderRow = Prisma.WeavingOrderGetPayload<{ select: typeof WEAVING_ORDER_SELECT }>;

export interface WeavingOrderDto {
  id: string;
  weavingOrderNumber: string;
  itemId: string;
  colorId: string | null;
  warpSpecId: string | null;
  plannedM: number | null;
  executionKind: WeavingExecutionKind;
  subcontractorId: string | null;
  status: WeavingOrderStatus;
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
  notes: string | null;
  closedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  item: { id: string; code: string; name: string };
  color: { id: string; code: string; name: string } | null;
  warpSpec: { id: string; code: string; name: string } | null;
  subcontractor: { id: string; code: string; name: string } | null;
  /** Kapanışı engelleyen açık koşum sayısı (`endedAt IS NULL AND revokedAt IS NULL`). */
  openRunCount: number;
}

export interface WeavingOrderCreateInput {
  itemId: string;
  colorId?: string | null;
  warpSpecId?: string | null;
  plannedM?: number | string | null;
  executionKind: WeavingExecutionKind;
  subcontractorId?: string | null;
  plannedStartDate?: string | Date | null;
  plannedEndDate?: string | Date | null;
  notes?: string | null;
  clientToken?: string | null;
}

export type WeavingOrderUpdateInput = Partial<Omit<WeavingOrderCreateInput, "clientToken">>;

export interface NormalizedWeavingOrderFields {
  itemId?: string;
  colorId?: string | null;
  warpSpecId?: string | null;
  plannedM?: Prisma.Decimal | null;
  executionKind?: WeavingExecutionKind;
  subcontractorId?: string | null;
  plannedStartDate?: Date | null;
  plannedEndDate?: Date | null;
  notes?: string | null;
}

export const WEAVING_ORDER_STATUS_LABEL: Record<WeavingOrderStatus, string> = {
  PLANNED: "planlandı",
  IN_PROGRESS: "devam ediyor",
  COMPLETED: "kapatıldı",
  CANCELLED: "iptal edildi",
};

export function toWeavingOrderDto(row: WeavingOrderRow): WeavingOrderDto {
  const { _count, closedById: _c, cancelledById: _x, ...rest } = row;
  void _c;
  void _x;
  return {
    ...rest,
    plannedM: row.plannedM === null ? null : Number(row.plannedM),
    openRunCount: _count.machineRuns,
  };
}

export function weavingOrderAuditView(row: WeavingOrderRow): Record<string, unknown> {
  return {
    weavingOrderNumber: row.weavingOrderNumber,
    status: row.status,
    itemId: row.itemId,
    colorId: row.colorId,
    warpSpecId: row.warpSpecId,
    plannedM: row.plannedM === null ? null : Number(row.plannedM),
    executionKind: row.executionKind,
    subcontractorId: row.subcontractorId,
    plannedStartDate: row.plannedStartDate,
    plannedEndDate: row.plannedEndDate,
    notes: row.notes,
    cancelReason: row.cancelReason,
  };
}

function normalizeDecimal(raw: number | string | null | undefined, label: string): Prisma.Decimal | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const d = new Prisma.Decimal(raw);
  if (!d.isFinite() || d.lessThanOrEqualTo(0)) throw AppError.badRequest(`${label} sıfırdan büyük olmalı`);
  return d;
}

function normalizeDate(raw: string | Date | null | undefined, label: string): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) throw AppError.badRequest(`${label} geçerli bir tarih değil`);
  return d;
}

/** Yalnız GÖNDERİLEN alanları normalize eder (`undefined` = dokunma). */
export function normalizeWeavingOrderFields(input: WeavingOrderUpdateInput): NormalizedWeavingOrderFields {
  const out: NormalizedWeavingOrderFields = {};
  if (input.itemId !== undefined) out.itemId = input.itemId;
  if (input.colorId !== undefined) out.colorId = input.colorId || null;
  if (input.warpSpecId !== undefined) out.warpSpecId = input.warpSpecId || null;
  if (input.plannedM !== undefined) out.plannedM = normalizeDecimal(input.plannedM, "Planlanan metre");
  if (input.executionKind !== undefined) out.executionKind = input.executionKind;
  if (input.subcontractorId !== undefined) out.subcontractorId = input.subcontractorId || null;
  if (input.plannedStartDate !== undefined) {
    out.plannedStartDate = normalizeDate(input.plannedStartDate, "Planlanan başlangıç");
  }
  if (input.plannedEndDate !== undefined) out.plannedEndDate = normalizeDate(input.plannedEndDate, "Planlanan bitiş");
  if (input.notes !== undefined) out.notes = input.notes?.trim().slice(0, 500) || null;
  return out;
}

/**
 * XOR: SUBCONTRACTED ⇒ fasoncu DOLU, IN_HOUSE ⇒ BOŞ. Uygulama katmanının
 * 400'ü; DB CHECK seddi migration notu gereği bu yüzeyle iner (borç: 01'in
 * P2b-1 inişinden sonra ham SQL migration + `test_db_invariants` envanteri).
 */
export function assertWeavingParty(kind: WeavingExecutionKind, subcontractorId: string | null): void {
  if (kind === WeavingExecutionKind.SUBCONTRACTED && !subcontractorId) {
    throw AppError.badRequest("Fasona verilen dokuma işinde fasoncu seçilmeli");
  }
  if (kind === WeavingExecutionKind.IN_HOUSE && subcontractorId) {
    throw AppError.badRequest("İç dokuma işinde fasoncu seçilemez");
  }
}

export function assertWeavingDateOrder(start: Date | null, end: Date | null): void {
  if (start && end && end.getTime() < start.getTime()) {
    throw AppError.badRequest("Planlanan bitiş, başlangıçtan önce olamaz");
  }
}
