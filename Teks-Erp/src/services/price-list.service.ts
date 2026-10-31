// =============================================================================
// FİYAT LİSTESİ — taslak · satır replace · standart maliyetten doldur · yayınla · arşivle · revizyon (MAL-4)
// =============================================================================
// Durum: DRAFT ──yayınla──▶ PUBLISHED ──(aynı müşteri+döviz yeni yayın ya da arşivle)──▶ ARCHIVED.
// Yayınlı listenin satırı DEĞİŞMEZ (claim `WHERE status='DRAFT'`); düzeltme revizyondur (yeni DRAFT, aynı
// numara, revisionNo+1). Yayın TEK tx: önce aynı müşteri+dövizin PUBLISHED'ı ARCHIVED, sonra bu taslak
// PUBLISHED; yarış `price_lists_published_uq` partial unique'inde → 409. Geçerlilik = yayın durumu
// (validFromDate/validUntilDate yalnız bilgi). Satır okuması teklif önerisi için `quote-price.helper`dadır.
// =============================================================================
import { Prisma, type Currency, type PriceListStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { isClientTokenP2002 } from "../utils/p2002";
import { buildTurkishSearch } from "../utils/query-parser";
import { decodeOffsetCursor, encodeOffsetCursor } from "../utils/cursor";
import { AuditService } from "./audit.service";
import { nextSeriesNo } from "./number-series.service";
import { isUniqueViolation, parseDecimalField, parseTextField } from "./helpers/cost-input.helper";
import { resolveMarkup } from "./cost-calc.service";
import { suggestUnitPrice } from "./helpers/fabric-cost.helper";
import { suggestFxRate } from "./helpers/maliyet-bridge.helper";
import { quoteToday } from "./helpers/sales-quote-state.helper";
import { tokenReplay } from "./helpers/token-replay.helper";
import { readQuoteToken } from "./sales-quote-transitions.service";
import { freezePriceListDocumentTx } from "./quote-documents.service";
import { assertRecipesMatchItems, LINE_RECIPE_SELECT, readRecipeId } from "./helpers/line-recipe.helper";

export const PRICE_LIST_TABLE = "PRICE_LIST";
export const PRICE_LIST_INCLUDE = {
  lines: { orderBy: { lineNo: "asc" }, include: { item: { select: { id: true, code: true, name: true } }, color: { select: { id: true, code: true, name: true } }, recipe: LINE_RECIPE_SELECT } },
  customer: { select: { id: true, code: true, name: true } },
} satisfies Prisma.PriceListInclude;
export type PriceListRecord = Prisma.PriceListGetPayload<{ include: typeof PRICE_LIST_INCLUDE }>;

const CURRENCIES: readonly Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];
const PRICE_RULE = { label: "Birim fiyat", min: 0, scale: 2 } as const;
const MINQTY_RULE = { label: "Asgari miktar", min: 0, minExclusive: true, scale: 3 } as const;
const FX_RULE = { label: "Kur", min: 0, minExclusive: true, scale: 6 } as const;
const MAX_LINES = 2000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

const conflict = (status?: PriceListStatus) =>
  AppError.conflict("Fiyat listesinin durumu bu işleme uygun değil ya da aynı anda değişti; sayfayı yenileyin.", { code: "PRICE_LIST_STATUS_CONFLICT", ...(status ? { status } : {}) });

function readUuid(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !/^[0-9a-f-]{36}$/i.test(raw)) throw AppError.badRequest(`${label} geçersiz.`);
  return raw;
}

function readOptYmd(raw: unknown, label: string): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string" || !YMD_RE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) throw AppError.badRequest(`${label} YYYY-AA-GG biçiminde olmalı.`);
  return new Date(`${raw}T00:00:00Z`);
}

/** Claim düşünce nedeni: yok → 404, aksi → durum çakışması. */
async function claimError(db: Prisma.TransactionClient, id: string): Promise<AppError> {
  const l = await db.priceList.findUnique({ where: { id }, select: { status: true } });
  return l ? conflict(l.status) : AppError.notFound("Fiyat listesi bulunamadı.");
}

