// =============================================================================
// Inventory Service / qty-adjust
// =============================================================================
// Sayım metraj düzeltmesi (adjustRollQty) ve ham satışa hazırlama (prepareRawForSale).
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { warehouseStampTx } from "../helpers/warehouse.helper";
import {
  postStockMove,
  qtyYazilabilir,
} from "../helpers/warehouse-ledger.helper";
import { WAREHOUSE_STOCK_STATUSES } from "../helpers/warehouse-stock.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
// G4 sayım metraj düzeltmesi — sapma satırı TEK yazma noktasından doğar
// (`roll-variance.helper` başlığındaki kural: çağıran `tx.rollVariance.create` yazmaz).
import { recordVarianceTx } from "../helpers/roll-variance.helper";
import { VARIANCE_SOURCES } from "../../constants/variance-reasons";
import {
  Prisma,
  RollStatus,
  RollVarianceKind,
  WarehouseEventType,
} from "@prisma/client";
import { TERIM } from "../../constants/terim";
import { emitRollQtyAdjustedTx } from "../notification-sources/depo";

// G4 — sayım metraj düzeltmesinin sapma kaynağı: katalogdan (2026-08-14 dikişi
// — ilk yazımdaki geçici tip köprüsü kaldırıldı, kaynak tek yerde).
const QTY_ADJUST_VARIANCE_SOURCE = VARIANCE_SOURCES.WAREHOUSE_QTY_ADJUST;

