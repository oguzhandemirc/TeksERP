// =============================================================================
// Shipping Service / fields
// =============================================================================
// Sevkiyat başlık alanları: yön, prosedür kodu, teslim yeri, irsaliye notu, elle çuval sayısı, fatura bağı, çuval notları.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================

import {
  InvoiceStatus,
  ShipmentStatus,
  ShipmentDestination,
  ShipmentEventType,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { writeShipmentEvent } from "../helpers/shipment-event.helper";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import {
  readShipmentManualSackCountEnabled,
} from "../system-setting.service";
import {
  assertInvoiceTraceAllowed,
  invoiceTraceWarning,
  resolveInvoiceMode,
} from "../helpers/shipping-invoice-mode.helper";
import {
  touchShipmentPlannedTx,
} from "../helpers/shipment-locks.helper";
import { sackFieldsAppearOnLabel } from "../helpers/sack-label-stale.helper";
import { ApiResponse } from "../../types/api.types";
import {
  resolveShipmentDestination,
} from "../helpers/shipment-destination.helper";
import { resolveDeliveryToTx, type DeliveryToInput, type DeliveryToValue } from "../helpers/shipment-delivery.helper";
import { settingRowPath } from "../../constants/panel-ayar-yolu";
import { destinationLockMessage, type ShippingServiceThis } from "./shared";

// eslint-disable-next-line max-params -- `this` bağlam bildirimi parametre değil; özgün metot 4 parametreli
export async function setDestination(this: ShippingServiceThis, shipmentId: string, destination: ShipmentDestination, userId?: string, destinationChosen = false): Promise<ApiResponse<unknown>> {
    const firstPick = await prisma.$transaction(async (tx) => {
      await touchShipmentPlannedTx(tx, shipmentId);
      const sh = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { customerId: true, branchId: true } });
      if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");
      const kilit = await resolveShipmentDestination(tx, { customerId: sh.customerId, branchId: sh.branchId });
      if (kilit.destination && kilit.destination !== destination) {
        throw AppError.conflict(destinationLockMessage(destination, kilit, false), {
          code: "SHIPMENT_DESTINATION_LOCKED",
          destination: kilit.destination,
          source: kilit.source,
        });
      }
      const picked = kilit.destination
        ? null
        : await this.claimFirstDestinationTx(tx, { customerId: sh.customerId, branchId: sh.branchId, requested: destination, chosen: destinationChosen, userId });
      await tx.shipment.update({ where: { id: shipmentId }, data: { destination } });
      return { firstChoice: picked?.firstChoice ?? null };
    });
    await this.logFirstShipmentDestination(firstPick, shipmentId, userId);
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "DESTINATION", destination } });
    return { success: true, data: { shipmentId, destination }, message: destination === ShipmentDestination.EXPORT ? "Yurtdışı sevk olarak işaretlendi" : "Yurtiçi sevk olarak işaretlendi" };
  }

export async function setProcedureCode(shipmentId: string, procedureCode: string | null, userId?: string): Promise<ApiResponse<unknown>> {
    const code = procedureCode?.trim() || null;
    await prisma.$transaction(async (tx) => {
      await touchShipmentPlannedTx(tx, shipmentId);
      await tx.shipment.update({ where: { id: shipmentId }, data: { procedureCode: code } });
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "PROCEDURE_CODE", procedureCode: code } });
    return { success: true, data: { shipmentId, procedureCode: code }, message: "Prosedür kodu güncellendi" };
  }

export async function setDeliveryTo(shipmentId: string, input: DeliveryToInput, userId?: string): Promise<ApiResponse<DeliveryToValue>> {
    const value = await prisma.$transaction(async (tx) => {
      const sh = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { customerId: true } });
      if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");
      const v = await resolveDeliveryToTx(tx, sh.customerId, input);
      const claimed = await tx.shipment.updateMany({
        where: { id: shipmentId, status: ShipmentStatus.PLANNED },
        data: { deliveryCustomerId: v.deliveryCustomerId, deliveryAddress: v.deliveryAddress, updatedById: userId ?? null },
      });
      if (claimed.count === 0) {
        throw AppError.conflict("Teslim yeri yalnız sevk edilmemiş (planlanan) sevkiyatta değiştirilebilir.", { code: "SHIPMENT_NOT_PLANNED" });
      }
      return v;
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "DELIVERY_TO", ...value } });
    return {
      success: true,
      data: value,
      message: value.deliveryCustomerId ? "Teslim yeri güncellendi" : "Teslim yeri kaldırıldı",
    };
  }

