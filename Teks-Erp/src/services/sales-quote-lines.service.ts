// =============================================================================
// SATIŞ TEKLİFİ KALEMLERİ — ekle · düzenle · sil · maliyeti tazele (MAL-4; plan §4.3 adım 1–2)
// =============================================================================
// Hepsi yalnız DRAFT: tx'in başında `claimDraftQuoteTx` (SENT teklif DEĞİŞMEZ → 409). Maliyet tx DIŞINDA
// çözülür (motor + kur köprüsü okur), fiyat önerisi tx İÇİNDE TEK zincirden (`quote-price.helper`).
// Birim fiyat gövdede verilirse MANUAL; yoksa öneri 2 haneye. Toplamlar aynı tx'te yeniden yazılır.
// Taslak kalemin silinmesi hard delete'tir: deftere hiç yazmamış taslak (CLAUDE.md iki sınıf).
// =============================================================================
import { Prisma, type ItemUnit } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { claimDraftQuoteTx } from "./helpers/sales-quote-state.helper";
import { resolveQuotePriceSuggestionTx } from "./helpers/quote-price.helper";
import { refreshQuoteLineCost, resolveQuoteLineCost, type QuoteLineCost } from "./helpers/quote-line-cost.helper";
import { MARKUP_RULE, parseDecimalField, parseTextField } from "./helpers/cost-input.helper";
import { parseAdHoc, resolveMarkup } from "./cost-calc.service";
import { QUOTE_INCLUDE, QUOTE_TABLE, type QuoteRecord } from "./sales-quote-transitions.service";
import { assertRecipesMatchItems, readRecipeId } from "./helpers/line-recipe.helper";

const QTY_RULE = { label: "Miktar", min: 0, minExclusive: true, scale: 3 } as const;
const PRICE_RULE = { label: "Birim fiyat", min: 0, scale: 2 } as const;
const WIDTH_RULE = { label: "En", min: 0, minExclusive: true, scale: 3 } as const;
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
const r2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, HALF_UP);

function readUnit(raw: unknown): ItemUnit {
  if (raw === undefined || raw === "MT") return "MT";
  throw AppError.badRequest("Teklif kalemi bu sürümde yalnız metre (MT) birimiyle verilir.", { code: "QUOTE_UNIT_UNSUPPORTED" });
}

function readOptUuid(raw: unknown, label: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !/^[0-9a-f-]{36}$/i.test(raw)) throw AppError.badRequest(`${label} geçersiz.`);
  return raw;
}

interface Pricing { markupPct: Prisma.Decimal; manualPrice: Prisma.Decimal | null; quantity: Prisma.Decimal; colorId: string | null; itemId: string | null; recipeId: string | null }

/** Öneri (tek zincir) + seçilen fiyat + satır toplamı — tx İÇİNDE, DRAFT kilidinin arkasında. */
async function priceLineTx(tx: Prisma.TransactionClient, quoteId: string, cost: QuoteLineCost, p: Pricing) {
  const q = await tx.salesQuote.findUniqueOrThrow({ where: { id: quoteId } });
  const s = await resolveQuotePriceSuggestionTx(tx, {
    itemId: p.itemId, colorId: p.colorId, recipeId: p.recipeId, customerId: q.customerId, currency: q.currency, costPerMTry: cost.costPerMTry,
    markupPct: p.markupPct, fxRate: q.fxRate, freightPerM: q.freightPerM, financeChargePct: q.financeChargePct, commissionPct: q.commissionPct,
  });
  const suggested = s.suggested ?? s.costPlus;
  if (!suggested) throw AppError.badRequest("Teklif kuru olmadan fiyat önerilemez.", { code: "COST_INPUT_MISSING", missing: ["FX_RATE_MISSING"] });
  const unitPrice = p.manualPrice ?? r2(suggested);
  return {
    costPerMTry: cost.costPerMTry, standardCostVersionId: cost.standardCostVersionId, costSnapshot: cost.snapshot as Prisma.InputJsonValue,
    markupPct: p.markupPct, suggestedUnitPrice: suggested, unitPrice, lineTotal: r2(unitPrice.mul(p.quantity)),
    priceSource: p.manualPrice ? ("MANUAL" as const) : s.source, priceListLineId: p.manualPrice ? null : s.priceListLineId,
  };
}

/** Başlık toplamları — kalem yazımıyla AYNI tx'te (satış tutarı + TL maliyet). */
async function recomputeTotalsTx(tx: Prisma.TransactionClient, quoteId: string): Promise<void> {
  const lines = await tx.salesQuoteLine.findMany({ where: { quoteId }, select: { lineTotal: true, costPerMTry: true, quantity: true } });
  const total = lines.reduce((a, l) => a.plus(l.lineTotal), new Prisma.Decimal(0));
  const cost = lines.reduce((a, l) => a.plus(l.costPerMTry.mul(l.quantity)), new Prisma.Decimal(0));
  await tx.salesQuote.update({ where: { id: quoteId }, data: { totalAmount: r2(total), totalCostTry: lines.length ? r2(cost) : null } });
}