/** DRAFT kilidi — satır/başlık yazımından ÖNCE tx'in başında. */
async function claimDraftTx(tx: Prisma.TransactionClient, id: string, userId?: string): Promise<void> {
  const r = await tx.priceList.updateMany({ where: { id, status: "DRAFT" }, data: { updatedById: userId ?? null, updatedAt: new Date() } });
  if (r.count === 0) throw await claimError(tx, id);
}

const LIST_REPLAY_BASE = {
  alive: { neverDies: "Arşivlenmiş liste de aynı formun cevabıdır: yeni deneme açmaz, durumu görünür." },
  collision: (p: PriceListRecord) => `Bu form daha önce başka bir fiyat listesi için kullanılmış (${p.listNo}/${p.revisionNo}). Formu yeniden açın.`,
  respond: (p: PriceListRecord) => p,
};

function createListReplay(customerId: string | null, currency: Currency) {
  return tokenReplay<PriceListRecord, PriceListRecord>({
    find: (db, clientToken) => db.priceList.findUnique({ where: { clientToken }, include: PRICE_LIST_INCLUDE }),
    alive: LIST_REPLAY_BASE.alive,
    identity: (p) => [{ ad: "customerId", mevcut: p.customerId, gelen: customerId }, { ad: "currency", mevcut: p.currency, gelen: currency }],
    collision: LIST_REPLAY_BASE.collision,
    respond: LIST_REPLAY_BASE.respond,
  });
}

function reviseListReplay(id: string) {
  return tokenReplay<PriceListRecord, PriceListRecord>({
    find: (db, clientToken) => db.priceList.findUnique({ where: { clientToken }, include: PRICE_LIST_INCLUDE }),
    alive: LIST_REPLAY_BASE.alive,
    identity: (p) => [{ ad: "revisionOfId", mevcut: p.revisionOfId, gelen: id }],
    collision: LIST_REPLAY_BASE.collision,
    respond: LIST_REPLAY_BASE.respond,
  });
}

function nextListNo(tx: Prisma.TransactionClient): Promise<string> {
  return nextSeriesNo("priceList", async (prefix) => {
    const rows = await tx.priceList.findMany({ where: { listNo: { gte: prefix, startsWith: prefix }, revisionNo: 1 }, select: { listNo: true, createdAt: true } });
    return rows.map((r) => ({ code: r.listNo, createdAt: r.createdAt }));
  });
}

/** `POST /api/price-lists` — taslak (satırsız); müşterisiz = genel liste. */
export async function createPriceList(body: Record<string, unknown>, userId?: string): Promise<PriceListRecord> {
  const clientToken = readQuoteToken(body.clientToken);
  const customerId = body.customerId ? readUuid(body.customerId, "Müşteri") : null;
  if (typeof body.currency !== "string" || !CURRENCIES.includes(body.currency as Currency)) throw AppError.badRequest("Geçersiz para birimi.");
  const currency = body.currency as Currency;
  return createListReplay(customerId, currency).run(clientToken, async () => {
    const name = parseTextField(body.name, "Liste adı", 100);
    if (!name) throw AppError.badRequest("Liste adı zorunlu.");
    if (customerId) {
      const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { isCustomerRole: true } });
      if (!c) throw AppError.notFound("Cari bulunamadı.");
      if (!c.isCustomerRole) throw AppError.badRequest("Seçilen carinin müşteri rolü yok.", { code: "CUSTOMER_ROLE_REQUIRED" });
    }
    const created = await withBarcodeRetry(
      () =>
        prisma.$transaction(async (tx) =>
          tx.priceList.create({
            data: {
              listNo: await nextListNo(tx), clientToken, name, customerId, currency,
              validFromDate: readOptYmd(body.validFromDate, "Geçerlilik başlangıcı") ?? null, validUntilDate: readOptYmd(body.validUntilDate, "Geçerlilik sonu") ?? null,
              notes: parseTextField(body.notes, "Not", 1000) ?? null, createdById: userId ?? null, updatedById: userId ?? null,
            },
            include: PRICE_LIST_INCLUDE,
          }),
        ),
      undefined,
      (e) => !isClientTokenP2002(e),
      "Fiyat listesi no",
    );
    void AuditService.log({ userId, action: "CREATE", tableName: PRICE_LIST_TABLE, recordId: created.id, oldData: null, newData: { listNo: created.listNo, customerId, currency } });
    return created;
  });
}

