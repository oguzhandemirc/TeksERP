// =============================================================================
// ÇOKLU ETİKET SETİ YAZICISI — global set + müşteri seti (2026-11-11)
// =============================================================================
// Set = sıralı şablon listesi + yıldızlı varsayılan. Varsayılanın evi DEĞİŞMEZ: global → `LabelContextDefault`,
// müşteri → `CustomerTemplateRoute`; set satırları yalnız seçenektir. PUT tek tx'te replace eder (yapılandırma
// pivotu → izinli hard delete) + varsayılanı yazar; tx'in İLK ifadesi set başına advisory kilit. İlk sürüm yalnız
// top etiketleri (ROLL_RAW · ROLL_FINISHED); çuval/kartela fail-closed yolu bu işe girmez.
// =============================================================================
import type { LabelKind, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { assertTemplateAssignable, rethrowDefaultConflict, writeContextDefaultTx } from "./label-template.service";

/**
 * Etiket seti advisory kilit uzayı (2 argümanlı form) — envanter `helpers/period-guard.helper.ts` başlığı.
 * Anahtar `hashtext('global:<kind>')` · `hashtext('customer:<id>')`; tx başına TEK kilit.
 */
export const LABEL_OPTIONS_LOCK_NS: number = 8047;

// Literal (enum deref değil): modül üst kapsamında Prisma enum okumak döngülü yüklemede TDZ verir.
export const LABEL_OPTION_KINDS: readonly LabelKind[] = ["ROLL_RAW", "ROLL_FINISHED"];
export const LABEL_OPTION_MAX = 20;

export interface LabelOptionItem {
  templateId: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  /** Pasif şablon sette kalabilir (K5); seçicide süzülür, panelde rozetle görünür. */
  active: boolean;
}

export interface LabelOptionSetView {
  kind: LabelKind;
  defaultTemplateId: string | null;
  items: LabelOptionItem[];
}

export interface CustomerLabelOptionSetView extends LabelOptionSetView {
  customerId: string;
  showGlobalTemplates: boolean;
  /** Herkes için set (salt-okunur önizleme). */
  globalItems: LabelOptionItem[];
}

export interface LabelOptionSetInput {
  kind: LabelKind;
  templateIds: string[];
  defaultTemplateId: string | null;
}

type TemplateRef = { id: string; name: string; isActive: boolean; deletedAt: Date | null };
const TEMPLATE_REF = { select: { id: true, name: true, isActive: true, deletedAt: true } } as const;

/** Varsayılan sette satırı olmasa da listenin başında `isDefault:true` ile döner. */
function buildItems(rows: Array<{ sortOrder: number; template: TemplateRef }>, def: TemplateRef | null): LabelOptionItem[] {
  const active = (t: TemplateRef) => t.isActive && t.deletedAt == null;
  const items: LabelOptionItem[] = [];
  if (def && !rows.some((r) => r.template.id === def.id)) {
    items.push({ templateId: def.id, name: def.name, sortOrder: -1, isDefault: true, active: active(def) });
  }
  for (const r of rows) {
    items.push({ templateId: r.template.id, name: r.template.name, sortOrder: r.sortOrder, isDefault: r.template.id === def?.id, active: active(r.template) });
  }
  return items;
}

const ORDER = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }];

function assertKind(kind: LabelKind): void {
  if (!LABEL_OPTION_KINDS.includes(kind)) {
    throw AppError.badRequest("Etiket seti yalnız ham ve bitmiş top etiketi için tanımlanır.", { code: "LABEL_OPTION_KIND_UNSUPPORTED" });
  }
}

/**
 * Girdi doğrulaması (tx DIŞINDA): tekrarsız, ≤20, varsayılan sette ya da null; YENİ eklenen her şablon aktif +
 * atanabilir (`assertTemplateAssignable`), sette zaten duran pasif şablon kalabilir (K5), silinmiş şablon asla.
 */
