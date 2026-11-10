// =============================================================================
// TAMBUR MÜŞTERİ AYARLARI — tartım zorunluluğu, bölme önerisi, en kaynağı (Gülkesim S5)
// =============================================================================
// Ayar müşteri kartındadır; müşteri = malın sahibi (emanet), yoksa kesimin etiket müşterisi
// (Kime?) — 2026-11-10 sırası çevrildi. Tartım kapısı top doğuran HER tambur yolunda (iki kesim + iki 'Bitir' kalanı +
// segmentli finalize) AYNI helper'dan geçer — biri unutulursa zorunlu müşterinin topu kg'sız doğar.
// =============================================================================
import { Prisma, SackWeightSource } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { normalizeLabelBatchNo } from "./label-batch-no.helper";
import { resolveDeliveryNoteLinesForRolls } from "./roll-delivery-note-line.helper";
import { readLabelWidthSource, type LabelWidthSource } from "./label-width-source.helper";
import { resolveConsigneeChain } from "../customer-consignee.service";
import { resolveWeightSource, type WeightSourceStamp } from "./weight-source-gate.helper";
import { readTamburLabelPrintTiming, type TamburLabelPrintTiming } from "../system-setting.service";

export interface TamburCustomerSettings {
  customerId: string | null;
  widthSource: LabelWidthSource | null;
  weighRequired: boolean;
  splitLengthM: number | null;
  /** Etikete müşteri parti no basılır (cari `tamburLabelBatchEnabled`). */
  labelBatchEnabled: boolean;
}

const EMPTY: TamburCustomerSettings = { customerId: null, widthSource: null, weighRequired: false, splitLengthM: null, labelBatchEnabled: false };

/** Ayarın sahibi müşteri: malın sahibi (emanet) ?? etiket müşterisi (Kime?) — eski APK'nın yanlış hedefine karşı sed. */
export function tamburSettingsCustomerId(targetCustomerId: string | null | undefined, ownerCustomerId: string | null | undefined): string | null {
  return ownerCustomerId ?? targetCustomerId ?? null;
}

/**
 * Kesimde yazılacak alıcı (`Roll.labelConsigneeId`): kayıt ayar müşterisinin olmalı (400
 * `CONSIGNEE_OWNER_MISMATCH`), mezar taşı hedefine çözülür, pasif 409 `CONSIGNEE_INACTIVE`. Boş → null.
 */
export async function resolveTamburConsignee(args: {
  labelConsigneeId: string | null | undefined;
  targetCustomerId: string | null | undefined;
  ownerCustomerId: string | null | undefined;
}): Promise<string | null> {
  if (!args.labelConsigneeId) return null;
  const c = await resolveConsigneeChain(args.labelConsigneeId);
  if (!c) throw AppError.badRequest("Alıcı bulunamadı", { code: "CONSIGNEE_NOT_FOUND" });
  const customerId = tamburSettingsCustomerId(args.targetCustomerId, args.ownerCustomerId);
  if (!customerId || c.customerId !== customerId) {
    throw AppError.badRequest("Alıcı bu topun müşterisine ait değil.", { code: "CONSIGNEE_OWNER_MISMATCH", consigneeId: c.id });
  }
  if (!c.isActive) throw AppError.conflict(`"${c.name}" alıcısı pasif — panelden aktifleştirin ya da başka alıcı seçin.`, { code: "CONSIGNEE_INACTIVE", consigneeId: c.id });
  return c.id;
}

/**
 * Kesimin kg kaynağı: kg yoksa null (kaynak verilmişse 400 `WEIGHT_SOURCE_WITHOUT_KG`); kaynaksız kg (eski APK)
 * MANUAL; beyan tek boğazdan (`resolveWeightSource`) çözülür — simüle kantar bayrak kapalıyken 400.
 */
export async function resolveTamburWeightSource(args: {
  weightKg: Prisma.Decimal | null;
  weightSource: SackWeightSource | null | undefined;
  stamp?: WeightSourceStamp | null;
}): Promise<SackWeightSource | null> {
  if (args.weightKg == null) {
    if (args.weightSource) throw AppError.badRequest("Kg kaynağı kg'sız gönderilemez.", { code: "WEIGHT_SOURCE_WITHOUT_KG" });
    return null;
  }
  return resolveWeightSource(args.weightSource ?? SackWeightSource.MANUAL, args.stamp, "kg'yi elle girin");
}

export async function loadTamburCustomerSettings(customerId: string | null): Promise<TamburCustomerSettings> {
  if (!customerId) return EMPTY;
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, labelWidthSource: true, tamburWeighRequired: true, tamburSplitLengthM: true, tamburLabelBatchEnabled: true },
  });
  if (!c) return EMPTY;
  return {
    customerId: c.id,
    widthSource: readLabelWidthSource(c.labelWidthSource),
    weighRequired: c.tamburWeighRequired,
    splitLengthM: c.tamburSplitLengthM != null ? Number(c.tamburSplitLengthM) : null,
    labelBatchEnabled: c.tamburLabelBatchEnabled,
  };
}