/** `PATCH /api/price-lists/:id` — yalnız taslağın başlığı (ad, bilgi tarihleri, not). */
export async function updatePriceList(id: string, body: Record<string, unknown>, userId?: string): Promise<PriceListRecord> {
  if (body.customerId !== undefined || body.currency !== undefined) throw AppError.badRequest("Listenin müşterisi/dövizi değiştirilemez; yeni liste açın.");
  const name = parseTextField(body.name, "Liste adı", 100);
  if (name === null) throw AppError.badRequest("Liste adı boş bırakılamaz.");
  const data: Prisma.PriceListUncheckedUpdateInput = {
    ...(name ? { name } : {}),
    ...(body.validFromDate !== undefined ? { validFromDate: readOptYmd(body.validFromDate, "Geçerlilik başlangıcı") } : {}),
    ...(body.validUntilDate !== undefined ? { validUntilDate: readOptYmd(body.validUntilDate, "Geçerlilik sonu") } : {}),
    ...(body.notes !== undefined ? { notes: parseTextField(body.notes, "Not", 1000) } : {}),
  };
  const out = await prisma.$transaction(async (tx) => {
    await claimDraftTx(tx, id, userId);
    return tx.priceList.update({ where: { id }, data, include: PRICE_LIST_INCLUDE });
  });
  void AuditService.log({ userId, action: "UPDATE", tableName: PRICE_LIST_TABLE, recordId: id, oldData: null, newData: { fields: Object.keys(data) } });
  return out;
}

interface LineInput { itemId: string; colorId: string | null; recipeId?: string | null; unitPrice: Prisma.Decimal; minQty: Prisma.Decimal | null; standardCostVersionId?: string | null; costPerMTry?: Prisma.Decimal | null; markupPct?: Prisma.Decimal | null }

function readLines(raw: unknown): LineInput[] {
  if (!Array.isArray(raw)) throw AppError.badRequest("Satırlar dizi olmalı.");
  if (raw.length > MAX_LINES) throw AppError.badRequest(`Bir listede en çok ${MAX_LINES} satır olabilir.`);
  return raw.map((r: Record<string, unknown>, i) => {
    const unitPrice = parseDecimalField(r?.unitPrice, { ...PRICE_RULE, label: `${i + 1}. satır birim fiyatı` });
    if (unitPrice === null || unitPrice === undefined) throw AppError.badRequest(`${i + 1}. satır birim fiyatı zorunlu.`);
    return {
      itemId: readUuid(r.itemId, `${i + 1}. satır ürünü`),
      colorId: r.colorId ? readUuid(r.colorId, `${i + 1}. satır rengi`) : null,
      recipeId: readRecipeId(r.recipeId, `${i + 1}. satır`) ?? null,
      unitPrice,
      minQty: parseDecimalField(r.minQty, MINQTY_RULE) ?? null,
    };
  });
}

/**
 * Satır kümesini YENİDEN yazar (④ taslak replace): aynı ürün+renk+varyant iki kez → 400 — DB'deki
 * `price_list_lines_item_color_uq` (COALESCE renk, COALESCE varyant) ile aynı anahtar. Varyant ürüne ait olmalı.
 */
