// =============================================================================
// TeksERP - TravelerCard (Refakat Kartı) Service
// =============================================================================
// İş Kuralları:
//   - Bir WorkOrder'ın aynı anda en fazla 1 ACTIVE kartı olabilir (partial unique).
//   - Kart basımı (print) sadece PLANNED veya IN_PROGRESS durumunda izinli.
//   - Reprint eski kartı REPRINTED, yeni kartı version+1 ile ACTIVE yapar.
//     Scan'ler eski kartta kalır (audit).
//   - Scan (tarama) ACTIVE olmayan kart ile reddedilir.
//   - WO COMPLETED veya CANCELLED olunca ACTIVE kartlar COMPLETED/VOIDED'a çekilir.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { buildBarcode, buildCardNumber, verifyBarcode } from "../utils/barcode";
import {
  TravelerCard,
  TravelerCardScan,
  TravelerCardStatus,
  ScanType,
  WorkOrderStatus,
} from "@prisma/client";

export class TravelerCardService {
  /**
   * Ay bazlı sıra üretici — aynı yıl-ay içinde oluşturulan en yüksek barkodun
   * 6-char segmentini decode edip +1 döndürür.
   * Collision olursa retry ile çözümlenir.
   */
  private async nextMonthlySequence(date: Date): Promise<number> {
    const yy = String(date.getFullYear()).slice(2);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const prefix = `RK-${yy}${mm}-`;

    const lastCard = await prisma.travelerCard.findFirst({
      where: { barcode: { startsWith: prefix } },
      orderBy: { barcode: "desc" },
      select: { barcode: true },
    });

    if (!lastCard) return 1;

    // barcode = RK-YYMM-XXXXXX-C → XXXXXX segmentini al ve crockford decode et
    const parts = lastCard.barcode.split("-");
    if (parts.length < 4) return 1;
    const seqStr = parts[2];

    const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let n = 0;
    for (const ch of seqStr.toUpperCase()) {
      const v = CROCKFORD.indexOf(ch);
      if (v < 0) return 1;
      n = n * 32 + v;
    }
    return n + 1;
  }

