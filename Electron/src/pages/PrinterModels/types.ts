/**
 * Yazıcı modeli kataloğu — termal yazıcı tanımları (Argox OS 214 plus vb.).
 * MachineHardware buna referans tutar → yazıcı değişse de tanımlar kalıcı.
 */
export type PrinterLanguage = "RASTER_HTML" | "PPLA" | "PPLB" | "ZPL";

export interface PrinterModel {
  id: string;
  code: string;
  name: string;
  manufacturer: string | null;
  dpi: number;
  maxWidthMm: number;
  language: PrinterLanguage;
  isActive: boolean;
  defaultProfileId: string | null;
  defaultProfile?: { id: string; code: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}