export async function setDispatchNote(shipmentId: string, note: string | null, userId?: string): Promise<ApiResponse<unknown>> {
    const value = note?.trim().slice(0, 500) || null;
    const updated = await prisma.shipment.updateMany({ where: { id: shipmentId }, data: { dispatchNote: value } });
    if (updated.count === 0) throw AppError.notFound("Sevkiyat bulunamadı");
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "DISPATCH_NOTE", dispatchNote: value } });
    return { success: true, data: { shipmentId, dispatchNote: value }, message: "İrsaliye açıklaması güncellendi" };
  }

export async function setManualSackCount(shipmentId: string, count: number | null, userId?: string): Promise<ApiResponse<unknown>> {
    if (!(await readShipmentManualSackCountEnabled())) {
      throw AppError.badRequest(`Elle çuval adedi girişi kapalı (${settingRowPath("shipmentManualSackCountEnabled")})`);
    }
    const value = count == null ? null : Math.trunc(count);
    if (value != null && (value < 1 || value > 9999)) {
      throw AppError.badRequest("Çuval adedi 1 ile 9999 arasında olmalı");
    }
    const updated = await prisma.shipment.updateMany({ where: { id: shipmentId }, data: { manualSackCount: value } });
    if (updated.count === 0) throw AppError.notFound("Sevkiyat bulunamadı");
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "MANUAL_SACK_COUNT", manualSackCount: value } });
    return { success: true, data: { shipmentId, manualSackCount: value }, message: "Çuval adedi güncellendi" };
  }

export async function setShipmentInvoice(
    shipmentId: string,
    invoiceNo: string | null,
    invoicedAt: Date | null,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const value = invoiceNo?.trim().slice(0, 64) || null;
    const stamp = value ? (invoicedAt ?? new Date()) : null;
    // ── FATURA İZİ REJİMİ (`shipping.invoiceMode`) ────────────────────────────
    // `clearing` = izi KALDIRMA → her modda serbest (yanlış iz düzeltilebilmeli).
    const invoiceMode = await resolveInvoiceMode();
    assertInvoiceTraceAllowed(invoiceMode, { clearing: value === null });
    // `ikisi` uyarısı için iç fatura NESTED RELATION'dan okunur — `prisma.invoice.`
    // erişimcisi bu servise GİRMEZ (rejim bekçisi sevkiyat router'ını "kapısız
    // ticaret" ilan ederdi).
    const internalDocNo =
      invoiceMode === "ikisi" && value !== null
        ? (
            await prisma.shipment.findUnique({
              where: { id: shipmentId },
              select: {
                invoices: {
                  where: { status: { not: InvoiceStatus.CANCELLED } },
                  select: { docNo: true },
                  take: 1,
                },
              },
            })
          )?.invoices[0]?.docNo ?? null
        : null;
    // ⚠️ TEK TX: defter satırı damgayla BİRLİKTE commit olmalı. İşaret kalkıp
    // defterde iz kalmazsa "fatura işaretini kim kaldırdı" cevapsız kalır —
    // üstelik bu işaret aynı zamanda storno kapısıdır (faturalanmış sevkiyat
    // geri alınamaz), yani onu kaldırmak bir YETKİ kararıdır.
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.shipment.updateMany({
        where: { id: shipmentId, status: ShipmentStatus.DISPATCHED },
        data: { invoiceNo: value, invoicedAt: stamp, invoicedById: value ? (userId ?? null) : null },
      });
      if (u.count > 0) {
        await writeShipmentEvent(tx, {
          shipmentId,
          type: value ? ShipmentEventType.INVOICED : ShipmentEventType.INVOICE_CLEARED,
          fromStatus: ShipmentStatus.DISPATCHED,
          toStatus: ShipmentStatus.DISPATCHED,
          reason: value ? `Fatura no: ${value}` : "Fatura işareti kaldırıldı",
          userId,
        });
      }
      return u;
    });
    if (updated.count === 0) {
      // Ayrımı kullanıcıya söyle: "bulunamadı" ile "henüz sevk edilmedi" farklı hatalar.
      const exists = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { status: true } });
      if (!exists) throw AppError.notFound("Sevkiyat bulunamadı");
      throw AppError.badRequest("Yalnız sevk edilmiş (DISPATCHED) sevkiyat faturalandırılabilir");
    }
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "INVOICE_MARK", invoiceNo: value, invoicedAt: stamp },
    });
    const traceNote = invoiceTraceWarning(invoiceMode, {
      clearing: value === null,
      internalDocNo,
    });
    return {
      success: true,
      data: { shipmentId, invoiceNo: value, invoicedAt: stamp },
      message: value ? "Fatura bilgisi kaydedildi" : "Fatura işareti kaldırıldı",
      ...(traceNote ? { warnings: [traceNote] } : {}),
    };
  }

