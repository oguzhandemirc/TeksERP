// =============================================================================
// TAMBUR ÇOCUK TOP — etiket niyeti (emanet kalan kuyruğu) ve en kaynağı (K7, 2026-11-10)
// =============================================================================
// Kalan kuyruğunu yazan üç yol (finalize · açık kumaş bitir · depo kesim bitir) emanet topta stok değil
// SAHİBİN niyetini yazar (sahip kilidi, `resolveLabelIntent` ile aynı karar). En: çocuk atanın enini
// miras alır; atada en yoksa gelen belge TOP satırının eni (ARABA özeti değil). Ölçülen en (Etikette
// kartındaki En) mirası ezer; sınır `measuredWidthLimit` (en ölçen istasyonla aynı hesap), iz audit'te.
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { buildIntentSnapshot } from "../label.service";
import { effectiveTamburPlanWidthGate } from "../system-setting.service";
import { measuredWidthLimit } from "./measured-width.helper";
import { resolveDeliveryNoteLinesForRolls } from "./roll-delivery-note-line.helper";

/** Kalan kuyruğu / toplu finalize çocuğunun niyeti: emanet topta sahip, değilse stok. */
export function ownerTailIntent(ownerCustomerId: string | null | undefined): {
  lastLabelSnapshot: Prisma.InputJsonValue;
  labelCustomerId: string | null;
} {
  return ownerCustomerId
    ? { lastLabelSnapshot: buildIntentSnapshot({ customerId: ownerCustomerId }), labelCustomerId: ownerCustomerId }
    : { lastLabelSnapshot: { stock: true }, labelCustomerId: null };
}

/** Miras en: atanın eni; yoksa gelen belge TOP satırının eni (ata zinciriyle tek çözücü); o da yoksa null. */
export async function inheritedChildWidth(rollId: string, parentWidth: Prisma.Decimal | null): Promise<Prisma.Decimal | null> {
  if (parentWidth != null) return parentWidth;
  const w = (await resolveDeliveryNoteLinesForRolls([rollId])).get(rollId)?.widthCm ?? null;
  return w != null ? new Prisma.Decimal(w) : null;
}

export interface TamburChildWidth {
  width: Prisma.Decimal | null;
  /** Ölçülen en izi (`widthBefore` = miras en korunur); ölçüm yoksa null. */
  trace: { widthBefore: number | null; widthAfter: number } | null;
}

/** Ölçülen en verilmişse sınır denetimi + iz; yoksa miras en. tx DIŞINDA. */
export async function resolveTamburChildWidth(inherited: Prisma.Decimal | null, measuredWidthCm: number | null | undefined): Promise<TamburChildWidth> {
  if (measuredWidthCm == null) return { width: inherited, trace: null };
  const widthBefore = inherited != null ? Number(inherited) : null;
  const { toleranceCm } = await effectiveTamburPlanWidthGate();
  const after = Math.round(measuredWidthCm * 1000) / 1000;
  const { maxCm } = measuredWidthLimit(widthBefore, toleranceCm);
  if (!(after > 0) || (maxCm != null && after > maxCm)) {
    throw AppError.badRequest(
      maxCm == null ? "Ölçülen en sıfırdan büyük olmalı" : `Ölçülen en 0'dan büyük ve en fazla ${maxCm} cm olmalı (miras en ${widthBefore} cm + eşik ${toleranceCm} cm)`,
      { code: "WIDTH_OUT_OF_RANGE", widthBefore, toleranceCm },
    );
  }
  return { width: new Prisma.Decimal(after.toFixed(3)), trace: { widthBefore, widthAfter: after } };
}
