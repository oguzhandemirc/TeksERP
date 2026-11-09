// =============================================================================
// Inventory Service / detail
// =============================================================================
// Top detayı: id ile / barkodla okuma, elle giriş gerekçesi ve iptal teşhisi.
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================

import { ACTIVE_OPERATION } from "../helpers/roll-operation.helper";
import { ACTIVE_ROLL_PROPERTY } from "../helpers/property-revoke.helper";
import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { loadActiveCustomerCodes } from "../helpers/roll-customer-code-read.helper";
import { resolveDeliveryNoteLinesForRolls } from "../helpers/roll-delivery-note-line.helper";
import { ambiguousCustomerCodeError, matchExtras, resolveRollByScanCode } from "../helpers/roll-scan-resolve.helper";
import { ApiResponse } from "../../types/api.types";
import {
  resolveRollRestoreBlockReason,
} from "../helpers/roll-cancel-restore.helper";
import {
  Roll,
  RollStatus,
  RollEntrySource,
} from "@prisma/client";
import { outstandingItemOfOpenDispatch } from "../helpers/fason-open-dispatch.helper";
import { ACTIONABLE_ROLL_ERROR_WHERE } from "../helpers/roll-error-scope.helper";
import { ROLL_LIST_INCLUDE, noteStatusOf, type InventoryServiceThis } from "./shared";

export async function readManualEntryReason(
    rollId: string,
    entrySource: RollEntrySource,
  ): Promise<string | null> {
    if (
      entrySource !== RollEntrySource.TAMBUR_MANUAL &&
      entrySource !== RollEntrySource.MANUAL_ENTRY
    ) {
      return null;
    }
    const own = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { entryReason: true },
    });
    return own?.entryReason?.trim() || null;
  }

