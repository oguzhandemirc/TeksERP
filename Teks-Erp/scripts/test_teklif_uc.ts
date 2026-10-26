// =============================================================================
// test_teklif_uc — MAL-4 teklif uçlarının servis + kapı davranışı
// =============================================================================
//   §1 oluştur: müşteri rolü yok 400 · USD kur yok (finans kapalı) 400 COST_INPUT_MISSING [FX_RATE_MISSING] · elle kur MANUAL
//   §2 kalem: standart sürümden maliyet (77,0395) + maliyet×kâr önerisi 2 haneye + toplamlar · elle fiyat MANUAL ·
//      MT dışı birim 400 · ürün yok + elle yapı yok 400 · standart yok + kur yok 400 (1'e düşmez)
//   §3 öneri zinciri: yayınlı GENEL liste > maliyet; yayınlı MÜŞTERİ listesi > genel
//   §4 ⭐ SENT teklif DEĞİŞMEZ: kalem ekle/düzenle/sil + başlık → 409 QUOTE_STATUS_CONFLICT
//   §5 kapılar: modül kapalı 403 MODULE_DISABLED · `quote:write` yok 403
//   §6 ⭐ görünürlük: `cost:read` yok → maliyet alanları DÜŞER (sıfırlanmaz), iç not yalnız `quote:write`;
//      rotaların her JSON yanıtı `quoteViewFor`dan geçer
// Çalıştır: npx tsx scripts/test_teklif_uc.ts (yalnız test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import * as quotes from "../src/services/sales-quote.service";
import * as lines from "../src/services/sales-quote-lines.service";
import { sendQuote } from "../src/services/sales-quote-transitions.service";
import { createStandardCostVersion } from "../src/services/standard-cost.service";
import { suggestUnitPrice } from "../src/services/helpers/fabric-cost.helper";
import { quoteViewFor } from "../src/services/helpers/quote-view.helper";
import { requireMaliyetEnabled } from "../src/middlewares/module.middleware";
import { requirePermission } from "../src/middlewares/rbac.middleware";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { teklifFiksturKur, teklifFiksturSil, type TeklifFikstur } from "./lib/teklif-fikstur";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
async function hata(fn: () => Promise<unknown>): Promise<{ status?: number; code?: string; missing?: string[] } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string; missing?: string[] } };
    return { status: err.statusCode, code: err.details?.code, missing: err.details?.missing };
  }
}
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);