async function finish(quoteId: string, audit: { action: "CREATE" | "UPDATE" | "DELETE"; recordId: string; newData: Record<string, unknown> | null }, userId?: string): Promise<QuoteRecord> {
  // Kalem ayak izi teklifin kaydına düşer (kalem teklifin parçası; ayrı tablo etiketi açılmaz).
  void AuditService.log({ userId, action: "UPDATE", tableName: QUOTE_TABLE, recordId: quoteId, oldData: null, newData: { kalem: audit.action, lineId: audit.recordId, ...(audit.newData ?? {}) } });
  return prisma.salesQuote.findUniqueOrThrow({ where: { id: quoteId }, include: QUOTE_INCLUDE });
}

/** `POST /api/quotes/:id/lines` — ürünlü (`itemId`) ya da elle yapılı (`adHoc`) kalem. */
export async function addQuoteLine(quoteId: string, body: Record<string, unknown>, userId?: string): Promise<{ quote: QuoteRecord; warnings: string[] }> {
  const itemId = readOptUuid(body.itemId, "Ürün");
  const adHoc = body.adHoc && typeof body.adHoc === "object" ? (body.adHoc as Record<string, unknown>) : null;
  if (itemId && adHoc) throw AppError.badRequest("Ya ürün ya elle yapı gönderilmeli, ikisi birden değil.");
  if (!itemId && !adHoc) throw AppError.badRequest("Ürün ya da elle yapı zorunlu.");
  const unit = readUnit(body.unit);
  const quantity = parseDecimalField(body.quantity, QTY_RULE);
  if (!quantity) throw AppError.badRequest("Miktar zorunlu.");
  const colorId = readOptUuid(body.colorId, "Renk");
  const recipeId = readRecipeId(body.recipeId, "Kalem") ?? null;
  if (recipeId && !itemId) throw AppError.badRequest("Varyant yalnız ürünlü kaleme verilir.", { code: "RECIPE_ITEM_MISMATCH", recipeId, itemId: null });
  if (recipeId) await assertRecipesMatchItems(prisma, [{ itemId, recipeId, label: "Kalem", isNew: true }]);
  const width = parseDecimalField(body.width, WIDTH_RULE) ?? null;
  const manualPrice = parseDecimalField(body.unitPrice, PRICE_RULE) ?? null;
  const notes = parseTextField(body.notes, "Kalem notu", 500) ?? null;
  let description = parseTextField(body.description, "Açıklama", 200) ?? null;
  if (!description && itemId) description = (await prisma.item.findUnique({ where: { id: itemId }, select: { name: true } }))?.name ?? null;
  if (!description) throw AppError.badRequest("Kalem açıklaması zorunlu (yeni desen adı).");
  const markupPct = await resolveMarkup(body.markupPct);
  const cost = await resolveQuoteLineCost(itemId ? { itemId } : { adHoc: parseAdHoc(adHoc!) });
  const line = await prisma.$transaction(async (tx) => {
    await claimDraftQuoteTx(tx, quoteId, userId);
    const priced = await priceLineTx(tx, quoteId, cost, { markupPct, manualPrice, quantity, colorId, itemId, recipeId });
    const max = await tx.salesQuoteLine.aggregate({ where: { quoteId }, _max: { lineNo: true } });
    const created = await tx.salesQuoteLine.create({
      data: { quoteId, lineNo: (max._max.lineNo ?? 0) + 1, itemId, colorId, recipeId, description, width, quantity, unit, notes, ...priced },
    });
    await recomputeTotalsTx(tx, quoteId);
    return created;
  });
  const quote = await finish(quoteId, { action: "CREATE", recordId: line.id, newData: { lineNo: line.lineNo, itemId, quantity: quantity.toString() } }, userId);
  return { quote, warnings: cost.warnings };
}

