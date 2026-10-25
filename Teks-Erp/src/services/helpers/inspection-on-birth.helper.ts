// =============================================================================
// KK1 DOĞUŞUNDA MUAYENE KAPISI (K4P-KK1, 2026-10-25)
// =============================================================================
// Muayene topla AYNI tx'te yazılır (`createInspectionTx`, tek yazar); kapı burada TEK yerde.
// Modül kapalı ya da `inspection:write` yoksa top YİNE doğar, muayene yazılmaz ve yanıt uyarı
// taşır: 403 kuyruktan dirilen KK1 kaydını kalıcı düşürürdü (fiziksel top sistemde doğmazdı).
// K4P-KK1b: giriş istasyonunun muayene yeteneği kapalıysa da aynı sınıf (kuyruk kaydı yetenek
// değişince kaybolmasın); 400 yalnız bozuk muayene verisidir (bilinmeyen tür, tekrar, metraj).
// =============================================================================
import { z } from "zod";
import { FourPointSize } from "@prisma/client";
import { matchesPermission } from "../../middlewares/rbac.middleware";

/** `POST /api/rolls/initial-entry` gövdesinin `inspection` alt şeması (metre ≤ metraj üst şemada). */
export const birthInspectionSchema = z.object({
  defects: z
    .array(
      z.object({
        defectTypeId: z.string().uuid("Geçersiz hata türü ID"),
        sizeClass: z.nativeEnum(FourPointSize, { message: "Geçersiz hata boyutu" }).optional().nullable(),
        startMeter: z.number().min(0, "Hata metresi negatif olamaz").optional().nullable(),
      }),
    )
    .max(500, "Bir muayenede en fazla 500 hata girilebilir")
    .default([]),
  inspectedLengthM: z.number().positive("Muayene uzunluğu pozitif olmalı").optional().nullable(),
  note: z.string().max(500, "Muayene notu en fazla 500 karakter").optional().nullable(),
});
export type BirthInspectionInput = z.infer<typeof birthInspectionSchema>;

export type InspectionSkipReason = "MODULE_DISABLED" | "PERMISSION_DENIED" | "STATION_NO_QUALITY";

export type InspectionOnBirthDecision = { write: true } | { write: false; reason: InspectionSkipReason };

/** Kapının TEK kararı: önce modül (kapalı modülde alt kural koşmaz, modul-bayrak §3.6), sonra izin. */
export function resolveInspectionOnBirth(
  user: { permissions?: readonly string[] | null } | null | undefined,
  flags: { kaliteGuvenceEnabled: boolean },
  stationCapable: boolean | null = null,
): InspectionOnBirthDecision {
  if (!flags.kaliteGuvenceEnabled) return { write: false, reason: "MODULE_DISABLED" };
  if (!matchesPermission(user?.permissions ?? [], "inspection:write")) return { write: false, reason: "PERMISSION_DENIED" };
  if (stationCapable === false) return { write: false, reason: "STATION_NO_QUALITY" };
  return { write: true };
}

const SKIP_MESSAGE: Record<InspectionSkipReason, string> = {
  MODULE_DISABLED: "Muayene kaydedilmedi: Kalite Güvence modülü bu kurulumda kapalı. Top kaydedildi.",
  PERMISSION_DENIED: "Muayene kaydedilmedi: muayene girme yetkiniz (inspection:write) yok. Top kaydedildi.",
  STATION_NO_QUALITY: "Muayene kaydedilmedi: bu istasyonda kalite muayenesi kapalı. Top kaydedildi.",
};

export interface InspectionNotSaved {
  code: "INSPECTION_NOT_SAVED";
  reason: InspectionSkipReason;
  message: string;
}

export function inspectionNotSaved(reason: InspectionSkipReason): InspectionNotSaved {
  return { code: "INSPECTION_NOT_SAVED", reason, message: SKIP_MESSAGE[reason] };
}
