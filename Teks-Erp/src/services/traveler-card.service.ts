// =============================================================================
// TeksERP - TravelerCard (Refakat Kartı) Service
// =============================================================================
// MODEL (2026-07-14): Kart İŞ EMRİ başınadır (parti değil) ve iş emri açılışında
// doğar. Tek-kod: cardNumber = barcode = workOrderNumber (İE+GGAAYY+NNNN). Karekod
// versiyonlar arası SABİT — WO değişirse reprint AYNI satırda snapshot'ı tazeler +
// version++, kod DEĞİŞMEZ (sahada hep aynı karekod). Parti (Batch) veri modeli kalır
// ama kart üretmez.
//
// İş Kuralları:
//   - Bir WorkOrder = tek TravelerCard (workOrderId @unique).
//   - Kart WO create tx'inde doğar (createForWorkOrder, idempotent).
//   - Reprint eski satırı korur (barkod sabit), snapshot'ı güncel WO'dan tazeler,
//     version++ eder. Ayrı satır/REPRINTED durumu YOK.
//   - Scan (tarama) ACTIVE olmayan kart ile reddedilir.
//   - WO COMPLETED / CANCELLED olunca kart COMPLETED / VOIDED'a çekilir
//     (setWorkOrderCardStatuses fan-out helper).
// =============================================================================

import { Request } from "express";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse, PaginatedResponse } from "../types/api.types";
import { isDailyCode } from "../utils/code-format";
import { readTravelerCardConfig, type TravelerCardConfig } from "./system-setting.service";
import bwipjs from "bwip-js";
import {
  renderTravelerCardHtml,
  type TravelerCardSnapshot,
} from "./document-render/traveler-card.html";
import { parseQueryParams, buildPagination, resolveSortBy, buildTurkishSearch } from "../utils/query-parser";
import {
  Prisma,
  TravelerCard,
  TravelerCardScan,
  TravelerCardStatus,
  ScanType,
  WorkOrderStatus,
} from "@prisma/client";

// Refakat kartı listesinde sıralanabilir kolonlar. createdAt BİLEREK yok →
// varsayılan/createdAt isteği printedAt'e düşer (yeni basılan kart ilk gelsin).
const TRAVELER_SORTABLE_FIELDS = ["printedAt", "cardNumber", "status", "version"] as const;

/** Kart kodu kabulü — İE (yeni tek-kod) birincil, RK (eski kart) legacy toleransı. */
function isCardCode(code: string): boolean {
  return isDailyCode(code, "IE") || isDailyCode(code, "RK");
}

// Belge Şablonu (Refakat Kartı Ayarları) canlı önizlemesi için örnek içerik.
// Gerçek kart verisi DEĞİL; renderSampleHtml taslak config ile birleştirir.
const SAMPLE_TRAVELER_BARCODE = "IE1207260001"; // tek kod: İE + GGAAYY + NNNN (= iş emri no)
const SAMPLE_TRAVELER_SNAPSHOT: Omit<TravelerCardSnapshot, "config"> = {
  workOrderNumber: "IE1207260001",
  type: "ORDER_PRODUCTION",
  width: 150,
  targetQuantity: 680,
  targetWeight: 110,
  foldType: "Top",
  plannedStartDate: "2026-06-07T00:00:00.000Z",
  plannedEndDate: "2026-06-14T00:00:00.000Z",
  routeTemplate: { name: "Standart Boyama Rotası" },
  targetItem: { code: "KMS-001", name: "Pamuklu Astar" },
  targetColor: { name: "Bej", hex: "#d8c9a8" },
  targetProperties: [{ propertyId: "p1", property: { name: "Su İticilik" } }],
  steps: [
    { id: "step1", stepSequence: 1, isUrgent: false, notes: null, station: { name: "Ham Kalite (KK1)", type: "INTERNAL" }, plannedSubcontractor: null },
    { id: "step2", stepSequence: 2, isUrgent: false, notes: "Yıkama yapma, matlaştır", station: { name: "Boyahane", type: "EXTERNAL" }, plannedSubcontractor: { id: "sub1", name: "Yıldız Boyahane" } },
    { id: "step3", stepSequence: 3, isUrgent: false, notes: null, station: { name: "Kurşun + KK2", type: "INTERNAL" }, plannedSubcontractor: null },
    { id: "step4", stepSequence: 4, isUrgent: false, notes: null, station: { name: "Tambur", type: "INTERNAL" }, plannedSubcontractor: null },
  ],
  orderLinks: [
    {
      orderLineId: "ol1",
      orderLine: {
        quantity: 680,
        order: { orderNumber: "SIP-2026-0107", customer: { name: "Örnek Tekstil A.Ş." } },
        item: { name: "Pamuklu Astar" },
        color: { name: "Bej" },
      },
    },
    {
      orderLineId: "ol2",
      orderLine: {
        quantity: 320,
        order: { orderNumber: "SIP-2026-0108", customer: { name: "Deneme Konfeksiyon" } },
        item: { name: "Pamuklu Astar" },
        color: { name: "Lacivert" },
      },
    },
  ],
};

