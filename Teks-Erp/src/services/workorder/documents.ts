// =============================================================================
// TeksERP - WorkOrder (Parti) Service / documents
// =============================================================================
// Belgeler, bağlı toplar, refakat kartı, manifest (canlı + kayıtlı).
// `workorder.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../workorder.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (workorder/replace.ts sayılır) */

import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import {
  RollStatus,
  Prisma,
} from "@prisma/client";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { nextManifestNo } from "../helpers/manifest-number.helper";
import { TERIM } from "../../constants/terim";
import type { WorkOrderServiceThis } from "./shared";

export async function getDocuments(workOrderId: string): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, workOrderNumber: true },
    });
    if (!wo) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);

    // Dört kaynak paralel değil SERİ okunur (pg adapter tek connection —
    // `Promise.all([tx.*])` yasağıyla aynı gerekçe; burada tx yok ama havuz
    // davranışı için de seri okumak güvenli ve fark ölçülemez: 4 küçük sorgu).
    const card = await prisma.travelerCard.findUnique({
      where: { workOrderId },
      select: { id: true, cardNumber: true, printedAt: true, createdAt: true, version: true, status: true, contentDirty: true },
    });

    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId },
      orderBy: { dispatchedAt: "desc" },
      select: {
        id: true,
        dispatchNo: true,
        dispatchedAt: true,
        totalQty: true,
        cancelledAt: true,
        directShippedAt: true,
        subcontractor: { select: { name: true } },
        batch: { select: { batchNumber: true } },
        step: { select: { stepSequence: true, station: { select: { name: true } } } },
        _count: { select: { items: true } },
      },
    });

    const receipts = await prisma.subcontractorReceipt.findMany({
      where: { workOrderId },
      orderBy: { receivedAt: "desc" },
      select: {
        id: true,
        receiptNo: true,
        manifestNo: true,
        receivedAt: true,
        cancelledAt: true,
        subcontractor: { select: { name: true } },
        step: { select: { stepSequence: true, station: { select: { name: true } } } },
        _count: { select: { items: true } },
      },
    });

    // Doğrudan sevk WO'ya DOLAYLI bağlı (DirectShipment → dispatch → workOrder).
    const directShipments = dispatches.length
      ? await prisma.directShipment.findMany({
          where: { dispatchId: { in: dispatches.map((d) => d.id) } },
          orderBy: { shippedAt: "desc" },
          select: {
            id: true,
            shipmentNo: true,
            shippedAt: true,
            totalQty: true,
            customer: { select: { name: true } },
            dispatch: { select: { step: { select: { station: { select: { name: true } } } } } },
          },
        })
      : [];

    const docs: Record<string, unknown>[] = [];

    if (card) {
      docs.push({
        docType: "TRAVELER_CARD",
        sourceId: card.id,
        documentNo: card.cardNumber,
        // Belge listesinde tarih SIRALAMA anahtarıdır. Hiç basılmamış kartın
        // basım tarihi YOKTUR (K8) — kartın doğduğu ana düşülür, çünkü liste
        // "bu iş emrinin belgeleri" sorusunu tarih sırasıyla cevaplıyor ve
        // tarihsiz satır sıranın dışına düşerdi.
        date: (card.printedAt ?? card.createdAt).toISOString(),
        group: `${TERIM.terbiyeIsEmri.tekil} Belgeleri`,
        title: "Refakat Kartı",
        subtitle: `v${card.version} · Üretim sahasında topla birlikte dolaşır`,
        cancelled: card.status === "VOIDED",
        // İstemci "güncel değil" rozetini bu alandan basar (bkz. contentDirty).
        contentDirty: card.contentDirty,
      });
    }

    for (const d of dispatches) {
      const station = d.step?.station?.name ?? "Fason";
      docs.push({
        docType: "SUBCONTRACTOR_DISPATCH",
        sourceId: d.id,
        documentNo: d.dispatchNo,
        date: d.dispatchedAt.toISOString(),
        group: station,
        title: "Fason Sevk İrsaliyesi",
        subtitle: [
          d.subcontractor?.name,
          d.batch?.batchNumber ? `Parti ${d.batch.batchNumber}` : null,
          `${d._count.items} top · ${Number(d.totalQty)} m`,
        ]
          .filter(Boolean)
          .join(" · "),
        cancelled: d.cancelledAt != null,
      });
    }

    for (const r of receipts) {
      const station = r.step?.station?.name ?? "Fason";
      docs.push({
        docType: "SUBCONTRACTOR_RECEIPT",
        sourceId: r.id,
        documentNo: r.receiptNo,
        date: r.receivedAt.toISOString(),
        group: station,
        title: "Fason Kabul Makbuzu",
        subtitle: [
          r.subcontractor?.name,
          r.manifestNo ? `Fason İrs. ${r.manifestNo}` : null,
          `${r._count.items} top`,
        ]
          .filter(Boolean)
          .join(" · "),
        cancelled: r.cancelledAt != null,
      });
    }

    for (const ds of directShipments) {
      docs.push({
        docType: "SUBCONTRACTOR_DIRECT_SHIP",
        sourceId: ds.id,
        documentNo: ds.shipmentNo,
        date: ds.shippedAt.toISOString(),
        group: ds.dispatch?.step?.station?.name ?? "Fason",
        title: "Fasondan Sevk İrsaliyesi",
        subtitle: [ds.customer?.name, `${Number(ds.totalQty)} m`].filter(Boolean).join(" · "),
        // Doğrudan sevk terminaldir — iptal yolu yok (buildFasonDirectShipDoc da
        // `voidInfo: null` der); alan sözleşme bütünlüğü için sabit false.
        cancelled: false,
      });
    }

    return {
      success: true,
      data: { workOrderNumber: wo.workOrderNumber, documents: docs },
    };
  }