export async function findRollById(this: InventoryServiceThis, id: string): Promise<ApiResponse<Roll | null>> {
    const roll = await prisma.roll.findUnique({
      where: { id },
      include: {
        item: true,
        color: true,
        errors: { where: { ...ACTIONABLE_ROLL_ERROR_WHERE } },
        // Rezervasyon bilgisi — detay panelinde "çuvalda/sevkiyatta" gösterimi.
        shipment: { select: { id: true, shipmentNo: true, status: true } },
        sack: { select: { id: true, sackNo: true, seq: true } },
        // KİM GİRDİ (2026-08-04): detay panelinde operatör hiç görünmüyordu —
        // `createdById` şemada vardı ama detay ucu ilişkiyi HİÇ çekmiyordu.
        // Elle eklenen topta "kim ekledi" sorusu sebep kadar önemli.
        createdBy: { select: { id: true, fullName: true, username: true } },
        // İPTALİ KİM YAPTI — `findRollByBarcode` ile AYNI şekil (ayrışırsa panel ile
        // okutma aynı top için farklı şey söyler).
        cancelledBy: { select: { id: true, fullName: true, username: true } },
        createdMachine: { select: { id: true, name: true, code: true } },
        // GİRİŞ İSTASYONU — liste include'uyla AYNI şekil.
        entryStation: { select: { id: true, code: true, name: true } },
        // Detay paneli listeyle AYNI şekli döner (ROLL_LIST_INCLUDE emsali).
        warehouse: { select: { id: true, code: true, name: true } },
        goodsReceipt: { select: { id: true, receiptNo: true, deliveryNoteNo: true } },
        // TOP KARTI (2026-11-10): sahiplik (emanet) ≠ etiket müşterisi; köken (ata top) ve parti/iş emri — to-one, N+1 yok.
        ownerCustomer: ROLL_LIST_INCLUDE.ownerCustomer,
        labelCustomer: { select: { id: true, name: true } },
        parent: { select: { id: true, barcode: true } },
        batch: { select: { id: true, batchNumber: true, workOrder: { select: { id: true, workOrderNumber: true } } } },
        // TOPUN BULUNDUĞU ADIM/İSTASYON — liste include'uyla AYNI şekil.
        // İkisi ayrışırsa panel ile satır aynı top için farklı şey söyler.
        currentStep: {
          select: {
            id: true,
            stepSequence: true,
            station: { select: { id: true, code: true, name: true, kind: true } },
            workOrder: { select: { id: true, workOrderNumber: true } },
          },
        },
        operations: {
          where: ACTIVE_OPERATION,
          select: {
            id: true,
            operationType: true,
            createdAt: true,
            operator: { select: { id: true, fullName: true, username: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        // `include` yerine `select`: damga kolonları (revokedAt…) API'ye sızmasın; `value`
        // liste ile aynı şekilde (detay↔liste ayrışması kapandı, plan §7.2).
        properties: {
          where: ACTIVE_ROLL_PROPERTY,
          select: {
            id: true,
            propertyId: true,
            valueId: true,
            createdAt: true,
            property: true,
            value: { select: { id: true, code: true, name: true } },
          },
        },
        // En güncel iade kaydı (iade gelmiş depo topu için not/neden).
        returns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            qty: true,
            reasonText: true,
            note: true,
            createdAt: true,
            reason: { select: { code: true, name: true, color: true } },
            receivedBy: { select: { fullName: true } },
          },
        },
        // AT_KARTELA top için aktif (iptal edilmemiş) kartela sevki → detay
        // panelinde "hangi kartela firmasında" gösterilir. En son non-cancelled.
        kartelaDispatchItems: {
          where: { dispatch: { cancelledAt: null } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            dispatch: {
              select: {
                dispatchNo: true,
                dispatchedAt: true,
                subcontractor: { select: { id: true, name: true, code: true } },
              },
            },
          },
        },
        // AT_SUBCONTRACTOR top için açık (dönmemiş) fason sevk kalemi → detay
        // panelinde (RollDetailSheet) "Fason Bilgisi" kartı: firma + sevk no +
        // sevk tarihi + işlem. ROLL_LIST_INCLUDE.dispatchItems ile AYNI tanım (F85)
        // + AYNI sıralama (dispatch.dispatchedAt DESC, özetle hizalı).
        dispatchItems: {
          where: outstandingItemOfOpenDispatch(),
          orderBy: { dispatch: { dispatchedAt: "desc" } },
          take: 1,
          select: {
            dispatch: {
              select: {
                dispatchNo: true,
                dispatchedAt: true,
                // "İşlem" kategorisi: step.requiredCategory boşsa firmanın
                // kategorisine düşülür (ROLL_LIST_INCLUDE ile aynı, activeCategoryOf).
                subcontractor: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    categories: { select: { category: { select: { id: true, name: true } } } },
                  },
                },
                step: { select: { requiredCategory: { select: { id: true, name: true } } } },
              },
            },
          },
        },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Top bulunamadı" };
    }

    const manualReason = await this.readManualEntryReason(roll.id, roll.entrySource);
    // Okutma ucuyla AYNI teşhis — Electron detay panelinde "İptali Geri Al"
    // butonunun çizilip çizilmeyeceğini bu belirler.
    const cancelDiag = await this.buildCancelDiagnostics(roll);
    // Panel künyesinde aktif müşteri kodu (D4-F2) — etiket/çeki ile AYNI okuyucu; kodsuz top → null.
    const customerCode = (await loadActiveCustomerCodes([roll.id])).get(roll.id) ?? null;
    // "Nereden geldi": en yakın atanın gelen belge satırı (tek çözücü); `inherited` = satır atada.
    const dnl = (await resolveDeliveryNoteLinesForRolls([roll.id])).get(roll.id);
    const deliveryNote = dnl
      ? { noteId: dnl.noteId, noteNo: dnl.noteNo, senderDocNo: dnl.senderDocNo, customerBatchNo: dnl.customerBatchNo?.trim() || null, senderRollNo: dnl.senderRollNo, inherited: dnl.sourceRollId !== roll.id }
      : null;
    return {
      success: true,
      data: { ...roll, manualReason, customerCode, deliveryNote, customerBatchNo: deliveryNote?.customerBatchNo ?? null, ...(cancelDiag ?? {}) } as unknown as Roll,
    };
  }

export async function buildCancelDiagnostics(
    roll: { id: string; status: RollStatus; preCancelStatus: RollStatus | null; batchId: string | null; sackId: string | null; shipmentId: string | null; currentStepId: string | null; cancelReasonCode: string | null },
  ): Promise<{ canRestore: boolean; restoreBlockReason: string | null } | null> {
    if (roll.status !== RollStatus.CANCELLED) return null;
    const [movementCount, operationCount, childCount, dispatchItemCount, kartelaItemCount, deliveryNoteStatus] =
      await Promise.all([
        prisma.rollMovement.count({ where: { ...ACTIVE_MOVEMENT, rollId: roll.id } }),
        prisma.rollOperation.count({ where: { ...ACTIVE_OPERATION, rollId: roll.id } }),
        prisma.roll.count({ where: { parentRollId: roll.id } }),
        prisma.subcontractorDispatchItem.count({ where: { rollId: roll.id } }),
        prisma.kartelaDispatchItem.count({ where: { rollId: roll.id } }),
        noteStatusOf(roll.id),
      ]);
    // Ekran ile uç AYNI yüklemi çağırır — kopyalanırsa arayüz "Geri Al" çizerken
    // uç 409 döner ve operatör çıkmaza girer.
    const restoreBlockReason = resolveRollRestoreBlockReason({
      status: roll.status,
      preCancelStatus: roll.preCancelStatus,
      batchId: roll.batchId,
      sackId: roll.sackId,
      shipmentId: roll.shipmentId,
      currentStepId: roll.currentStepId,
      cancelReasonCode: roll.cancelReasonCode,
      movementCount,
      operationCount,
      childCount,
      dispatchItemCount,
      kartelaItemCount,
      deliveryNoteStatus,
    });
    return { canRestore: restoreBlockReason === null, restoreBlockReason };
  }

export async function findRollByBarcode(this: InventoryServiceThis, barcode: string): Promise<ApiResponse<Roll | null>> {
    // D4-F1: tek okutma boğazı — iç barkod önce, ayar açıksa aktif müşteri kodu (belirsizlik 409).
    const resolved = await resolveRollByScanCode(barcode, { load: (where) => prisma.roll.findUnique({
      where,
      include: {
        item: true,
        color: true,
        errors: { where: { ...ACTIONABLE_ROLL_ERROR_WHERE } },
        // Rezervasyon bilgisi — barkod okutmada "bu top çuvalda/sevkiyatta" uyarısı.
        shipment: { select: { id: true, shipmentNo: true, status: true } },
        sack: { select: { id: true, sackNo: true, seq: true } },
        // İPTALİ KİM YAPTI — okutma yüzeyi "05.08 10:56 · HamGiris" diyebilsin.
        // Sebep/tarih topun kendi kolonlarında (`cancelReason`/`cancelledAt`), yalnız
        // insan adı ilişkiden gelir. Küçük join; hot path'e ölçülebilir yük katmaz
        // (nullable FK, satır başına en fazla bir kullanıcı).
        cancelledBy: { select: { id: true, fullName: true, username: true } },
        // EMANET sahibi — tablet okutma satırındaki sahip rozeti (T3); liste include'uyla AYNI şekil.
        ownerCustomer: ROLL_LIST_INCLUDE.ownerCustomer,
        // En güncel iade kaydı — Tambur/depo barkod okutmada iade notu/nedeni görünür.
        returns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            qty: true,
            reasonText: true,
            note: true,
            createdAt: true,
            reason: { select: { code: true, name: true, color: true } },
            receivedBy: { select: { fullName: true } },
          },
        },
      },
    }) });
    if (resolved.kind === "AMBIGUOUS") throw ambiguousCustomerCodeError(resolved);
    if (resolved.kind === "NONE") {
      return { success: false, data: null, message: "Barkod bulunamadı" };
    }
    const roll = resolved.roll;

    // İptal edilmiş topta "neden + geri alınabilir mi" teşhisi. Okutan yüzey
    // artık "stokta değil" deyip susmak zorunda değil.
    const cancelDiag = await this.buildCancelDiagnostics(roll);

    return { success: true, data: { ...roll, ...(cancelDiag ?? {}), ...matchExtras(resolved) } as unknown as Roll };
  }
