// =============================================================================
// TOP ETİKETİ ELLE DÜZENLEME — tek yazar (panel "Etiketi düzenle")
// =============================================================================
// Kullanıcı bir topun etiketini bir seferlik şablonla ve elle yazdığı alanlarla kaydeder; sonraki
// her basım (panel + tablet) bunu backend çözümünden alır. Yazım atomik claim: durum kilidi
// (sevkli/ölü top) + `labelEditedAt` iyimser sürüm → araya giren yazar 409. Aynı yamanın tekrarı
// (ağ zaman aşımı sonrası) no-op 200'dür. Audit tx DIŞINDA, yalnız ayak izi.
// =============================================================================
import { LabelKind, Prisma, type LabelTemplate } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { LabelService } from "./label.service";
import { readCanvasLayout } from "../config/label-elements";
import {
  ROLL_LABEL_COLUMN_KEYS,
  ROLL_LABEL_EDIT_FIELDS,
  ROLL_LABEL_MEASURED_KEYS,
  isRollLabelColumnKey,
} from "../config/roll-label-edit";
import { effectiveRollLabelEdit, mergeRollLabelEdit, sameRollLabelEdit, type RollLabelEditState } from "./helpers/roll-label-edit.helper";
import { fieldDisplayValue } from "./helpers/label-field-values";
import { getKindExclusiveKeys } from "./helpers/label-context-fit";
import { resolveLabelRouting } from "./helpers/label-routing.resolver";
import { rollLabelKindOf } from "./helpers/roll-stage.helper";
import { LABEL_TEXT_LOCKED_STATUSES, labelTextFixBlock } from "./inventory/label-texts";
import { resolveLabelIntent } from "./helpers/label-intent.helper";
import { resolveTamburConsignee } from "./helpers/tambur-customer-settings.helper";

const labelService = new LabelService();

export interface RollLabelEditField {
  key: string;
  label: string;
  /** Ölçülen değer (metraj/kg/en): ezme yalnız etikette, topun ölçüsü değişmez. */
  measured: boolean;
  /** Topun kendi etiket kolonuna yazılır (kumaş adı / renk / müşteri parti). */
  column: boolean;
  /** Etikette bugün basılan değer (düzenleme dahil). */
  value: string;
  /** Elle yazılmış (kayıtlı ezme ya da dolu etiket kolonu). */
  overridden: boolean;
}

export interface RollLabelEditTemplate {
  id: string;
  name: string;
  /** Şablonun bağladığı alanlar — form bu alanların inputunu gösterir. */
  boundKeys: string[];
}

export interface RollLabelEditView {
  rollId: string;
  barcode: string | null;
  /** Düzenleme engeli (sevkli/ölü top) — doluysa form salt okunur. */
  locked: { code: string; reason: string } | null;
  /** İyimser sürüm belirteci — PUT'ta `expectedEditedAt` olarak geri gönderilir. */
  labelEditedAt: string | null;
  /** Topun bir seferlik şablonu (yoksa null → zincirin şablonu). */
  templateId: string | null;
  /** Bir seferlik şablon olmasaydı basılacak şablon (müşteri/cihaz/bağlam zinciri). */
  chainTemplateId: string | null;
  templates: RollLabelEditTemplate[];
  fields: RollLabelEditField[];
  customerId: string | null;
  customerName: string | null;
  ownerCustomerId: string | null;
  consigneeId: string | null;
}

export interface RollLabelEditInput {
  /** undefined dokunma · null kaldır · id bir seferlik şablon. */
  templateId?: string | null;
  /** Alan yaması (anahtar yok = dokunma · null = kaynağa dön · metin = yaz). */
  fields?: Record<string, string | null>;
  /** Etiket müşterisi (kayıtlı cari): undefined dokunma · {customerId} · {stock:true}. */
  customer?: { customerId: string } | { stock: true };
  /** Etiket alıcısı (kayıtlı): undefined dokunma · null sahibin kendisi · id. */
  consigneeId?: string | null;
  expectedEditedAt?: string | null;
}

/** Kanvas varyantlarının + akış alan listesinin bağladığı anahtarlar (koşullu eleman dahil: inputu gösterilir). */
function boundKeysOf(t: { fields: unknown; variants: { elements: unknown }[] }): Set<string> {
  const keys = new Set<string>();
  for (const v of t.variants) {
    for (const el of readCanvasLayout(v.elements)?.elements ?? []) {
      if (el.type === "field" && typeof el.bind === "string") keys.add(el.bind);
    }
  }
  if (Array.isArray(t.fields)) {
    for (const f of t.fields as Array<{ key?: unknown; isVisible?: unknown }>) {
      if (typeof f.key === "string" && f.isVisible !== false) keys.add(f.key);
    }
  }
  return keys;
}

