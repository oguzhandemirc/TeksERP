// =============================================================================
// SATIŞ TEKLİFİ — oluştur · başlık düzenle · detay · liste (MAL-4; plan §3.2, §3.4, §4.3)
// =============================================================================
// Numara DOĞUŞTA (oluşturma tx'inde `nextSeriesNo("salesQuote")`); revizyon yeni sıra çekmez.
// Kur: TRY → 1 · gövdede verilen → MANUAL · yoksa finans önerisi (kaynak boş bırakılır — köprü yalnız
// sayı döndürür) · hiçbiri yoksa 400 COST_INPUT_MISSING [FX_RATE_MISSING] (1 VARSAYILMAZ).
// Başlık düzenlemesi yalnız DRAFT (tx başında `claimDraftQuoteTx`). Kalemler: `sales-quote-lines.service`.
// =============================================================================
import { Prisma, type Currency, type SalesQuoteStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { isClientTokenP2002 } from "../utils/p2002";
import { buildTurkishSearch } from "../utils/query-parser";
import { decodeOffsetCursor, encodeOffsetCursor } from "../utils/cursor";
import { AuditService } from "./audit.service";
import { nextSeriesNo } from "./number-series.service";
import { claimDraftQuoteTx, quoteExpiredWhere, quoteToday } from "./helpers/sales-quote-state.helper";
import { suggestFxRate } from "./helpers/maliyet-bridge.helper";
import { parseDecimalField, parseTextField, PCT_RULE } from "./helpers/cost-input.helper";
import { tokenReplay } from "./helpers/token-replay.helper";
import { QUOTE_INCLUDE, QUOTE_TABLE, readQuoteToken, type QuoteRecord } from "./sales-quote-transitions.service";

const CURRENCIES: readonly Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];
const DAY_MS = 86_400_000;
const DEFAULT_VALID_DAYS = 30;
const FX_RULE = { label: "Kur", min: 0, minExclusive: true, scale: 6 } as const;
const FREIGHT_RULE = { label: "Navlun", min: 0, scale: 4 } as const;
const DAYS_RULE = (label: string) => ({ label, min: 0, max: 3650, scale: 0, integer: true });
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function readCurrency(raw: unknown): Currency {
  if (typeof raw !== "string" || !CURRENCIES.includes(raw as Currency)) throw AppError.badRequest("Geçersiz para birimi.");
  return raw as Currency;
}

function readUuid(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !/^[0-9a-f-]{36}$/i.test(raw)) throw AppError.badRequest(`${label} geçersiz.`);
  return raw;
}

/** "YYYY-MM-DD" → UTC gece yarısı (`@db.Date`); geçersiz biçim 400. */
function readYmd(raw: unknown, label: string): Date {
  if (typeof raw !== "string" || !YMD_RE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw AppError.badRequest(`${label} YYYY-AA-GG biçiminde olmalı.`);
  }
  return new Date(`${raw}T00:00:00Z`);
}

function readValidUntil(body: Record<string, unknown>, quoteDate: Date): Date {
  const until =
    body.validUntilDate !== undefined && body.validUntilDate !== null
      ? readYmd(body.validUntilDate, "Geçerlilik tarihi")
      : new Date(quoteDate.getTime() + Number(parseDecimalField(body.validDays, DAYS_RULE("Geçerlilik süresi (gün)")) ?? DEFAULT_VALID_DAYS) * DAY_MS);
  if (until.getTime() < quoteDate.getTime()) throw AppError.badRequest("Geçerlilik tarihi teklif tarihinden önce olamaz.");
  return until;
}

async function assertCustomer(customerId: string, branchId: string | null): Promise<void> {
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { isCustomerRole: true, isActive: true } });
  if (!c) throw AppError.notFound("Cari bulunamadı.");
  if (!c.isCustomerRole) throw AppError.badRequest("Seçilen carinin müşteri rolü yok; teklif yalnız müşteriye verilir.", { code: "CUSTOMER_ROLE_REQUIRED" });
  if (!c.isActive) throw AppError.badRequest("Pasif cariye teklif verilemez.");
  if (branchId) {
    const b = await prisma.customerBranch.findUnique({ where: { id: branchId }, select: { customerId: true } });
    if (!b || b.customerId !== customerId) throw AppError.badRequest("Şube seçilen müşteriye ait değil.");
  }
}

interface FxPick { fxRate: Prisma.Decimal; fxRateSource: "MANUAL" | null; fxRateDate: Date | null }

/** Kur kararı — TRY 1 · elle MANUAL · finans önerisi (kaynak boş) · yoksa 400 (1'e düşmez). */
async function pickFx(currency: Currency, raw: unknown, quoteDate: Date): Promise<FxPick> {
  if (currency === "TRY") return { fxRate: new Prisma.Decimal(1), fxRateSource: null, fxRateDate: null };
  const given = parseDecimalField(raw, FX_RULE);
  if (given) return { fxRate: given, fxRateSource: "MANUAL", fxRateDate: quoteDate };
  const suggested = await suggestFxRate(currency, quoteDate);
  if (!suggested) {
    throw AppError.badRequest(`${currency} kuru bulunamadı; teklif kurunu elle girin.`, { code: "COST_INPUT_MISSING", missing: ["FX_RATE_MISSING"] });
  }
  return { fxRate: suggested, fxRateSource: null, fxRateDate: quoteDate };
}

