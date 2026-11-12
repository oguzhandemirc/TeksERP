// =============================================================================
// TeksERP — Makine gövdesindeki PLANLAMA alanlarının açık doğrulaması (Seyitoğlu temel, 2026-11-11)
// =============================================================================
// `planRpm` · `planEfficiencyPct` · `maxWorkingWidthCm` BaseController'da BİLEREK yazılabilir
// (DMMF allowlist); aralık burada, DB CHECK `machines_plan_*` ikinci hat. `null` temizler.
// Ondalıklar metin olarak geçirilir — Decimal kolona JS float yazılmaz.
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

/** Sayı ya da sayı metni → sonlu sayı; boş metin null (panel boş alanı). */
const numeric = (label: string) =>
  z.union([z.number(), z.string().trim()], { message: `${label} sayı olmalı` }).nullable().transform((v, ctx) => {
    if (v === null || v === "") return null;
    const n = typeof v === "number" ? v : Number(v.replace(",", "."));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: `${label} sayı olmalı` });
      return z.NEVER;
    }
    return n;
  });

/** En çok 2 ondalık (Decimal(…,2)); metin olarak döner. */
const decimal2 = (label: string, max: number, maxMsg: string) =>
  numeric(label).superRefine((n, ctx) => {
    if (n === null) return;
    if (n <= 0) ctx.addIssue({ code: "custom", message: `${label} sıfırdan büyük olmalı` });
    else if (n > max) ctx.addIssue({ code: "custom", message: maxMsg });
    else if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) {
      ctx.addIssue({ code: "custom", message: `${label} en çok 2 ondalık basamak taşır` });
    }
  }).transform((n) => (n === null ? null : n.toFixed(2)));

export const machinePlanFields = z
  .object({
    planRpm: numeric("Plan devri")
      .superRefine((n, ctx) => {
        if (n === null) return;
        if (!Number.isInteger(n)) ctx.addIssue({ code: "custom", message: "Plan devri tam sayı olmalı (devir/dk)" });
        else if (n <= 0) ctx.addIssue({ code: "custom", message: "Plan devri sıfırdan büyük olmalı" });
        else if (n > 5000) ctx.addIssue({ code: "custom", message: "Plan devri en çok 5000 devir/dk olabilir" });
      })
      .optional(),
    planEfficiencyPct: decimal2("Plan randımanı", 100, "Plan randımanı en çok %100 olabilir").optional(),
    maxWorkingWidthCm: decimal2("Azami çalışma eni", 9999.99, "Azami çalışma eni en çok 9999,99 cm olabilir").optional(),
  })
  .passthrough();

export function validateMachinePlanFields(req: Request, _res: Response, next: NextFunction): void {
  try {
    if (req.body && typeof req.body === "object") req.body = machinePlanFields.parse(req.body);
    next();
  } catch (e) {
    next(e);
  }
}
