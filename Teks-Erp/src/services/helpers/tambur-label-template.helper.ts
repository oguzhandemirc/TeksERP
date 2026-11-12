// =============================================================================
// Tambur kesiminde seçilen etiket şablonu → çocuğun `labelTemplateId/Kind`i (çoklu etiket, 2026-11-11)
// =============================================================================
// Beş kesim/bitirme yolunun TEK boğazı, tx'ten ÖNCE çağrılır. Seçim yoksa sorgu da yok (bayt-aynı). Teklif dışı id
// 400 `LABEL_TEMPLATE_NOT_OFFERED` — sessizce varsayılana düşmek operatörün gördüğü önizlemeyle basılanı ayırırdı.
// Varsayılan seçildiyse null yazılır (varsayılan sonradan değişince top da uyar). Seçim yalnız bu kesimin çocuğuna
// yazılır; çocuktan toruna MİRAS GEÇMEZ (kesim yolları ebeveynin kolonunu okumaz).
// =============================================================================
import type { LabelKind } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { isOfferedTemplate, resolveLabelTemplateOptions } from "./label-template-options.helper";

export interface TamburLabelTemplateChoice {
  labelTemplateId: string | null;
  labelTemplateKind: LabelKind | null;
}

const NONE: TamburLabelTemplateChoice = { labelTemplateId: null, labelTemplateKind: null };

export async function resolveTamburLabelTemplate(args: {
  labelTemplateId?: string | null;
  /** Çocuğun etiket bağlamı (doğacağı aşamadan). */
  kind: LabelKind;
  /** Çocuğun etiket müşterisi (niyetten; emanette sahip) — önizlemeyle aynı. */
  customerId: string | null;
  consigneeId: string | null;
  deviceId?: string | null;
  machineId?: string | null;
}): Promise<TamburLabelTemplateChoice> {
  if (!args.labelTemplateId) return NONE;
  const offer = await resolveLabelTemplateOptions({
    kind: args.kind,
    customerId: args.customerId,
    consigneeId: args.consigneeId,
    deviceId: args.deviceId ?? null,
    machineId: args.machineId ?? null,
  });
  if (!isOfferedTemplate(offer, args.labelTemplateId)) {
    throw AppError.badRequest("Seçilen etiket şablonu bu kesim için atanmış şablonlardan biri değil.", {
      code: "LABEL_TEMPLATE_NOT_OFFERED",
    });
  }
  if (args.labelTemplateId === offer.defaultTemplateId) return NONE;
  return { labelTemplateId: args.labelTemplateId, labelTemplateKind: args.kind };
}
