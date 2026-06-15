import { z } from "zod";

export const printerModelFormSchema = z.object({
  code: z.string().trim().min(1, "Kod gerekli").max(48),
  name: z.string().trim().min(1, "Ad gerekli").max(100),
  manufacturer: z.string().trim().max(64).optional().default(""),
  dpi: z.coerce.number().int().min(50).max(1200),
  maxWidthMm: z.coerce.number().int().min(10, "Max genişlik 10mm+").max(2000),
  language: z.enum(["RASTER_HTML", "PPLA", "PPLB", "ZPL"]),
  defaultProfileId: z.string().optional().default(""),
  isActive: z.boolean(),
});

export type PrinterModelFormValues = z.infer<typeof printerModelFormSchema>;

const nn = (v: string) => (v.trim() ? v.trim() : null);
export function buildPrinterModelPayload(v: PrinterModelFormValues) {
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    manufacturer: nn(v.manufacturer),
    dpi: v.dpi,
    maxWidthMm: v.maxWidthMm,
    language: v.language,
    defaultProfileId: nn(v.defaultProfileId),
    isActive: v.isActive,
  };
}

export const printerModelFormDefaults: PrinterModelFormValues = {
  code: "",
  name: "",
  manufacturer: "",
  dpi: 203,
  maxWidthMm: 104,
  language: "PPLA",
  defaultProfileId: "",
  isActive: true,
};
