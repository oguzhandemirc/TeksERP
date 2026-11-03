// =============================================================================
// TeksERP - Etiket şablonu yerleşim Zod şemaları
// =============================================================================
// Controller dosya tavanı (max-lines) için ayrıldı; HTTP kontrat sınırı yine
// label-template.controller.ts'tedir — burada yalnız paylaşılan alan şemaları.

import { z } from "zod";

// Uzman raw-code override (dil→kod). Boş/yok → o dilde otomatik üretim.
export const rawCodeSchema = z
  .object({
    PPLA:        z.string().max(20000).optional(),
    PPLB:        z.string().max(20000).optional(),
    ZPL:         z.string().max(20000).optional(),
    RASTER_HTML: z.string().max(20000).optional(),
  })
  .partial();

// Şablon-başına yerleşim ayarları — null = temizle (varsayılana dön).
export const lineStepMmSchema = z.number().min(0).max(20).nullable().optional();
export const qrScaleSchema = z.number().int().min(2).max(15).nullable().optional();
export const lengthBannerSchema = z.boolean().nullable().optional();
// Birim sistemi (Gülkesim S5) — null = bugünkü metrik biçim.
export const unitSettingsSchema = z
  .object({
    system: z.enum(["METRIC", "US", "BOTH"], { message: "Birim sistemi METRIC, US ya da BOTH olmalı" }),
    decimals: z.number().int().min(0, "Ondalık 0-3 olmalı").max(3, "Ondalık 0-3 olmalı").nullable().optional(),
    decimalSep: z.enum([",", "."], { message: "Ondalık ayırıcı virgül ya da nokta olmalı" }).nullable().optional(),
  })
  .nullable()
  .optional();