export async function getAttachedRolls(workOrderId: string): Promise<ApiResponse<unknown[]>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { steps: true },
    });

    if (!wo) {
      throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
    }

    const stepIds = wo.steps.map((s) => s.id);
    if (stepIds.length === 0) {
      return { success: true, data: [] };
    }

    // PERF (#12 select>include): tüketiciler (mobil WorkOrderDetailSheet +
    // printWorkOrder) yalnız id/barcode/status/currentQty/item.name okuyor; color
    // savunma amaçlı dar select'le tutulur. item:true / color:true tüm sütunları
    // çekiyordu (over-fetch).
    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { producedInStepId: { in: stepIds } },
          { currentStepId: { in: stepIds } },
        ],
      },
      select: {
        id: true,
        barcode: true,
        status: true,
        currentQty: true,
        colorId: true,
        item: { select: { id: true, name: true } },
        color: { select: { id: true, code: true, name: true, hex: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: rolls };
  }

export async function getTravelCard(workOrderId: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        targetColor: true,
        steps: {
          include: { station: true },
          orderBy: { stepSequence: "asc" },
        },
        orderLinks: {
          where: ACTIVE_ORDER_LINK,
          orderBy: { createdAt: "asc" },
          include: {
            orderLine: {
              include: {
                order: { include: { customer: true } },
                item: true,
                color: true,
              },
            },
          },
        },
      },
    });

    if (!wo) {
      return { success: false, data: null, message: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı` };
    }

    const travelCard = {
      batchNumber: wo.workOrderNumber,
      type: wo.type,
      width: wo.width,
      targetColor: wo.targetColor
        ? { id: wo.targetColor.id, code: wo.targetColor.code, name: wo.targetColor.name }
        : null,
      status: wo.status,
      parameters: wo.parameters,
      route: wo.steps.map((step) => ({
        sequence: step.stepSequence,
        stationCode: step.station.code,
        stationName: step.station.name,
        stationType: step.station.type,
        status: step.status,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
      })),
      linkedOrders: wo.orderLinks.map((link) => ({
        orderNumber: link.orderLine.order.orderNumber,
        customerName: link.orderLine.order.customer.name,
        itemName: link.orderLine.item.name,
        colorName: link.orderLine.color?.name ?? null,
        requestedQty: link.orderLine.quantity,
      })),
      createdAt: wo.createdAt,
    };

    return { success: true, data: travelCard };
  }

export async function computeLiveManifest(
    workOrderId: string
  ): Promise<Record<string, unknown> | null> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        steps: {
          include: { station: true },
          orderBy: { stepSequence: "asc" },
        },
      },
    });
    if (!wo) return null;

    const rolls = await prisma.roll.findMany({
      where: {
        parentRollId: null,
        status: { notIn: [RollStatus.CANCELLED] },
        OR: [
          { producedInStepId: { in: wo.steps.map((s) => s.id) } },
          { currentStepId: { in: wo.steps.map((s) => s.id) } },
        ],
      },
      // F69: manifest yalnız bu alanları kullanıyor — tüm item satırını çekme (over-fetch).
      select: {
        barcode: true,
        currentQty: true,
        weightKg: true,
        status: true,
        item: { select: { name: true } },
      },
    });

    // Hedef adım (rota'nın ilk istasyonu) — dyehouse alanı kaldırıldığı için
    // destination her zaman ilk istasyon üzerinden türetilir. Bir EXTERNAL adım
    // varsa fason firma bilgisi WorkOrderStep.plannedSubcontractor üzerinden
    // ileride buraya eklenebilir (ayrı bir task).
    const destination = wo.steps[0]
      ? {
          kind: "STATION" as const,
          stationCode: wo.steps[0].station.code,
          stationName: wo.steps[0].station.name,
        }
      : null;

    return {
      batchNumber: wo.workOrderNumber,
      type: wo.type,
      width: wo.width,
      totalRolls: rolls.length,
      // Decimal aritmetik — float drift'i önler. Serializer Decimal'i number'a çevirir.
      totalMeterage: rolls.reduce(
        (sum, r) => sum.plus(r.currentQty),
        new Prisma.Decimal(0)
      ),
      totalWeight: rolls.reduce(
        (sum, r) => sum.plus(r.weightKg ?? 0),
        new Prisma.Decimal(0)
      ),
      rolls: rolls.map((r) => ({
        barcode: r.barcode,
        itemName: r.item.name,
        currentQty: r.currentQty,
        weightKg: r.weightKg,
        status: r.status,
      })),
      destination,
    };
  }

export async function getManifest(this: WorkOrderServiceThis, workOrderId: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    const latestManifest = await prisma.manifest.findFirst({
      where: { workOrderId },
      orderBy: { printedAt: "desc" },
      include: {
        printedBy: { select: { id: true, username: true, fullName: true } },
      },
    });

    if (latestManifest) {
      const snapshot = (latestManifest.snapshot ?? {}) as Record<string, unknown>;
      return {
        success: true,
        data: {
          ...snapshot,
          isSnapshot: true,
          manifestNo: latestManifest.manifestNo,
          printedAt: latestManifest.printedAt,
          printedBy: latestManifest.printedBy,
          notes: latestManifest.notes,
        },
      };
    }

    const live = await this.computeLiveManifest(workOrderId);
    if (!live) {
      return { success: false, data: null, message: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı` };
    }
    return { success: true, data: { ...live, isSnapshot: false } };
  }