const FOREIGN_KINDS = [LabelKind.SACK, LabelKind.MACHINE, LabelKind.WARP_BEAM, LabelKind.SWATCH];
const foreignKeys = (): Set<string> => new Set(FOREIGN_KINDS.flatMap((k) => [...getKindExclusiveKeys(k)]));

/** Top etiketine seçilebilir şablon: aktif, silinmemiş, serbest değil, türü uyumlu, başka bağlamın alanını bağlamıyor. */
function usableForRoll(t: Pick<LabelTemplate, "isActive" | "deletedAt" | "standalone" | "kind">, bound: Set<string>, kind: LabelKind, foreign: Set<string>): boolean {
  if (!t.isActive || t.deletedAt != null || t.standalone) return false;
  if (t.kind != null && t.kind !== kind) return false;
  for (const k of bound) if (foreign.has(k)) return false;
  return true;
}

const ROLL_EDIT_SELECT = {
  id: true, barcode: true, status: true, stage: true, ownerCustomerId: true, labelCustomerId: true,
  labelConsigneeId: true, labelItemName: true, labelColorName: true, labelBatchNo: true,
  labelOverrides: true, labelTemplateId: true, labelEditedAt: true,
} satisfies Prisma.RollSelect;

export class RollLabelEditService {
  async getEditForm(rollId: string, opts: { peripheralId?: string | null } = {}): Promise<ApiResponse<RollLabelEditView>> {
    const roll = await prisma.roll.findUnique({ where: { id: rollId }, select: ROLL_EDIT_SELECT });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    const kind = rollLabelKindOf(roll.stage);
    const payload = (await labelService.getRollLabel(rollId)).data;

    const chain = await resolveLabelRouting({
      kind,
      peripheralId: opts.peripheralId ?? null,
      customerId: payload.customerId ?? null,
      consigneeId: payload.consigneeId ?? null,
    });
    const foreign = foreignKeys();
    const rows = await prisma.labelTemplate.findMany({
      where: { isActive: true, deletedAt: null, standalone: false },
      select: { id: true, name: true, kind: true, isActive: true, deletedAt: true, standalone: true, fields: true, variants: { select: { elements: true } } },
      orderBy: { name: "asc" },
    });
    const templates: RollLabelEditTemplate[] = [];
    for (const t of rows) {
      const bound = boundKeysOf(t);
      if (usableForRoll(t, bound, kind, foreign)) templates.push({ id: t.id, name: t.name, boundKeys: [...bound] });
    }

    const overrides = effectiveRollLabelEdit(roll).overrides;
    const fields: RollLabelEditField[] = ROLL_LABEL_EDIT_FIELDS.map((f) => {
      const column = isRollLabelColumnKey(f.key);
      return {
        key: f.key,
        label: f.defaultLabel,
        measured: ROLL_LABEL_MEASURED_KEYS.has(f.key),
        column,
        value: fieldDisplayValue(payload, f.key).value,
        overridden: column ? roll[ROLL_LABEL_COLUMN_KEYS[f.key as keyof typeof ROLL_LABEL_COLUMN_KEYS]] != null : f.key in overrides,
      };
    });
    const block = labelTextFixBlock(roll.status);
    return {
      success: true,
      data: {
        rollId: roll.id,
        barcode: roll.barcode,
        locked: block ? { code: block.code, reason: block.reason } : null,
        labelEditedAt: roll.labelEditedAt?.toISOString() ?? null,
        templateId: roll.labelTemplateId,
        chainTemplateId: chain.template?.id ?? null,
        templates,
        fields,
        customerId: payload.customerId ?? null,
        customerName: payload.customerName ?? null,
        ownerCustomerId: roll.ownerCustomerId,
        consigneeId: roll.labelConsigneeId,
      },
    };
  }

  async save(rollId: string, input: RollLabelEditInput, userId?: string): Promise<ApiResponse<RollLabelEditView & { changed: boolean }>> {
    const roll = await prisma.roll.findUnique({ where: { id: rollId }, select: ROLL_EDIT_SELECT });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.barcode) throw AppError.badRequest("Barkodsuz (açık kumaş) topun etiketi yok.", { code: "ROLL_NO_BARCODE" });
    const block = labelTextFixBlock(roll.status);
    if (block) throw AppError.conflict(block.reason, { code: block.code });