async function writeLinesTx(tx: Prisma.TransactionClient, id: string, lines: LineInput[]): Promise<void> {
  const seen = new Set<string>();
  for (const l of lines) {
    const k = `${l.itemId}|${l.colorId ?? ""}|${l.recipeId ?? ""}`;
    if (seen.has(k)) throw AppError.badRequest("Aynı ürün, renk ve varyant listede iki kez yer alamaz.", { code: "PRICE_LIST_DUPLICATE_LINE" });
    seen.add(k);
  }
  // Varyantsız kümede ek sorgu yok (SIFIR FARK).
  const prior = lines.some((l) => l.recipeId)
    ? await tx.priceListLine.findMany({ where: { priceListId: id, recipeId: { not: null } }, select: { recipeId: true } })
    : [];
  const priorRecipes = new Set(prior.map((p) => p.recipeId));
  await assertRecipesMatchItems(
    tx,
    lines.flatMap((l, i) => (l.recipeId ? [{ itemId: l.itemId, recipeId: l.recipeId, label: `${i + 1}. satır`, isNew: !priorRecipes.has(l.recipeId) }] : [])),
  );
  await tx.priceListLine.deleteMany({ where: { priceListId: id } });
  if (lines.length) await tx.priceListLine.createMany({ data: lines.map((l, i) => ({ priceListId: id, lineNo: i + 1, ...l })) });
}

/** `PUT /api/price-lists/:id/lines` — taslağın satırları bütünüyle değişir. */
export async function replacePriceListLines(id: string, body: Record<string, unknown>, userId?: string): Promise<PriceListRecord> {
  const lines = readLines(body.lines);
  const out = await prisma.$transaction(async (tx) => {
    await claimDraftTx(tx, id, userId);
    await writeLinesTx(tx, id, lines);
    return tx.priceList.findUniqueOrThrow({ where: { id }, include: PRICE_LIST_INCLUDE });
  });
  void AuditService.log({ userId, action: "UPDATE", tableName: PRICE_LIST_TABLE, recordId: id, oldData: null, newData: { lineCount: lines.length } });
  return out;
}

/**
 * `POST /api/price-lists/:id/fill-from-standard-cost` — seçilen (ya da standart sürümü olan TÜM) kumaşlar için
 * renksiz satır = aktif sürüm × (1 + kâr) / kur, 2 hane; satırda sürüm + maliyet + kâr DONAR. Kur yoksa 400.
 */
export async function fillFromStandardCost(id: string, body: Record<string, unknown>, userId?: string): Promise<PriceListRecord> {
  const head = await prisma.priceList.findUnique({ where: { id }, select: { currency: true, status: true } });
  if (!head) throw AppError.notFound("Fiyat listesi bulunamadı.");
  if (head.status !== "DRAFT") throw conflict(head.status);
  const markupPct = await resolveMarkup(body.markupPct);
  const fxRate = parseDecimalField(body.fxRate, FX_RULE) ?? (await suggestFxRate(head.currency, quoteToday()));
  if (!fxRate) throw AppError.badRequest(`${head.currency} kuru bulunamadı; kuru elle girin.`, { code: "COST_INPUT_MISSING", missing: ["FX_RATE_MISSING"] });
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map((x, i) => readUuid(x, `${i + 1}. ürün`)) : null;
  const versions = await prisma.standardCostVersion.findMany({
    where: { status: "ACTIVE", recipeId: null, ...(itemIds ? { itemId: { in: itemIds } } : {}) },
    select: { id: true, itemId: true, totalCostPerMTry: true },
  });
  if (versions.length === 0) throw AppError.badRequest("Seçilen ürünlerin yürürlükte standart maliyeti yok.", { code: "COST_INPUT_MISSING", missing: ["STANDARD_COST_MISSING"] });
  const filled = new Map(versions.map((v) => [v.itemId, v]));
  const out = await prisma.$transaction(async (tx) => {
    await claimDraftTx(tx, id, userId);
    const existing = await tx.priceListLine.findMany({ where: { priceListId: id }, orderBy: { lineNo: "asc" } });
    const kept: LineInput[] = existing
      .filter((l) => !(l.colorId === null && l.recipeId === null && filled.has(l.itemId)))
      .map((l) => ({ itemId: l.itemId, colorId: l.colorId, recipeId: l.recipeId, unitPrice: l.unitPrice, minQty: l.minQty, standardCostVersionId: l.standardCostVersionId, costPerMTry: l.costPerMTry, markupPct: l.markupPct }));
    const added: LineInput[] = versions.map((v) => ({
      itemId: v.itemId, colorId: null, minQty: existing.find((l) => l.itemId === v.itemId && l.colorId === null && l.recipeId === null)?.minQty ?? null,
      unitPrice: suggestUnitPrice({ costPerMTry: v.totalCostPerMTry, markupPct, fxRate })!.toDecimalPlaces(2, HALF_UP),
      standardCostVersionId: v.id, costPerMTry: v.totalCostPerMTry, markupPct,
    }));
    await writeLinesTx(tx, id, [...kept, ...added]);
    return tx.priceList.findUniqueOrThrow({ where: { id }, include: PRICE_LIST_INCLUDE });
  });
  void AuditService.log({ userId, action: "UPDATE", tableName: PRICE_LIST_TABLE, recordId: id, oldData: null, newData: { filledFromStandardCost: versions.length, markupPct: markupPct.toString() } });
  return out;
}

