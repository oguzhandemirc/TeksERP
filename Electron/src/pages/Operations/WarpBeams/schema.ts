import { z } from "zod";

/** Plan formu METİN taşır; köken XOR'u burada da ölçülür (backend ikinci hat: 400 + DB CHECK). */
export const warpBeamPlanSchema = z
  .object({
    warpSpecId: z.string().min(1, "Çözgü kartı seçilmeli"),
    plannedLengthM: z.string().trim().refine((v) => Number(v) > 0, "Plan metresi sıfırdan büyük olmalı"),
    originKind: z.enum(["IN_HOUSE", "SUBCONTRACT", "PURCHASED", "CONSIGNED"]),
    subcontractorId: z.string().optional().or(z.literal("")),
    supplierId: z.string().optional().or(z.literal("")),
    /** G3 emanet: sahip müşteri — CONSIGNED'da zorunlu; yalnız yeni planda gönderilir (düzenlemede PATCH almaz). */
    ownerCustomerId: z.string().optional().or(z.literal("")),
    physicalBeamNo: z.string().max(32, "En fazla 32 karakter").optional().or(z.literal("")),
    notes: z.string().max(500, "Not en fazla 500 karakter olabilir").optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    const sub = !!v.subcontractorId;
    const sup = !!v.supplierId;
    if (v.originKind === "IN_HOUSE" && (sub || sup)) ctx.addIssue({ code: "custom", path: ["subcontractorId"], message: "İçeride sarılan levente karşı taraf yazılmaz" });
    if (v.originKind === "SUBCONTRACT" && !sub) ctx.addIssue({ code: "custom", path: ["subcontractorId"], message: "Fasona sardırılan levent için fasoncu seçilmeli" });
    if (v.originKind === "SUBCONTRACT" && sup) ctx.addIssue({ code: "custom", path: ["supplierId"], message: "Fasona sardırılan levente tedarikçi yazılmaz" });
    if (v.originKind === "PURCHASED" && sub === sup) ctx.addIssue({ code: "custom", path: ["supplierId"], message: "Hazır alınan levent için TAM BİR taraf: tedarikçi YA DA fasoncu" });
    if (v.originKind === "CONSIGNED" && !v.ownerCustomerId) ctx.addIssue({ code: "custom", path: ["ownerCustomerId"], message: "Emanet levent için sahibi olan müşteri seçilmeli" });
    if (v.originKind === "CONSIGNED" && (sub || sup)) ctx.addIssue({ code: "custom", path: ["subcontractorId"], message: "Emanet levente fasoncu/tedarikçi yazılmaz — taraf malın sahibidir" });
  });

export type WarpBeamPlanValues = z.infer<typeof warpBeamPlanSchema>;

export const warpBeamPlanDefaults: WarpBeamPlanValues = {
  warpSpecId: "",
  plannedLengthM: "",
  originKind: "IN_HOUSE",
  subcontractorId: "",
  supplierId: "",
  ownerCustomerId: "",
  physicalBeamNo: "",
  notes: "",
};