/** `PATCH /api/quotes/:id/lines/:lineId` — miktar/fiyat/kâr/renk/metin; maliyet fotoğrafı DEĞİŞMEZ (tazele ayrı). */
export async function updateQuoteLine(quoteId: string, lineId: string, body: Record<string, unknown>, userId?: string): Promise<QuoteRecord> {
  if (body.itemId !== undefined || body.adHoc !== undefined) throw AppError.badRequest("Kalemin ürünü/yapısı değiştirilemez; kalemi silip yenisini ekleyin.");
  if (body.unit !== undefined) readUnit(body.unit);
  const quantity = parseDecimalField(body.quantity, QTY_RULE);
  if (quantity === null) throw AppError.badRequest("Miktar boş bırakılamaz.");
  const markupRaw = parseDecimalField(body.markupPct, MARKUP_RULE("Kâr oranı"));
  if (markupRaw === null) throw AppError.badRequest("Kâr oranı boş bırakılamaz.");
  const manualPrice = parseDecimalField(body.unitPrice, PRICE_RULE);
  const description = parseTextField(body.description, "Açıklama", 200);
  if (description === null) throw AppError.badRequest("Kalem açıklaması boş bırakılamaz.");
  const notes = parseTextField(body.notes, "Kalem notu", 500);
  const width = parseDecimalField(body.width, WIDTH_RULE);
  const colorId = body.colorId === undefined ? undefined : readOptUuid(body.colorId, "Renk");
  const recipeId = readRecipeId(body.recipeId, "Kalem");
  await prisma.$transaction(async (tx) => {
    await claimDraftQuoteTx(tx, quoteId, userId);
    const l = await tx.salesQuoteLine.findFirst({ where: { id: lineId, quoteId } });
    if (!l) throw AppError.notFound("Teklif kalemi bulunamadı.");
    if (recipeId) {
      if (!l.itemId) throw AppError.badRequest("Varyant yalnız ürünlü kaleme verilir.", { code: "RECIPE_ITEM_MISMATCH", recipeId, itemId: null });
      await assertRecipesMatchItems(tx, [{ itemId: l.itemId, recipeId, label: "Kalem", isNew: recipeId !== l.recipeId }]);
    }
    // `unitPrice: null` → öneriye dön; verilmezse önceki seçim (MANUAL ise elle fiyat) korunur.
    const keepManual = manualPrice === undefined && l.priceSource === "MANUAL" ? l.unitPrice : null;
    const cost: QuoteLineCost = { costPerMTry: l.costPerMTry, standardCostVersionId: l.standardCostVersionId, snapshot: l.costSnapshot as never, warnings: [] };
    const priced = await priceLineTx(tx, quoteId, cost, {
      markupPct: markupRaw ?? l.markupPct, manualPrice: manualPrice ?? keepManual, quantity: quantity ?? l.quantity,
      colorId: colorId === undefined ? l.colorId : colorId, itemId: l.itemId, recipeId: recipeId === undefined ? l.recipeId : recipeId,
    });
    await tx.salesQuoteLine.update({
      where: { id: lineId },
      data: {
        ...priced, quantity: quantity ?? l.quantity, ...(colorId !== undefined ? { colorId } : {}), ...(recipeId !== undefined ? { recipeId } : {}), ...(description ? { description } : {}),
        ...(notes !== undefined ? { notes } : {}), ...(width !== undefined ? { width } : {}),
      },
    });
    await recomputeTotalsTx(tx, quoteId);
  });
  return finish(quoteId, { action: "UPDATE", recordId: lineId, newData: { fields: Object.keys(body) } }, userId);
}

/** `DELETE /api/quotes/:id/lines/:lineId` — yalnız taslak teklifin kalemi (deftere hiç yazmamış taslak). */
export async function deleteQuoteLine(quoteId: string, lineId: string, userId?: string): Promise<QuoteRecord> {
  await prisma.$transaction(async (tx) => {
    await claimDraftQuoteTx(tx, quoteId, userId);
    const r = await tx.salesQuoteLine.deleteMany({ where: { id: lineId, quoteId } });
    if (r.count === 0) throw AppError.notFound("Teklif kalemi bulunamadı.");
    await recomputeTotalsTx(tx, quoteId);
  });
  return finish(quoteId, { action: "DELETE", recordId: lineId, newData: null }, userId);
}

/** `POST /api/quotes/:id/refresh-costs` — her kalemin maliyeti yeniden kurulur; elle fiyat korunur, öneri tazelenir. */
export async function refreshQuoteCosts(quoteId: string, userId?: string): Promise<{ quote: QuoteRecord; warnings: string[] }> {
  const lines = await prisma.salesQuoteLine.findMany({ where: { quoteId }, orderBy: { lineNo: "asc" } });
  const costs: QuoteLineCost[] = [];
  for (const l of lines) costs.push(await refreshQuoteLineCost(l));
  await prisma.$transaction(async (tx) => {
    await claimDraftQuoteTx(tx, quoteId, userId);
    for (const [i, l] of lines.entries()) {
      const priced = await priceLineTx(tx, quoteId, costs[i]!, {
        markupPct: l.markupPct, manualPrice: l.priceSource === "MANUAL" ? l.unitPrice : null, quantity: l.quantity, colorId: l.colorId, itemId: l.itemId, recipeId: l.recipeId,
      });
      const r = await tx.salesQuoteLine.updateMany({ where: { id: l.id, quoteId }, data: priced });
      if (r.count === 0) throw AppError.conflict("Teklif kalemleri aynı anda değişti; sayfayı yenileyin.", { code: "QUOTE_STATUS_CONFLICT" });
    }
    await recomputeTotalsTx(tx, quoteId);
  });
  void AuditService.log({ userId, action: "UPDATE", tableName: QUOTE_TABLE, recordId: quoteId, oldData: null, newData: { refreshedLines: lines.length } });
  const quote = await prisma.salesQuote.findUniqueOrThrow({ where: { id: quoteId }, include: QUOTE_INCLUDE });
  return { quote, warnings: [...new Set(costs.flatMap((c) => c.warnings))] };
}
