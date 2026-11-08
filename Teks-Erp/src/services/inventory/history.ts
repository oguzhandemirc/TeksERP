// =============================================================================
// Inventory Service / history
// =============================================================================
// Top geçmişi (getRollHistory).
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (inventory/list.ts sayılır) */

import { ACTIVE_OPERATION } from "../helpers/roll-operation.helper";
import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { ApiResponse } from "../../types/api.types";
import { factoryTimezoneAt } from "../../constants/time";
import {
  RollStatus,
  RollOperationType,
  RollEntrySource,
} from "@prisma/client";
import { readRollMeasurements, type RollMeasurements } from "../helpers/roll-measurements.helper";
import type { InventoryServiceThis } from "./shared";

export type RollHistoryEventKind =
  | "CREATED"
  | "MOVEMENT_IN"
  | "MOVEMENT_OUT"
  | "OPERATION"
  | "SUBCONTRACTOR_DISPATCH"
  | "SUBCONTRACTOR_RECEIPT";

export interface RollHistoryEvent {
  kind: RollHistoryEventKind;
  subKind?: string;
  at: string;
  title: string;
  stationName: string | null;
  details: Record<string, unknown>;
  operatorName: string | null;
}

export interface RollHistoryPayload {
  roll: {
    id: string;
    /// Açık kumaş Roll'larında NULL olabilir (etiket basılmaz).
    barcode: string | null;
    status: RollStatus;
    initialQty: number;
    currentQty: number;
    weightKg: number | null;
    item: { id: string; code: string; name: string; itemType: string } | null;
    color: { id: string; code: string; name: string; hex: string | null } | null;
  };
  events: RollHistoryEvent[];
  /** D4-B4 EKLEMELİ: metre okumaları + sapma satırları ölçüm kaynağıyla (eski istemci yok sayar). */
  measurements: RollMeasurements;
}

/**
 * Operatöre gösterilecek tarih-saat — kaydın ANINDAKİ fabrika saat diliminde.
 * Süreç `TZ`'sine yaslanmaz: mesaj sahadaki insana "10:48'de bastınız" demeli ve
 * sunucu UTC'ye kurulsa da aynı şeyi demeli (bkz. `constants/time.ts`).
 */