export class TravelerCardService {
  /**
   * İş emri açılışından (`workorder.service` create tx'i) çağrılan idempotent kart
   * üretici. Bir WO = tek kart. Kart zaten varsa döner ({created:false}); yoksa
   * version=1 ile üretir. Tek-kod: cardNumber = barcode = workOrderNumber (İE) →
   * sequence/barkod-retry YOK (kod deterministik, WO no benzersiz).
   *
   * Audit BU METOTTAN KALDIRILDI (tx içinde) — çağıran, `created:true` ise audit'i
   * tx COMMIT'inden SONRA yazar.
   */
  async createForWorkOrder(
    tx: Prisma.TransactionClient,
    workOrderId: string,
    userId?: string,
  ): Promise<{ card: TravelerCard; created: boolean }> {
    const existing = await tx.travelerCard.findUnique({ where: { workOrderId } });
    if (existing) return { card: existing, created: false };

    const wo = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: { workOrderNumber: true },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    const snapshot = await this.buildSnapshot(tx, workOrderId);
    const card = await tx.travelerCard.create({
      data: {
        cardNumber: wo.workOrderNumber, // = barcode (tek kod)
        barcode: wo.workOrderNumber,
        workOrderId,
        version: 1,
        status: TravelerCardStatus.ACTIVE,
        printedById: userId ?? null,
        snapshot,
      },
    });
    return { card, created: true };
  }

  /**
   * Kartı garanti eder (idempotent). Kart WO açılışında doğduğundan bu uç genelde
   * mevcut kartı döner; eski/kartsız WO'larda oluşturur. 409 ATMAZ.
   */
  async print(
    workOrderId: string,
    userId?: string,
  ): Promise<ApiResponse<TravelerCard>> {
    const { card, created } = await prisma.$transaction((tx) =>
      this.createForWorkOrder(tx, workOrderId, userId),
    );
    if (created) {
      await AuditService.log({
        userId,
        action: "CREATE",
        tableName: "TRAVELER_CARD",
        recordId: card.id,
        newData: { cardNumber: card.cardNumber, barcode: card.barcode, event: "PRINT" },
      });
    }
    return {
      success: true,
      data: card,
      message: created
        ? `Refakat kartı basıldı: ${card.cardNumber}`
        : `Refakat kartı zaten mevcut: ${card.cardNumber}`,
    };
  }

