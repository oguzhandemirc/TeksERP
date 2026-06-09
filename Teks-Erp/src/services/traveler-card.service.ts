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

import { Request } from "express";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse, PaginatedResponse } from "../types/api.types";
import { buildBarcode, buildCardNumber, verifyBarcode } from "../utils/barcode";
import { readTravelerCardConfig } from "./system-setting.service";
import { parseQueryParams, buildPagination, resolveSortBy } from "../utils/query-parser";

// Refakat kartı listesinde sıralanabilir kolonlar. createdAt BİLEREK yok →
// varsayılan/createdAt isteği printedAt'e düşer (yeni basılan kart ilk gelsin).
// Whitelist dışı sortBy → printedAt (bilinmeyen kolon 500'ünü engeller).
const TRAVELER_SORTABLE_FIELDS = ["printedAt", "cardNumber", "status", "version"] as const;
import { withBarcodeRetry } from "../utils/barcode-retry";
import {
  Prisma,
  TravelerCard,
  TravelerCardScan,
  TravelerCardStatus,
  ScanType,
  WorkOrderStatus,
} from "@prisma/client";

export class TravelerCardService {
  /**
   * Ay bazlı sıra üretici — aynı yıl-ay içinde oluşturulan en yüksek barkodun
   * 6-char segmentini decode edip +1 döndürür. Collision olursa retry ile çözümlenir.
   *
   * Defensive: tek satır yerine son 10 satırı çekip ilk parse-edilebilen
   * barkoddan sequence çıkarır. Böylece DB'de bozuk format kayıt olsa bile
   * sessizce 1'e dönüp duplicate üretmek yerine bir sonraki geçerli kayda
   * geçer. Hiçbiri parse edilemezse net hata fırlatır — admin müdahale eder.
   */
  private async nextMonthlySequence(date: Date): Promise<number> {
    const yy = String(date.getFullYear()).slice(2);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const prefix = `RK-${yy}${mm}-`;

    const candidates = await prisma.travelerCard.findMany({
      where: { barcode: { startsWith: prefix } },
      orderBy: { barcode: "desc" },
      take: 10,
      select: { barcode: true },
    });

    if (candidates.length === 0) return 1;

    const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    for (const c of candidates) {
      // barcode = RK-YYMM-XXXXXX-C → XXXXXX segmenti
      const parts = c.barcode.split("-");
      if (parts.length < 4) continue;
      const seqStr = parts[2].toUpperCase();
      let n = 0;
      let valid = true;
      for (const ch of seqStr) {
        const v = CROCKFORD.indexOf(ch);
        if (v < 0) {
          valid = false;
          break;
        }
        n = n * 32 + v;
      }
      if (valid) return n + 1;
    }

    throw AppError.internal(
      `Refakat kartı sequence: ${prefix} prefix'inde bozuk barkodlar tespit edildi, ` +
        `son 10 kayıttan hiçbiri parse edilemiyor. DB'yi manuel inceleyin.`
    );
  }

