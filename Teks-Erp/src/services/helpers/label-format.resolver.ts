// =============================================================================
// Etiket format çözümü — baskı anında hangi fiziksel geometri + yazıcı dili?
// =============================================================================
// Öncelik zinciri:
//   1. explicit profileId (query/body)
//   2. machineId → MachineHardware.formatProfile → printerModel.defaultProfile
//      (yazıcı dili = printerModel.language)
//   3. sistem default profili (code="DEFAULT", yoksa en eski aktif)
//   4. KOD FALLBACK (DB boş) → DEFAULT_LABEL_FORMAT + RASTER_HTML
//
// Mobil: `req.device.machineId` (device.middleware) → istasyon yazıcısı OTO çözülür.
// Electron: device yok → sistem default (adım 3).
// =============================================================================

import { PrinterLanguage } from "@prisma/client";
import prisma from "../../lib/prisma";
import { DEFAULT_LABEL_FORMAT, type LabelFormatGeometry } from "./label-html.helper";

export type FormatResolveSource = "explicit" | "machine" | "system-default" | "code-fallback";

export interface ResolvedLabelFormat extends Required<LabelFormatGeometry> {
  dpi: number;
  language: PrinterLanguage;
  /** Çözülen profil id (kod fallback'te null). */
  profileId: string | null;
  source: FormatResolveSource;
}

interface ProfileRow {
  id: string;
  widthMm: unknown;
  heightMm: unknown;
  marginMm: unknown;
  dpi: number;
  orientation: "PORTRAIT" | "LANDSCAPE";
  isActive: boolean;
}

function fromProfile(
  p: ProfileRow,
  language: PrinterLanguage,
  source: FormatResolveSource,
): ResolvedLabelFormat {
  return {
    widthMm: Number(p.widthMm),
    heightMm: Number(p.heightMm),
    marginMm: Number(p.marginMm),
    orientation: p.orientation,
    dpi: p.dpi,
    language,
    profileId: p.id,
    source,
  };
}

export async function resolveLabelFormat(opts?: {
  profileId?: string | null;
  machineId?: string | null;
}): Promise<ResolvedLabelFormat> {
  let language: PrinterLanguage = PrinterLanguage.RASTER_HTML;

  // 1. explicit profileId
  if (opts?.profileId) {
    const p = await prisma.labelFormatProfile.findUnique({ where: { id: opts.profileId } });
    if (p?.isActive) {
      // machineId de verildiyse dili modelden al (geometri explicit, dil makineden)
      if (opts.machineId) {
        const hw = await prisma.machineHardware.findUnique({
          where: { machineId: opts.machineId },
          select: { printerModel: { select: { language: true } } },
        });
        if (hw?.printerModel) language = hw.printerModel.language;
      }
      return fromProfile(p, language, "explicit");
    }
  }

  // 2. machineId → donanım → format profili + yazıcı dili
  if (opts?.machineId) {
    const hw = await prisma.machineHardware.findUnique({
      where: { machineId: opts.machineId },
      include: { formatProfile: true, printerModel: { include: { defaultProfile: true } } },
    });
    if (hw?.printerModel) language = hw.printerModel.language;
    const p =
      (hw?.formatProfile?.isActive ? hw.formatProfile : null) ??
      (hw?.printerModel?.defaultProfile?.isActive ? hw.printerModel.defaultProfile : null);
    if (p) return fromProfile(p, language, "machine");
  }

  // 3. sistem default profili (code="DEFAULT" tercihli, yoksa en eski aktif)
  const sys =
    (await prisma.labelFormatProfile.findFirst({ where: { code: "DEFAULT", isActive: true } })) ??
    (await prisma.labelFormatProfile.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    }));
  if (sys) return fromProfile(sys, language, "system-default");

  // 4. KOD FALLBACK — DB'de hiç profil yok
  return {
    ...DEFAULT_LABEL_FORMAT,
    dpi: 203,
    language,
    profileId: null,
    source: "code-fallback",
  };
}