  /**
   * Yeniden basım — AYNI satırda: snapshot'ı GÜNCEL WO'dan tazeler + version++.
   * Karekod (İE) DEĞİŞMEZ. WO'ya sipariş/müşteri eklendiyse operatör bununla güncel
   * kartı basar. Yalnız ACTIVE kart yeniden basılabilir (iptal/tamamlanmış WO'da 409).
   */
  async reprint(
    workOrderId: string,
    reason: string,
    userId?: string,
  ): Promise<ApiResponse<TravelerCard>> {
    if (!reason || reason.trim().length < 3) {
      throw AppError.badRequest("Yeniden basım için gerekçe zorunlu (en az 3 karakter)");
    }

    const card = await prisma.$transaction(async (tx) => {
      const existing = await tx.travelerCard.findUnique({ where: { workOrderId } });
      if (!existing) {
        // Kartsız (eski) WO — ilk kez üret.
        const created = await this.createForWorkOrder(tx, workOrderId, userId);
        return created.card;
      }
      if (existing.status !== TravelerCardStatus.ACTIVE) {
        throw AppError.conflict(
          `Kart aktif değil (${existing.status}) — iptal/tamamlanmış iş emrinin kartı yeniden basılamaz.`,
        );
      }
      const snapshot = await this.buildSnapshot(tx, workOrderId);
      return tx.travelerCard.update({
        where: { id: existing.id },
        data: {
          version: existing.version + 1,
          snapshot,
          printedById: userId ?? null,
          printedAt: new Date(),
        },
      });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "TRAVELER_CARD",
      recordId: card.id,
      newData: { cardNumber: card.cardNumber, version: card.version, event: "REPRINT", reason },
    });

    return {
      success: true,
      data: card,
      message: `Refakat kartı yeniden basıldı: ${card.cardNumber} (v${card.version})`,
    };
  }

