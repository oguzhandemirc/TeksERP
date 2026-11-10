// =============================================================================
// Inventory Service / label-texts — topun etiket ad/renk/parti no düzeltmesi
// =============================================================================
// Tamburda topa yazılan müşteri etiket değerleri (`Roll.labelItemName` /
// `labelColorName` / `labelBatchNo` / `labelConsigneeId`) top sevk edilene kadar düzeltilebilir
// (Gülkesim 2026-11-09). Durum alanıdır: eski değer audit'te kalır, defter yok
// (satır silinince raporlanan hiçbir sayı değişmez). Uç: PATCH /api/rolls/:id/label-texts.
// =============================================================================

import { RollStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import type { ApiResponse } from "../../types/api.types";
import { K18_DEAD_STATUSES } from "../batch.service";
import { SHIP_READY_GONE_STATUSES } from "../helpers/ship-readiness.helper";
import { normalizeLabelBatchNo, normalizeRollLabelText } from "../helpers/label-batch-no.helper";
import { resolveTamburConsignee } from "../helpers/tambur-customer-settings.helper";

/** Fiziksel olarak fabrikadan çıkmış top: müşteriye sevk (tek kaynak `SHIP_READY_GONE_STATUSES`) + fason/kartela sevki. */
const LABEL_TEXT_SHIPPED: readonly RollStatus[] = [
  ...SHIP_READY_GONE_STATUSES,
  RollStatus.AT_SUBCONTRACTOR,
  RollStatus.AT_KARTELA,
];
/** Etiketi artık anlamsız top: K18 ölü kümesi + fire + fason dönüşünde kapanmış eski barkod. */
const LABEL_TEXT_DEAD: readonly RollStatus[] = [
  ...K18_DEAD_STATUSES,
  RollStatus.SCRAP,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
];
/** Atomik claim'in WHERE'i ve önizleme yüklemi aynı kümeden (boş değil → `notIn: []` tuzağı yok). */
export const LABEL_TEXT_LOCKED_STATUSES: readonly RollStatus[] = [...LABEL_TEXT_SHIPPED, ...LABEL_TEXT_DEAD];

export type LabelTextFixBlock = { code: "ROLL_SHIPPED" | "ROLL_DEAD"; reason: string };

/** Etiket ad/renk/parti düzeltmesinin TEK engel yüklemi (null = düzeltilebilir). */
export function labelTextFixBlock(status: RollStatus): LabelTextFixBlock | null {
  if (LABEL_TEXT_SHIPPED.includes(status)) {
    return {
      code: "ROLL_SHIPPED",
      reason: status === RollStatus.SHIPPED
        ? "Bu top sevk edilmiş — etiket bilgisi artık düzeltilemez."
        : "Bu top fason/kartela sevkiyle dışarıda — etiket bilgisi düzeltilemez.",
    };
  }
  if (LABEL_TEXT_DEAD.includes(status)) {
    return { code: "ROLL_DEAD", reason: "Bu top tüketilmiş, iptal ya da fire edilmiş — etiketi yok, düzeltilemez." };
  }
  return null;
}

export interface LabelTextsFixInput {
  /** `undefined` dokunma · null/"" temizle (varsayılan ada döner) · metin yaz. */
  labelItemName?: string | null;
  labelColorName?: string | null;
  labelBatchNo?: string | null;
  /** Etiket alıcısı (emanet top): `undefined` dokunma · null sahibe dön · id yaz (sahibin alıcısı olmalı). */
  labelConsigneeId?: string | null;
  reason: string;
}

export interface LabelTextsFixResult {
  rollId: string;
  labelItemName: string | null;
  labelColorName: string | null;
  labelBatchNo: string | null;
  labelConsigneeId: string | null;
  changed: boolean;
}

const patchText = (v: string | null | undefined, alan: "Etiket kumaş adı" | "Etiket rengi") =>
  v === undefined ? undefined : normalizeRollLabelText(v, alan);

export async function fixRollLabelTexts(
  rollId: string,
  data: LabelTextsFixInput,
  userId?: string,
): Promise<ApiResponse<LabelTextsFixResult>> {
  const reason = data.reason?.trim() ?? "";
  if (reason.length < 3) throw AppError.badRequest("Düzeltme sebebi (en az 3 karakter) zorunludur.", { code: "REASON_REQUIRED" });
  const next = {
    labelItemName: patchText(data.labelItemName, "Etiket kumaş adı"),
    labelColorName: patchText(data.labelColorName, "Etiket rengi"),
    labelBatchNo: normalizeLabelBatchNo(data.labelBatchNo),
  };
  if (next.labelItemName === undefined && next.labelColorName === undefined && next.labelBatchNo === undefined && data.labelConsigneeId === undefined) {
    throw AppError.badRequest("Düzeltilecek en az bir etiket alanı gönderilmeli.", { code: "LABEL_TEXT_EMPTY_PATCH" });
  }

  const roll = await prisma.roll.findUnique({
    where: { id: rollId },
    select: {
      id: true, barcode: true, status: true, labelItemName: true, labelColorName: true, labelBatchNo: true,
      labelConsigneeId: true, ownerCustomerId: true, labelCustomerId: true,
    },
  });
  if (!roll) throw AppError.notFound("Top bulunamadı");
  const block = labelTextFixBlock(roll.status);
  if (block) throw AppError.conflict(block.reason, { code: block.code });
  // Alıcı: kesim yollarıyla aynı çözücü (sahip doğrulaması, mezar taşı → hedef, pasif 409).
  const nextConsignee = data.labelConsigneeId === undefined
    ? undefined
    : await resolveTamburConsignee({ labelConsigneeId: data.labelConsigneeId, targetCustomerId: roll.labelCustomerId, ownerCustomerId: roll.ownerCustomerId });

  const old = {
    labelItemName: roll.labelItemName, labelColorName: roll.labelColorName, labelBatchNo: roll.labelBatchNo, labelConsigneeId: roll.labelConsigneeId,
  };
  const changes: Partial<typeof old> = {};
  for (const k of ["labelItemName", "labelColorName", "labelBatchNo", "labelConsigneeId"] as const) {
    const v = k === "labelConsigneeId" ? nextConsignee : next[k];
    if (v !== undefined && v !== old[k]) changes[k] = v;
  }
  const final = { ...old, ...changes };
  if (Object.keys(changes).length === 0) {
    return { success: true, data: { rollId, ...final, changed: false }, message: "Etiket bilgisi zaten aynı" };
  }

  // ATOMİK CLAIM: durum (sevk/ölü değil) + okunan eski değerler WHERE'de — arada sevk edilen ya da
  // başka biri tarafından düzeltilen topta 0 satır → 409 (kaybolan güncelleme yok).
  const { count } = await prisma.roll.updateMany({
    where: { id: rollId, status: { notIn: [...LABEL_TEXT_LOCKED_STATUSES] }, ...old },
    data: { ...changes, labelDirty: true },
  });
  if (count === 0) {
    const now = await prisma.roll.findUnique({ where: { id: rollId }, select: { status: true } });
    const late = now ? labelTextFixBlock(now.status) : null;
    if (late) throw AppError.conflict(late.reason, { code: late.code });
    throw AppError.conflict("Top bu arada değişti — yenileyip tekrar deneyin.", { code: "ROLL_CHANGED" });
  }

  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "ROLL",
    recordId: rollId,
    oldData: { ...old, barcode: roll.barcode },
    newData: { ...changes, reason, event: "LABEL_TEXT_FIX" },
  });

  return { success: true, data: { rollId, ...final, changed: true }, message: "Etiket bilgisi düzeltildi" };
}