/** Başlığın serbest alanları (oluştur + PATCH ortak); `undefined` = dokunma. */
function readHeaderFields(body: Record<string, unknown>) {
  return {
    paymentTermDays: parseDecimalField(body.paymentTermDays, DAYS_RULE("Vade (gün)")),
    financeChargePct: parseDecimalField(body.financeChargePct, PCT_RULE("Vade farkı")),
    commissionPct: parseDecimalField(body.commissionPct, PCT_RULE("Komisyon")),
    freightPerM: parseDecimalField(body.freightPerM, FREIGHT_RULE),
    customerReference: parseTextField(body.customerReference, "Müşteri referansı", 100),
    notes: parseTextField(body.notes, "Not", 1000),
    internalNote: parseTextField(body.internalNote, "İç not", 1000),
  };
}

const intOrNull = (d: Prisma.Decimal | null | undefined): number | null | undefined => (d === undefined ? undefined : d === null ? null : d.toNumber());

function createReplay(customerId: string) {
  return tokenReplay<QuoteRecord, QuoteRecord>({
    find: (db, clientToken) => db.salesQuote.findUnique({ where: { clientToken }, include: QUOTE_INCLUDE }),
    alive: { neverDies: "İptal edilmiş teklif de aynı formun cevabıdır: yeni deneme açmaz, durumu görünür." },
    identity: (p) => [{ ad: "customerId", mevcut: p.customerId, gelen: customerId }],
    collision: (p) => `Bu form daha önce başka bir müşteri için teklif oluşturmuş (${p.quoteNo}). Formu yeniden açın.`,
    respond: (p) => p,
  });
}

/** Seri numara — aynı önekli (yıl) kayıtlar; revizyonlar aynı numarayı taşır, sayaç tekrar etmez. */
function nextQuoteNo(tx: Prisma.TransactionClient): Promise<string> {
  return nextSeriesNo("salesQuote", async (prefix) => {
    const rows = await tx.salesQuote.findMany({ where: { quoteNo: { gte: prefix, startsWith: prefix }, revisionNo: 1 }, select: { quoteNo: true, createdAt: true } });
    return rows.map((r) => ({ code: r.quoteNo, createdAt: r.createdAt }));
  });
}

/** `POST /api/quotes` — DRAFT teklif (kalemsiz); numara doğuşta. */
export async function createQuote(body: Record<string, unknown>, userId?: string): Promise<QuoteRecord> {
  const clientToken = readQuoteToken(body.clientToken);
  const customerId = readUuid(body.customerId, "Müşteri");
  return createReplay(customerId).run(clientToken, async () => {
    const branchId = body.branchId ? readUuid(body.branchId, "Şube") : null;
    const currency = readCurrency(body.currency);
    await assertCustomer(customerId, branchId);
    const quoteDate = quoteToday();
    const validUntilDate = readValidUntil(body, quoteDate);
    const fx = await pickFx(currency, body.fxRate, quoteDate);
    const h = readHeaderFields(body);
    const created = await withBarcodeRetry(
      () =>
        prisma.$transaction(async (tx) => {
          const quoteNo = await nextQuoteNo(tx);
          return tx.salesQuote.create({
            data: {
              quoteNo, clientToken, customerId, branchId, quoteDate, validUntilDate, currency, ...fx,
              paymentTermDays: intOrNull(h.paymentTermDays) ?? null, financeChargePct: h.financeChargePct ?? null,
              commissionPct: h.commissionPct ?? null, freightPerM: h.freightPerM ?? null, customerReference: h.customerReference ?? null,
              notes: h.notes ?? null, internalNote: h.internalNote ?? null, createdById: userId ?? null, updatedById: userId ?? null,
            },
            include: QUOTE_INCLUDE,
          });
        }),
      undefined,
      (e) => !isClientTokenP2002(e),
      "Teklif no",
    );
    void AuditService.log({
      userId, action: "CREATE", tableName: QUOTE_TABLE, recordId: created.id, oldData: null,
      newData: { quoteNo: created.quoteNo, revisionNo: created.revisionNo, customerId, currency, status: created.status },
    });
    return created;
  });
}

