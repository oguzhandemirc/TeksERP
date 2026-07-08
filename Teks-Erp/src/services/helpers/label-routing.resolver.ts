// =============================================================================
// Etiket yönlendirme çözümü — baskı anında cihaz → {format, template, dil}
// =============================================================================
// `resolveLabelFormat` (geometri+dil) üstüne PeripheralDevice cihaz kaydı + şablon
// yönlendirmesini katar. Cihaz seçimi: explicit peripheralId > tablete-bağlı
// (deviceId) LABEL_PRINTER > makineye-bağlı (machineId) LABEL_PRINTER.
//
// Öncelikler:
//   dil    : peripheral.languageOverride > format.language (global ayar)
//   format : cihaz medyası (peripheral.labelWidthMm vd.) > sistem varsayılan medyası
//   şablon : explicit templateId > peripheral.templateRoutes[kind] > kind default (isDefault) > null
//
// Cihaz eşleşmezse: tümüyle bugünkü davranış (resolveLabelFormat + kind default
// şablon) — BAYT-stabil geri uyum.
// =============================================================================

import { LabelKind, PrinterLanguage, type LabelTemplate, type LabelTemplateVariant } from "@prisma/client";
import prisma from "../../lib/prisma";
import { resolveLabelFormat, formatFromPeripheralOrDefault, type ResolvedLabelFormat } from "./label-format.resolver";
import { pickVariant, type VariantMatch } from "./label-variant.resolver";

/** Şablon + boyut varyantları — routing include'larıyla birlikte yüklenir. */
export type TemplateWithVariants = LabelTemplate & { variants: LabelTemplateVariant[] };

export interface LabelRouting {
  format: ResolvedLabelFormat;
  template: LabelTemplate | null;
  /** Medyaya (format) uyan boyut varyantı — null → akış-modeli (dual-mode). */
  variant: LabelTemplateVariant | null;
  /** exact = boyut eşleşti; fallback = primary varyant basılıyor (uyumsuz medya). */
  variantMatch: VariantMatch;
  language: PrinterLanguage;
  /** Çözülen cihaz id (yoksa null) — native gönderim hedefi için. */
  peripheralId: string | null;
  /** F179: native gönderim hedef adresi (IP/host) — çözülen cihazdan taşınır. */
  peripheralAddress: string | null;
  /** F179: hedef port (null → çağıran 9100 varsayar). */
  peripheralPort: number | null;
}

export interface LabelRoutingOpts {
  kind: LabelKind;
  peripheralId?: string | null;
  templateId?: string | null;
  machineId?: string | null;
  deviceId?: string | null;
  /** Baskı bağlamının müşterisi (EXPLICIT-ONLY çözülmüş payload.customerId) —
   *  doluysa CustomerTemplateRoute halkası devreye girer. Stok/müşterisiz baskıda
   *  null → halka hiç sorgulanmaz (WO tahmini YASAK kuralı korunur). */
  customerId?: string | null;
}

const PERIPHERAL_INCLUDE = (kind: LabelKind) => ({
  templateRoutes: {
    where: { kind },
    include: { template: { include: { variants: true } } },
    take: 1,
  },
});

/** Bağlam (kind) varsayılan şablonu — tek doğru kaynak LabelContextDefault.
 *  Pasif/kalıcı-silinmiş şablona işaret ediyorsa null (katalog default'una düşülür). */
export async function findContextDefaultTemplate(kind: LabelKind): Promise<TemplateWithVariants | null> {
  const def = await prisma.labelContextDefault.findUnique({
    where: { kind },
    include: { template: { include: { variants: true } } },
  });
  if (!def) return null;
  return def.template.isActive && def.template.deletedAt == null ? def.template : null;
}

export async function resolveLabelRouting(opts: LabelRoutingOpts): Promise<LabelRouting> {
  const { kind } = opts;

  // --- 1. Cihaz seçimi: explicit > tablet-owned > machine-attached (hepsi LABEL_PRINTER, aktif) ---
  // Explicit seçimde pasif cihaz bilerek kabul edilir (kullanıcı elle seçmiş);
  // KALICI silinmiş (deletedAt dolu) ise asla çözülmez.
  let peripheral = opts.peripheralId
    ? await prisma.peripheralDevice.findFirst({
        where: { id: opts.peripheralId, deletedAt: null },
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

  // --- 2. Geometri: cihazın MEDYASI (labelWidthMm vd.) > sistem varsayılan medyası ---
  const format = peripheral
    ? await formatFromPeripheralOrDefault(peripheral, PrinterLanguage.RASTER_HTML)
    : await resolveLabelFormat({ machineId: opts.machineId ?? null, kind });

  // --- 3. Dil: cihaz override > format.language (global ayar) ---
  const language = peripheral?.languageOverride ?? format.language;

  // --- 4. Şablon: explicit > MÜŞTERİ route[customerId,kind] > cihaz route[kind]
  //         > bağlam default > null.
  //     Müşteri > cihaz doğru sıradır: cihazın fiziksel kısıtları (dil, geometri)
  //     şablondan bağımsız çözülür (yukarıda); müşteri şablonu yalnız İÇERİK
  //     düzenini değiştirir. ---
  let template: TemplateWithVariants | null = null;
  if (opts.templateId) {
    // KALICI silinmiş şablon explicit istense bile çözülmez.
    template = await prisma.labelTemplate.findFirst({
      where: { id: opts.templateId, deletedAt: null },
      include: { variants: true },
    });
  }
  if (!template && opts.customerId) {
    const route = await prisma.customerTemplateRoute.findUnique({
      where: { customerId_kind: { customerId: opts.customerId, kind } },
      include: { template: { include: { variants: true } } },
    });
    if (route && route.template.isActive && route.template.deletedAt == null) {
      template = route.template;
    }
  }
  if (!template && peripheral?.templateRoutes?.length) {
    template = peripheral.templateRoutes[0].template as TemplateWithVariants;
  }
  if (!template) {
    // Tek doğru kaynak: LabelContextDefault (eski kind-başına isDefault'un yeni evi).
    template = await findContextDefaultTemplate(kind);
  }

  // --- 5. Varyant: medya (format) boyutuna ±1mm eşleşen; yoksa primary (fallback);
  //         şablon varyantsızsa null → akış-modeli (dual-mode, bayt-stabil). ---
  const picked = pickVariant(template?.variants, {
    widthMm: format.widthMm,
    heightMm: format.heightMm,
  });

  return {
    format: { ...format, language },
    template,
    variant: picked.variant,
    variantMatch: picked.match,
    language,
    peripheralId: peripheral?.id ?? null,
    peripheralAddress: peripheral?.address ?? null,
    peripheralPort: peripheral?.port ?? null,
  };
}
