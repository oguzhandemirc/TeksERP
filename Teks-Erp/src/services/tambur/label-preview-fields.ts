// =============================================================================
// TAMBUR ETİKET ÖNİZLEME ALANLARI — kesimde doğacak çocuğun şablonunda hangi alanlar var (2026-11-10)
// =============================================================================
// Tablet "Etikette" kartı yalnız basılacak alanları gösterir (ör. şablonda `weightKg` yoksa kg kutusu
// çizilmez). Şablon baskıyla AYNI zincirden çözülür (`resolveLabelRouting`: alıcı > müşteri > cihaz >
// bağlam); kind çocuğun doğacağı aşamadan (`rollLabelKindOf`). Kanvas varyantında bağlı `field`
// elemanları, akış şablonunda görünür alanlar; barkod/QR/tarih atılır. Şablon yoksa `fields: null`.
// =============================================================================
import type { LabelKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { findFieldDef, type TemplateField } from "../../config/label-fields";
import { resolveLabelRouting } from "../helpers/label-routing.resolver";
import { rollLabelKindOf, stageForProductionExit } from "../helpers/roll-stage.helper";

export interface TamburLabelPreviewFields {
  kind: LabelKind;
  templateId: string | null;
  templateName: string | null;
  fields: Array<{ key: string; label: string }> | null;
}

const NON_TEXT_TYPES = new Set(["barcode", "qr", "date"]);

function canvasFieldBinds(elements: unknown): Array<{ key: string; label: string | null }> | null {
  const list = (elements as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(list)) return null;
  return list
    .filter((e): e is { type: string; bind: string; label?: unknown } => !!e && (e as { type?: unknown }).type === "field" && typeof (e as { bind?: unknown }).bind === "string")
    .map((e) => ({ key: e.bind, label: typeof e.label === "string" && e.label.trim() ? e.label.trim() : null }));
}

export async function getTamburLabelPreviewFields(args: {
  rollId: string;
  customerId?: string | null;
  consigneeId?: string | null;
  deviceId?: string | null;
  machineId?: string | null;
}): Promise<TamburLabelPreviewFields> {
  const roll = await prisma.roll.findUnique({
    where: { id: args.rollId },
    select: { stage: true, ownerCustomerId: true, currentStep: { select: { outputStage: true } } },
  });
  if (!roll) throw AppError.notFound("Top bulunamadı");
  const kind = rollLabelKindOf(roll.currentStep ? stageForProductionExit(roll.currentStep.outputStage) : roll.stage);
  const routing = await resolveLabelRouting({
    kind,
    // Emanet topta etiket müşterisi sahiptir (sahip kilidi) — kesim yollarıyla aynı karar.
    customerId: roll.ownerCustomerId ?? args.customerId ?? null,
    consigneeId: args.consigneeId ?? null,
    deviceId: args.deviceId ?? null,
    machineId: args.machineId ?? null,
  });
  const t = routing.template;
  if (!t) return { kind, templateId: null, templateName: null, fields: null };
  const raw = routing.variant ? canvasFieldBinds(routing.variant.elements) : null;
  const picked = raw ?? (Array.isArray(t.fields) ? (t.fields as unknown as TemplateField[]) : [])
    .filter((f) => f && f.isVisible)
    .sort((a, b) => a.order - b.order)
    .map((f) => ({ key: f.key, label: f.label?.trim() || null }));
  const seen = new Set<string>();
  const fields: Array<{ key: string; label: string }> = [];
  for (const f of picked) {
    const def = findFieldDef(kind, f.key);
    if (seen.has(f.key) || (def && NON_TEXT_TYPES.has(def.type))) continue;
    seen.add(f.key);
    fields.push({ key: f.key, label: f.label ?? def?.defaultLabel ?? f.key });
  }
  return { kind, templateId: t.id, templateName: t.name, fields };
}