/** `POST /api/price-lists/:id/publish` — tek tx: eşinin PUBLISHED'ı ARCHIVED + bu DRAFT → PUBLISHED. */
export async function publishPriceList(id: string, userId?: string): Promise<PriceListRecord> {
  const now = new Date();
  try {
    const out = await prisma.$transaction(async (tx) => {
      const me = await tx.priceList.findUnique({ where: { id }, select: { customerId: true, currency: true, _count: { select: { lines: true } } } });
      if (!me) throw AppError.notFound("Fiyat listesi bulunamadı.");
      if (me._count.lines === 0) throw AppError.badRequest("Satırsız liste yayınlanamaz.");
      await tx.priceList.updateMany({
        where: { status: "PUBLISHED", customerId: me.customerId, currency: me.currency, id: { not: id } },
        data: { status: "ARCHIVED", archivedAt: now, archivedById: userId ?? null, updatedById: userId ?? null },
      });
      const r = await tx.priceList.updateMany({ where: { id, status: "DRAFT" }, data: { status: "PUBLISHED", publishedAt: now, publishedById: userId ?? null, updatedById: userId ?? null } });
      if (r.count === 0) throw await claimError(tx, id);
      // Belge yayın ANINDA donar (lazy "geriye dönük" değil); hata yayını geri sarar.
      await freezePriceListDocumentTx(tx, id, userId);
      return tx.priceList.findUniqueOrThrow({ where: { id }, include: PRICE_LIST_INCLUDE });
    });
    void AuditService.log({ userId, action: "UPDATE", tableName: PRICE_LIST_TABLE, recordId: id, oldData: { status: "DRAFT" }, newData: { status: "PUBLISHED" } });
    return out;
  } catch (e) {
    if (isUniqueViolation(e)) throw AppError.conflict("Aynı müşteri ve döviz için başka bir liste aynı anda yayınlandı; sayfayı yenileyin.", { code: "PRICE_LIST_STATUS_CONFLICT" });
    throw e;
  }
}

/** `POST /api/price-lists/:id/archive` — PUBLISHED → ARCHIVED (öneri zincirinden çıkar). */
export async function archivePriceList(id: string, userId?: string): Promise<PriceListRecord> {
  const out = await prisma.$transaction(async (tx) => {
    const r = await tx.priceList.updateMany({ where: { id, status: "PUBLISHED" }, data: { status: "ARCHIVED", archivedAt: new Date(), archivedById: userId ?? null, updatedById: userId ?? null } });
    if (r.count === 0) throw await claimError(tx, id);
    return tx.priceList.findUniqueOrThrow({ where: { id }, include: PRICE_LIST_INCLUDE });
  });
  void AuditService.log({ userId, action: "UPDATE", tableName: PRICE_LIST_TABLE, recordId: id, oldData: { status: "PUBLISHED" }, newData: { status: "ARCHIVED" } });
  return out;
}