  /**
   * Transaction-aware idempotent kart oluşturucu — WorkOrder.create flow'undan
   * çağrılır. WO zaten varlık doğrulamış olduğu için tekrar kontrol etmez.
   *
   * - Halihazırda ACTIVE kart varsa onu döner (idempotent — yarıda kesilen
   *   create/recreate akışlarında güvenli).
   * - Aksi halde version=1 ile yeni kart üretir, AuditService.log düşer.
   */
  async createForWorkOrder(
    tx: Prisma.TransactionClient,
    workOrderId: string,
    userId?: string
  ): Promise<TravelerCard> {
    const existing = await tx.travelerCard.findFirst({
      where: { workOrderId, status: TravelerCardStatus.ACTIVE },
    });
    if (existing) return existing;

    const now = new Date();
    const seq = await this.nextMonthlySequence(now);
    const cardNumber = buildCardNumber(now, seq);
    const barcode = buildBarcode(now, seq);
    const snapshot = await this.buildSnapshot(tx, workOrderId);

    const card = await tx.travelerCard.create({
      data: {
        cardNumber,
        barcode,
        workOrderId,
        version: 1,
        status: TravelerCardStatus.ACTIVE,
        printedById: userId ?? null,
        snapshot,
      },
    });

    // Audit dış prisma'ya yazıyor — tx commit'inden sonra düşse bile kayıp olmaz
    // (best-effort log). Asıl card kaydı tx içinde garanti.
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "TRAVELER_CARD",
      recordId: card.id,
      newData: {
        cardNumber,
        barcode,
        version: 1,
        event: "AUTO_PRINT_ON_WO_CREATE",
      },
    });

    return card;
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

    // Eski kartı REPRINTED'a çek, yeni kartı üret (transaction içinde).
    // Barkod sequence çakışırsa (P2002) tx'i baştan dener.
    const card = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
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

        return tx.travelerCard.create({
          data: {
            cardNumber,
            barcode,
            workOrderId,
            version: lastVersion + 1,
            status: TravelerCardStatus.ACTIVE,
            printedById: userId ?? null,
          },
        });
      })
    );

    // Audit tx DIŞINDA: tx içinde atılırsa P2002 retry'ında başarısız denemenin
    // ya da rollback'in audit'i (AuditService global prisma kullanır, ayrı
    // bağlantıda hemen commit eder) SystemLog'da hayalet kayıt olarak kalırdı.
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "TRAVELER_CARD",
      recordId: card.id,
      newData: {
        cardNumber: card.cardNumber,
        barcode: card.barcode,
        version: card.version,
        event: "REPRINT",
        reason,
      },
    });

    return {
      success: true,
      data: card,
      message: `Refakat kartı yeniden basıldı: ${card.cardNumber} (v${card.version})`,
    };
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
   * Aktif refakat kartlarını listeler — mobil ekranlarda "kart seç" picker'ı için.
   *
   * Filtreler:
   *  - `?filter[status]=ACTIVE|COMPLETED|...|ALL` (default: ACTIVE)
   *  - `?search=...` — cardNumber, barcode, batchNumber üzerinde contains (insensitive)
   *
   * Sıralama: default `printedAt desc`. Sayfa derinliği `MAX_OFFSET` ile sınırlı.
   * Response shape mobil `TravelerCardLookup` ile uyumlu (workOrder + targetItem.color).
   */
  async list(req: Request): Promise<PaginatedResponse<unknown>> {
    const params = parseQueryParams(req);

    // Status filtresi — explicit 'ALL' verilirse status'a göre filtreleme yapma.
    const where: Prisma.TravelerCardWhereInput = {};

    // WO'ya birebir filtre (Hızlı İş Emri kart çıktısı bunu kullanır — fuzzy
    // batchNumber araması yerine kesin eşleşme).
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

    // Search: cardNumber / barcode TAM eşleşme (ikisi de unique → index seek; kart
    // okutulur/yapıştırılır, ortasından aranmaz — rolls barkod düzeltmesiyle aynı
    // gerekçe). WO batchNumber kısmi araması için contains kalır (relation).
    if (params.search && params.search.trim()) {
      const q = params.search.trim();
      where.OR = [
        { cardNumber: q },
        { barcode: q },
        { workOrder: { batchNumber: { contains: q, mode: "insensitive" } } },
      ];
    }

    const { skip, take } = buildPagination(params.page, params.pageSize);
    // createdAt yerine printedAt üzerinden sırala — yeni basılan kart ilk gelsin.
    // resolveSortBy: whitelist dışı (createdAt/garbage) → printedAt fallback.
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
              batchNumber: true,
              status: true,
              type: true,
              // targetItem (iç ürün) + targetColor AYRI alanlar — mobil WorkOrder
              // tipi/tüketicileri böyle okur. (Item'ın `color` ilişkisi YOK;
              // önceki targetItem.color select'i geçersizdi → list 400 dönüyordu.)
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
   * Barkoddan kart bilgisi (tarama öncesi önizleme).
   */
  /**
   * Kartı barkod **veya** insan-okur kart numarası ile bulur.
   *
   * - Tam barkod (checksum'lı): `RK-YYMM-XXXXXX-C` — kamera/yazıcı çıktısı
   * - Kart numarası (insan-okur): `RK-YYMM-NNN` — elle yazılırken kısa hali
   *
   * Mobile/admin tarafı her iki formatta da bu endpoint'i çağırabilir.
   */
  async findByBarcode(
    input: string,
  ): Promise<ApiResponse<(TravelerCard & { hasOpenDispatch: boolean }) | null>> {
    const normalized = input.trim().toUpperCase();

    const isFullBarcode = /^RK-\d{4}-[0-9A-Z]{6}-[0-9A-Z]$/.test(normalized);
    const isCardNumber = /^RK-\d{4}-\d{1,6}$/.test(normalized);

    if (!isFullBarcode && !isCardNumber) {
      throw AppError.badRequest(
        "Geçersiz format. Beklenen: RK-YYMM-XXXXXX-C (barkod) veya RK-YYMM-NNN (kart no)",
      );
    }
    if (isFullBarcode && !verifyBarcode(normalized)) {
      throw AppError.badRequest("Barkod checksum'ı geçersiz");
    }

    const card = await prisma.travelerCard.findFirst({
      where: isFullBarcode ? { barcode: normalized } : { cardNumber: normalized },
      include: {
        workOrder: {
          include: {
            targetItem: true,
            targetColor: true,
            steps: { include: { station: true }, orderBy: { stepSequence: "asc" } },
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

    // Fason Sevk akışı: bu WO için açık (cancelledAt=null + mal kabul tam değil)
    // sevk varsa kart üstüne yeni sevk eklenemez. Tüketici mobil UI bu flag'i
    // okuyup operatöre erken uyarı verir; backend dispatch endpoint'i de
    // ayrıca 409 atar (çift güvenlik).
    const openDispatchCount = await prisma.subcontractorDispatch.count({
      where: {
        workOrderId: card.workOrderId,
        cancelledAt: null,
        items: { some: { receiptItems: { none: {} } } },
      },
    });

    return {
      success: true,
      data: { ...card, hasOpenDispatch: openDispatchCount > 0 },
    };
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
   * Basım anında WO içeriğini DONDURUR (refakat kartı snapshot'ı). PDF'in
   * okuduğu WorkOrder alt-kümesiyle aynı şekil → reprint ve eski kartlar bu
   * snapshot'tan birebir basılır (WO sonradan değişse de kart sabit kalır).
   */
  private async buildSnapshot(
    client: Prisma.TransactionClient,
    workOrderId: string,
  ): Promise<Prisma.InputJsonValue> {
    const wo = await client.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        batchNumber: true,
        type: true,
        width: true,
        targetQuantity: true,
        targetWeight: true,
        foldType: true,
        plannedStartDate: true,
        plannedEndDate: true,
        dyehouseNote: true,
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
      // Marka/içerik ayarı da donar → reprint düzeni de sabit kalır.
      config,
      batchNumber: wo.batchNumber,
      type: wo.type,
      width: num(wo.width),
      targetQuantity: num(wo.targetQuantity),
      targetWeight: num(wo.targetWeight),
      foldType: wo.foldType,
      plannedStartDate: wo.plannedStartDate?.toISOString() ?? null,
      plannedEndDate: wo.plannedEndDate?.toISOString() ?? null,
      dyehouseNote: wo.dyehouseNote,
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
            }
          : null,
      })),
    } as unknown as Prisma.InputJsonValue;
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
    // Snapshot'ı retry dışında bir kez hesapla (re-create'te yeniden sorgulanmasın).
    const snapshot = await this.buildSnapshot(prisma, workOrderId);
    // Barkod sequence çakışırsa (P2002) yeniden hesaplanır ve create tekrarlanır.
    const card = await withBarcodeRetry(async () => {
      const now = new Date();
      const seq = await this.nextMonthlySequence(now);
      const cardNumber = buildCardNumber(now, seq);
      const barcode = buildBarcode(now, seq);

      return prisma.travelerCard.create({
        data: {
          cardNumber,
          barcode,
          workOrderId,
          version,
          status: TravelerCardStatus.ACTIVE,
          printedById: userId ?? null,
          snapshot,
        },
      });
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "TRAVELER_CARD",
      recordId: card.id,
      newData: {
        cardNumber: card.cardNumber,
        barcode: card.barcode,
        version,
        event,
      },
    });

    return {
      success: true,
      data: card,
      message: `Refakat kartı basıldı: ${card.cardNumber}`,
    };
  }
}