/** `PATCH /api/quotes/:id` — yalnız DRAFT; döviz değişmez (kalemler o dövizde fiyatlandı — yeni teklif açılır). */
export async function updateQuoteHeader(id: string, body: Record<string, unknown>, userId?: string): Promise<QuoteRecord> {
  if (body.currency !== undefined) throw AppError.badRequest("Teklifin para birimi değiştirilemez; yeni teklif açın.");
  const h = readHeaderFields(body);
  const branchId = body.branchId === undefined ? undefined : body.branchId ? readUuid(body.branchId, "Şube") : null;
  const fxRate = parseDecimalField(body.fxRate, FX_RULE);
  if (fxRate === null) throw AppError.badRequest("Kur boş bırakılamaz.");
  const before = await prisma.salesQuote.findUnique({ where: { id }, select: { customerId: true, currency: true, quoteDate: true } });
  if (!before) throw AppError.notFound("Teklif bulunamadı.");
  if (branchId) await assertCustomer(before.customerId, branchId);
  if (fxRate && before.currency === "TRY" && !fxRate.eq(1)) throw AppError.badRequest("TL teklifin kuru 1'dir.");
  const validUntilDate = body.validUntilDate === undefined ? undefined : readValidUntil({ validUntilDate: body.validUntilDate }, before.quoteDate);
  const data: Prisma.SalesQuoteUncheckedUpdateInput = {
    ...(branchId !== undefined ? { branchId } : {}),
    ...(validUntilDate ? { validUntilDate } : {}),
    ...(fxRate ? { fxRate, fxRateSource: "MANUAL", fxRateDate: quoteToday() } : {}),
    ...Object.fromEntries(Object.entries({ ...h, paymentTermDays: intOrNull(h.paymentTermDays) }).filter(([, v]) => v !== undefined)),
    updatedById: userId ?? null,
  };
  const q = await prisma.$transaction(async (tx) => {
    await claimDraftQuoteTx(tx, id, userId);
    await tx.salesQuote.update({ where: { id }, data });
    return tx.salesQuote.findUniqueOrThrow({ where: { id }, include: QUOTE_INCLUDE });
  });
  const changed = Object.keys(data).filter((k) => k !== "updatedById" && k !== "internalNote");
  void AuditService.log({ userId, action: "UPDATE", tableName: QUOTE_TABLE, recordId: id, oldData: null, newData: { fields: changed } });
  return q;
}

export async function getQuote(id: string): Promise<QuoteRecord> {
  const q = await prisma.salesQuote.findUnique({ where: { id }, include: QUOTE_INCLUDE });
  if (!q) throw AppError.notFound("Teklif bulunamadı.");
  return q;
}

const ACTOR_KEYS = ["createdById", "sentById", "acceptedById", "rejectedById", "cancelledById", "convertedById"] as const;

/** Zaman çizelgesinin "kim"i: geçiş kolonları FK'sız uuid — ad yalnız detay yanıtında çözülür (MAL-5). */
export async function quoteActors(q: Pick<QuoteRecord, (typeof ACTOR_KEYS)[number]>): Promise<Record<string, string>> {
  const ids = [...new Set(ACTOR_KEYS.map((k) => q[k]).filter((v): v is string => typeof v === "string"))];
  if (ids.length === 0) return {};
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  return Object.fromEntries(users.map((u) => [u.id, u.fullName]));
}

export interface QuoteListQuery {
  durum?: SalesQuoteStatus[];
  customerId?: string | { in: string[] } | null;
  from?: string;
  to?: string;
  suresiDoldu?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
}

const LIST_INCLUDE = {
  customer: { select: { id: true, code: true, name: true } },
  convertedOrder: { select: { id: true, orderNumber: true, status: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.SalesQuoteInclude;
export type QuoteListRow = Prisma.SalesQuoteGetPayload<{ include: typeof LIST_INCLUDE }>;

/**
 * `GET /api/quotes` — süzme SUNUCUDA; özet şeridi durum süzgecinden ÖNCEKİ where'den (müşteri/tarih/arama),
 * liste + sayım + cursor TEK where'den.
 */
export async function listQuotes(q: QuoteListQuery) {
  const base: Prisma.SalesQuoteWhereInput = {
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.from || q.to ? { quoteDate: { ...(q.from ? { gte: readYmd(q.from, "Başlangıç") } : {}), ...(q.to ? { lte: readYmd(q.to, "Bitiş") } : {}) } } : {}),
    ...(q.q ? { OR: [{ quoteNo: { contains: q.q, mode: "insensitive" } }, { customer: { OR: buildTurkishSearch<Prisma.CustomerWhereInput>(q.q, ["code", "name"]) } }] } : {}),
  };
  const where: Prisma.SalesQuoteWhereInput = {
    AND: [base, ...(q.durum?.length ? [{ status: { in: q.durum } }] : []), ...(q.suresiDoldu ? [quoteExpiredWhere()] : [])],
  };
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const offset = decodeOffsetCursor(q.cursor);
  const groups = await prisma.salesQuote.groupBy({ by: ["status"], where: base, _count: { _all: true } });
  const expired = await prisma.salesQuote.count({ where: { AND: [base, quoteExpiredWhere()] } });
  const total = await prisma.salesQuote.count({ where });
  const rows = await prisma.salesQuote.findMany({
    where, include: LIST_INCLUDE, orderBy: [{ quoteDate: "desc" }, { quoteNo: "desc" }, { revisionNo: "desc" }, { id: "asc" }], skip: offset, take: limit,
  });
  const summary: Record<string, number> = { toplam: 0, suresiDoldu: expired };
  for (const g of groups) {
    summary[g.status] = g._count._all;
    summary.toplam += g._count._all;
  }
  return { data: rows, ozet: summary, toplamSuzulen: total, nextCursor: offset + limit < total ? encodeOffsetCursor(offset + limit) : null };
}
