import { z } from "zod";

/** Sayı/tarih alanları formda METİN taşır (boş bırakılabilsin diye); gönderimde
 *  `buildPayload` çevirir. XOR (fasonda ⇔ fasoncu dolu) burada da ölçülür — backend
 *  ikinci hattır (400 + DB CHECK), ama hata alanın YANINDA görünmeli. */
export const weavingOrderFormSchema = z
  .object({
    itemId: z.string().min(1, "Kumaş seçilmeli"),
    colorId: z.string().optional().or(z.literal("")),
    warpSpecId: z.string().optional().or(z.literal("")),
    plannedM: z
      .string()
      .trim()
      .refine((v) => v === "" || Number(v) > 0, "Hedef metre sıfırdan büyük olmalı")
      .optional()
      .or(z.literal("")),
    executionKind: z.enum(["IN_HOUSE", "SUBCONTRACTED"]),
    subcontractorId: z.string().optional().or(z.literal("")),
    plannedStartDate: z.string().optional().or(z.literal("")),
    plannedEndDate: z.string().optional().or(z.literal("")),
    notes: z.string().max(500, "Not en fazla 500 karakter olabilir").optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    if (v.executionKind === "SUBCONTRACTED" && !v.subcontractorId) {
      ctx.addIssue({ code: "custom", path: ["subcontractorId"], message: "Fasonda dokunan iş için fasoncu seçilmeli" });
    }
    if (v.executionKind === "IN_HOUSE" && v.subcontractorId) {
      ctx.addIssue({ code: "custom", path: ["subcontractorId"], message: "Kendi tezgahında dokunan işe fasoncu yazılmaz" });
    }
    if (v.plannedStartDate && v.plannedEndDate && v.plannedEndDate < v.plannedStartDate) {
      ctx.addIssue({ code: "custom", path: ["plannedEndDate"], message: "Bitiş, başlangıçtan önce olamaz" });
    }
  });

export type WeavingOrderFormValues = z.infer<typeof weavingOrderFormSchema>;

export const weavingOrderFormDefaults: WeavingOrderFormValues = {
  itemId: "",
  colorId: "",
  warpSpecId: "",
  plannedM: "",
  executionKind: "IN_HOUSE",
  subcontractorId: "",
  plannedStartDate: "",
  plannedEndDate: "",
  notes: "",
};
