// =============================================================================
// Order Service / validation
// =============================================================================
// Sipariş satır/başlık doğrulamaları: satır, renk, kalem, varyant, canlı referans, birim, şube, müşteri, para birimi, termin.
// `order.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../order.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import type { ItemUnit } from "@prisma/client";
import { ApiResponse } from "../../types/api.types";
import { AppError } from "../../utils/app-error";
import {
  Prisma,
} from "@prisma/client";
import { CURRENCIES } from "../../config/currencies";
import {
  unmeasuredLineWarnings,
} from "../helpers/order-status.helper";
import { isItemUnit } from "../../constants/item-unit";
import { assertColorsAssignableToCustomer } from "../helpers/color-assignment.helper";
import { assertTargetablePropertyIds } from "../helpers/targetable-property.helper";
import { runItemUsageChecks, type ItemUsageCheck } from "../helpers/item-usage.helper";
import { prepareOrderLineRecipes } from "../helpers/line-recipe.helper";
import {
  prepareLineTargetValues,
} from "../helpers/order-line-target-value.helper";
import type { OrderServiceThis } from "./shared";

export function validateLines(lines: unknown): void {
    if (!Array.isArray(lines)) return;
    lines.forEach((rawLine, idx) => {
      if (rawLine == null || typeof rawLine !== "object") return;
      const line = rawLine as Record<string, unknown>;
      const qty = Number(line.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw AppError.badRequest(
          `Sipariş kalemi #${idx + 1}: miktar pozitif olmalı (0'dan büyük).`
        );
      }
      // Decimal(12,3) tavanı — aşımda DB'de P2020 yerine alan-düzeyinde net hata.
      if (qty > 999_999_999) {
        throw AppError.badRequest(`Sipariş kalemi #${idx + 1}: miktar çok büyük.`);
      }
      // En (width) opsiyonel; verildiyse pozitif + makul üst sınır (0/negatif/
      // aşırı-büyük en üretim spec'ini bozar — miktar deseniyle aynı hijyen).
      if (line.width != null) {
        const w = Number(line.width);
        if (!Number.isFinite(w) || w <= 0) {
          throw AppError.badRequest(`Sipariş kalemi #${idx + 1}: en pozitif olmalı (0'dan büyük).`);
        }
        if (w > 100_000) {
          throw AppError.badRequest(`Sipariş kalemi #${idx + 1}: en çok büyük.`);
        }
      }
      if (line.unitPrice != null) {
        const price =
          typeof line.unitPrice === "string"
            ? Number(line.unitPrice)
            : (line.unitPrice as number);
        if (!Number.isFinite(price) || price < 0) {
          throw AppError.badRequest(
            `Sipariş kalemi #${idx + 1}: birim fiyat negatif olamaz.`
          );
        }
        if (price > 999_999_999) {
          throw AppError.badRequest(
            `Sipariş kalemi #${idx + 1}: birim fiyat çok büyük.`
          );
        }
      }
    });
  }

export async function validateLineColors(
    lines: unknown,
    customerId: string | null | undefined,
  ): Promise<void> {
    if (!Array.isArray(lines)) return;
    const colorIds = lines.map((l) => {
      if (l && typeof l === "object") {
        const c = (l as Record<string, unknown>).colorId;
        if (typeof c === "string") return c;
      }
      return null;
    });
    await assertColorsAssignableToCustomer(colorIds, customerId);
  }