  /**
   * Aktif kartı manuel olarak iptal eder (VOIDED). Atomik claim (ACTIVE→VOIDED).
   */
  async voidCard(
    cardId: string,
    reason: string,
    userId?: string,
  ): Promise<ApiResponse<TravelerCard>> {
    if (!reason || reason.trim().length < 3) {
      throw AppError.badRequest("İptal gerekçesi zorunlu (en az 3 karakter)");
    }

    const card = await prisma.travelerCard.findUnique({ where: { id: cardId } });
    if (!card) throw AppError.notFound("Refakat kartı bulunamadı");
    if (card.status !== TravelerCardStatus.ACTIVE) {
      throw AppError.badRequest(
        `Sadece ACTIVE durumdaki kart iptal edilebilir (mevcut: ${card.status})`,
      );
    }

    const claim = await prisma.travelerCard.updateMany({
      where: { id: cardId, status: TravelerCardStatus.ACTIVE },
      data: { status: TravelerCardStatus.VOIDED, voidedAt: new Date(), voidReason: reason },
    });
    if (claim.count === 0) {
      throw AppError.conflict("Kart bu sırada iptal edildi veya durumu değişti");
    }
    const updated = await prisma.travelerCard.findUnique({ where: { id: cardId } });
    if (!updated) throw AppError.notFound("Refakat kartı bulunamadı");

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "TRAVELER_CARD",
      recordId: cardId,
      oldData: { status: TravelerCardStatus.ACTIVE },
      newData: { status: TravelerCardStatus.VOIDED, reason },
    });

    return {
      success: true,
      data: updated,
      message: `Refakat kartı iptal edildi: ${updated.cardNumber}`,
    };
  }

  /**
   * İstasyon taraması — barkodu oku, ACTIVE kart ise scan kaydı oluştur.
   * workOrderStepId otomatik çözümlenir (WO'nun bu istasyondaki PENDING/ACTIVE adımı).
   */
  async scan(
    data: {
      barcode: string;
      stationId: string;
      scanType: ScanType;
      notes?: string;
      deviceId?: string;
    },
    userId?: string,
  ): Promise<ApiResponse<TravelerCardScan>> {
    if (!isCardCode(data.barcode)) {
      throw AppError.badRequest("Geçersiz barkod formatı");
    }

    const card = await prisma.travelerCard.findUnique({
      where: { barcode: data.barcode.toUpperCase() },
      include: {
        workOrder: { include: { steps: { orderBy: { stepSequence: "asc" } } } },
      },
    });

    if (!card) throw AppError.notFound("Barkod sistemde kayıtlı değil");
    if (card.status !== TravelerCardStatus.ACTIVE) {
      throw AppError.conflict(
        `Bu kart artık geçerli değil: ${card.status}. Kart numarası: ${card.cardNumber}`,
      );
    }
    if (card.workOrder.status === WorkOrderStatus.CANCELLED) {
      throw AppError.conflict("Bağlı iş emri iptal edilmiş");
    }

    const station = await prisma.station.findUnique({
      where: { id: data.stationId },
      select: { isActive: true },
    });
    if (!station) throw AppError.notFound("İstasyon bulunamadı");
    if (!station.isActive) throw AppError.badRequest("İstasyon pasif — okutma yapılamaz");

    // İstasyona karşılık gelen step'i bul (birden fazla varsa PENDING/ACTIVE olanı tercih et)
    const woSteps = card.workOrder.steps;
    const matchingStep =
      woSteps.find(
        (s) => s.stationId === data.stationId && s.status !== "COMPLETED" && s.status !== "SKIPPED",
      ) ?? woSteps.find((s) => s.stationId === data.stationId);

    const scan = await prisma.travelerCardScan.create({
      data: {
        cardId: card.id,
        stationId: data.stationId,
        workOrderStepId: matchingStep?.id ?? null,
        scanType: data.scanType,
        scannedById: userId ?? null,
        deviceId: data.deviceId ?? null,
        notes: data.notes ?? null,
      },
      include: { station: true, step: true },
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "TRAVELER_CARD_SCAN",
      recordId: scan.id,
      newData: {
        cardId: card.id,
        barcode: card.barcode,
        stationId: data.stationId,
        scanType: data.scanType,
      },
    });

    return {
      success: true,
      data: scan,
      message: `Tarama kaydedildi: ${card.cardNumber} @ ${scan.station.name}`,
    };
  }

  /**
   * Aktif refakat kartlarını listeler — mobil ekranlarda "kart seç" picker'ı için.
   *  - `?filter[status]=ACTIVE|...|ALL` (default: ACTIVE)
   *  - `?filter[workOrderId]=...` — WO'ya birebir filtre
   *  - `?search=...` — cardNumber/barcode TAM eşleşme + workOrderNumber contains
   */
  async list(req: Request): Promise<PaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    const where: Prisma.TravelerCardWhereInput = {};

    const woFilter = params.filters.workOrderId;
    if (typeof woFilter === "string" && woFilter) where.workOrderId = woFilter;

    const statusFilter = params.filters.status;
    if (statusFilter === "ALL" || (Array.isArray(statusFilter) && statusFilter.includes("ALL"))) {
      // no status filter
    } else if (Array.isArray(statusFilter)) {
      where.status = { in: statusFilter as TravelerCardStatus[] };
    } else if (typeof statusFilter === "string") {
      where.status = statusFilter as TravelerCardStatus;
    } else {
      where.status = TravelerCardStatus.ACTIVE;
    }

    if (params.search && params.search.trim()) {
      const q = params.search.trim();
      const qUpper = q.toUpperCase();
      where.OR = [
        { cardNumber: qUpper },
        { barcode: qUpper },
        ...buildTurkishSearch<Prisma.TravelerCardWhereInput>(q, ["workOrder.workOrderNumber"]),
      ];
    }

    const { skip, take } = buildPagination(params.page, params.pageSize);
    const sortField = resolveSortBy(params.sortBy, TRAVELER_SORTABLE_FIELDS, "printedAt");
    const orderBy = { [sortField]: params.sortOrder };

    const [items, total] = await Promise.all([
      prisma.travelerCard.findMany({
        where,
        orderBy,
        skip,
        take,
        select: {
          id: true,
          cardNumber: true,
          barcode: true,
          version: true,
          status: true,
          workOrderId: true,
          printedAt: true,
          workOrder: {
            select: {
              id: true,
              workOrderNumber: true,
              status: true,
              type: true,
              targetItem: { select: { id: true, code: true, name: true } },
              targetColor: { select: { id: true, code: true, name: true, hex: true } },
            },
          },
        },
      }),
      prisma.travelerCard.count({ where }),
    ]);

    return {
      success: true,
      data: items,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.ceil(total / params.pageSize) || 1,
      },
    };
  }

  /**
   * Kartı tek kodu (barkod = kart numarası = iş emri no) ile bulur. İE (yeni) veya
   * RK (eski/legacy) kabul edilir. Tarama öncesi önizleme.
   */
  async findByBarcode(
    input: string,
  ): Promise<ApiResponse<(Omit<TravelerCard, "snapshot"> & { hasOpenDispatch: boolean }) | null>> {
    const normalized = input.trim().toUpperCase();
    if (!isCardCode(normalized)) {
      throw AppError.badRequest("Geçersiz format. Beklenen: İE1207260001 (iş emri kartı)");
    }

    const card = await prisma.travelerCard.findFirst({
      where: { OR: [{ barcode: normalized }, { cardNumber: normalized }] },
      omit: { snapshot: true },
      include: {
        workOrder: {
          include: {
            targetItem: true,
            targetColor: true,
            steps: { include: { station: true }, orderBy: { stepSequence: "asc" } },
          },
        },
        scans: { orderBy: { scannedAt: "desc" }, take: 20, include: { station: true } },
      },
    });

    if (!card) {
      return { success: false, data: null, message: "Kart bulunamadı" };
    }

    // Fason Sevk akışı: bu WO için açık (cancelledAt=null + mal kabul tam değil) sevk
    // varsa mobil UI erken uyarı verir (backend dispatch de ayrıca 409 atabilir).
    const openDispatchCount = await prisma.subcontractorDispatch.count({
      where: {
        workOrderId: card.workOrderId,
        cancelledAt: null,
        items: { some: { receiptItems: { none: {} } } },
      },
    });

    const data = { ...card, hasOpenDispatch: openDispatchCount > 0 };
    return { success: true, data };
  }

  /**
   * Bir iş emrinin kartı + tarama geçmişi (WO = tek kart).
   */
  async getHistory(workOrderId: string): Promise<ApiResponse<unknown>> {
    const cards = await prisma.travelerCard.findMany({
      where: { workOrderId },
      orderBy: { version: "desc" },
      include: {
        printedBy: { select: { id: true, username: true, fullName: true } },
        scans: {
          orderBy: { scannedAt: "asc" },
          include: {
            station: true,
            step: true,
            scannedBy: { select: { id: true, username: true, fullName: true } },
          },
        },
      },
    });
    return { success: true, data: cards };
  }

  /**
   * Refakat kartının resmi HTML çıktısı — TEK KAYNAK (Electron + mobil aynı HTML).
   * İçerik kartın DONMUŞ snapshot'ından; yoksa WO'dan canlı kurulur. QR = barkod (İE).
   */
  async getCardHtml(cardId: string): Promise<string> {
    const card = await prisma.travelerCard.findUnique({
      where: { id: cardId },
      select: {
        cardNumber: true,
        barcode: true,
        version: true,
        printedAt: true,
        status: true,
        voidReason: true,
        snapshot: true,
        workOrderId: true,
      },
    });
    if (!card) throw new AppError("Refakat kartı bulunamadı", 404);

    const snapshot =
      (card.snapshot as unknown as TravelerCardSnapshot | null) ??
      ((await this.buildSnapshot(prisma, card.workOrderId)) as unknown as TravelerCardSnapshot);

    let qrSvg: string | null = null;
    try {
      qrSvg = bwipjs.toSVG({ bcid: "qrcode", text: card.barcode, scale: 3, backgroundcolor: "FFFFFF" });
    } catch {
      qrSvg = null;
    }

    return renderTravelerCardHtml(snapshot, {
      cardNumber: card.cardNumber,
      barcode: card.barcode,
      version: card.version,
      printedAt: card.printedAt.toISOString(),
      status: card.status,
      voidReason: card.voidReason,
      qrSvg,
    });
  }

  /**
   * ÖRNEK HTML — "Refakat Kartı Ayarları" panelindeki canlı önizleme.
   */
  async renderSampleHtml(config: TravelerCardConfig): Promise<string> {
    const snapshot: TravelerCardSnapshot = { ...SAMPLE_TRAVELER_SNAPSHOT, config };
    let qrSvg: string | null = null;
    try {
      qrSvg = bwipjs.toSVG({ bcid: "qrcode", text: SAMPLE_TRAVELER_BARCODE, scale: 3, backgroundcolor: "FFFFFF" });
    } catch {
      qrSvg = null;
    }
    return renderTravelerCardHtml(snapshot, {
      cardNumber: SAMPLE_TRAVELER_BARCODE,
      barcode: SAMPLE_TRAVELER_BARCODE,
      version: 1,
      printedAt: "2026-06-07T10:30:00.000Z",
      qrSvg,
      draft: true,
    });
  }

  /**
   * Basım anında WO içeriğini DONDURUR (kart snapshot'ı). Değişken veriler
   * (top sayısı/metraj) plandan gelir; kartta müşteri/sipariş/rota sabit kalır.
   */
  private async buildSnapshot(
    client: Prisma.TransactionClient,
    workOrderId: string,
  ): Promise<Prisma.InputJsonValue> {
    const wo = await client.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        workOrderNumber: true,
        type: true,
        width: true,
        targetQuantity: true,
        targetWeight: true,
        foldType: true,
        plannedStartDate: true,
        plannedEndDate: true,
        routeTemplate: { select: { name: true } },
        targetItem: { select: { code: true, name: true } },
        targetColor: { select: { name: true, hex: true } },
        targetProperties: {
          select: { propertyId: true, property: { select: { name: true } } },
        },
        steps: {
          orderBy: { stepSequence: "asc" },
          select: {
            id: true,
            stepSequence: true,
            isUrgent: true,
            notes: true,
            station: { select: { name: true, type: true } },
            plannedSubcontractor: { select: { id: true, name: true } },
          },
        },
        orderLinks: {
          select: {
            orderLineId: true,
            orderLine: {
              select: {
                quantity: true,
                order: {
                  select: { orderNumber: true, customer: { select: { name: true } } },
                },
                item: { select: { name: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!wo) return {};
    const config = await readTravelerCardConfig(client);
    const num = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));
    return {
      config,
      workOrderNumber: wo.workOrderNumber, // İş Emri no (İE…) — kartta iri kimlik
      type: wo.type,
      width: num(wo.width),
      targetQuantity: num(wo.targetQuantity),
      targetWeight: num(wo.targetWeight),
      foldType: wo.foldType,
      plannedStartDate: wo.plannedStartDate?.toISOString() ?? null,
      plannedEndDate: wo.plannedEndDate?.toISOString() ?? null,
      routeTemplate: wo.routeTemplate ? { name: wo.routeTemplate.name } : null,
      targetItem: wo.targetItem
        ? { code: wo.targetItem.code, name: wo.targetItem.name }
        : null,
      targetColor: wo.targetColor
        ? { name: wo.targetColor.name, hex: wo.targetColor.hex }
        : null,
      targetProperties: wo.targetProperties.map((p) => ({
        propertyId: p.propertyId,
        property: { name: p.property.name },
      })),
      steps: wo.steps.map((st) => ({
        id: st.id,
        stepSequence: st.stepSequence,
        isUrgent: st.isUrgent,
        notes: st.notes,
        station: st.station ? { name: st.station.name, type: st.station.type } : null,
        plannedSubcontractor: st.plannedSubcontractor
          ? { id: st.plannedSubcontractor.id, name: st.plannedSubcontractor.name }
          : null,
      })),
      orderLinks: wo.orderLinks.map((l) => ({
        orderLineId: l.orderLineId,
        orderLine: l.orderLine
          ? {
              quantity: num(l.orderLine.quantity),
              order: l.orderLine.order
                ? {
                    orderNumber: l.orderLine.order.orderNumber,
                    customer: l.orderLine.order.customer
                      ? { name: l.orderLine.order.customer.name }
                      : null,
                  }
                : null,
              item: l.orderLine.item ? { name: l.orderLine.item.name } : null,
              color: l.orderLine.color ? { name: l.orderLine.color.name } : null,
            }
          : null,
      })),
    } as unknown as Prisma.InputJsonValue;
  }
}