export async function createManifest(this: WorkOrderServiceThis, 
    workOrderId: string,
    userId?: string,
    notes?: string
  ): Promise<ApiResponse<Record<string, unknown> | null>> {
    const live = await this.computeLiveManifest(workOrderId);
    if (!live) {
      throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
    }

    // Çeki listesi numarası biçimi VERİDİR (numara serisi `manifest`); ön ek,
    // tarih segmenti ve hane fabrikanın ayarından gelir.
    const now = new Date();

    // manifestNo @unique + günlük sequence TÜM WO'lar arasında paylaşımlı —
    // eşzamanlı iki basım aynı NNN'i hesaplardı; projedeki diğer tüm belge
    // numaraları gibi withBarcodeRetry ile sarıldı (P2002'de sequence closure
    // içinde yeniden okunur).
    const manifest = await withBarcodeRetry(async () => {
      // O-4: collation-güvenli (gte + startsWith) + NUMERIC max — lexicographic
      // "999">"1000" taşmasını önler (findFirst+orderBy desc "...999"da sıkışıp
      // withBarcodeRetry'ı kalıcı 409'a düşürüyordu). withBarcodeRetry sarması
      // korunur: P2002'de closure taze max okur.
      // ⚠️ C0 KAPSAMI: sayaç yalnız BU BİÇİM yürürlüğe girdikten sonra doğan
      // kodlara bakar (`formatChangedAt`); tarih segmenti düşünce eski rejimin
      // kodları sayaca girerdi. `nextSeriesNo` kapsamı ve çakışma atlamasını TEK
      // YERDE tutar — `withBarcodeRetry` sarması korunur (yarışta taze okuma).
      const manifestNo = await nextManifestNo(now);

      return prisma.manifest.create({
        data: {
          manifestNo,
          workOrderId,
          printedById: userId ?? null,
          snapshot: live as Prisma.InputJsonValue,
          notes: notes ?? null,
        },
      });
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "MANIFEST",
      recordId: manifest.id,
      newData: { packingListNo: manifest.manifestNo, workOrderId },
    });

    return {
      success: true,
      data: {
        id: manifest.id,
        manifestNo: manifest.manifestNo,
        printedAt: manifest.printedAt,
        snapshot: manifest.snapshot,
      },
      message: `Çeki listesi oluşturuldu: ${manifest.manifestNo}`,
    };
  }

export async function listManifests(workOrderId: string): Promise<ApiResponse<unknown>> {
    const manifests = await prisma.manifest.findMany({
      where: { workOrderId },
      orderBy: { printedAt: "desc" },
      // snapshot (JSON) liste görünümünde yüklenmez; sadece detail/print endpoint'i çeker
      select: {
        id: true,
        manifestNo: true,
        workOrderId: true,
        printedAt: true,
        notes: true,
        printedBy: { select: { id: true, username: true, fullName: true } },
      },
    });
    return { success: true, data: manifests };
  }

export async function getManifestById(manifestId: string): Promise<ApiResponse<unknown>> {
    const manifest = await prisma.manifest.findUnique({
      where: { id: manifestId },
      select: {
        id: true,
        manifestNo: true,
        workOrderId: true,
        printedAt: true,
        notes: true,
        snapshot: true,
        printedBy: { select: { id: true, username: true, fullName: true } },
      },
    });

    if (!manifest) {
      throw AppError.notFound("Çeki listesi bulunamadı");
    }

    return { success: true, data: manifest };
  }