export async function validateLineItems(this: OrderServiceThis, 
    lines: unknown,
    ctx: {
      fromScannedRolls?: boolean;
      current?: ReadonlyArray<{ id: string; itemId: string; quantity: Prisma.Decimal | number }>;
    } = {},
  ): Promise<{ unitByItem: Map<string, ItemUnit>; checks: ItemUsageCheck[]; warnings: string[] }> {
    const unitByItem = new Map<string, ItemUnit>();
    const checks: ItemUsageCheck[] = [];
    if (!Array.isArray(lines)) return { unitByItem, checks, warnings: [] };
    const currentById = new Map((ctx.current ?? []).map((l) => [l.id, l]));

    const itemIds = new Set<string>();
    const propertyIds = new Set<string>();
    const colorIds = new Set<string>();
    const pairs: Array<{ itemId: string; colorId: string | null; propIds: string[] }> = [];
    for (const raw of lines) {
      if (!raw || typeof raw !== "object") continue;
      const line = raw as Record<string, unknown>;
      const itemId = typeof line.itemId === "string" && line.itemId ? line.itemId : null;
      const colorId = typeof line.colorId === "string" && line.colorId ? line.colorId : null;
      const propIds = Array.isArray(line.requiredPropertyIds)
        ? (line.requiredPropertyIds as unknown[]).filter(
            (p): p is string => typeof p === "string" && p.length > 0,
          )
        : [];
      if (itemId) {
        itemIds.add(itemId);
        pairs.push({ itemId, colorId, propIds });
        const prev = typeof line.id === "string" ? currentById.get(line.id) : undefined;
        if (!prev || prev.itemId !== itemId) {
          checks.push({ itemId, usage: "NEW_ORDER", opts: { fromScannedRolls: ctx.fromScannedRolls === true } });
        } else if (Number(prev.quantity) !== Number(line.quantity)) {
          checks.push({ itemId, usage: "LINE_QTY", opts: { oldQty: Number(prev.quantity), newQty: Number(line.quantity) } });
        } // değişmeyen satır yeni referans doğurmaz — kontrol yok (iptal satırı Pasif kartta kalabilir)
      }
      if (colorId) colorIds.add(colorId);
      for (const p of propIds) propertyIds.add(p);
    }

    if (itemIds.size > 0) {
      // M-24: Item.allowedColors/allowedProperties kuralı (dolu = bu listeden;
      // boş = sınırsız) artık SİPARİŞ satırında da enforce edilir — KK1'in
      // zaten uyguladığı kuralın simetriği. Yoksa üretilemez renkte satır MRP
      // talebi yaratıyor, hata ancak KK1/üretimde patlıyordu.
      const live = await prisma.item.findMany({
        where: { id: { in: [...itemIds] } },
        select: {
          id: true,
          name: true,
          unit: true,
          allowedColors: { select: { colorId: true } },
          allowedProperties: { select: { propertyId: true } },
        },
      });
      if (live.length !== itemIds.size) {
        throw AppError.badRequest("Sipariş kaleminde bulunmayan ürün var");
      }
      const itemById = new Map(live.map((i) => [i.id, i]));
      for (const i of live) unitByItem.set(i.id, i.unit);
      for (const pair of pairs) {
        const item = itemById.get(pair.itemId);
        if (!item) continue;
        const allowedColorSet = new Set(item.allowedColors.map((c) => c.colorId));
        if (pair.colorId && allowedColorSet.size > 0 && !allowedColorSet.has(pair.colorId)) {
          throw AppError.badRequest(
            `Seçilen renk '${item.name}' ürününün izinli renk listesinde değil`,
          );
        }
        const allowedPropSet = new Set(item.allowedProperties.map((p) => p.propertyId));
        if (allowedPropSet.size > 0) {
          const outside = pair.propIds.find((p) => !allowedPropSet.has(p));
          if (outside) {
            throw AppError.badRequest(
              `Seçilen özelliklerden biri '${item.name}' ürününün izinli özellik listesinde değil`,
            );
          }
        }
      }
    }

    const warnings = await runItemUsageChecks(prisma, checks);
    await this.assertLineRefsLive(colorIds, propertyIds);
    return { unitByItem, checks, warnings };
  }

export async function prepareLineVariants(
    lines: unknown,
    current: ReadonlyArray<{
      id: string;
      itemId: string;
      recipeId: string | null;
      targetValues?: ReadonlyArray<{ propertyId: string; valueId: string }>;
    }> = [],
  ): Promise<void> {
    await prepareOrderLineRecipes(prisma, lines, current);
    await prepareLineTargetValues(
      prisma,
      lines,
      current.map((l) => ({ id: l.id, targetValues: l.targetValues ?? [] })),
    );
  }