/** `POST /api/price-lists/:id/revise {clientToken}` — yayınlı/arşivli listeden yeni DRAFT (aynı numara, satırlar kopya). */
export async function revisePriceList(id: string, body: { clientToken?: unknown }, userId?: string): Promise<PriceListRecord> {
  const clientToken = readQuoteToken(body.clientToken);
  return reviseListReplay(id).run(clientToken, async () => {
    let created: PriceListRecord;
    try {
      created = await prisma.$transaction(async (tx) => {
        const old = await tx.priceList.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
        if (!old) throw AppError.notFound("Fiyat listesi bulunamadı.");
        if (old.status === "DRAFT") throw conflict(old.status);
        return tx.priceList.create({
          data: {
            listNo: old.listNo, revisionNo: old.revisionNo + 1, clientToken, revisionOfId: old.id, name: old.name, customerId: old.customerId,
            currency: old.currency, validFromDate: old.validFromDate, validUntilDate: old.validUntilDate, notes: old.notes, createdById: userId ?? null, updatedById: userId ?? null,
            lines: {
              create: old.lines.map((l) => ({
                lineNo: l.lineNo, itemId: l.itemId, colorId: l.colorId, recipeId: l.recipeId, unitPrice: l.unitPrice, minQty: l.minQty,
                standardCostVersionId: l.standardCostVersionId, costPerMTry: l.costPerMTry, markupPct: l.markupPct,
              })),
            },
          },
          include: PRICE_LIST_INCLUDE,
        });
      });
    } catch (e) {
      if (isUniqueViolation(e) && !isClientTokenP2002(e)) throw AppError.conflict("Bu listenin revizyonu zaten açılmış.", { code: "PRICE_LIST_STATUS_CONFLICT" });
      throw e;
    }
    void AuditService.log({ userId, action: "CREATE", tableName: PRICE_LIST_TABLE, recordId: created.id, oldData: null, newData: { listNo: created.listNo, revisionNo: created.revisionNo, revisionOfId: id } });
    return created;
  });
}

export async function getPriceList(id: string): Promise<PriceListRecord> {
  const l = await prisma.priceList.findUnique({ where: { id }, include: PRICE_LIST_INCLUDE });
  if (!l) throw AppError.notFound("Fiyat listesi bulunamadı.");
  return l;
}

export interface PriceListQuery { durum?: PriceListStatus[]; customerId?: string | { in: string[] } | null; genel?: boolean; currency?: Currency[]; q?: string; cursor?: string; limit?: number }

/** `GET /api/price-lists` — liste + sayım + cursor TEK where'den; özet şeridi durum süzgecinden önceki kümeden. */
export async function listPriceLists(q: PriceListQuery) {
  const base: Prisma.PriceListWhereInput = {
    ...(q.genel ? { customerId: null } : q.customerId ? { customerId: q.customerId } : {}),
    ...(q.currency?.length ? { currency: { in: q.currency } } : {}),
    ...(q.q ? { OR: [{ listNo: { contains: q.q, mode: "insensitive" } }, ...buildTurkishSearch<Prisma.PriceListWhereInput>(q.q, ["name"])] } : {}),
  };
  const where: Prisma.PriceListWhereInput = { AND: [base, ...(q.durum?.length ? [{ status: { in: q.durum } }] : [])] };
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const offset = decodeOffsetCursor(q.cursor);
  const groups = await prisma.priceList.groupBy({ by: ["status"], where: base, _count: { _all: true } });
  const total = await prisma.priceList.count({ where });
  const rows = await prisma.priceList.findMany({
    where, orderBy: [{ listNo: "desc" }, { revisionNo: "desc" }, { id: "asc" }], skip: offset, take: limit,
    include: { customer: { select: { id: true, code: true, name: true } }, _count: { select: { lines: true } } },
  });
  const summary: Record<string, number> = { toplam: 0 };
  for (const g of groups) {
    summary[g.status] = g._count._all;
    summary.toplam += g._count._all;
  }
  return { data: rows, ozet: summary, toplamSuzulen: total, nextCursor: offset + limit < total ? encodeOffsetCursor(offset + limit) : null };
}