export async function setDirectShipmentInvoice(
    directShipmentId: string,
    invoiceNo: string | null,
    invoicedAt: Date | null,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const value = invoiceNo?.trim().slice(0, 64) || null;
    const stamp = value ? (invoicedAt ?? new Date()) : null;
    // ⚠️ DOĞRUDAN SEVK DE KAPSAMDA. Kapsam dışı bırakmak, `ic` modunda elle izin
    // kapatıldığı ama iç fatura satır kurucusunun yalnız `Shipment` tanıdığı bir
    // dünyada fasona doğrudan sevkin faturalanacak HİÇBİR yolunu bırakmazdı —
    // ama simetriyi bozmak da "aynı ekran, iki farklı kural" demekti. Karar:
    // kapsamda; `ic` modunu açan kurulum doğrudan sevki de ERP'den faturalar.
    const invoiceMode = await resolveInvoiceMode();
    assertInvoiceTraceAllowed(invoiceMode, { clearing: value === null });
    const internalDocNo =
      invoiceMode === "ikisi" && value !== null
        ? (
            await prisma.directShipment.findUnique({
              where: { id: directShipmentId },
              select: {
                invoices: {
                  where: { status: { not: InvoiceStatus.CANCELLED } },
                  select: { docNo: true },
                  take: 1,
                },
              },
            })
          )?.invoices[0]?.docNo ?? null
        : null;
    const updated = await prisma.directShipment.updateMany({
      where: { id: directShipmentId },
      data: { invoiceNo: value, invoicedAt: stamp, invoicedById: value ? (userId ?? null) : null },
    });
    if (updated.count === 0) throw AppError.notFound("Fasondan sevk kaydı bulunamadı");
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "DIRECT_SHIPMENT",
      recordId: directShipmentId,
      newData: { kind: "INVOICE_MARK", invoiceNo: value, invoicedAt: stamp },
    });
    const traceNote = invoiceTraceWarning(invoiceMode, {
      clearing: value === null,
      internalDocNo,
    });
    return {
      success: true,
      data: { directShipmentId, invoiceNo: value, invoicedAt: stamp },
      message: value ? "Fatura bilgisi kaydedildi" : "Fatura işareti kaldırıldı",
      ...(traceNote ? { warnings: [traceNote] } : {}),
    };
  }

export async function getDispatchNote(shipmentId: string): Promise<ApiResponse<{ dispatchNote: string | null }>> {
    const s = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { dispatchNote: true } });
    if (!s) throw AppError.notFound("Sevkiyat bulunamadı");
    return { success: true, data: { dispatchNote: s.dispatchNote } };
  }

export async function setSackNotes(this: ShippingServiceThis, sackId: string, notes: string | null, userId?: string): Promise<ApiResponse<unknown>> {
    const value = notes?.trim().slice(0, 500) || null;
    // Not GERÇEKTEN değişti mi + hangi müşterinin şablonuna bakılacak: yazmadan önce oku.
    const before = await prisma.sack.findUnique({
      where: { id: sackId },
      select: { notes: true, customerId: true },
    });
    if (!before) throw AppError.notFound("Çuval bulunamadı");
    const updated = await prisma.sack.updateMany({ where: { id: sackId }, data: { notes: value } });
    if (updated.count === 0) throw AppError.notFound("Çuval bulunamadı");

    // KOŞULLU BAYAT: `sackNote` şablona sürüklenmişse basılı etiket artık yalan.
    // Koşulsuz yazsaydık, notu HİÇ basmayan kurulumlarda (varsayılan) her not
    // düzenlemesi sahte "yeniden bas" uyarısı üretir, rozet enflasyonu da gerçek
    // uyarıyı öldürürdü. Değer değişmediyse (aynı metin yeniden kaydedildi) hiç sorma.
    let labelDirty = false;
    if (value !== before.notes) {
      labelDirty = await this.sackNoteAppearsOnLabel(before.customerId);
      if (labelDirty) {
        await prisma.sack.updateMany({ where: { id: sackId, labelDirty: false }, data: { labelDirty: true } });
      }
    }

    await AuditService.log({ userId, action: "UPDATE", tableName: "SACK", recordId: sackId, newData: { kind: "SACK_NOTES", notes: value, labelDirty } });
    return { success: true, data: { sackId, notes: value, labelDirty }, message: value ? "Çuval notu kaydedildi" : "Çuval notu temizlendi" };
  }

export async function sackNoteAppearsOnLabel(customerId: string | null): Promise<boolean> {
    // Gövde alan-parametreli helper'a taşındı (sevk partisi alanları da aynı soruyu sorar).
    return sackFieldsAppearOnLabel(customerId, ["sackNote"]);
  }

export async function getSackNotes(sackId: string): Promise<ApiResponse<{ notes: string | null }>> {
    const s = await prisma.sack.findUnique({ where: { id: sackId }, select: { notes: true } });
    if (!s) throw AppError.notFound("Çuval bulunamadı");
    return { success: true, data: { notes: s.notes } };
  }
