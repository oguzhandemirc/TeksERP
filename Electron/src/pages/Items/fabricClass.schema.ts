// K7/K8 ürün formu alanları: kumaş türü, yanmazlık, kompozisyon düzeltmesi, iplik lif bileşimi.
import { z } from "zod";
import type { FlameRetardancy } from "./types";

export const FLAME_OPTIONS: Array<{ value: FlameRetardancy; label: string }> = [
  { value: "NONE", label: "Yok" },
  { value: "FR_YARN", label: "FR (yanmaz iplik)" },
  { value: "TREVIRA_CS", label: "Trevira CS" },
  { value: "OTHER_FR", label: "Diğer FR" },
];

/** Pay metni → sayı (virgül kabul); geçersizse NaN. */
export const pctNumber = (s: string): number => Number(s.trim().replace(",", "."));

/** Lif paylarının toplamı (geçersiz satır 0 sayılır) — gösterge ve doğrulama aynı hesap. */
export const fiberTotal = (rows: Array<{ pct: string }>): number =>
  Math.round(rows.reduce((s, r) => s + (Number.isFinite(pctNumber(r.pct)) ? pctNumber(r.pct) : 0), 0) * 100) / 100;

const fiberRow = z.object({
  fiberTypeId: z.string().min(1, "Lif seçin"),
  pct: z
    .string()
    .trim()
    .refine((v) => /^\d+([.,]\d{1,2})?$/.test(v), "Pay sayı olmalı (en fazla 2 ondalık)")
    .refine((v) => pctNumber(v) > 0 && pctNumber(v) <= 100, "Pay 0'dan büyük, en fazla 100 olmalı"),
});

export const fabricClassFields = {
  composition: z.string().trim().max(200, "Kompozisyon en fazla 200 karakter olabilir"),
  fabricTypeId: z.string(),
  flameRetardancy: z.union([z.literal(""), z.enum(["NONE", "FR_YARN", "TREVIRA_CS", "OTHER_FR"])]),
  fibers: z
    .array(fiberRow)
    .refine((rows) => rows.length === 0 || fiberTotal(rows) === 100, "Lif payları toplamı tam 100 olmalı")
    .refine((rows) => new Set(rows.map((r) => r.fiberTypeId)).size === rows.length, "Aynı lif iki kez seçilmiş"),
};

export const fabricClassDefaults = {
  composition: "",
  fabricTypeId: "",
  flameRetardancy: "" as const,
  fibers: [] as Array<{ fiberTypeId: string; pct: string }>,
};