export async function assertLineRefsLive(colorIds: Set<string>, propertyIds: Set<string>): Promise<void> {
    // M-23: satır rengi varlık + isActive (item/property gibi — pasif renk
    // canlı sipariş satırına yazılamaz; assertColorsAssignableToCustomer
    // yalnız atama kuralına bakar, aktifliğe bakmaz).
    if (colorIds.size > 0) {
      const liveColors = await prisma.color.findMany({
        where: { id: { in: [...colorIds] }, isActive: true },
        select: { id: true },
      });
      if (liveColors.length !== colorIds.size) {
        throw AppError.badRequest("Sipariş kaleminde bulunmayan veya pasif renk var");
      }
    }

    if (propertyIds.size > 0) {
      const live = await prisma.fabricProperty.findMany({
        where: { id: { in: [...propertyIds] }, isActive: true },
        select: { id: true },
      });
      if (live.length !== propertyIds.size) {
        throw AppError.badRequest("Sipariş kaleminde bulunmayan veya pasif özellik var");
      }
      // SEÇİM tipli özellik sipariş şartı olamaz (denetim Q2): "müşteri GRAMAJ
      // istiyor" hangi gramaj olduğunu söylemez; iş emri kalıtımıyla hedef
      // listeye ve oradan doğan toplara değersiz satır olarak yayılırdı.
      await assertTargetablePropertyIds([...propertyIds], "sipariş kalemi özelliği");
    }
  }

export function resolveLineUnit(
    raw: Record<string, unknown>,
    unitByItem: Map<string, ItemUnit>,
  ): ItemUnit {
    if (raw.unit != null && raw.unit !== "") {
      if (!isItemUnit(raw.unit)) {
        throw AppError.badRequest(`Geçersiz kalem birimi: ${String(raw.unit)} (MT, KG veya ADET).`);
      }
      return raw.unit;
    }
    const fromItem = typeof raw.itemId === "string" ? unitByItem.get(raw.itemId) : undefined;
    if (!fromItem) {
      throw AppError.badRequest("Sipariş kaleminin birimi çözülemedi — ürün seçilmemiş.");
    }
    return fromItem;
  }

export function withUnitWarnings<T>(res: ApiResponse<T>): ApiResponse<T> {
    const lines = (res.data as { lines?: unknown } | null)?.lines;
    if (!Array.isArray(lines)) return res;
    const warnings = unmeasuredLineWarnings(lines as Parameters<typeof unmeasuredLineWarnings>[0]);
    return warnings.length > 0 ? { ...res, warnings } : res;
  }

export async function validateBranch(
    branchId: string,
    customerId: string
  ): Promise<void> {
    const branch = await prisma.customerBranch.findUnique({
      where: { id: branchId },
      select: { id: true, customerId: true, isActive: true },
    });
    if (!branch) throw AppError.notFound("Şube bulunamadı");
    if (branch.customerId !== customerId) {
      throw AppError.badRequest("Şube bu müşteriye ait değil");
    }
    if (!branch.isActive) throw AppError.badRequest("Şube pasif durumda");
  }

export async function validateCustomer(customerId: string): Promise<void> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, isActive: true },
    });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");
    if (!customer.isActive) {
      throw AppError.badRequest(
        "Müşteri pasif durumda. Aktif olmayan müşteriye sipariş açılamaz."
      );
    }
  }

export function assertValidCurrency(currency: unknown): void {
    if (currency == null) return; // opsiyonel; şema default TRY
    const code = String(currency);
    if (!CURRENCIES.some((c) => c.code === code)) {
      throw AppError.badRequest(`Geçersiz para birimi: ${code}`);
    }
  }

export function assertDeadlineNotBeforeOrderDate(deadline: unknown, orderDate: unknown): void {
    if (deadline == null) return;
    const d = new Date(deadline as string);
    if (Number.isNaN(d.getTime())) throw AppError.badRequest("Termin tarihi geçersiz");
    const ref = orderDate != null ? new Date(orderDate as string) : new Date();
    if (Number.isNaN(ref.getTime())) throw AppError.badRequest("Sipariş tarihi geçersiz");
    if (d.getTime() < ref.getTime()) {
      throw AppError.badRequest("Termin tarihi sipariş tarihinden önce olamaz");
    }
  }
