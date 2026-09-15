// =============================================================================
// TeksERP — İPLİK LOTU servisi (devere Faz 2): liste (türetilen bakiye) · elle aç · düzenle
// =============================================================================
// Lot DURUM kaydıdır; bakiyesi hareketlerden TÜRETİLİR (`yarn-lot.helper`). Hard delete
// YOK — pasife alınır (hareketi olan lot zaten Restrict FK ile silinemez). Yazıcı değil:
// iplik hareketini yalnız `applyYarnMovementTx` yazar.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import type { ApiResponse } from "../types/api.types";
import type { CursorPaginatedResponse } from "./base.service";
import { buildNextCursor, cursorWhere, decodeCursor } from "../utils/cursor";
import { buildTurkishSearch } from "../utils/query-parser";
import { ensureYarnLotTx, normalizeLotNo, yarnLotBalancesTx } from "./helpers/yarn-lot.helper";
import { assertEmanetWritableTx } from "./helpers/emanet-owner.helper";

export interface YarnLotDto {
  id: string;
  itemId: string;
  lotNo: string;
  supplierId: string | null;
  notes: string | null;
  isActive: boolean;
  item: { id: string; code: string; name: string };
  supplier: { id: string; name: string } | null;
  /** G3 emanet: lotun sahibi (müşteri); null = bizim iplik. */
  ownerCustomerId: string | null;
  ownerCustomer: { id: string; name: string } | null;
  /** Σ işaretli kg (tüm depolar) — hareketlerden türetilir, kolon değil. */
  balanceKg: number;
  createdAt: Date;
  updatedAt: Date;
}

const LOT_SELECT = {
  id: true, itemId: true, lotNo: true, supplierId: true, notes: true, isActive: true, createdAt: true, updatedAt: true, ownerCustomerId: true,
  item: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, name: true } },
  ownerCustomer: { select: { id: true, name: true } },
} satisfies Prisma.YarnLotSelect;

export class YarnLotService {
  async list(params: { itemId?: string; supplierId?: string; search?: string; isActive?: boolean; cursor?: string; limit?: number }): Promise<CursorPaginatedResponse<YarnLotDto>> {
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));
    const where: Prisma.YarnLotWhereInput = {};
    if (params.itemId) where.itemId = params.itemId;
    if (params.supplierId) where.supplierId = params.supplierId;
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.search) {
      const q = params.search.trim();
      if (q) where.OR = [{ lotNo: { contains: q, mode: "insensitive" } }, { item: { OR: buildTurkishSearch(q, ["name", "code"]) } }];
    }
    const cur = decodeCursor(params.cursor);
    const rows = await prisma.yarnLot.findMany({
      where: cur ? { AND: [where, cursorWhere(cur)] } : where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: LOT_SELECT,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const balances = await yarnLotBalancesTx(prisma, page.map((r) => r.id));
    return {
      success: true,
      data: page.map((r) => ({ ...r, balanceKg: Number(balances.get(r.id) ?? 0) })),
      pagination: { nextCursor: hasMore ? buildNextCursor(page[page.length - 1]!) : null, hasMore, limit },
    };
  }

  /** Elle lot açma — mal kabul upsert'iyle AYNI tek kapı (`ensureYarnLotTx`, 8029 kilidi). */
  async create(input: { itemId: string; lotNo: string; supplierId?: string | null; notes?: string | null; ownerCustomerId?: string | null }, userId?: string): Promise<ApiResponse<YarnLotDto>> {
    const lotNo = normalizeLotNo(input.lotNo);
    if (!lotNo) throw AppError.badRequest("Lot numarası boş olamaz", { code: "YARN_LOT_NO_REQUIRED" });
    const item = await prisma.item.findUnique({ where: { id: input.itemId }, select: { itemType: true, isActive: true, name: true } });
    if (!item || item.itemType !== "YARN") throw AppError.badRequest("Lot yalnız iplik kalemine açılır", { code: "YARN_LOT_ITEM_NOT_YARN" });
    if (!item.isActive) throw AppError.badRequest(`"${item.name}" kalemi pasif — lot açılamaz`);
    const created = await prisma.$transaction(async (tx) => {
      // G3 emanet: sahip verildiyse modül açık olmalı (403); sahip doğum niteliğidir — `update` yolu almaz (E2b).
      await assertEmanetWritableTx(tx, input.ownerCustomerId ?? null, "iplik lotu");
      const lot = await ensureYarnLotTx(tx, { itemId: input.itemId, lotNo, supplierId: input.supplierId ?? null, ownerCustomerId: input.ownerCustomerId ?? null, userId });
      if (!lot.created) throw AppError.conflict(`"${lotNo}" lotu bu kalemde zaten var`, { code: "YARN_LOT_EXISTS", lotId: lot.id });
      if (input.notes?.trim()) await tx.yarnLot.update({ where: { id: lot.id }, data: { notes: input.notes.trim().slice(0, 300) } });
      return tx.yarnLot.findUniqueOrThrow({ where: { id: lot.id }, select: LOT_SELECT });
    });
    void AuditService.log({ userId, action: "CREATE", tableName: "YARN_LOT", recordId: created.id, newData: { itemId: created.itemId, lotNo: created.lotNo, supplierId: created.supplierId } });
    return { success: true, data: { ...created, balanceKg: 0 }, message: `"${created.lotNo}" lotu açıldı.` };
  }

  /** Not / aktiflik — `lotNo` ve `itemId` DEĞİŞMEZ (kimlik; hareketler ona bağlı). */
  async update(id: string, input: { notes?: string | null; isActive?: boolean; supplierId?: string | null }, userId?: string): Promise<ApiResponse<YarnLotDto>> {
    const before = await prisma.yarnLot.findUnique({ where: { id }, select: { id: true, notes: true, isActive: true, supplierId: true, lotNo: true } });
    if (!before) throw AppError.notFound("İplik lotu bulunamadı");
    const data: Prisma.YarnLotUpdateInput = { updatedById: userId ?? null };
    if (input.notes !== undefined) data.notes = input.notes?.trim() ? input.notes.trim().slice(0, 300) : null;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.supplierId !== undefined) data.supplier = input.supplierId ? { connect: { id: input.supplierId } } : { disconnect: true };
    const row = await prisma.yarnLot.update({ where: { id }, data, select: LOT_SELECT });
    const balances = await yarnLotBalancesTx(prisma, [id]);
    void AuditService.log({ userId, action: "UPDATE", tableName: "YARN_LOT", recordId: id, oldData: before, newData: { notes: row.notes, isActive: row.isActive, supplierId: row.supplierId } });
    return { success: true, data: { ...row, balanceKg: Number(balances.get(id) ?? 0) } };
  }
}

export const yarnLotService = new YarnLotService();
export default yarnLotService;
