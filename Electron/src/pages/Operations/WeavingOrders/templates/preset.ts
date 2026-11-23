// Özel dokuma şablonu — saf dönüşümler: şablon → dokuma iş emri formu ön-dolgusu · şablon formu ↔ gövde · sıra.
// Şablon yalnız ön-doldurur; boş alan gönderilmez (formun varsayılanı kalır). `max(n)` = backend `@db.VarChar(n)`.
import { z } from "zod";
import { formatMeasure } from "@/lib/format";
import type { WeavingFormPreset } from "@/pages/Operations/WorkOrders/oie/nav";
import { weavingOrderFormDefaults, type WeavingOrderFormValues } from "../schema";
import type { WeavingOrderTemplate } from "./types";

export const templateFormSchema = z
  .object({
    name: z.string().trim().min(1, "Şablon adı zorunlu").max(100, "Şablon adı en fazla 100 karakter olabilir"),
    description: z.string().max(300, "Açıklama en fazla 300 karakter olabilir"),
    itemId: z.string(),
    executionKind: z.enum(["", "IN_HOUSE", "SUBCONTRACTED"]),
    subcontractorId: z.string(),
    plannedM: z.string().trim().refine((v) => v === "" || Number(v.replace(",", ".")) > 0, "Hedef metre sıfırdan büyük olmalı"),
    notes: z.string().max(500, "Not en fazla 500 karakter olabilir"),
    sortOrder: z.string().trim().refine((v) => v === "" || (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 9999), "Sıra 0–9999 arası tam sayı olmalı"),
  })
  .superRefine((v, ctx) => {
    if (v.executionKind === "IN_HOUSE" && v.subcontractorId) {
      ctx.addIssue({ code: "custom", path: ["subcontractorId"], message: "Kendi tezgahında dokunan işe fasoncu yazılmaz" });
    }
  });

export type TemplateFormValues = z.infer<typeof templateFormSchema>;

export const templateFormDefaults: TemplateFormValues = {
  name: "", description: "", itemId: "", executionKind: "", subcontractorId: "", plannedM: "", notes: "", sortOrder: "",
};

export function templateToFormValues(t: WeavingOrderTemplate | null): TemplateFormValues {
  if (!t) return templateFormDefaults;
  return {
    name: t.name,
    description: t.description ?? "",
    itemId: t.itemId ?? "",
    executionKind: t.executionKind ?? "",
    subcontractorId: t.subcontractorId ?? "",
    plannedM: t.plannedM == null ? "" : String(Number(t.plannedM)),
    notes: t.notes ?? "",
    sortOrder: t.sortOrder ? String(t.sortOrder) : "",
  };
}

/** Form → API gövdesi (backend allowlist'iyle birebir alanlar). Fasonda değilse fasoncu gönderilmez. */
export function templatePayload(v: TemplateFormValues): Record<string, unknown> {
  const kind = v.executionKind || null;
  return {
    name: v.name.trim(),
    description: v.description.trim() || null,
    itemId: v.itemId || null,
    executionKind: kind,
    subcontractorId: kind === "IN_HOUSE" ? null : v.subcontractorId || null,
    plannedM: v.plannedM.trim() === "" ? null : Number(v.plannedM.replace(",", ".")),
    notes: v.notes.trim() || null,
    sortOrder: v.sortOrder.trim() === "" ? 0 : Number(v.sortOrder),
  };
}

/** Şablon → dokuma iş emri formu ön-dolgusu (yalnız dolu alanlar). Fasoncu yalnız "fasonda" türüyle taşınır. */
export function templateToPreset(t: WeavingOrderTemplate): WeavingFormPreset {
  const p: WeavingFormPreset = {};
  if (t.itemId) p.itemId = t.itemId;
  if (t.executionKind) p.executionKind = t.executionKind;
  if (t.subcontractorId && t.executionKind !== "IN_HOUSE") {
    p.subcontractorId = t.subcontractorId;
    p.executionKind = "SUBCONTRACTED";
  }
  if (t.plannedM != null && Number(t.plannedM) > 0) p.plannedM = String(Number(t.plannedM));
  if (t.notes) p.notes = t.notes;
  return p;
}

/** Yeni dokuma iş emri formunun açılış değerleri: varsayılan + ön-dolgu (bilinmeyen alan sızmaz). */
export function applyPreset(preset: WeavingFormPreset | null | undefined): WeavingOrderFormValues {
  if (!preset) return weavingOrderFormDefaults;
  const out: WeavingOrderFormValues = { ...weavingOrderFormDefaults };
  if (preset.itemId) out.itemId = preset.itemId;
  if (preset.executionKind) out.executionKind = preset.executionKind;
  if (preset.subcontractorId && out.executionKind === "SUBCONTRACTED") out.subcontractorId = preset.subcontractorId;
  if (preset.plannedM) out.plannedM = preset.plannedM;
  if (preset.notes) out.notes = preset.notes;
  return out;
}

/** Seçicideki sıra: `sortOrder` küçük önce, eşitlikte ad (Türkçe); pasif şablon listelenmez. */
export function orderTemplates(list: readonly WeavingOrderTemplate[]): WeavingOrderTemplate[] {
  return list.filter((t) => t.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"));
}

/** Karo alt satırı: kumaş · kim dokuyor · metre — boşsa açıklama, o da yoksa genel ipucu. */
export function templateHint(t: WeavingOrderTemplate, kindLabel: Record<"IN_HOUSE" | "SUBCONTRACTED", string>): string {
  const parts = [
    t.item?.name,
    t.subcontractor?.name ?? (t.executionKind ? kindLabel[t.executionKind] : undefined),
    t.plannedM != null && Number(t.plannedM) > 0 ? formatMeasure(t.plannedM, "m") : undefined,
  ].filter(Boolean);
  return parts.join(" · ") || t.description || "Ön-dolu dokuma iş emri";
}
