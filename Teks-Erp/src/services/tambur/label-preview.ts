// =============================================================================
// TAMBUR CANLI ETİKET ÖNİZLEMESİ — kesimde doğacak çocuğun etiketi, taslak değerlerle (2026-11-10)
// =============================================================================
// Önizleme şablonun HTML render'ıdır, yazıcı dilinden bağımsız. Tablette WebView/SVG paketi yok → HTML
// metni yerine aynı render'ın ÇİZİLEBİLİR elemanları döner: konum (mm) + BASILACAK METİN. Metin baskıyla aynı fonksiyonlardan (`prepareElements` +
// `elementText`, akış şablonunda `templateTextLinesKeyed`); payload `getRollLabel` zinciri, şablon
// preview-fields ile aynı karar (`resolveLabelRouting`, emanette sahip). Hiçbir şey YAZMAZ.
// Çocuğun barkodu kesimde doğar → barkod elemanı yer tutucu (`value: null`).
// =============================================================================
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { LabelService } from "../label.service";
import { resolveLabelRouting } from "../helpers/label-routing.resolver";
import { rollLabelKindOf, stageForProductionExit } from "../helpers/roll-stage.helper";
import { readCanvasLayout } from "../../config/label-elements";
import { templateTextLinesKeyed } from "../helpers/native-label.shared";
import { applyTamburDraft, composeCanvasElements, sourceWidthOf, type TamburLabelDraft, type TamburLabelPreview } from "./label-preview-compose";

export type { TamburLabelDraft, TamburLabelPreview, TamburPreviewElement } from "./label-preview-compose";

const labels = new LabelService();

export async function getTamburLabelPreview(args: {
  rollId: string;
  orderLineId?: string | null;
  customerId?: string | null;
  consigneeId?: string | null;
  draft: TamburLabelDraft;
  deviceId?: string | null;
  machineId?: string | null;
}): Promise<TamburLabelPreview> {
  const roll = await prisma.roll.findUnique({
    where: { id: args.rollId },
    select: { stage: true, ownerCustomerId: true, currentStep: { select: { outputStage: true } } },
  });
  if (!roll) throw AppError.notFound("Top bulunamadı");
  const kind = rollLabelKindOf(roll.currentStep ? stageForProductionExit(roll.currentStep.outputStage) : roll.stage);
  // Emanet topta etiket müşterisi sahiptir (sahip kilidi) — kesim yolları ve preview-fields ile aynı.
  const customerId = roll.ownerCustomerId ?? args.customerId ?? null;
  const orderLineId = args.orderLineId ?? null;
  const base = await labels.getRollLabel(args.rollId, {
    orderLineId,
    customerId: orderLineId ? null : customerId,
    stock: !orderLineId && !customerId,
    allowMissingBarcode: true,
    // Ad/renk/parti kaydetme ile AYNI birleştiriciden; çocuğa ana topun kolonları MİRAS geçmez (null = kaynağa dön).
    labelEdit: {
      fields: {
        itemName: args.draft.labelItemName ?? null,
        colorName: args.draft.labelColorName ?? null,
        labelBatchNo: args.draft.labelBatchNo ?? null,
      },
    },
  });
  const sourceWidthCm = sourceWidthOf(base.data);
  const payload = applyTamburDraft(base.data, args.draft);
  if (args.consigneeId && roll.ownerCustomerId) {
    const c = await prisma.customerConsignee.findFirst({
      where: { id: args.consigneeId, customerId: roll.ownerCustomerId },
      select: { id: true, name: true },
    });
    if (c) {
      payload.consigneeName = c.name;
      payload.consigneeId = c.id;
    }
  }
  const routing = await resolveLabelRouting({
    kind,
    customerId: payload.customerId ?? customerId,
    consigneeId: payload.consigneeId ?? null,
    deviceId: args.deviceId ?? null,
    machineId: args.machineId ?? null,
  });
  const t = routing.template;
  const layout = routing.variant ? readCanvasLayout(routing.variant.elements) : null;
  if (routing.variant && layout) {
    const widthMm = Number(routing.variant.widthMm);
    const heightMm = Number(routing.variant.heightMm);
    return {
      kind,
      templateId: t?.id ?? null,
      templateName: t?.name ?? null,
      widthMm,
      heightMm,
      sourceWidthCm,
      elements: composeCanvasElements(layout.elements, payload, {
        // Önizleme yazıcı dilinden BAĞIMSIZ: HTML render'ının eleman kümesi (kullanıcı kararı 2026-11-10).
        language: "RASTER_HTML",
        heightMm,
        dpi: routing.format.dpi,
      }),
      rows: null,
    };
  }
  return {
    kind,
    templateId: t?.id ?? null,
    templateName: t?.name ?? null,
    widthMm: Number(routing.format.widthMm) || 100,
    heightMm: Number(routing.format.heightMm) || 60,
    sourceWidthCm,
    elements: null,
    rows: templateTextLinesKeyed(payload, t).map((r) => ({ key: r.key, text: r.text, size: r.size, bold: r.bold })),
  };
}
