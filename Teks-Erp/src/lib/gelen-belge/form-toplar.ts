// Gelen belge → İE formu kip alanları (Zod): çok parti `mode` + "Toplar ayrı geldi" `rollMode`/`rolls`. Route dosyası
// satır tavanında olduğundan şekil burada; servis aynı tipleri kullanır (gövde ↔ servis tek tanım).
import { z } from "zod";

export const FORM_ROLLS_MAX = 200;

export const formModeFieldShape = {
  mode: z.enum(["SINGLE", "PER_PARTY"], "Seçenek SINGLE ya da PER_PARTY olmalı").optional(),
  // SEPARATE + rolls → tek İE, her top ayrı top (kurşun metresi = topların toplamı); yoksa tek parça (bugünkü).
  rollMode: z.enum(["SINGLE", "SEPARATE"], "Top seçeneği SINGLE ya da SEPARATE olmalı").optional(),
  rolls: z.array(z.strictObject({
    meters: z.number().positive("Top metresi sıfırdan büyük olmalı").max(1_000_000),
    weightKg: z.number().positive("Top kilosu sıfırdan büyük olmalı").max(1_000_000).nullable().optional(),
    senderRollNo: z.string().trim().max(64, "En çok 64 karakter").nullable().optional(),
  }), "Geçersiz top listesi").min(1, "En az bir top gerekir").max(FORM_ROLLS_MAX, `En çok ${FORM_ROLLS_MAX} top`).optional(),
};

export type FormRollMode = "SINGLE" | "SEPARATE";
export interface FormRollInput { meters: number; weightKg?: number | null; senderRollNo?: string | null }
