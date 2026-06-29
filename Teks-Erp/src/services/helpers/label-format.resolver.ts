// =============================================================================
// Etiket format çözümü — baskı anında hangi fiziksel geometri + yazıcı dili?
// =============================================================================
// Öncelik zinciri:
//   1. explicit profileId (query/body)
//   2. machineId → makineye-bağlı LABEL_PRINTER PeripheralDevice.formatProfile →
//      printerModel.defaultProfile (yazıcı dili = printerModel.language)
//   3. sistem default profili (code="DEFAULT", yoksa en eski aktif)
//   4. KOD FALLBACK (DB boş) → DEFAULT_LABEL_FORMAT + RASTER_HTML
//
// Mobil: `req.device.machineId` (device.middleware) → istasyon yazıcısı OTO çözülür.
// Electron: device yok → sistem default (adım 3).
// =============================================================================

import { PrinterLanguage } from "@prisma/client";
import prisma from "../../lib/prisma";
import { readPrinterLanguage } from "../system-setting.service";
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

/**
 * Makineye-SABİT aktif LABEL_PRINTER cihazını (model+default profil+format profili)
 * döner. Hem format hem routing resolver'ın "istasyon yazıcısı" kaynağı —
 * `MachineHardware` emekliye ayrıldı, yazıcı tek kaynağı PeripheralDevice.
 */
export async function loadMachinePrinter(machineId: string) {
  return prisma.peripheralDevice.findFirst({
    where: { machineId, kind: "LABEL_PRINTER", isActive: true },
    include: { formatProfile: true, printerModel: { include: { defaultProfile: true } } },
    orderBy: { createdAt: "desc" },
  });
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
  // Yazıcı dili: bir istasyon yazıcı MODELİ çözülürse onunki (örn Argox=PPLA),
  // yoksa global ayar `label.printerLanguage` (default PPLA). Model dili önceliklidir.
  let modelLanguage: PrinterLanguage | null = null;
  let profile: ProfileRow | null = null;
  let source: FormatResolveSource = "code-fallback";

  // 1. explicit profileId (geometri)
  if (opts?.profileId) {
    const p = await prisma.labelFormatProfile.findUnique({ where: { id: opts.profileId } });
    if (p?.isActive) {
      profile = p;
      source = "explicit";
    }
  }

  // 2. machineId → makineye-bağlı yazıcı cihazı → (geometri yoksa profil) + yazıcı dili
  if (opts?.machineId) {
    const printer = await loadMachinePrinter(opts.machineId);
    if (printer?.printerModel) modelLanguage = printer.printerModel.language;
    if (!profile) {
      const p =
        (printer?.formatProfile?.isActive ? printer.formatProfile : null) ??
        (printer?.printerModel?.defaultProfile?.isActive ? printer.printerModel.defaultProfile : null);
      if (p) {
        profile = p;
        source = "machine";
      }
    }
  }

  // 3. sistem default profili (code="DEFAULT" tercihli, yoksa en eski aktif)
  if (!profile) {
    const sys =
      (await prisma.labelFormatProfile.findFirst({ where: { code: "DEFAULT", isActive: true } })) ??
      (await prisma.labelFormatProfile.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
      }));
    if (sys) {
      profile = sys;
      source = "system-default";
    }
  }

  // Etkin dil — model dili (varsa) ?? global ayar (default PPLA). `??` model yolunda
  // ayar okumasını kısa-devre yapar (mobil baskıda ekstra sorgu yok).
  const language = modelLanguage ?? (await readPrinterLanguage());

  // 4. KOD FALLBACK — DB'de hiç profil yok
  if (!profile) {
    return { ...DEFAULT_LABEL_FORMAT, dpi: 203, language, profileId: null, source: "code-fallback" };
  }
  return fromProfile(profile, language, source);
}
