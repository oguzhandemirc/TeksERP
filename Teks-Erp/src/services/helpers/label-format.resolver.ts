// =============================================================================
// Etiket format çözümü — baskı anında hangi fiziksel geometri + yazıcı dili?
// =============================================================================
// Öncelik zinciri:
//   1. explicit profileId (query/body)
//   2. machineId → makineye-bağlı LABEL_PRINTER PeripheralDevice.formatProfile
//   3. sistem default profili (top: isRollDefault; sonra code="DEFAULT"; yoksa en eski aktif)
//   4. KOD FALLBACK (DB boş) → DEFAULT_LABEL_FORMAT + RASTER_HTML
//
// Dil bu katmanda HER ZAMAN global ayardır (`label.printerLanguage`); cihaz-özel
// `languageOverride` bir üst katmanda (label-routing.resolver) biner.
//
// Mobil: `req.device.machineId` (device.middleware) → istasyon yazıcısı OTO çözülür.
// Electron: device yok → sistem default (adım 3).
// =============================================================================

import { PrinterLanguage, type LabelKind } from "@prisma/client";
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
  marginTopMm?: unknown;
  marginRightMm?: unknown;
  marginBottomMm?: unknown;
  marginLeftMm?: unknown;
  gapMm?: unknown;
  dpi: number;
  orientation: "PORTRAIT" | "LANDSCAPE";
  isActive: boolean;
}

/**
 * Makineye-SABİT aktif LABEL_PRINTER cihazını (format profiliyle) döner. Hem format
 * hem baskı-hedefi (adres/port) kaynağı — `MachineHardware` emekliye ayrıldı, yazıcı
 * tek kaynağı PeripheralDevice.
 */
export async function loadMachinePrinter(machineId: string) {
  return prisma.peripheralDevice.findFirst({
    where: { machineId, kind: "LABEL_PRINTER", isActive: true },
    include: { formatProfile: true },
    orderBy: { createdAt: "desc" },
  });
}

function fromProfile(
  p: ProfileRow,
  language: PrinterLanguage,
  source: FormatResolveSource,
): ResolvedLabelFormat {
  const base = Number(p.marginMm);
  const side = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : base);
  return {
    widthMm: Number(p.widthMm),
    heightMm: Number(p.heightMm),
    marginMm: base,
    marginTopMm: side(p.marginTopMm),
    marginRightMm: side(p.marginRightMm),
    marginBottomMm: side(p.marginBottomMm),
    marginLeftMm: side(p.marginLeftMm),
    gapMm: p.gapMm != null && Number.isFinite(Number(p.gapMm)) ? Number(p.gapMm) : 2,
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
  /** TOP etiketinde (ROLL_RAW/ROLL_FINISHED) sistem-varsayılan = isRollDefault profili;
   * diğer türlerde (SWATCH) code="DEFAULT". Verilmezse eski davranış (code="DEFAULT"). */
  kind?: LabelKind | null;
}): Promise<ResolvedLabelFormat> {
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

  // 2. machineId → makineye-bağlı yazıcı cihazının kendi format profili.
  //    (Explicit profil çözüldüyse makine sorgusu tamamen atlanır.)
  if (opts?.machineId && !profile) {
    const printer = await loadMachinePrinter(opts.machineId);
    const p = printer?.formatProfile?.isActive ? printer.formatProfile : null;
    if (p) {
      profile = p;
      source = "machine";
    }
  }

  // 3. sistem default profili. TOP etiketinde önce isRollDefault'lu profil; sonra
  //    code="DEFAULT" (kartela/diğerleri burayı kullanır); yoksa en eski aktif.
  if (!profile) {
    // SWATCH (kartela) HARİÇ her şey — kind verilmeyen bulk/önizleme dahil — TOP
    // varsayılanını (isRollDefault) kullanır. Sistem top-merkezli; kartela özel durum.
    // Böylece bulk (kind'sız) ile tekil (kind=ROLL) yolu aynı boyutu çözer.
    const isRoll = opts?.kind !== "SWATCH";
    const sys =
      (isRoll
        ? await prisma.labelFormatProfile.findFirst({ where: { isRollDefault: true, isActive: true } })
        : null) ??
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

  // Etkin dil — bu katmanda HER ZAMAN global ayar (`label.printerLanguage`, default
  // PPLA). Cihaz-özel `languageOverride` bir üst katmanda (label-routing.resolver) biner.
  const language = await readPrinterLanguage();

  // 4. KOD FALLBACK — DB'de hiç profil yok
  if (!profile) {
    return { ...DEFAULT_LABEL_FORMAT, dpi: 203, language, profileId: null, source: "code-fallback" };
  }
  return fromProfile(profile, language, source);
}
