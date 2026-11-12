// =============================================================================
// TAMBUR CANLI ETİKET ÖNİZLEMESİ — kesimde doğacak çocuğun etiketi, taslak değerlerle (2026-11-10)
// =============================================================================
// Önizleme şablonun HTML render'ıdır, yazıcı dilinden bağımsız. Tablette WebView/SVG paketi yok → HTML
// metni yerine aynı render'ın ÇİZİLEBİLİR elemanları döner: konum (mm) + BASILACAK METİN. Metin baskıyla aynı fonksiyonlardan (`prepareElements` +
// `elementText`, akış şablonunda `templateTextLinesKeyed`); payload `getRollLabel` zinciri, şablon
// preview-fields ile aynı karar (`resolveLabelRouting`, emanette sahip). Hiçbir şey YAZMAZ.
// Çocuğun barkodu kesimde doğar → barkod elemanı yer tutucu (`value: null`). Şablonun birim ayarı
// (sistem/hane/ondalık ayırıcı) basımla AYNI kapıdan (`payloadWithTemplateUnits`); yoksa tablet "54,7", basım "54.7".
// =============================================================================
import prisma from "../../lib/prisma";
import type { LabelPayload } from "../../types/label.types";
import { AppError } from "../../utils/app-error";
import { LabelService } from "../label.service";
import { resolveLabelRouting } from "../helpers/label-routing.resolver";
import { isOfferedTemplate, resolveLabelTemplateOptions } from "../helpers/label-template-options.helper";
import { rollLabelKindOf, stageForProductionExit } from "../helpers/roll-stage.helper";
import { readCanvasLayout } from "../../config/label-elements";
import { templateTextLinesKeyed } from "../helpers/native-label.shared";
import { payloadWithTemplateUnits } from "../../config/label-units";
import { inheritedChildWidth } from "../helpers/tambur-child-label.helper";
import { applyTamburDraft, composeCanvasElements, sourceWidthOf, type TamburLabelDraft, type TamburLabelPreview } from "./label-preview-compose";

export type { TamburLabelDraft, TamburLabelPreview, TamburPreviewElement } from "./label-preview-compose";

const labels = new LabelService();

export async function getTamburLabelPreview(args: {
  rollId: string;
  orderLineId?: string | null;
  customerId?: string | null;
  consigneeId?: string | null;
  /** Operatörün seçtiği şablon (çoklu etiket seti); teklif dışıysa 400 `LABEL_TEMPLATE_NOT_OFFERED`. */
  templateId?: string | null;
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
  // Topta en yoksa kesimde çocuğa geçecek miras en (gelen belge beyanı, `inheritedChildWidth`) — ipucu ve önizleme kesimle aynı.
  if (sourceWidthOf(base.data) == null) {
    const inherited = await inheritedChildWidth(args.rollId, null);
    if (inherited != null) base.data.widthCm = Number(inherited);
  }
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
  const ctx = {
    kind,
    customerId: payload.customerId ?? customerId,
    consigneeId: payload.consigneeId ?? null,
    deviceId: args.deviceId ?? null,
    machineId: args.machineId ?? null,
  };
  // Teklif kesim yollarıyla aynı bağlamdan; seçim explicit halkadan basılır (kesimde çocuğa yazılacak olan).
  const offer = await resolveLabelTemplateOptions(ctx);
  if (args.templateId && !isOfferedTemplate(offer, args.templateId)) {
    throw AppError.badRequest("Seçilen etiket şablonu bu kesim için atanmış şablonlardan biri değil.", { code: "LABEL_TEMPLATE_NOT_OFFERED" });
  }
  const routing = await resolveLabelRouting({ ...ctx, templateId: args.templateId ?? undefined });
  const options = { templateOptions: offer.options, defaultTemplateId: offer.defaultTemplateId };
  return composePreview(routing, payload, { kind, sourceWidthCm, ...options });
}

/** Seçilen şablonun çizilebilir hâli — kanvas varyantında konumlu elemanlar, akışta sıralı satırlar. */
function composePreview(
  routing: Awaited<ReturnType<typeof resolveLabelRouting>>,
  payload: LabelPayload,
  head: Pick<TamburLabelPreview, "kind" | "sourceWidthCm" | "templateOptions" | "defaultTemplateId">,
): TamburLabelPreview {
  const { kind, sourceWidthCm, ...options } = head;
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
      elements: composeCanvasElements(layout.elements, payloadWithTemplateUnits(payload, t), {
        // Önizleme yazıcı dilinden BAĞIMSIZ: HTML render'ının eleman kümesi (kullanıcı kararı 2026-11-10).
        language: "RASTER_HTML",
        heightMm,
        dpi: routing.format.dpi,
      }),
      rows: null,
      ...options,
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
    rows: templateTextLinesKeyed(payloadWithTemplateUnits(payload, t), t).map((r) => ({ key: r.key, text: r.text, size: r.size, bold: r.bold })),
    ...options,
  };
}
