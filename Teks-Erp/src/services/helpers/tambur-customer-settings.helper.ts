// =============================================================================
// TAMBUR MÜŞTERİ AYARLARI — tartım zorunluluğu, bölme önerisi, en kaynağı (Gülkesim S5)
// =============================================================================
// Ayar müşteri kartındadır; müşteri = kesimin etiket müşterisi (Kime?), yoksa malın
// sahibi. Tartım kapısı top doğuran HER tambur yolunda (iki kesim + iki 'Bitir' kalanı +
// segmentli finalize) AYNI helper'dan geçer — biri unutulursa zorunlu müşterinin topu kg'sız doğar.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { normalizeLabelBatchNo } from "./label-batch-no.helper";
import { resolveDeliveryNoteLinesForRolls } from "./roll-delivery-note-line.helper";
import { readLabelWidthSource, type LabelWidthSource } from "./label-width-source.helper";
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

/** Ayarın sahibi müşteri: etiket müşterisi (Kime?) ?? malın sahibi. */
export function tamburSettingsCustomerId(targetCustomerId: string | null | undefined, ownerCustomerId: string | null | undefined): string | null {
  return targetCustomerId ?? ownerCustomerId ?? null;
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
}

/**
 * Tablet kesim ekranının ayar okuması: açık müşteri (Kime?) verildiyse o, yoksa topun sahibi.
 * Top bulunamazsa 404 — yanlış id sessizce "ayarsız" dönmesin.
 */
export async function getTamburLabelSettings(args: {
  rollId?: string | null;
  customerId?: string | null;
}): Promise<TamburLabelSettingsView> {
  let ownerCustomerId: string | null = null;
  let ownerCustomer: { id: string; name: string } | null = null;
  let deliveryNoteBatchNo: string | null = null;
  if (args.rollId) {
    const roll = await prisma.roll.findUnique({ where: { id: args.rollId }, select: { ownerCustomerId: true, ownerCustomer: { select: { id: true, name: true } } } });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    ownerCustomerId = roll.ownerCustomerId;
    ownerCustomer = roll.ownerCustomer ?? null;
    deliveryNoteBatchNo = (await resolveDeliveryNoteLinesForRolls([args.rollId])).get(args.rollId)?.customerBatchNo?.trim() || null;
  }
  const settings = await loadTamburCustomerSettings(tamburSettingsCustomerId(args.customerId, ownerCustomerId));
  return { ...settings, printTiming: await readTamburLabelPrintTiming(), ownerCustomer, deliveryNoteBatchNo };
}
