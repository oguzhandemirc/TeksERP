// =============================================================================
// Etiket format çözümü — baskı anında hangi fiziksel geometri + yazıcı dili?
// =============================================================================
// Etiket Stüdyosu v2: MEDYA (etiket ölçüsü) doğrudan YAZICI CİHAZINDA (Peripheral
// Device.labelWidthMm vd.); ayrı "Boyutlar" (LabelFormatProfile) kataloğu EMEKLİ.
// Öncelik zinciri:
//   1. explicit peripheralId → cihazın kendi medyası
//   2. machineId → makineye-bağlı LABEL_PRINTER cihazının medyası
//   3. sistem VARSAYILAN medyası (label.defaultMedia ayarı)
//   4. KOD FALLBACK → 100×148 / 203dpi
// Orientation w/h'den türer (w ≥ h → LANDSCAPE). Paylar (margin) yalnız eski akış
// yolu (kartela/varyantsız) içindir → varsayılan medyanın marginMm'i (kanvas paydan
// bağımsız; boşluğu eleman konumu verir).
//
// Dil bu katmanda SABİT RASTER_HTML; dil YALNIZ cihaz languageOverride'ından
// (label-routing.resolver'da biner). Mobil: req.device.machineId → istasyon
// yazıcısı OTO. Electron: cihaz yok → varsayılan medya.
// =============================================================================

import { PrinterLanguage, type LabelKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { type LabelFormatGeometry } from "./label-html.helper";
import { readDefaultLabelMedia } from "../system-setting.service";

export type FormatResolveSource = "explicit" | "machine" | "system-default" | "code-fallback";

export interface ResolvedLabelFormat extends Required<LabelFormatGeometry> {
  dpi: number;
  language: PrinterLanguage;
  source: FormatResolveSource;
}

/** Cihaz kaydından okunan medya (yazıcıda takılı etiket). */
export interface PrinterMedia {
  labelWidthMm: unknown;
  labelHeightMm: unknown;
  labelDpi: number | null;
  labelGapMm: unknown;
}

/** Cihaz medyasını çözülmüş formata çevir; medya YOKSA (labelWidthMm null) null. */
function fromPeripheralMedia(
  p: PrinterMedia | null | undefined,
  language: PrinterLanguage,
  source: FormatResolveSource,
  marginMm: number,
): ResolvedLabelFormat | null {
  if (!p || p.labelWidthMm == null || p.labelHeightMm == null) return null;
  const widthMm = Number(p.labelWidthMm);
  const heightMm = Number(p.labelHeightMm);
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm)) return null;
  const gapMm = p.labelGapMm != null && Number.isFinite(Number(p.labelGapMm)) ? Number(p.labelGapMm) : 2;
  return {
    widthMm,
    heightMm,
    marginMm,
    marginTopMm: marginMm,
    marginRightMm: marginMm,
    marginBottomMm: marginMm,
    marginLeftMm: marginMm,
    gapMm,
    orientation: widthMm >= heightMm ? "LANDSCAPE" : "PORTRAIT",
    dpi: p.labelDpi ?? 203,
    language,
    source,
  };
}

/**
 * Makineye-SABİT aktif LABEL_PRINTER cihazını döner (medya kolonları dahil). Hem
 * medya hem baskı-hedefi (adres/port) kaynağı — yazıcı tek kaynağı PeripheralDevice.
 */
export async function loadMachinePrinter(machineId: string) {
  return prisma.peripheralDevice.findFirst({
    where: { machineId, kind: "LABEL_PRINTER", isActive: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Sistem varsayılan medyasından çözülmüş format (cihaz yok/medyasız). */
export async function resolveDefaultFormat(language: PrinterLanguage): Promise<ResolvedLabelFormat> {
  const m = await readDefaultLabelMedia();
  return {
    widthMm: m.widthMm,
    heightMm: m.heightMm,
    marginMm: m.marginMm,
    marginTopMm: m.marginMm,
    marginRightMm: m.marginMm,
    marginBottomMm: m.marginMm,
    marginLeftMm: m.marginMm,
    gapMm: m.gapMm,
    orientation: m.widthMm >= m.heightMm ? "LANDSCAPE" : "PORTRAIT",
    dpi: m.dpi,
    language,
    source: "system-default",
  };
}

/** Cihaz medyası (routing'in yüklediği peripheral) → format; yoksa varsayılan. */
export async function formatFromPeripheralOrDefault(
  p: PrinterMedia | null | undefined,
  language: PrinterLanguage,
): Promise<ResolvedLabelFormat> {
  const m = await readDefaultLabelMedia();
  return fromPeripheralMedia(p, language, "explicit", m.marginMm) ?? (await resolveDefaultFormat(language));
}

export async function resolveLabelFormat(opts?: {
  peripheralId?: string | null;
  machineId?: string | null;
  /** DEPRECATED — kind artık medya seçimini etkilemez (tek varsayılan medya). */
  kind?: LabelKind | null;
}): Promise<ResolvedLabelFormat> {
  // Dil bu katmanda SABİT RASTER_HTML; cihaz languageOverride'ı routing'de biner.
  const language: PrinterLanguage = PrinterLanguage.RASTER_HTML;
  const margin = (await readDefaultLabelMedia()).marginMm;

  // 1. explicit peripheralId → cihazın medyası
  if (opts?.peripheralId) {
    const p = await prisma.peripheralDevice.findFirst({
      where: { id: opts.peripheralId, deletedAt: null },
      select: { labelWidthMm: true, labelHeightMm: true, labelDpi: true, labelGapMm: true },
    });
    const f = fromPeripheralMedia(p, language, "explicit", margin);
    if (f) return f;
  }

  // 2. machineId → makineye-bağlı yazıcının medyası
  if (opts?.machineId) {
    const printer = await loadMachinePrinter(opts.machineId);
    const f = fromPeripheralMedia(printer, language, "machine", margin);
    if (f) return f;
  }

  // 3. sistem varsayılan medyası (4. kod fallback readDefaultLabelMedia içinde)
  return resolveDefaultFormat(language);
}