async function validateSet(input: LabelOptionSetInput, existingIds: Set<string>): Promise<Map<string, { kind: LabelKind | null; name: string }>> {
  assertKind(input.kind);
  if (new Set(input.templateIds).size !== input.templateIds.length) {
    throw AppError.badRequest("Aynı şablon sette iki kez olamaz.", { code: "LABEL_OPTION_DUPLICATE" });
  }
  if (input.templateIds.length > LABEL_OPTION_MAX) {
    throw AppError.badRequest(`Bir sette en çok ${LABEL_OPTION_MAX} şablon olabilir.`, { code: "LABEL_OPTION_TOO_MANY" });
  }
  if (input.defaultTemplateId && !input.templateIds.includes(input.defaultTemplateId)) {
    throw AppError.badRequest("Varsayılan şablon setin içinde olmalı.", { code: "LABEL_DEFAULT_NOT_IN_SET" });
  }
  const rows = await prisma.labelTemplate.findMany({
    where: { id: { in: input.templateIds } },
    select: { id: true, name: true, kind: true, isActive: true, deletedAt: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of input.templateIds) {
    const t = byId.get(id);
    const mustBeActive = !existingIds.has(id) || id === input.defaultTemplateId;
    if (!t || t.deletedAt != null || (mustBeActive && !t.isActive)) {
      throw AppError.badRequest("Şablon bulunamadı, silinmiş ya da pasif.", { code: "LABEL_TEMPLATE_NOT_USABLE", templateId: id });
    }
    if (!existingIds.has(id) || id === input.defaultTemplateId) await assertTemplateAssignable(id, input.kind);
  }
  return new Map(rows.map((r) => [r.id, { kind: r.kind, name: r.name }]));
}

async function lockSetTx(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LABEL_OPTIONS_LOCK_NS}::int, hashtext(${key}))`;
}

export class LabelTemplateOptionService {
  async getGlobal(kind: LabelKind): Promise<ApiResponse<LabelOptionSetView>> {
    assertKind(kind);
    return { success: true, data: await this.globalView(kind) };
  }

  private async globalView(kind: LabelKind): Promise<LabelOptionSetView> {
    const rows = await prisma.labelTemplateGlobalOption.findMany({ where: { kind }, select: { sortOrder: true, template: TEMPLATE_REF }, orderBy: ORDER });
    const def = await prisma.labelContextDefault.findUnique({ where: { kind }, select: { template: TEMPLATE_REF } });
    return { kind, defaultTemplateId: def?.template.id ?? null, items: buildItems(rows, def?.template ?? null) };
  }

  async setGlobal(input: LabelOptionSetInput, userId?: string): Promise<ApiResponse<LabelOptionSetView>> {
    const before = await this.globalView(input.kind);
    const existing = new Set(before.items.map((i) => i.templateId));
    const meta = await validateSet(input, existing);
    const def = input.defaultTemplateId ? { id: input.defaultTemplateId, kind: meta.get(input.defaultTemplateId)?.kind ?? null } : null;
    await prisma
      .$transaction(async (tx) => {
        await lockSetTx(tx, `global:${input.kind}`);
        await tx.labelTemplateGlobalOption.deleteMany({ where: { kind: input.kind } });
        await tx.labelTemplateGlobalOption.createMany({
          data: input.templateIds.map((templateId, i) => ({ kind: input.kind, templateId, sortOrder: i, createdById: userId ?? null, updatedById: userId ?? null })),
        });
        await writeContextDefaultTx(tx, input.kind, def);
      })
      .catch(rethrowDefaultConflict);
    const after = await this.globalView(input.kind);
    await AuditService.log({
      userId, action: "UPDATE", tableName: "LABEL_TEMPLATE_GLOBAL_OPTION", recordId: input.kind,
      oldData: { kind: input.kind, defaultTemplateId: before.defaultTemplateId, templateIds: before.items.map((i) => i.templateId) },
      newData: { kind: input.kind, defaultTemplateId: after.defaultTemplateId, templateIds: input.templateIds, event: "SET_GLOBAL_LABEL_OPTIONS" },
    }).catch(() => undefined);
    return { success: true, data: after, message: "Etiket seti kaydedildi" };
  }

  async getCustomer(customerId: string, kind: LabelKind): Promise<ApiResponse<CustomerLabelOptionSetView>> {
    assertKind(kind);
    return { success: true, data: await this.customerView(customerId, kind) };
  }

  private async customerView(customerId: string, kind: LabelKind): Promise<CustomerLabelOptionSetView> {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, labelShowGlobalTemplates: true } });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");
    const rows = await prisma.customerLabelTemplateOption.findMany({ where: { customerId, kind }, select: { sortOrder: true, template: TEMPLATE_REF }, orderBy: ORDER });
    const route = await prisma.customerTemplateRoute.findUnique({ where: { customerId_kind: { customerId, kind } }, select: { template: TEMPLATE_REF } });
    const global = await this.globalView(kind);
    return {
      kind,
      customerId,
      defaultTemplateId: route?.template.id ?? null,
      items: buildItems(rows, route?.template ?? null),
      showGlobalTemplates: customer.labelShowGlobalTemplates,
      globalItems: global.items,
    };
  }

  async setCustomer(customerId: string, input: LabelOptionSetInput & { showGlobalTemplates?: boolean }, userId?: string): Promise<ApiResponse<CustomerLabelOptionSetView>> {
    assertKind(input.kind);
    const before = await this.customerView(customerId, input.kind);
    await validateSet(input, new Set(before.items.map((i) => i.templateId)));
    const { kind, defaultTemplateId } = input;
    await prisma.$transaction(async (tx) => {
      await lockSetTx(tx, `customer:${customerId}`);
      await tx.customerLabelTemplateOption.deleteMany({ where: { customerId, kind } });
      await tx.customerLabelTemplateOption.createMany({
        data: input.templateIds.map((templateId, i) => ({ customerId, kind, templateId, sortOrder: i, createdById: userId ?? null, updatedById: userId ?? null })),
      });
      if (defaultTemplateId) {
        await tx.customerTemplateRoute.upsert({
          where: { customerId_kind: { customerId, kind } },
          update: { templateId: defaultTemplateId },
          create: { customerId, kind, templateId: defaultTemplateId },
        });
      } else {
        await tx.customerTemplateRoute.deleteMany({ where: { customerId, kind } });
      }
      if (input.showGlobalTemplates !== undefined && input.showGlobalTemplates !== before.showGlobalTemplates) {
        await tx.customer.update({ where: { id: customerId }, data: { labelShowGlobalTemplates: input.showGlobalTemplates } });
      }
    });
    const after = await this.customerView(customerId, kind);
    await AuditService.log({
      userId, action: "UPDATE", tableName: "CUSTOMER_LABEL_TEMPLATE_OPTION", recordId: customerId,
      oldData: { kind, defaultTemplateId: before.defaultTemplateId, templateIds: before.items.map((i) => i.templateId), labelShowGlobalTemplates: before.showGlobalTemplates },
      newData: { kind, defaultTemplateId: after.defaultTemplateId, templateIds: input.templateIds, labelShowGlobalTemplates: after.showGlobalTemplates, event: "SET_CUSTOMER_LABEL_OPTIONS" },
    }).catch(() => undefined);
    return { success: true, data: after, message: "Müşteri etiket seti kaydedildi" };
  }
}