    const before = effectiveRollLabelEdit(roll);
    const after: RollLabelEditState = input.fields ? mergeRollLabelEdit(before, input.fields) : before;
    const nextTemplateId = input.templateId === undefined ? roll.labelTemplateId : input.templateId;
    if (nextTemplateId && nextTemplateId !== roll.labelTemplateId) await this.assertTemplateUsable(nextTemplateId, rollLabelKindOf(roll.stage));
    // Müşteri niyeti kesim yollarıyla aynı çözücüden (pasif cari, emanet sahibi kilidi).
    const intent = input.customer
      ? await resolveLabelIntent({ targetCustomerId: "customerId" in input.customer ? input.customer.customerId : null, ownerCustomerId: roll.ownerCustomerId })
      : null;
    const nextCustomerId = intent ? (intent.resolvedCustomerId ?? intent.customerId ?? null) : roll.labelCustomerId;
    const nextConsignee = input.consigneeId === undefined
      ? roll.labelConsigneeId
      : await resolveTamburConsignee({ labelConsigneeId: input.consigneeId, targetCustomerId: nextCustomerId, ownerCustomerId: roll.ownerCustomerId });

    const rowChanged = !sameRollLabelEdit(before, after) || nextTemplateId !== roll.labelTemplateId || nextConsignee !== roll.labelConsigneeId;
    const customerChanged = nextCustomerId !== roll.labelCustomerId;
    if (!rowChanged && !customerChanged) {
      // Aynı yamanın tekrarı (ya da boş yama) — yazım yok, audit yok.
      return { success: true, data: { ...(await this.getEditForm(rollId)).data, changed: false }, message: "Etiket zaten bu hâlde" };
    }
    const expected = input.expectedEditedAt === undefined ? roll.labelEditedAt : input.expectedEditedAt ? new Date(input.expectedEditedAt) : null;
    if (expected && Number.isNaN(expected.getTime())) throw AppError.badRequest("expectedEditedAt geçersiz", { code: "LABEL_EDIT_INVALID" });
    if ((expected?.getTime() ?? null) !== (roll.labelEditedAt?.getTime() ?? null)) {
      throw AppError.conflict("Etiket başka biri tarafından değiştirildi; yenileyip tekrar deneyin.", { code: "LABEL_EDIT_STALE" });
    }

    // ATOMİK CLAIM: durum kilidi + okunan sürüm WHERE'de — arada sevk edilen/düzenlenen topta 0 satır → 409.
    const { count } = await prisma.roll.updateMany({
      where: { id: rollId, status: { notIn: [...LABEL_TEXT_LOCKED_STATUSES] }, labelEditedAt: roll.labelEditedAt },
      data: {
        ...after.columns,
        labelOverrides: Object.keys(after.overrides).length > 0 ? after.overrides : Prisma.DbNull,
        labelTemplateId: nextTemplateId,
        labelConsigneeId: nextConsignee,
        labelEditedAt: new Date(),
        labelDirty: true,
      },
    });
    if (count === 0) {
      const now = await prisma.roll.findUnique({ where: { id: rollId }, select: { status: true } });
      const late = now ? labelTextFixBlock(now.status) : null;
      if (late) throw AppError.conflict(late.reason, { code: late.code });
      throw AppError.conflict("Etiket başka biri tarafından değiştirildi; yenileyip tekrar deneyin.", { code: "LABEL_EDIT_STALE" });
    }
    // Müşteri niyeti mevcut tek yazardan (snapshot + `labelCustomerId` aynası); cari kaydı değişmez.
    if (customerChanged && intent) {
      await labelService.seedRollLabelSnapshot(rollId, userId, intent.customerId ? { customerId: intent.customerId } : { stock: true });
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      oldData: { barcode: roll.barcode, ...before.columns, labelOverrides: before.overrides, labelTemplateId: roll.labelTemplateId, labelConsigneeId: roll.labelConsigneeId, labelCustomerId: roll.labelCustomerId },
      newData: { ...after.columns, labelOverrides: after.overrides, labelTemplateId: nextTemplateId, labelConsigneeId: nextConsignee, labelCustomerId: nextCustomerId, event: "ROLL_LABEL_EDIT" },
    });
    return { success: true, data: { ...(await this.getEditForm(rollId)).data, changed: true }, message: "Etiket kaydedildi" };
  }

  /** Bir seferlik şablon: var, aktif, silinmemiş, serbest değil, top bağlamına uygun — değilse 400. */
  private async assertTemplateUsable(templateId: string, kind: LabelKind): Promise<void> {
    const t = await prisma.labelTemplate.findUnique({
      where: { id: templateId },
      select: { isActive: true, deletedAt: true, standalone: true, kind: true, fields: true, variants: { select: { elements: true } } },
    });
    if (!t || !usableForRoll(t, boundKeysOf(t), kind, foreignKeys())) {
      throw AppError.badRequest("Seçilen şablon bu top etiketine uygun değil (silinmiş, pasif ya da başka bağlamın şablonu).", {
        code: "LABEL_TEMPLATE_NOT_USABLE",
      });
    }
  }
}