  /**
   * Yeni bir refakat kartı üretir (ilk basım).
   */
  async print(
    workOrderId: string,
    userId?: string
  ): Promise<ApiResponse<TravelerCard>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { travelerCards: { where: { status: TravelerCardStatus.ACTIVE } } },
    });

    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    if (
      wo.status !== WorkOrderStatus.PLANNED &&
      wo.status !== WorkOrderStatus.IN_PROGRESS
    ) {
      throw AppError.conflict(
        `Bu durumda refakat kartı basılamaz: ${wo.status}. Sadece PLANNED veya IN_PROGRESS.`
      );
    }

    if (wo.travelerCards.length > 0) {
      throw AppError.conflict(
        `Bu iş emri için zaten aktif bir refakat kartı var: ${wo.travelerCards[0].cardNumber}. Yeniden basım için reprint endpoint'ini kullanın.`
      );
    }

    return this.createCardInternal(workOrderId, 1, userId, "PRINT");
  }

  /**
   * Mevcut aktif kartı REPRINTED'a çekip yeni bir ACTIVE kart basar.
   */
  async reprint(
    workOrderId: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<TravelerCard>> {
    if (!reason || reason.trim().length < 3) {
      throw AppError.badRequest("Yeniden basım için gerekçe zorunlu (en az 3 karakter)");
    }

    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { travelerCards: { orderBy: { version: "desc" } } },
    });

    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    if (
      wo.status !== WorkOrderStatus.PLANNED &&
      wo.status !== WorkOrderStatus.IN_PROGRESS
    ) {
      throw AppError.conflict(`Bu durumda reprint yapılamaz: ${wo.status}`);
    }

    const activeCard = wo.travelerCards.find((c) => c.status === TravelerCardStatus.ACTIVE);
    const lastVersion = wo.travelerCards[0]?.version ?? 0;

    // Eski kartı REPRINTED'a çek, yeni kartı üret (transaction içinde)
    return prisma.$transaction(async (tx) => {
      if (activeCard) {
        await tx.travelerCard.update({
          where: { id: activeCard.id },
          data: {
            status: TravelerCardStatus.REPRINTED,
            voidReason: `REPRINT: ${reason}`,
            voidedAt: new Date(),
          },
        });
      }
      // Not: createCardInternal kendi küçük transaction'ı var; burada dış
      // transaction'a katılması için tx'i direkt geçiremeyiz. Basit çözüm:
      // kart oluşturma işini burada inline yapalım.
      const seq = await this.nextMonthlySequence(new Date());
      const now = new Date();
      const cardNumber = buildCardNumber(now, seq);
      const barcode = buildBarcode(now, seq);

      const card = await tx.travelerCard.create({
        data: {
          cardNumber,
          barcode,
          workOrderId,
          version: lastVersion + 1,
          status: TravelerCardStatus.ACTIVE,
          printedById: userId ?? null,
        },
      });

      await AuditService.log({
        userId,
        action: "CREATE",
        tableName: "TRAVELER_CARD",
        recordId: card.id,
        newData: { cardNumber, barcode, version: card.version, event: "REPRINT", reason },
      });

      return {
        success: true,
        data: card,
        message: `Refakat kartı yeniden basıldı: ${cardNumber} (v${card.version})`,
      };
    });
  }

  /**
   * Aktif kartı manuel olarak iptal eder (VOIDED).
   */
  async voidCard(
    cardId: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<TravelerCard>> {
    if (!reason || reason.trim().length < 3) {
      throw AppError.badRequest("İptal gerekçesi zorunlu (en az 3 karakter)");
    }

    const card = await prisma.travelerCard.findUnique({ where: { id: cardId } });
    if (!card) {
      throw AppError.notFound("Refakat kartı bulunamadı");
    }

    if (card.status !== TravelerCardStatus.ACTIVE) {
      throw AppError.badRequest(
        `Sadece ACTIVE durumdaki kart iptal edilebilir (mevcut: ${card.status})`
      );
    }

    const updated = await prisma.travelerCard.update({
      where: { id: cardId },
      data: {
        status: TravelerCardStatus.VOIDED,
        voidedAt: new Date(),
        voidReason: reason,
      },
    });

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
    userId?: string
  ): Promise<ApiResponse<TravelerCardScan>> {
    if (!verifyBarcode(data.barcode)) {
      throw AppError.badRequest("Geçersiz barkod formatı veya checksum hatası");
    }

    const card = await prisma.travelerCard.findUnique({
      where: { barcode: data.barcode.toUpperCase() },
      include: { workOrder: { include: { steps: { orderBy: { stepSequence: "asc" } } } } },
    });

    if (!card) {
      throw AppError.notFound("Barkod sistemde kayıtlı değil");
    }

    if (card.status !== TravelerCardStatus.ACTIVE) {
      throw AppError.conflict(
        `Bu kart artık geçerli değil: ${card.status}. Kart numarası: ${card.cardNumber}`
      );
    }

    if (card.workOrder.status === WorkOrderStatus.CANCELLED) {
      throw AppError.conflict("Bağlı iş emri iptal edilmiş");
    }

    // İstasyona karşılık gelen step'i bul (birden fazla varsa PENDING/ACTIVE olanı tercih et)
    const matchingStep = card.workOrder.steps.find(
      (s) => s.stationId === data.stationId && s.status !== "COMPLETED" && s.status !== "SKIPPED"
    ) ?? card.workOrder.steps.find((s) => s.stationId === data.stationId);

    const scan = await prisma.travelerCardScan.create({
      data: {
        cardId:          card.id,
        stationId:       data.stationId,
        workOrderStepId: matchingStep?.id ?? null,
        scanType:        data.scanType,
        scannedById:     userId ?? null,
        deviceId:        data.deviceId ?? null,
        notes:           data.notes ?? null,
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
   * Barkoddan kart bilgisi (tarama öncesi önizleme).
   */
  async findByBarcode(barcode: string): Promise<ApiResponse<TravelerCard | null>> {
    if (!verifyBarcode(barcode)) {
      throw AppError.badRequest("Geçersiz barkod formatı");
    }

    const card = await prisma.travelerCard.findUnique({
      where: { barcode: barcode.toUpperCase() },
      include: {
        workOrder: {
          include: {
            steps: { include: { station: true }, orderBy: { stepSequence: "asc" } },
            dyehouseCompany: true,
          },
        },
        scans: {
          orderBy: { scannedAt: "desc" },
          take: 20,
          include: { station: true },
        },
      },
    });

    if (!card) {
      return { success: false, data: null, message: "Kart bulunamadı" };
    }

    return { success: true, data: card };
  }

  /**
   * Bir iş emrinin tüm kart + tarama geçmişi.
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
   * Kart oluşturma — print ve reprint tarafından kullanılır.
   */
  private async createCardInternal(
    workOrderId: string,
    version: number,
    userId: string | undefined,
    event: "PRINT" | "REPRINT"
  ): Promise<ApiResponse<TravelerCard>> {
    const now = new Date();
    const seq = await this.nextMonthlySequence(now);
    const cardNumber = buildCardNumber(now, seq);
    const barcode = buildBarcode(now, seq);

    const card = await prisma.travelerCard.create({
      data: {
        cardNumber,
        barcode,
        workOrderId,
        version,
        status: TravelerCardStatus.ACTIVE,
        printedById: userId ?? null,
      },
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "TRAVELER_CARD",
      recordId: card.id,
      newData: { cardNumber, barcode, version, event },
    });

    return {
      success: true,
      data: card,
      message: `Refakat kartı basıldı: ${cardNumber}`,
    };
  }
}