async function withSetting<T>(key: string, value: boolean, fn: () => Promise<T>): Promise<T> {
  const onceki = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  try {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return await fn();
  } finally {
    if (onceki) await prisma.systemSetting.update({ where: { key }, data: { value: onceki.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.delete({ where: { key } });
  }
}

const newQuote = (customerId: string, extra: Record<string, unknown> = {}) =>
  quotes.createQuote({ clientToken: randomUUID(), customerId, currency: "USD", fxRate: "34", ...extra });

async function bolum1(t: TeklifFikstur): Promise<void> {
  const nonCustomer = await prisma.customer.create({ data: { code: `${t.tag}-T`.slice(0, 32), name: `${t.tag} tedarikçi`, isCustomerRole: false, isSupplierRole: true } });
  try {
    const e1 = await hata(() => newQuote(nonCustomer.id));
    check("§1a müşteri rolü olmayan cari → 400 CUSTOMER_ROLE_REQUIRED", e1?.status === 400 && e1.code === "CUSTOMER_ROLE_REQUIRED");
  } finally {
    await prisma.customer.delete({ where: { id: nonCustomer.id } });
  }
  const e2 = await withSetting(SETTING_KEYS.FINANCE_ENABLED, false, () => hata(() => quotes.createQuote({ clientToken: randomUUID(), customerId: t.customerId, currency: "USD" })));
  check("§1b ⭐ USD + kur yok (finans kapalı) → 400 COST_INPUT_MISSING [FX_RATE_MISSING]", e2?.status === 400 && e2.code === "COST_INPUT_MISSING" && !!e2.missing?.includes("FX_RATE_MISSING"));
  const q = await newQuote(t.customerId);
  check("§1c elle kur → MANUAL, DRAFT", q.fxRate.toString() === "34" && q.fxRateSource === "MANUAL" && q.status === "DRAFT");
}

async function bolum2(t: TeklifFikstur, m: MaliyetFikstur): Promise<string> {
  const q = await newQuote(t.customerId, { internalNote: "gizli" });
  const markup = (await prisma.costParameterSet.findUniqueOrThrow({ where: { id: m.paramId }, select: { defaultMarkupPct: true } })).defaultMarkupPct;
  const r = await lines.addQuoteLine(q.id, { itemId: m.fabricId, quantity: "100" });
  const l = r.quote.lines[0]!;
  const expected = suggestUnitPrice({ costPerMTry: D("77.0395"), markupPct: markup, fxRate: D(34) })!;
  check("§2a ⭐ standart sürümden maliyet 77,0395 + sürüm bağı", l.costPerMTry.toString() === "77.0395" && l.standardCostVersionId !== null);
  check("§2b öneri = maliyet × (1+kâr) / kur, fiyat 2 haneye, COST_PLUS", l.suggestedUnitPrice.eq(expected) && l.unitPrice.eq(expected.toDecimalPlaces(2)) && l.priceSource === "COST_PLUS", `${l.suggestedUnitPrice} / ${l.unitPrice}`);
  check("§2c satır toplamı + başlık toplamları aynı tx'te", l.lineTotal.eq(l.unitPrice.mul(100)) && r.quote.totalAmount.eq(l.lineTotal) && r.quote.totalCostTry!.eq(D("7703.95")));
  const snap = l.costSnapshot as { schemaVersion?: number; kaynak?: string };
  check("§2d maliyet fotoğrafı katı şema (schemaVersion 1, STANDART)", snap.schemaVersion === 1 && snap.kaynak === "STANDART");
  const r2 = await lines.addQuoteLine(q.id, { itemId: m.fabricId, quantity: "50", unitPrice: "2.40" });
  const l2 = r2.quote.lines[1]!;
  check("§2e elle fiyat → MANUAL, öneri yine saklanır", l2.priceSource === "MANUAL" && l2.unitPrice.toString() === "2.4" && l2.suggestedUnitPrice.eq(expected));
  const e1 = await hata(() => lines.addQuoteLine(q.id, { itemId: m.fabricId, quantity: "5", unit: "KG" }));
  check("§2f MT dışı birim → 400 QUOTE_UNIT_UNSUPPORTED", e1?.status === 400 && e1.code === "QUOTE_UNIT_UNSUPPORTED");
  const e2 = await hata(() => lines.addQuoteLine(q.id, { quantity: "5" }));
  check("§2g ürün de elle yapı da yok → 400", e2?.status === 400);
  const upd = await lines.updateQuoteLine(q.id, l2.id, { unitPrice: null });
  const l2b = upd.lines.find((x) => x.id === l2.id)!;
  check("§2h `unitPrice: null` → öneriye döner (COST_PLUS)", l2b.priceSource === "COST_PLUS" && l2b.unitPrice.eq(expected.toDecimalPlaces(2)));
  return q.id;
}

async function bolum2b(t: TeklifFikstur, m: MaliyetFikstur): Promise<void> {
  const versions = await prisma.standardCostVersion.findMany({ where: { itemId: m.fabricId, status: "ACTIVE" }, select: { id: true } });
  await prisma.standardCostVersion.updateMany({ where: { id: { in: versions.map((v) => v.id) } }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
  try {
    const q = await newQuote(t.customerId);
    const e = await withSetting(SETTING_KEYS.FINANCE_ENABLED, false, () => hata(() => lines.addQuoteLine(q.id, { itemId: m.fabricId, quantity: "10" })));
    check("§2i ⭐ standart yok + iplik kuru yok → 400 COST_INPUT_MISSING (1'e düşmez)", e?.status === 400 && e.code === "COST_INPUT_MISSING" && !!e.missing?.includes("FX_RATE_MISSING"), JSON.stringify(e));
  } finally {
    await prisma.standardCostVersion.updateMany({ where: { id: { in: versions.map((v) => v.id) } }, data: { status: "ACTIVE", supersededAt: null } });
  }
}

async function bolum3(t: TeklifFikstur, m: MaliyetFikstur, generalIds: string[]): Promise<void> {
  const mk = async (customerId: string | null, price: string) => {
    const l = await prisma.priceList.create({
      data: { listNo: `${t.tag}-${price}`.slice(0, 32), clientToken: randomUUID(), name: "test", customerId, currency: "USD", status: "PUBLISHED", publishedAt: new Date(), lines: { create: [{ lineNo: 1, itemId: m.fabricId, unitPrice: price }] } },
      include: { lines: true },
    });
    if (!customerId) generalIds.push(l.id);
    return l;
  };
  // Test DB'de yayınlı genel USD listesi varsa eşsizlik ihlal olur — geçici arşivle.
  const parked = await prisma.priceList.findMany({ where: { status: "PUBLISHED", customerId: null, currency: "USD" }, select: { id: true } });
  await prisma.priceList.updateMany({ where: { id: { in: parked.map((p) => p.id) } }, data: { status: "ARCHIVED", archivedAt: new Date() } });
  try {
    const g = await mk(null, "3.10");
    const q1 = await newQuote(t.customerId);
    const l1 = (await lines.addQuoteLine(q1.id, { itemId: m.fabricId, quantity: "10" })).quote.lines[0]!;
    check("§3a ⭐ yayınlı GENEL liste > maliyet önerisi", l1.priceSource === "PRICE_LIST" && l1.unitPrice.toString() === "3.1" && l1.priceListLineId === g.lines[0]!.id);
    const c = await mk(t.customerId, "2.95");
    const q2 = await newQuote(t.customerId);
    const l2 = (await lines.addQuoteLine(q2.id, { itemId: m.fabricId, quantity: "10" })).quote.lines[0]!;
    check("§3b ⭐ yayınlı MÜŞTERİ listesi > genel liste", l2.priceSource === "PRICE_LIST" && l2.unitPrice.toString() === "2.95" && l2.priceListLineId === c.lines[0]!.id);
    await prisma.priceList.updateMany({ where: { id: { in: [g.id, c.id] } }, data: { status: "ARCHIVED", archivedAt: new Date() } });
  } finally {
    await prisma.priceList.updateMany({ where: { id: { in: parked.map((p) => p.id) } }, data: { status: "PUBLISHED", archivedAt: null } });
  }
}

async function bolum4(quoteId: string): Promise<void> {
  const q = await prisma.salesQuote.findUniqueOrThrow({ where: { id: quoteId }, include: { lines: true } });
  await sendQuote(quoteId);
  const tries = await Promise.all([
    hata(() => lines.addQuoteLine(quoteId, { itemId: q.lines[0]!.itemId, quantity: "1" })),
    hata(() => lines.updateQuoteLine(quoteId, q.lines[0]!.id, { quantity: "7" })),
    hata(() => lines.deleteQuoteLine(quoteId, q.lines[0]!.id)),
    hata(() => quotes.updateQuoteHeader(quoteId, { notes: "değişmesin" })),
    hata(() => lines.refreshQuoteCosts(quoteId)),
  ]);
  check("§4 ⭐ SENT teklif: kalem ekle/düzenle/sil, başlık, tazele → 409 QUOTE_STATUS_CONFLICT", tries.every((e) => e?.status === 409 && e.code === "QUOTE_STATUS_CONFLICT"), JSON.stringify(tries.map((e) => e?.code)));
  const after = await prisma.salesQuote.findUniqueOrThrow({ where: { id: quoteId }, include: { lines: true } });
  check("§4b SENT teklif bayt-aynı kaldı (kalem sayısı, not, toplam)", after.lines.length === q.lines.length && after.notes === q.notes && after.totalAmount.eq(q.totalAmount));
}

async function bolum5(): Promise<void> {
  const gate = (): Promise<{ statusCode?: number; details?: { code?: string } } | null> =>
    new Promise((resolve) => void requireMaliyetEnabled({} as never, {} as never, (err?: unknown) => resolve((err as never) ?? null)));
  const g = await withSetting(SETTING_KEYS.MALIYET_ENABLED, false, gate);
  check("§5a ⭐ modül kapalı → 403 MODULE_DISABLED", g?.statusCode === 403 && g.details?.code === "MODULE_DISABLED");
  const perm = await new Promise<{ statusCode?: number } | null>((resolve) =>
    requirePermission("quote:write")({ user: { userId: "x", permissions: ["quote:read"] } } as never, {} as never, (err?: unknown) => resolve((err as never) ?? null)),
  );
  check("§5b `quote:write` yok → 403", perm?.statusCode === 403);
}

async function bolum6(quoteId: string): Promise<void> {
  const q = await quotes.getQuote(quoteId);
  const salesOnly = quoteViewFor({ permissions: ["quote:read", "quote:write"] }).quote(q) as Record<string, unknown> & { lines: Array<Record<string, unknown>> };
  const costKeys = ["costPerMTry", "markupPct", "suggestedUnitPrice", "costSnapshot", "standardCostVersionId"];
  check("§6a ⭐ `cost:read` yok → kalem maliyet alanları DÜŞER (sıfır değil, anahtar yok)", salesOnly.lines.length > 0 && salesOnly.lines.every((l) => costKeys.every((k) => !(k in l))) && "unitPrice" in salesOnly.lines[0]!);
  check("§6b `cost:read` yok → toplam maliyet ve marj yok", !("totalCostTry" in salesOnly) && !("marj" in salesOnly));
  check("§6c `quote:write` var → iç not görünür", salesOnly.internalNote === "gizli");
  const readOnly = quoteViewFor({ permissions: ["quote:read"] }).quote(q) as Record<string, unknown>;
  check("§6d `quote:write` yok → iç not DÜŞER", !("internalNote" in readOnly));
  const full = quoteViewFor({ permissions: ["quote:read", "quote:write", "cost:read"] }).quote(q) as Record<string, unknown> & { lines: Array<Record<string, unknown>>; marj: { brutMarjTry: string } | null };
  check("§6e `cost:read` → maliyet + marj görünür", full.lines.every((l) => "costPerMTry" in l) && "totalCostTry" in full && full.marj !== null, JSON.stringify(full.marj));
  for (const f of ["quote.routes.ts", "price-list.routes.ts"]) {
    const src = fs.readFileSync(path.join(__dirname, "../src/routes", f), "utf8");
    const raw = [...src.matchAll(/res\.status\([^)]*\)\.json\(([^\n]*)/g)].map((x) => x[1]!);
    const naked = raw.filter((s) => !/quoteViewFor|view\.quote|\.\.\.out/.test(s));
    check(`§6f ⭐ ${f}: her JSON yanıtı görünürlük süzgecinden geçer`, raw.length >= 2 && naked.length === 0, naked.join(" | "));
  }
}

async function main(): Promise<void> {
  assertGelistirmeVeritabani("test_teklif_uc");
  const m = await fiksturKur("TKU");
  const t = await teklifFiksturKur("TKU");
  const generalIds: string[] = [];
  try {
    await altinYapiYaz(m);
    await createStandardCostVersion(m.fabricId, { fxRates: { USD: "34" }, reason: "teklif testi" });
    await bolum1(t);
    const qid = await bolum2(t, m);
    await bolum2b(t, m);
    await bolum3(t, m, generalIds);
    await bolum6(qid);
    await bolum4(qid);
    await bolum5();
  } finally {
    await teklifFiksturSil(t);
    await prisma.priceListLine.deleteMany({ where: { priceListId: { in: generalIds } } });
    await prisma.priceList.deleteMany({ where: { id: { in: generalIds } } });
    await fiksturSil(m);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