function formatFactoryDateTime(at: Date): string {
  return at.toLocaleString("tr-TR", {
    timeZone: factoryTimezoneAt(at),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function operationLabel(type: RollOperationType): string {
  switch (type) {
    case "KURSUN_APPLIED":
      return "Kurşun Uygulandı";
    case "QC2_COMPLETED":
      return "QC2 Tamamlandı";
    case "TAMBUR_PROCESSED":
      return "Tambur İşlendi";
    case "SUBCONTRACTOR_SENT":
      return "Fasona Gönderildi";
    case "SUBCONTRACTOR_RETURNED":
      return "Fasondan Döndü";
    default:
      return type;
  }
}

export async function getRollHistory(this: InventoryServiceThis, id: string): Promise<ApiResponse<RollHistoryPayload | null>> {
    const roll = await prisma.roll.findUnique({
      where: { id },
      select: {
        id: true,
        barcode: true,
        status: true,
        initialQty: true,
        currentQty: true,
        weightKg: true,
        entrySource: true,
        qualityGrade: true,
        parentRollId: true,
        createdAt: true,
        // Ekleme sebebinin katalog KODU (2026-08-21) — metin `readManualEntryReason`
        // ile (kolon → audit fallback) çözülür, kod yalnız kolondadır.
        entryReasonCode: true,
        item: { select: { id: true, code: true, name: true, itemType: true } },
        color: { select: { id: true, code: true, name: true, hex: true } },
        // Topu sisteme kim açtı — KK1, fason kabul, Tambur split (parent oluşturucu)
        createdBy: { select: { id: true, username: true, fullName: true } },
        // Parent (kaynak) top — TAMBUR_SPLIT için "kimden ayrıldı" bilgisi.
        // FK indexed, +1 LEFT JOIN; sadece detay sayfasında çağrılan endpoint.
        parent: {
          select: {
            id: true,
            barcode: true,
            qualityGrade: true,
            producedInStep: {
              select: {
                stepSequence: true,
                station: { select: { code: true, name: true } },
                workOrder: { select: { id: true, workOrderNumber: true } },
              },
            },
          },
        },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Top bulunamadı" };
    }

    const [movements, operations, dispatchItems, receiptItems] =
      await Promise.all([
        prisma.rollMovement.findMany({
          where: { ...ACTIVE_MOVEMENT, rollId: id },
          include: {
            step: { include: { station: true } },
            operator: { select: { id: true, username: true, fullName: true } },
          },
          orderBy: { enteredAt: "asc" },
        }),
        prisma.rollOperation.findMany({
          where: { ...ACTIVE_OPERATION, rollId: id },
          include: {
            step: { include: { station: true } },
            operator: { select: { id: true, username: true, fullName: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.subcontractorDispatchItem.findMany({
          where: { rollId: id },
          include: {
            dispatch: {
              include: {
                subcontractor: { select: { id: true, code: true, name: true } },
                dispatchedBy: { select: { id: true, username: true, fullName: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.subcontractorReceiptItem.findMany({
          where: { newRollId: id },
          include: {
            receipt: {
              include: {
                subcontractor: { select: { id: true, code: true, name: true } },
                receivedBy: { select: { id: true, username: true, fullName: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
      ]);

    const events: RollHistoryEvent[] = [];

    // Top'un sisteme nasıl girdiğine göre başlık — itemType'tan değil entrySource'tan türer.
    //
    // ⚠️ Bu switch'in `default` dalı SESSİZ BİR YALAN üretir: eşleşmeyen her kaynak
    // "Ham Giriş" olarak görünür. İki kez ısırdı — önce SUBCONTRACTOR_RETURN, sonra
    // SEMI_FINISHED (2026-08-17'de enum'a eklendi, buraya eklenmedi; dışarıdan alınan
    // yarı mamul topun geçmişinde aylarca "Ham Giriş" yazdı). `RollEntrySource`'a yeni
    // bir değer eklerken buraya da case ekle; `default` yalnız son çare olsun.
    const entryTitle = ((): string => {
      switch (roll.entrySource) {
        case RollEntrySource.TAMBUR_SPLIT:
          return "Tambur Kesimi (Yeni Parça)";
        case RollEntrySource.SUBCONTRACTOR_RETURN:
          return "Fason Dönüşü";
        case RollEntrySource.MANUAL_ENTRY:
          return "Manuel Giriş";
        case RollEntrySource.TAMBUR_MANUAL:
          return "Tambur (Manuel)";
        case RollEntrySource.SEMI_FINISHED:
          return "Yarı Mamul Girişi (Dış Alım)";
        case RollEntrySource.WEAVING:
          return "Dokuma (Tezgahtan İndi)";
        case RollEntrySource.SUPPLIER_RECEIPT:
        default:
          return "Ham Giriş";
      }
    })();

    // Parent referansı — split rolünün kaynağını izlenebilir kıl.
    // TAMBUR_SPLIT için zorunlu, diğerlerinde de parent varsa eklenir.
    const parentInfo = roll.parent
      ? {
        parentRollId: roll.parent.id,
        parentBarcode: roll.parent.barcode,
        parentQualityGrade: roll.parent.qualityGrade,
        parentWorkOrder: roll.parent.producedInStep?.workOrder
          ? {
            id: roll.parent.producedInStep.workOrder.id,
            batchNumber: roll.parent.producedInStep.workOrder.workOrderNumber,
          }
          : null,
        parentProducedStation: roll.parent.producedInStep?.station
          ? {
            code: roll.parent.producedInStep.station.code,
            name: roll.parent.producedInStep.station.name,
            stepSequence: roll.parent.producedInStep.stepSequence,
          }
          : null,
      }
      : null;

    // ELLE EKLENEN TOPUN SEBEBİ (2026-08-04) — audit'ten okunur.
    //
    // NEDEN BURADAN: sebep şemada kolon DEĞİL, `SystemLog.newData.reason` içinde
    // (kolon eklemek yerine WO kapanış dispozisyonu deseni izlendi). Ama yalnız
    // audit'te durması "yazılıyor ama okunmuyor" demekti: operatör bir topa
    // bakarken sebebi göremiyor, görmek için Aktivite Günlüğü'ne gidip doğru
    // satırı bulup JSON'a bakması gerekiyordu. "Bu top nereden geldi" sorusu
    // TOPA BAKARKEN sorulur — cevabı da orada olmalı.
    //
    // Yalnız elle doğan toplarda sorgulanır (iki event) — diğer topların
    // geçmişinde gereksiz sorgu koşmasın.
    const manualEntryReason = await this.readManualEntryReason(roll.id, roll.entrySource);

    events.push({
      kind: "CREATED",
      at: roll.createdAt.toISOString(),
      title: entryTitle,
      stationName: null,
      details: {
        barcode: roll.barcode,
        initialQty: roll.initialQty,
        weightKg: roll.weightKg,
        itemCode: roll.item?.code,
        itemName: roll.item?.name,
        itemType: roll.item?.itemType,
        entrySource: roll.entrySource,
        qualityGrade: roll.qualityGrade,
        ...(manualEntryReason ? { manualReason: manualEntryReason } : {}),
        ...(roll.entryReasonCode ? { manualReasonCode: roll.entryReasonCode } : {}),
        ...(parentInfo ? { parent: parentInfo } : {}),
      },
      operatorName: roll.createdBy?.fullName ?? roll.createdBy?.username ?? null,
    });

    for (const m of movements) {
      events.push({
        kind: "MOVEMENT_IN",
        at: m.enteredAt.toISOString(),
        title: `${m.step?.station?.name ?? "İstasyon"} – Giriş`,
        stationName: m.step?.station?.name ?? null,
        details: {
          qtyIn: m.qtyIn,
          weightIn: m.weightIn,
          notes: m.notes,
        },
        operatorName: m.operator?.fullName ?? m.operator?.username ?? null,
      });
      if (m.exitedAt) {
        events.push({
          kind: "MOVEMENT_OUT",
          at: m.exitedAt.toISOString(),
          title: `${m.step?.station?.name ?? "İstasyon"} – Çıkış`,
          stationName: m.step?.station?.name ?? null,
          details: {
            qtyOut: m.qtyOut,
            weightOut: m.weightOut,
            qtyIn: m.qtyIn,
            weightIn: m.weightIn,
            notes: m.notes,
          },
          operatorName: m.operator?.fullName ?? m.operator?.username ?? null,
        });
      }
    }

    for (const op of operations) {
      events.push({
        kind: "OPERATION",
        subKind: op.operationType,
        at: op.createdAt.toISOString(),
        title: operationLabel(op.operationType),
        stationName: op.step?.station?.name ?? null,
        details: {
          metadata: op.metadata,
        },
        operatorName: op.operator?.fullName ?? op.operator?.username ?? null,
      });
    }

    for (const di of dispatchItems) {
      events.push({
        kind: "SUBCONTRACTOR_DISPATCH",
        at: di.dispatch.dispatchedAt.toISOString(),
        title: `Fasona Sevk: ${di.dispatch.subcontractor?.name ?? "-"}`,
        stationName: null,
        details: {
          dispatchNo: di.dispatch.dispatchNo,
          subcontractorCode: di.dispatch.subcontractor?.code,
          subcontractorName: di.dispatch.subcontractor?.name,
          dispatchedQty: di.dispatchedQty,
          dispatchedWeight: di.dispatchedWeight,
          plateNumber: di.dispatch.plateNumber,
          driverName: di.dispatch.driverName,
        },
        operatorName:
          di.dispatch.dispatchedBy?.fullName ??
          di.dispatch.dispatchedBy?.username ??
          null,
      });
    }

    for (const ri of receiptItems) {
      events.push({
        kind: "SUBCONTRACTOR_RECEIPT",
        at: ri.receipt.receivedAt.toISOString(),
        title: `Fasondan Kabul: ${ri.receipt.subcontractor?.name ?? "-"}`,
        stationName: null,
        details: {
          receiptNo: ri.receipt.receiptNo,
          manifestNo: ri.receipt.manifestNo,
          subcontractorCode: ri.receipt.subcontractor?.code,
          subcontractorName: ri.receipt.subcontractor?.name,
          notes: ri.notes,
        },
        operatorName:
          ri.receipt.receivedBy?.fullName ??
          ri.receipt.receivedBy?.username ??
          null,
      });
    }

    // Sort: first by timestamp, then by kind order (MOVEMENT_OUT before MOVEMENT_IN
    // before OPERATION) to correctly represent process flow when timestamps coincide.
    // Stable sort preserves original relative order for equal keys.
    // Eşit timestamp'te doğal süreç sırası:
    // istasyondan çıkış → o istasyondaki işlem/karar → sonraki istasyona giriş
    const kindOrder: Record<string, number> = {
      MOVEMENT_OUT: 0,
      OPERATION: 1,
      MOVEMENT_IN: 2,
      SUBCONTRACTOR_DISPATCH: 3,
      SUBCONTRACTOR_RECEIPT: 4,
      CREATED: 5,
    };
    events.sort((a, b) => {
      if (a.at < b.at) return -1;
      if (a.at > b.at) return 1;
      return (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9);
    });

    return {
      success: true,
      data: {
        roll: {
          id: roll.id,
          barcode: roll.barcode,
          status: roll.status,
          currentQty: Number(roll.currentQty),
          initialQty: Number(roll.initialQty),
          weightKg: roll.weightKg !== null ? Number(roll.weightKg) : null,
          item: roll.item,
          color: roll.color,
        },
        events,
        measurements: await readRollMeasurements(id),
      },
    };
  }
