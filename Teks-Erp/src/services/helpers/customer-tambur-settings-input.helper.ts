// =============================================================================
// TeksERP - Müşteri kartı tambur/etiket ayarı girdi normalizasyonu (Gülkesim S5)
// =============================================================================
// customer.service dosya tavanı için ayrıldı; create + update aynı boğazdan geçer.

import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { LABEL_WIDTH_SOURCES } from "./label-width-source.helper";

/**
 * Tambur/etiket müşteri ayarları (Gülkesim S5): en kaynağı INCOMING|MEASURED|null (null = bugünkü
 * güncel en), bölme ölçüsü 0 < m ≤ 100000 ya da null, tartım zorunlu boolean. Bozuk değer 400 TR.
 */
export function normalizeTamburLabelSettings(data: Record<string, unknown>): void {
  if ("labelWidthSource" in data) {
    const v = data.labelWidthSource;
    if (v == null || v === "") data.labelWidthSource = null;
    else if (typeof v !== "string" || !(LABEL_WIDTH_SOURCES as readonly string[]).includes(v)) {
      throw AppError.badRequest(`Geçersiz etiket en kaynağı: ${String(v)} (INCOMING veya MEASURED).`, {
        code: "CUSTOMER_LABEL_SETTING_INVALID",
      });
    }
  }
  if ("tamburSplitLengthM" in data) {
    const v = data.tamburSplitLengthM;
    if (v == null || v === "") data.tamburSplitLengthM = null;
    else {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
      if (!Number.isFinite(n) || n <= 0 || n > 100000) {
        throw AppError.badRequest("Bölme ölçüsü 0'dan büyük ve en çok 100000 m olmalı.", {
          code: "CUSTOMER_LABEL_SETTING_INVALID",
        });
      }
      data.tamburSplitLengthM = new Prisma.Decimal(n.toFixed(2));
    }
  }
  if ("tamburWeighRequired" in data && typeof data.tamburWeighRequired !== "boolean") {
    throw AppError.badRequest("Tamburda tartım ayarı açık/kapalı olmalı.", { code: "CUSTOMER_LABEL_SETTING_INVALID" });
  }
  if ("tamburLabelBatchEnabled" in data && typeof data.tamburLabelBatchEnabled !== "boolean") {
    throw AppError.badRequest("Etikete parti no ayarı açık/kapalı olmalı.", { code: "CUSTOMER_LABEL_SETTING_INVALID" });
  }
}
