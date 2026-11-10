// =============================================================================
// ÇOKLU ETİKET SETİ — "bu etikete hangi şablonlar seçilebilir" TEK cevabı (2026-11-11)
// =============================================================================
// Liste = DEFAULT (şu an basılacak olan; `resolveLabelRouting` zincirinin kendisi, ikinci varsayılan hesabı YOK)
//   ∪ MÜŞTERİ seti (`CustomerLabelTemplateOption`) ∪ GLOBAL set (`LabelTemplateGlobalOption`, müşteri
//   `labelShowGlobalTemplates` kapalıysa düşer); tekrarsız, ilk geçen kazanır. Set boşken liste = [DEFAULT] → bugünkü
//   davranış bayt-aynı. Stok/müşterisiz bağlamda müşteri halkası sorgulanmaz (iş emrinden müşteri TAHMİN EDİLMEZ).
// Seçenek tablolarına okuma/yazma yalnız bu dosya + `label-template-option.service.ts` (+ şablon kalıcı silmede
// `label-template.service.ts` yalnız deleteMany) — bekçi `test_label_template_options`.
// =============================================================================
import type { LabelKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { resolveLabelRouting } from "./label-routing.resolver";
import { USABLE_TEMPLATE_SELECT, boundKeysOf, foreignKeys, usableForRoll } from "./label-template-usable.helper";

export type LabelTemplateOptionSource = "DEFAULT" | "CUSTOMER" | "GLOBAL";

export interface LabelTemplateOption {
  id: string;
  name: string;
  source: LabelTemplateOptionSource;
  isDefault: boolean;
}

export interface LabelTemplateOptionsOpts {
  kind: LabelKind;
  customerId?: string | null;
  consigneeId?: string | null;
  deviceId?: string | null;
  machineId?: string | null;
  peripheralId?: string | null;
}

export interface LabelTemplateOptions {
  defaultTemplateId: string | null;
  options: LabelTemplateOption[];
}

/** Set satırları (sıra: sortOrder, createdAt, id — belirlenimli). */
const OPTION_ORDER = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }];
const OPTION_TEMPLATE_SELECT = { template: { select: { id: true, name: true, ...USABLE_TEMPLATE_SELECT } } } as const;

/** Müşteri global seti görüyor mu — müşterisiz bağlamda daima evet. */
async function showsGlobal(customerId: string | null | undefined): Promise<boolean> {
  if (!customerId) return true;
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { labelShowGlobalTemplates: true } });
  return c?.labelShowGlobalTemplates ?? true;
}

export async function resolveLabelTemplateOptions(opts: LabelTemplateOptionsOpts): Promise<LabelTemplateOptions> {
  const routing = await resolveLabelRouting({ ...opts, templateId: undefined });
  const def = routing.template;
  const options: LabelTemplateOption[] = [];
  const seen = new Set<string>();
  if (def) {
    options.push({ id: def.id, name: def.name, source: "DEFAULT", isDefault: true });
    seen.add(def.id);
  }

  const customerRows = opts.customerId
    ? await prisma.customerLabelTemplateOption.findMany({
        where: { customerId: opts.customerId, kind: opts.kind },
        select: OPTION_TEMPLATE_SELECT,
        orderBy: OPTION_ORDER,
      })
    : [];
  const globalRows = (await showsGlobal(opts.customerId))
    ? await prisma.labelTemplateGlobalOption.findMany({
        where: { kind: opts.kind },
        select: OPTION_TEMPLATE_SELECT,
        orderBy: OPTION_ORDER,
      })
    : [];

  const foreign = foreignKeys();
  const tagged: Array<{ source: LabelTemplateOptionSource; rows: typeof customerRows }> = [
    { source: "CUSTOMER", rows: customerRows },
    { source: "GLOBAL", rows: globalRows },
  ];
  for (const { source, rows } of tagged) {
    for (const { template: t } of rows) {
      if (seen.has(t.id)) continue;
      if (!usableForRoll(t, boundKeysOf(t), opts.kind, foreign)) continue;
      seen.add(t.id);
      options.push({ id: t.id, name: t.name, source, isDefault: false });
    }
  }
  return { defaultTemplateId: def?.id ?? null, options };
}

/** Seçilen şablon bu bağlamda teklif ediliyor mu (istemcinin seçimini doğrulayan TEK yüklem). */
export function isOfferedTemplate(r: { options: LabelTemplateOption[] }, templateId: string): boolean {
  return r.options.some((o) => o.id === templateId);
}

/** Şablon herhangi bir sette duruyor mu — `templateHasAssignments` (atanmış şablon statik kaydedilemez). */
export async function templateInOptionSets(templateId: string): Promise<boolean> {
  if ((await prisma.labelTemplateGlobalOption.count({ where: { templateId } })) > 0) return true;
  return (await prisma.customerLabelTemplateOption.count({ where: { templateId } })) > 0;
}
