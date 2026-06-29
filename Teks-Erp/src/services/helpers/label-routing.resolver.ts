// =============================================================================
// Etiket yönlendirme çözümü — baskı anında cihaz → {format, template, dil}
// =============================================================================
// `resolveLabelFormat` (geometri+dil) üstüne PeripheralDevice cihaz kaydı + şablon
// yönlendirmesini katar. Cihaz seçimi: explicit peripheralId > tablete-bağlı
// (deviceId) LABEL_PRINTER > makineye-bağlı (machineId) LABEL_PRINTER.
//
// Öncelikler:
//   dil    : peripheral.languageOverride > peripheral.printerModel.language > format.language (model/global)
//   format : explicit profileId > peripheral.formatProfile/model.defaultProfile > resolveLabelFormat zinciri
//   şablon : explicit templateId > peripheral.templateRoutes[kind] > kind default (isDefault) > null
//
// Cihaz eşleşmezse: tümüyle bugünkü davranış (resolveLabelFormat + kind default
// şablon) — BAYT-stabil geri uyum.
// =============================================================================

import { LabelKind, PrinterLanguage, type LabelTemplate } from "@prisma/client";
import prisma from "../../lib/prisma";
import { resolveLabelFormat, type ResolvedLabelFormat } from "./label-format.resolver";

export interface LabelRouting {
  format: ResolvedLabelFormat;
  template: LabelTemplate | null;
  language: PrinterLanguage;
  /** Çözülen cihaz id (yoksa null) — native gönderim hedefi için. */
  peripheralId: string | null;
}

export interface LabelRoutingOpts {
  kind: LabelKind;
  peripheralId?: string | null;
  profileId?: string | null;
  templateId?: string | null;
  machineId?: string | null;
  deviceId?: string | null;
}

const PERIPHERAL_INCLUDE = (kind: LabelKind) => ({
  printerModel: { include: { defaultProfile: true } },
  formatProfile: true,
  templateRoutes: { where: { kind }, include: { template: true }, take: 1 },
});

export async function resolveLabelRouting(opts: LabelRoutingOpts): Promise<LabelRouting> {
  const { kind } = opts;

  // --- 1. Cihaz seçimi: explicit > tablet-owned > machine-attached (hepsi LABEL_PRINTER, aktif) ---
  let peripheral = opts.peripheralId
    ? await prisma.peripheralDevice.findUnique({
        where: { id: opts.peripheralId },
        include: PERIPHERAL_INCLUDE(kind),
      })
    : null;
  if (!peripheral && opts.deviceId) {
    peripheral = await prisma.peripheralDevice.findFirst({
      where: { deviceId: opts.deviceId, kind: "LABEL_PRINTER", isActive: true },
      include: PERIPHERAL_INCLUDE(kind),
      orderBy: { createdAt: "desc" },
    });
  }
  if (!peripheral && opts.machineId) {
    peripheral = await prisma.peripheralDevice.findFirst({
      where: { machineId: opts.machineId, kind: "LABEL_PRINTER", isActive: true },
      include: PERIPHERAL_INCLUDE(kind),
      orderBy: { createdAt: "desc" },
    });
  }

  // --- 2. Geometri: explicit profileId > cihazın profili/model-default > resolveLabelFormat zinciri ---
  const peripheralProfileId =
    (peripheral?.formatProfile?.isActive ? peripheral.formatProfileId : null) ??
    (peripheral?.printerModel?.defaultProfile?.isActive ? peripheral.printerModel.defaultProfileId : null);
  const format = await resolveLabelFormat({
    profileId: opts.profileId ?? peripheralProfileId ?? null,
    machineId: opts.machineId ?? null,
  });

  // --- 3. Dil: cihaz override > cihaz modeli > format.language (machineHardware model/global) ---
  const language =
    peripheral?.languageOverride ?? peripheral?.printerModel?.language ?? format.language;

  // --- 4. Şablon: explicit > cihaz route[kind] > kind default > null ---
  let template: LabelTemplate | null = null;
  if (opts.templateId) {
    template = await prisma.labelTemplate.findUnique({ where: { id: opts.templateId } });
  }
  if (!template && peripheral?.templateRoutes?.length) {
    template = peripheral.templateRoutes[0].template;
  }
  if (!template) {
    template = await prisma.labelTemplate.findFirst({
      where: { kind, isDefault: true, isActive: true },
    });
  }

  return {
    format: { ...format, language },
    template,
    language,
    peripheralId: peripheral?.id ?? null,
  };
}
