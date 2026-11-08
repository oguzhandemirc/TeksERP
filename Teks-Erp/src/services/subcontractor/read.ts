// =============================================================================
// TeksERP - Subcontractor (Fason) Service / read
// =============================================================================
// Okuma uçları: sevk/makbuz listesi ve detayı, renk-talimat örtüsü, makbuz baskı görüntüsü.
// `subcontractor.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../subcontractor.service`) okunur.
// =============================================================================

/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (dispatch.ts sayılır) */
import { ACTIVE_OPERATION } from "../helpers/roll-operation.helper";
import { ACTIVE_TARGET_PROPERTY } from "../helpers/property-revoke.helper";
import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import { Prisma, SubcontractorDispatchItemKind } from "@prisma/client";
import { listYarnItems } from "../subcontractor-yarn.service";
import { buildPagination, buildTextSearch } from "../../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../../utils/cursor";
import { assertWorkOrderBound } from "../helpers/dispatch-header.helper";
import { BORN_ROLL_FOREIGN_STOCK_MOVE, BORN_ROLL_SAFE_STATUSES } from "./receipt-cancel";

export async function listDispatches(params?: {
    workOrderId?: string;
    subcontractorId?: string;
    /** 'all' (varsayılan) · 'active' = iptal edilmemiş · 'cancelled' = iptal edilmiş. */
    status?: "all" | "active" | "cancelled";
    /** sevk no / fason firma adı / parti kodu (case-insensitive). */
    search?: string;
    dateFrom?: Date;
    dateTo?: Date;
    // offset (eski FasonSevk modal davranışı + geriye uyum)
    page?: number;
    pageSize?: number;
    // cursor (yeni Fason Sevk Geçmişi sayfası — keyset, derin sayfalama hızlı)
    cursor?: string;
    mode?: string;
    limit?: number;
    withTotal?: boolean;
  }): Promise<{
    success: true;
    data: unknown[];
    pagination: {
      page?: number;
      pageSize?: number;
      total?: number;
      totalPages?: number;
      nextCursor?: string | null;
      hasMore?: boolean;
      limit?: number;
      totalEstimate?: number;
    };
  }> {
    const where: Prisma.SubcontractorDispatchWhereInput = {};
    if (params?.workOrderId) where.workOrderId = params.workOrderId;
    if (params?.subcontractorId) where.subcontractorId = params.subcontractorId;

    const status = params?.status ?? "all";
    if (status === "active") where.cancelledAt = null;
    else if (status === "cancelled") where.cancelledAt = { not: null };

    if (params?.dateFrom || params?.dateTo) {
      where.dispatchedAt = {
        ...(params?.dateFrom ? { gte: params.dateFrom } : {}),
        ...(params?.dateTo ? { lte: params.dateTo } : {}),
      };
    }

    const search = params?.search?.trim();
    if (search) {
      // Y-2/Y-3: Türkçe-duyarlı arama (C-locale ILIKE İ/ı katlamaz).
      // ⚠️ Bu tablo fold gölge kolonu TAŞIR → hızlı yol (`buildTextSearch`).
      where.OR = buildTextSearch<Prisma.SubcontractorDispatchWhereInput>(search, {
        text: ["subcontractor.name"],
        code: ["dispatchNo", "workOrder.workOrderNumber"],
      });
    }

    // Liste için ÇOK HAFIF select — detay endpoint (`getDispatch`) tam veriyi döner.
    // Müşteri/orderLinks gibi N+ join'ler list response'unu şişiriyordu;
    // operatör detaya tıkladığında lazy fetch ile zenginleşir.
    const select = {
      id: true,
      dispatchNo: true,
      dispatchedAt: true,
      totalQty: true,
      plateNumber: true,
      driverName: true,
      notes: true,
      instruction: true,
      stepId: true,
      cancelledAt: true,
      cancelReason: true,
      workOrder: { select: { id: true, workOrderNumber: true } },
      subcontractor: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    } as const;

    // CURSOR mode (Fason Sevk Geçmişi sayfası): keyset by dispatchedAt desc + id desc.
    // count YOK (withTotal ile opt-in) → derin sayfalamada sabit maliyet.
    const useCursor = !!params?.cursor || params?.mode === "cursor";
    if (useCursor) {
      const limit = Math.min(Math.max(1, params?.limit ?? 30), 100);
      const cursor = decodeDynamicCursor(params?.cursor);
      const whereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "dispatchedAt", "desc")] }
        : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.subcontractorDispatch.findMany({
          where: whereClause,
          select,
          orderBy: [{ dispatchedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
        params?.withTotal
          ? prisma.subcontractorDispatch.count({ where })
          : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const rows = hasMore ? items.slice(0, limit) : items;
      const last = rows[rows.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "dispatchedAt") : null;
      return {
        success: true,
        data: rows,
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    // OFFSET mode (geriye uyum).
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 10));
    // buildPagination MAX_OFFSET=10K aşımında 400 fırlatır (curl saldırı yüzeyi).
    const { skip } = buildPagination(page, pageSize);

    const [dispatches, total] = await Promise.all([
      prisma.subcontractorDispatch.findMany({
        where,
        select,
        orderBy: { dispatchedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.subcontractorDispatch.count({ where }),
    ]);

    return {
      success: true,
      data: dispatches,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
    };
  }

export async function getDispatch(id: string, opts?: { includeBeams?: boolean }): Promise<ApiResponse<unknown>> {
    const includeBeams = opts?.includeBeams === true;
    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        plannedSubcontractor: true,
        // WO + sipariş + müşteri zinciri (detay panelinde "kim için" göstermek için)
        workOrder: {
          include: {
            targetItem: true,
            targetColor: true,
            targetProperties: { where: ACTIVE_TARGET_PROPERTY, include: { property: true } },
            orderLinks: {
              where: ACTIVE_ORDER_LINK,
              include: {
                orderLine: {
                  include: {
                    item: true,
                    color: true,
                    order: { include: { customer: true } },
                  },
                },
              },
            },
          },
        },
        step: { include: { station: true } },
        items: {
          // G1: iplik kalemi `items`e HİÇ girmez (roll/warpBeam null bağıyla eski istemciyi kırmasın) — `yarnItems` ayrı alan.
          where: { kind: { in: includeBeams ? [SubcontractorDispatchItemKind.ROLL, SubcontractorDispatchItemKind.WARP_BEAM] : [SubcontractorDispatchItemKind.ROLL] } },
          include: {
            roll: {
              include: {
                item: true,
                color: true,
              },
            },
            ...(includeBeams ? { warpBeam: { select: { id: true, beamNo: true, status: true, physicalBeamNo: true, warpSpec: { select: { id: true, code: true, name: true } } } } } : {}),
          },
        },
        dispatchedBy: { select: { id: true, username: true, fullName: true } },
        cancelledBy: { select: { id: true, username: true, fullName: true } },
        _count: { select: { items: { where: { kind: SubcontractorDispatchItemKind.WARP_BEAM } } } },
      },
    });

    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    const { _count, ...rest } = dispatch;
    // G1: iplik kalemleri birimi AÇIK (`unit:"KG"`) ayrı listede; `yarnTotalKg` başlıkta — `totalQty` metredir (H1).
    const yarn = await listYarnItems(prisma, id);
    return { success: true, data: { ...rest, beamItemCount: _count.items, yarnItems: yarn.items, yarnTotalKg: yarn.yarnTotalKg } };
  }

export async function listReceipts(params?: {
    workOrderId?: string;
    subcontractorId?: string;
    page?: number;
    pageSize?: number;
    /** Cursor mode (DEFAULT — Geçmiş Kabuller sonsuz akışı): keyset by receivedAt. */
    mode?: string;
    limit?: number;
    cursor?: string;
    /** İlk sayfada yaklaşık toplam için (cursor mode'da count opt-in). */
    withTotal?: boolean;
    /**
     * İptal edilebilirlik filtresi — mobil "İptal Edilebilirler" vs "Geçmiş
     * Kabuller" sekmelerini ayırır. Mantık: bir receipt iptal edilebilir <=>
     * tüm bornRoll'ları "güvenli durumda" (üzerinde işlem yok, sonraki adıma
     * geçmemiş, bölünmemiş, başka sevkte değil, status STOCK/IN_PRODUCTION).
     *   - 'yes' → tüm bornRoll'ları güvenli
     *   - 'no'  → en az bir bornRoll bloklu (settled)
     *   - undefined → her ikisi (varsayılan, eski davranış)
     * BornRoll'sız receipt'ler her zaman cancellable sayılır (none: vacuously true).
     */
    cancellable?: "yes" | "no";
  }): Promise<{
    success: true;
    data: unknown[];
    pagination:
      | { page: number; pageSize: number; total: number; totalPages: number }
      | { nextCursor: string | null; hasMore: boolean; limit: number; totalEstimate?: number };
  }> {
    // Default: iptal edilmiş receipt'ler listede görünmez — operatörün geçmiş
    // kabuller ekranında kafası karışmasın. Cancel sonrası soft-delete olduğu
    // için kayıt durur ama listelenmez. İleride admin "iptaller dahil" görünümü
    // isterse explicit query param ile açılır.
    const where: Prisma.SubcontractorReceiptWhereInput = { cancelledAt: null };
    if (params?.workOrderId) where.workOrderId = params.workOrderId;
    if (params?.subcontractorId) where.subcontractorId = params.subcontractorId;

    // computeBornRollBlockingReasons ile aynı şartlar — burada Prisma where
    // ile ifade ediliyor ki count + findMany pagination doğru olsun.
    const blockingCondition: Prisma.RollWhereInput = {
      OR: [
        { operations: { some: ACTIVE_OPERATION } },
        { movements: { some: { ...ACTIVE_MOVEMENT, exitedAt: { not: null } } } },
        { children: { some: {} } },
        { dispatchItems: { some: {} } },
        { sackId: { not: null } },
        { warehouseMovements: { some: BORN_ROLL_FOREIGN_STOCK_MOVE } },
        { status: { notIn: [...BORN_ROLL_SAFE_STATUSES] } },
      ],
    };
    if (params?.cancellable === "yes") {
      // Tüm bornRoll'lar güvenli → bloklu bornRoll yok
      where.bornRolls = { none: blockingCondition };
    } else if (params?.cancellable === "no") {
      // En az bir bornRoll bloklu (settled)
      where.bornRolls = { some: blockingCondition };
    }

    // Hafif select — detay `getReceipt` ile lazy gelir (sevk listesindeki desen).
    // Mal kabulde metraj ölçülmez; toplam metraj sevk anındaki `dispatchedQty`
    // toplamından hesaplanır (fason hizmeti — qty değişmez).
    const select = {
      id: true,
      receiptNo: true,
      manifestNo: true,
      receivedAt: true,
      notes: true,
      workOrder: { select: { id: true, workOrderNumber: true } },
      subcontractor: { select: { id: true, name: true, code: true } },
      step: {
        select: {
          id: true,
          stepSequence: true,
          station: { select: { name: true, code: true } },
        },
      },
      receivedBy: { select: { id: true, username: true, fullName: true } },
      _count: { select: { items: true } },
      items: {
        select: {
          sourceDispatchItem: { select: { dispatchedQty: true } },
        },
      },
    } as const;

    // totalQty hesabı (items'tan) — list response'a items taşımadan.
    const enrich = <T extends { items: { sourceDispatchItem: { dispatchedQty: Prisma.Decimal } | null }[] }>(
      rows: T[],
    ) =>
      rows.map(({ items, ...rest }) => ({
        ...rest,
        // Decimal aritmetik — float drift olmasın; serializer number'a çevirir.
        totalQty: items.reduce(
          (sum, it) => sum.plus(it.sourceDispatchItem?.dispatchedQty ?? 0),
          new Prisma.Decimal(0),
        ),
      }));

    // CURSOR mode (DEFAULT — Geçmiş Kabuller sonsuz akışı): keyset by receivedAt
    // desc + id desc. count YOK (withTotal ile opt-in) → derin sayfalamada sabit
    // maliyet + MAX_OFFSET tavanı yok. cancellable filtresi where'de korunur.
    const useCursor = !!params?.cursor || params?.mode === "cursor";
    if (useCursor) {
      const limit = Math.min(Math.max(1, params?.limit ?? 20), 100);
      const cursor = decodeDynamicCursor(params?.cursor);
      const whereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "receivedAt", "desc")] }
        : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.subcontractorReceipt.findMany({
          where: whereClause,
          select,
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
        params?.withTotal
          ? prisma.subcontractorReceipt.count({ where })
          : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const rows = hasMore ? items.slice(0, limit) : items;
      const last = rows[rows.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "receivedAt") : null;
      return {
        success: true,
        data: enrich(rows),
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    // OFFSET mode (geriye uyum).
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 10));
    // buildPagination MAX_OFFSET=10K aşımında 400 fırlatır (curl saldırı yüzeyi).
    const { skip } = buildPagination(page, pageSize);

    const [receipts, total] = await Promise.all([
      prisma.subcontractorReceipt.findMany({
        where,
        select,
        orderBy: { receivedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.subcontractorReceipt.count({ where }),
    ]);

    return {
      success: true,
      data: enrich(receipts),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
    };
  }

export async function getReceipt(id: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        // ÜRETİM BİLGİSİ (2026-08-09 saha isteği): "mal kabul detayında işlem
        // detayı yok". `workOrder: true` YALNIZ skaler alanları getirir —
        // hedef RENK ADI ve ÖZELLİKLER ilişkidir ve gelmiyordu, yani ekran
        // onları basmak isteseydi boş görürdü.
        // ⚠️ Ders (2026-08-05 "Ekleme Nedeni" vakası): alanı ekrana koymak
        // yetmez, HANGİ YANITTA döndüğünü doğrula.
        workOrder: {
          include: {
            targetColor: { select: { id: true, code: true, name: true, hex: true } },
            targetProperties: {
              where: ACTIVE_TARGET_PROPERTY,
              select: { property: { select: { id: true, name: true } } },
            },
          },
        },
        step: { include: { station: true } },
        items: {
          include: {
            newRoll: { include: { item: true, color: true } },
            sourceDispatchItem: { include: { roll: true } },
          },
        },
        // Fasondan dönen yeni açık kumaş parçaları (split senaryosu için kritik).
        // UI bunları ayrı section'da listeler; orijinal items ile karıştırılmaz.
        bornRolls: {
          select: {
            id: true,
            initialQty: true,
            currentQty: true,
            weightKg: true,
            width: true,
            // KAT — topun kalıcı özelliği (migration 20260804210000). Seçilmezse
            // ekranda "—" çıkardı ve operatör "kat girilmemiş" sanırdı.
            foldType: true,
            status: true,
            qualityGrade: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        receivedBy: { select: { id: true, username: true, fullName: true } },
      },
    });

    if (!receipt) throw AppError.notFound("Mal kabul belgesi bulunamadı");
    return { success: true, data: receipt };
  }

export async function getDispatchDyeOverlay(id: string): Promise<ApiResponse<unknown>> {
    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id },
      select: {
        cancelledAt: true,
        workOrderId: true,
        instruction: true,
        step: { select: { notes: true } },
        workOrder: {
          select: {
            targetColor: { select: { id: true, code: true, name: true, hex: true } },
          },
        },
      },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    assertWorkOrderBound(dispatch); // boya kaplaması iş emri sevkinin alanı

    // P4: Fason talimatı düzenleme kilidi — iptal edilmiş ya da (kabul edilmiş =
    // mal döndü) sevkin talimatı artık değiştirilemez. Frontend editörü buna göre
    // disabled eder; backend updateInstruction de aynı guard'ı uygular.
    const instructionLocked =
      dispatch.cancelledAt != null ||
      (await prisma.subcontractorReceiptItem.count({
        where: {
          sourceDispatchItem: { dispatchId: id },
          receipt: { cancelledAt: null },
        },
      })) > 0;

    return {
      success: true,
      data: {
        requestedColor: dispatch.workOrder.targetColor
          ? {
              id: dispatch.workOrder.targetColor.id,
              code: dispatch.workOrder.targetColor.code,
              name: dispatch.workOrder.targetColor.name,
              hex: dispatch.workOrder.targetColor.hex,
            }
          : null,
        instruction: dispatch.instruction,
        stepNote: dispatch.step.notes,
        instructionLocked,
      },
    };
  }

export async function getReceiptPrintSnapshot(id: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        workOrder: { select: { id: true, workOrderNumber: true, type: true } },
        step: { include: { station: { select: { name: true, code: true } } } },
        receivedBy: { select: { fullName: true } },
        items: {
          include: {
            newRoll: {
              include: {
                item: { select: { code: true, name: true } },
                color: { select: { code: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!receipt) throw AppError.notFound("Kabul belgesi bulunamadı");
    assertWorkOrderBound(receipt, "Kabul belgesi");

    const rolls = receipt.items.map((item, idx) => ({
      sequence: idx + 1,
      id: item.newRoll.id,
      barcode: item.newRoll.barcode,
      itemCode: item.newRoll.item?.code ?? "",
      itemName: item.newRoll.item?.name ?? "",
      colorCode: item.newRoll.color?.code ?? null,
      colorName: item.newRoll.color?.name ?? null,
      qualityGrade: item.newRoll.qualityGrade,
      notes: item.notes ?? null,
    }));

    return {
      success: true,
      data: {
        receiptNo: receipt.receiptNo,
        manifestNo: receipt.manifestNo,
        receivedAt: receipt.receivedAt.toISOString(),
        notes: receipt.notes,
        receivedBy: receipt.receivedBy?.fullName ?? null,
        workOrder: {
          id: receipt.workOrder.id,
          workOrderNumber: receipt.workOrder.workOrderNumber,
          type: receipt.workOrder.type,
        },
        subcontractor: {
          id: receipt.subcontractor.id,
          name: receipt.subcontractor.name,
          code: receipt.subcontractor.code ?? null,
        },
        step: {
          id: receipt.step.id,
          stepSequence: receipt.step.stepSequence,
          station: {
            name: receipt.step.station.name,
            code: receipt.step.station.code,
          },
        },
        rolls,
        totals: { rollCount: rolls.length },
      },
    };
  }