/**
 * Kesimde doğan topun etiket parti no'su. Değer yoksa null (bugünkü davranış); değer var
 * ama müşteri ayarı kapalıysa 400 `LABEL_BATCH_NOT_ENABLED` — sessizce atılmaz (fail-closed).
 */
export async function resolveTamburLabelBatchNo(args: {
  labelBatchNo: string | null | undefined;
  targetCustomerId: string | null | undefined;
  ownerCustomerId: string | null | undefined;
}): Promise<string | null> {
  const v = normalizeLabelBatchNo(args.labelBatchNo);
  if (v == null) return null;
  const s = await loadTamburCustomerSettings(tamburSettingsCustomerId(args.targetCustomerId, args.ownerCustomerId));
  if (!s.labelBatchEnabled) {
    throw AppError.badRequest("Bu müşteride etikete parti no basılmıyor — cari ayarını açın ya da alanı boşaltın.", {
      code: "LABEL_BATCH_NOT_ENABLED",
      customerId: s.customerId,
    });
  }
  return v;
}

/**
 * Kesimin kg'ı: verilmişse Decimal (3 ondalık); müşteri tartım istiyorsa ve yoksa 400
 * `TAMBUR_WEIGHT_REQUIRED`. Ayar kapalı ve kg yok → null (bugünkü davranış).
 */
export async function resolveTamburCutWeight(args: {
  weightKg: number | null | undefined;
  targetCustomerId: string | null | undefined;
  ownerCustomerId: string | null | undefined;
}): Promise<Prisma.Decimal | null> {
  if (args.weightKg != null) {
    if (!(args.weightKg > 0) || args.weightKg > 100_000) {
      throw AppError.badRequest("Tartım kg 0'dan büyük olmalı", { code: "TAMBUR_WEIGHT_INVALID" });
    }
    return new Prisma.Decimal(args.weightKg.toFixed(3));
  }
  const s = await loadTamburCustomerSettings(tamburSettingsCustomerId(args.targetCustomerId, args.ownerCustomerId));
  if (s.weighRequired) {
    throw AppError.badRequest("Bu müşterinin topu tamburda tartılmadan kesilemez — kg girin.", {
      code: "TAMBUR_WEIGHT_REQUIRED",
      customerId: s.customerId,
    });
  }
  return null;
}

export interface TamburLabelSettingsView extends TamburCustomerSettings {
  /** Fabrika ayarı `tambur.labelPrintTiming` (EACH | END). */
  printTiming: TamburLabelPrintTiming;
  /** Malın sahibi (EMANET `Roll.ownerCustomerId`) — Kime?'den BAĞIMSIZ; tablet fason topta hedefi buna çeker. Sahipsiz/topsuz: null. */
  ownerCustomer: { id: string; name: string } | null;
  /** Topun gelen belge müşteri partisi (ata zinciriyle, tek çözücü) — tablette parti no varsayılanı. Satırsız/topsuz: null. */
  deliveryNoteBatchNo: string | null;
  /** Gelen belgedeki kumaş adı / renk (tek çözücü) — tablet Etikette kartında "belgede: …" ipucu. */
  deliveryNoteItemText: string | null;
  deliveryNoteColorText: string | null;
  /** Emanet top: etiket müşterisi sahibe kilitli (Kime? seçilemez; yalnız alıcı). */
  ownerLocked: boolean;
}

/**
 * Tablet kesim ekranının ayar okuması: topun sahibi (emanet) varsa o, yoksa açık müşteri (Kime?).
 * Top bulunamazsa 404 — yanlış id sessizce "ayarsız" dönmesin.
 */
export async function getTamburLabelSettings(args: {
  rollId?: string | null;
  customerId?: string | null;
}): Promise<TamburLabelSettingsView> {
  let ownerCustomerId: string | null = null;
  let ownerCustomer: { id: string; name: string } | null = null;
  let deliveryNoteBatchNo: string | null = null;
  let deliveryNoteItemText: string | null = null;
  let deliveryNoteColorText: string | null = null;
  if (args.rollId) {
    const roll = await prisma.roll.findUnique({ where: { id: args.rollId }, select: { ownerCustomerId: true, ownerCustomer: { select: { id: true, name: true } } } });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    ownerCustomerId = roll.ownerCustomerId;
    ownerCustomer = roll.ownerCustomer ?? null;
    const line = (await resolveDeliveryNoteLinesForRolls([args.rollId])).get(args.rollId);
    deliveryNoteBatchNo = line?.customerBatchNo?.trim() || null;
    deliveryNoteItemText = line?.itemText?.trim() || null;
    deliveryNoteColorText = line?.colorText?.trim() || null;
  }
  const settings = await loadTamburCustomerSettings(tamburSettingsCustomerId(args.customerId, ownerCustomerId));
  return {
    ...settings, printTiming: await readTamburLabelPrintTiming(), ownerCustomer, deliveryNoteBatchNo,
    deliveryNoteItemText, deliveryNoteColorText, ownerLocked: ownerCustomerId != null,
  };
}