export async function adjustRollQty(
    rollId: string,
    data: { newQty: number; reason: string },
    userId?: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    // Servis katmanı Zod'a güvenmez (bekçiler servis üzerinden çağırır) —
    // sebep zorunluluğu burada da ölçülür.
    const reason = data.reason?.trim() ?? "";
    if (reason.length < 3) {
      throw AppError.badRequest(
        "Metraj düzeltmesi için işlem nedeni (en az 3 karakter) zorunludur.",
      );
    }
    if (!(data.newQty > 0)) {
      throw AppError.badRequest("Geçerli bir metraj (mt) girilmeli");
    }

    const FREE_STOCK: RollStatus[] = [
      RollStatus.STOCK,
      RollStatus.WAREHOUSE,
      RollStatus.A1_STOCK,
    ];

    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: {
        id: true,
        barcode: true,
        status: true,
        initialQty: true,
        currentQty: true,
        sackId: true,
        shipmentId: true,
        currentStepId: true,
        warehouseId: true,
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    // Kapsam dışı statüler — sessiz red değil, SOMUT sebep (yıkıcı-işlem kuralının
    // okuma yönü: operatör neden yapamadığını görmeli, doğaçlamaya itilmemeli).
    if (!FREE_STOCK.includes(roll.status)) {
      if (roll.status === RollStatus.IN_PRODUCTION) {
        throw AppError.conflict(
          "Bu top üretimde — metrajı istasyon akışı (kurşun/tambur ölçümü) belirler; sayım düzeltmesi yalnız serbest stok (Ham Stok / Bitmiş Depo / 2. Kalite) topunda yapılır.",
        );
      }
      if (roll.status === RollStatus.SHIPPED) {
        throw AppError.conflict(
          "Bu top sevk edilmiş — çıkış kaydına dokunulmaz (brüt kuralı); fark iade/storno akışıyla kapatılır.",
        );
      }
      if (
        roll.status === RollStatus.AT_SUBCONTRACTOR ||
        roll.status === RollStatus.AT_KARTELA ||
        roll.status === RollStatus.RETURNED_FROM_SUBCONTRACTOR
      ) {
        throw AppError.conflict(
          "Bu top fasonda/kartelada — mal fiziksel olarak dışarıda; metraj kabul adımında ölçülür.",
        );
      }
      throw AppError.conflict(
        `Bu top emekli/arşiv statüde (${roll.status}) — düzeltilecek canlı stok kaydı yok.`,
      );
    }
    if (roll.sackId) {
      throw AppError.conflict(
        "Bu top bir çuvalın içinde — metraj düzeltmesi çuval toplamını ve çuval etiketini bayatlatır; önce çuvaldan çıkarın.",
      );
    }
    if (roll.shipmentId) {
      throw AppError.conflict(
        "Bu top bir sevkiyata atanmış — önce sevkiyattan çıkarın.",
      );
    }
    if (roll.currentStepId) {
      // FREE_STOCK statüsüyle bir iş emri adımında duran top (ham kesim devamı
      // gibi) yine istasyon akışının malıdır — prepareRawForSale ile aynı guard.
      throw AppError.conflict(
        `Bu top bir ${TERIM.terbiyeIsEmri.tekilKucuk} adımına bağlı — metrajı istasyon akışı belirler; önce üretimden ayırın.`,
      );
    }

    const oldQty = roll.currentQty;
    const newQty = new Prisma.Decimal(data.newQty);
    if (newQty.equals(oldQty)) {
      throw AppError.badRequest("Yeni metraj mevcut kayıtla aynı — düzeltilecek fark yok.");
    }

    const isShort = newQty.lessThan(oldQty);
    const kind = isShort ? RollVarianceKind.RECORD_CORRECTION : RollVarianceKind.OVERAGE;
    const diff = isShort ? oldQty.minus(newQty) : newQty.minus(oldQty);

    let varianceId: string | null = null;
    await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM (check-then-act YASAK): üyelik + statü + METRAJ tek WHERE'de.
      // `currentQty: oldQty` gerçek bir CAS'tır — iki paralel düzeltme aynı eski
      // değeri okur; satır kilidini kazanan yazar, kaybedenin WHERE'i commit
      // edilmiş YENİ değeri görüp count=0 ile 409'a düşer. Kaybeden de yazsaydı
      // sapma defteri aynı farkı İKİ KEZ görürdü (varyans satırı claim'in
      // ARKASINDA, aynı tx'te — ya birlikte olur ya hiç).
      const claim = await tx.roll.updateMany({
        where: {
          id: rollId,
          status: { in: FREE_STOCK },
          sackId: null,
          shipmentId: null,
          currentStepId: null,
          currentQty: oldQty,
        },
        // labelDirty: metraj etikete basılıyor (`label-field-values`) — fiziksel
        // etiket artık yanlış sayıyı taşıyor. "Fark yok" hâli yukarıda elendi,
        // yani işaret hiçbir no-op kayıtta yanmaz.
        data: { currentQty: newQty, labelDirty: true },
      });
      if (claim.count === 0) {
        // count-0 tanısı (2026-08-14 eki ①): sebep tx içinde TAZE okumayla söylenir —
        // yarışın kaybedenine jenerik "olmadı" değil, o an geçerli engel anlatılır.
        const fresh = await tx.roll.findUnique({
          where: { id: rollId },
          select: { status: true, sackId: true, shipmentId: true, currentStepId: true, currentQty: true },
        });
        if (!fresh) throw AppError.notFound("Top bulunamadı");
        if (!FREE_STOCK.includes(fresh.status)) {
          throw AppError.conflict(
            `Top bu sırada ${fresh.status} statüsüne geçti — yenileyip tekrar deneyin.`,
          );
        }
        if (fresh.sackId) {
          throw AppError.conflict("Top bu sırada bir çuvala okutuldu — önce çuvaldan çıkarın.");
        }
        if (fresh.shipmentId) {
          throw AppError.conflict("Top bu sırada bir sevkiyata atandı — önce sevkiyattan çıkarın.");
        }
        if (fresh.currentStepId) {
          throw AppError.conflict(`Top bu sırada bir ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} bağlandı — önce üretimden ayırın.`);
        }
        throw AppError.conflict(
          "Topun metrajı bu sırada değişti (eşzamanlı düzeltme/işlem) — güncel değeri kontrol edip tekrar deneyin.",
        );
      }

      varianceId = await recordVarianceTx(tx, {
        rollId,
        kind,
        qty: diff,
        source: QTY_ADJUST_VARIANCE_SOURCE,
        // RECORD_CORRECTION sebep KATALOGLUDUR (fail-closed) — sayım düzeltmesinin
        // serbest gerekçesi "DIGER" + metin olarak yazılır (requiresText≥3, yukarıda
        // garanti). Sayım sahada sıklaşırsa doğru adım kataloğa "SAYIM_FARKI"
        // eklemektir (J: tam sayım belgesi işi), DIGER'i büyütmek değil.
        // OVERAGE sebep İSTEMEZ; operatörün gerekçesi yine reasonText'te taşınır.
        reasonCode: isShort ? "DIGER" : null,
        reasonText: reason,
        userId: userId ?? null,
      });

      // STOK DEFTERİ — düşükse çıkış ucu −fark, yüksekse giriş ucu +fark; deposuz
      // (ufuk öncesi) top satır almaz — diğer yazıcılarla aynı kapı.
      if (roll.warehouseId !== null && WAREHOUSE_STOCK_STATUSES.includes(roll.status) && qtyYazilabilir(diff)) {
        const end = { warehouseId: roll.warehouseId, status: roll.status };
        await postStockMove(tx, {
          rollId,
          eventType: WarehouseEventType.ADJUST,
          qty: diff,
          ...(isShort ? { from: end } : { to: end }),
          reasonCode: STOCK_MOVE_REASON.MANUAL_ADJUST,
          rollVarianceId: varianceId,
          userId: userId ?? null,
          notes: reason.slice(0, 300),
        });
      }
      await emitRollQtyAdjustedTx(tx, rollId, { from: oldQty, to: newQty, reason }, userId);
    });

    // Audit tx-DIŞI (best-effort konvansiyonu — bu dosyadaki diğer CUD'ler gibi).
    // Kalıcı gerekçe RollVariance satırındadır (audit 6 ayda arşivlenir; sapma
    // defteri verinin parçasıdır — Roll.entryReason emsali).
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL_QTY_ADJUST",
      recordId: rollId,
      oldData: { currentQty: Number(oldQty) },
      newData: {
        currentQty: Number(newQty),
        diffQty: Number(diff),
        kind,
        reason,
        varianceId,
      },
    });

    return {
      success: true,
      data: {
        rollId,
        barcode: roll.barcode,
        oldQty: Number(oldQty),
        newQty: Number(newQty),
        diffQty: Number(diff),
        direction: isShort ? "SHORT" : "OVER",
        kind,
        varianceId,
      },
      message: isShort
        ? `Metraj düzeltildi: ${Number(oldQty)} m → ${Number(newQty)} m (−${Number(diff)} m kayıt düzeltmesi)`
        : `Metraj düzeltildi: ${Number(oldQty)} m → ${Number(newQty)} m (+${Number(diff)} m fazlalık)`,
    };
  }

