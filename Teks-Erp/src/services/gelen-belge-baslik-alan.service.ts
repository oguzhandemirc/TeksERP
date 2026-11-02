// =============================================================================
// GELEN BELGE — başlık PATCH'inin parti no + kurşun metresi alanları (Gülkesim B; tasarım §2.3)
// =============================================================================
// Yaratma gövdesinde YOKTUR: okuma katmanı doldurur, operatör PATCH'le düzeltir/onaylar. Kolon çifti (metre ↔ kaynak)
// DB CHECK `customer_delivery_notes_kursun_source_ck` ile birlikte dolu/boş yazılır.
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { text } from "./gelen-belge-line.service";
import { MANUAL_BATCH_NO_KEY } from "./gelen-belge-sablon.service";
import type { DeliveryNoteHeaderInput } from "./gelen-belge-note.service";

/** Başlık PATCH'inin ek alanları (Gülkesim B; yaratma gövdesinde YOK — okuma katmanı doldurur, operatör düzeltir). */
export interface DeliveryNoteHeaderPatch extends DeliveryNoteHeaderInput {
  ourBatchNo?: string | null;
  /** Seçilen adayın şablon alan anahtarı; verilmezse elle yazılmış sayılır (`MANUAL`). */
  ourBatchNoKey?: string | null;
  /** > 0 → kaynak MANUAL + gözden geçirildi; null temizler. */
  kursunMeters?: number | null;
  /** Mevcut değeri olduğu gibi onaylar → MANUAL + gözden geçirildi. */
  kursunMetersReviewed?: true;
}

/**
 * Parti no + kurşun metresi PATCH kolonları (tasarım §2.3): operatörün yazdığı/onayladığı metre MANUAL kaynaklı ve gözden geçirilmiş
 * sayılır; parti no anahtarsızsa MANUAL (hatırlanmaz). Kolon çifti (metre ↔ kaynak) DB CHECK'iyle birlikte dolu/boş.
 */
export function batchAndMeterColumns(patch: DeliveryNoteHeaderPatch, current: { kursunMeters: Prisma.Decimal | null }): Prisma.CustomerDeliveryNoteUncheckedUpdateManyInput {
  const out: Prisma.CustomerDeliveryNoteUncheckedUpdateManyInput = {};
  if (patch.ourBatchNoKey !== undefined && patch.ourBatchNo === undefined) {
    throw AppError.badRequest("Parti no anahtarı parti no'yla birlikte gönderilir.", { code: "DELIVERY_NOTE_BATCH_NO_KEY_WITHOUT_VALUE" });
  }
  if (patch.ourBatchNo !== undefined) {
    const v = text(patch.ourBatchNo);
    out.ourBatchNo = v;
    out.ourBatchNoKey = v === null ? null : (patch.ourBatchNoKey ?? MANUAL_BATCH_NO_KEY);
  }
  if (patch.kursunMeters !== undefined) {
    out.kursunMeters = patch.kursunMeters === null ? null : new Prisma.Decimal(patch.kursunMeters);
    out.kursunMetersSource = patch.kursunMeters === null ? null : "MANUAL";
    out.kursunMetersReview = false;
  } else if (patch.kursunMetersReviewed) {
    if (current.kursunMeters === null) throw AppError.badRequest("Onaylanacak kurşun metresi yok; önce metreyi girin.", { code: "KURSUN_METERS_REQUIRED" });
    out.kursunMetersSource = "MANUAL";
    out.kursunMetersReview = false;
  }
  return out;
}