export async function prepareRawForSale(rollId: string, userId?: string): Promise<ApiResponse<Record<string, unknown>>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, barcode: true, status: true, shipmentId: true, currentStepId: true, warehouseId: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.status === RollStatus.WAREHOUSE) {
      return { success: true, data: { rollId, status: "WAREHOUSE" }, message: "Top zaten sevke hazır (depoda)" };
    }
    if (roll.status !== RollStatus.STOCK) {
      throw AppError.badRequest(`Yalnız STOCK topu satışa hazırlanabilir (bu top: ${roll.status})`);
    }
    if (roll.shipmentId) throw AppError.conflict("Top bir sevkiyatta — önce çıkarın");
    if (roll.currentStepId) throw AppError.conflict(`Top bir ${TERIM.terbiyeIsEmri.tekilKucuk} adımında — önce üretimden çıkarın`);
    const openDispatch = await prisma.subcontractorDispatchItem.findFirst({
      where: { rollId, dispatch: { cancelledAt: null } },
      select: { id: true },
    });
    if (openDispatch) throw AppError.conflict("Top açık bir fason sevkiyatında");

    // Atomik: hâlâ STOCK + serbest iken WAREHOUSE'a çek.
    // ⚠️ Depo damgası ORTAK YÜKLEMDEN: terfi yolları `warehouseId`ye hiç
    // dokunmuyordu ve deposu olmayan top burada "depoda ama deposuz" oluyordu.
    const claimed = await prisma.roll.updateMany({
      where: { id: rollId, status: RollStatus.STOCK, shipmentId: null, currentStepId: null },
      data: { status: RollStatus.WAREHOUSE, ...(await warehouseStampTx(prisma, roll.warehouseId)) },
    });
    if (claimed.count === 0) {
      throw AppError.conflict("Top az önce başka bir akışa girdi — tekrar deneyin");
    }
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      newData: { kind: "RAW_FOR_SALE", status: "WAREHOUSE", barcode: roll.barcode },
    });
    return { success: true, data: { rollId, status: "WAREHOUSE" }, message: "Ham top satışa hazırlandı (depoya alındı)" };
  }
