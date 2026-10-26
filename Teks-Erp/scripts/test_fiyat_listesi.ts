// =============================================================================
// test_fiyat_listesi — MAL-4 fiyat listesi yaşam döngüsü (servis yolu)
// =============================================================================
//   §1 taslak + satır replace (aynı ürün+renk iki kez 400) · müşteri rolsüz cari 400
//   §2 ⭐ standart maliyetten doldur: aktif sürüm × (1+kâr) / kur, 2 hane; satırda sürüm/maliyet/kâr DONAR; kur yoksa 400
//   §3 ⭐ yayınla: satırsız 400; yayınlı listenin satırı/başlığı → 409; aynı müşteri+döviz yeni yayın → eskisi ARCHIVED
//   §4 arşivle (PUBLISHED → ARCHIVED; ikinci kez 409) · revizyon (aynı numara, satırlar kopya; ikinci revizyon 409; token replay)
//   §5 ⭐ iki taslağın paralel yayını → sonunda TEK PUBLISHED, 500 yok
//   §6 DB seddi: aynı müşteri+döviz için ikinci PUBLISHED doğrudan yazılamaz
// Çalıştır: npx tsx scripts/test_fiyat_listesi.ts (yalnız test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import * as pl from "../src/services/price-list.service";
import { createStandardCostVersion } from "../src/services/standard-cost.service";
import { suggestUnitPrice } from "../src/services/helpers/fabric-cost.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { altinYapiYaz, fiksturKur, fiksturSil } from "./lib/maliyet-fikstur";
import { teklifFiksturKur, teklifFiksturSil } from "./lib/teklif-fikstur";
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

async function main(): Promise<void> {
  assertGelistirmeVeritabani("test_fiyat_listesi");
  const m = await fiksturKur("TFL");
  const t = await teklifFiksturKur("TFL");
  const mk = (extra: Record<string, unknown> = {}) => pl.createPriceList({ clientToken: randomUUID(), name: `${t.tag} liste`, customerId: t.customerId, currency: "USD", ...extra });
  try {
    await altinYapiYaz(m);
    await createStandardCostVersion(m.fabricId, { fxRates: { USD: "34" }, reason: "liste testi" });
    // §1
    const supplier = await prisma.customer.create({ data: { code: `${t.tag}-S`.slice(0, 32), name: `${t.tag} tedarikçi`, isCustomerRole: false, isSupplierRole: true } });
    const e0 = await hata(() => mk({ customerId: supplier.id }));
    await prisma.customer.delete({ where: { id: supplier.id } });
    check("§1a müşteri rolsüz cari → 400 CUSTOMER_ROLE_REQUIRED", e0?.status === 400 && e0.code === "CUSTOMER_ROLE_REQUIRED");
    const a = await mk();
    const dup = await hata(() => pl.replacePriceListLines(a.id, { lines: [{ itemId: m.fabricId, unitPrice: "1" }, { itemId: m.fabricId, unitPrice: "2" }] }));
    check("§1b aynı ürün+renk iki kez → 400 PRICE_LIST_DUPLICATE_LINE", dup?.status === 400 && dup.code === "PRICE_LIST_DUPLICATE_LINE");
    const a1 = await pl.replacePriceListLines(a.id, { lines: [{ itemId: m.fabricId, unitPrice: "1.50", minQty: "100" }] });
    check("§1c satır replace (taslak)", a1.lines.length === 1 && a1.lines[0]!.unitPrice.toString() === "1.5");

    // §2
    const noFx = await withSetting(SETTING_KEYS.FINANCE_ENABLED, false, () => hata(() => pl.fillFromStandardCost(a.id, { itemIds: [m.fabricId], markupPct: "20" })));
    check("§2a kur yok (finans kapalı, gövdede yok) → 400 FX_RATE_MISSING", noFx?.status === 400 && !!noFx.missing?.includes("FX_RATE_MISSING"));
    const filled = await pl.fillFromStandardCost(a.id, { itemIds: [m.fabricId], markupPct: "20", fxRate: "34" });
    const fl = filled.lines[0]!;
    const exp = suggestUnitPrice({ costPerMTry: D("77.0395"), markupPct: D(20), fxRate: D(34) })!.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    check("§2b ⭐ standart × (1+kâr) / kur, 2 hane", filled.lines.length === 1 && fl.unitPrice.eq(exp), `${fl.unitPrice} ≟ ${exp}`);
    check("§2c satırda sürüm + maliyet + kâr donar; asgari miktar korunur", !!fl.standardCostVersionId && fl.costPerMTry?.toString() === "77.0395" && fl.markupPct?.toString() === "20" && fl.minQty?.toString() === "100");

    // §3
    const empty = await mk();
    const e1 = await hata(() => pl.publishPriceList(empty.id));
    check("§3a satırsız liste yayınlanamaz → 400", e1?.status === 400);
    const pub = await pl.publishPriceList(a.id);
    check("§3b yayınla → PUBLISHED + publishedAt", pub.status === "PUBLISHED" && pub.publishedAt !== null);
    const e2 = await Promise.all([
      hata(() => pl.replacePriceListLines(a.id, { lines: [] })),
      hata(() => pl.updatePriceList(a.id, { name: "x" })),
      hata(() => pl.fillFromStandardCost(a.id, { fxRate: "34" })),
    ]);
    check("§3c ⭐ yayınlı listenin satırı/başlığı → 409 PRICE_LIST_STATUS_CONFLICT", e2.every((e) => e?.status === 409 && e.code === "PRICE_LIST_STATUS_CONFLICT"), JSON.stringify(e2));
    const b = await mk();
    await pl.replacePriceListLines(b.id, { lines: [{ itemId: m.fabricId, unitPrice: "2" }] });
    await pl.publishPriceList(b.id);
    const aAfter = await prisma.priceList.findUniqueOrThrow({ where: { id: a.id } });
    check("§3d ⭐ aynı müşteri+döviz yeni yayın → eskisi ARCHIVED (tek tx)", aAfter.status === "ARCHIVED" && aAfter.archivedAt !== null);

    // §4
    await pl.archivePriceList(b.id);
    const e3 = await hata(() => pl.archivePriceList(b.id));
    check("§4a arşivle → ARCHIVED; ikinci kez 409", (await prisma.priceList.findUniqueOrThrow({ where: { id: b.id } })).status === "ARCHIVED" && e3?.status === 409);
    const tok = randomUUID();
    const rv = await pl.revisePriceList(b.id, { clientToken: tok });
    check("§4b revizyon: aynı numara, revisionNo+1, DRAFT, satırlar kopya", rv.listNo === b.listNo && rv.revisionNo === b.revisionNo + 1 && rv.status === "DRAFT" && rv.lines.length === 1);
    const rv2 = await pl.revisePriceList(b.id, { clientToken: tok });
    check("§4c aynı token → aynı revizyon", rv2.id === rv.id);
    const e4 = await hata(() => pl.revisePriceList(b.id, { clientToken: randomUUID() }));
    check("§4d ikinci revizyon → 409", e4?.status === 409, JSON.stringify(e4));
    const e5 = await hata(() => pl.revisePriceList(empty.id, { clientToken: randomUUID() }));
    check("§4e taslaktan revizyon → 409", e5?.status === 409);

    // §5
    const c1 = await mk();
    const c2 = await mk();
    for (const c of [c1, c2]) await pl.replacePriceListLines(c.id, { lines: [{ itemId: m.fabricId, unitPrice: "3" }] });
    const r = await Promise.allSettled([pl.publishPriceList(c1.id), pl.publishPriceList(c2.id)]);
    const bad = r.filter((x) => x.status === "rejected" && (x.reason as { statusCode?: number }).statusCode !== 409);
    const nPub = await prisma.priceList.count({ where: { customerId: t.customerId, currency: "USD", status: "PUBLISHED" } });
    check("§5 ⭐ paralel yayın → sonunda TEK PUBLISHED, 409 dışı hata yok", nPub === 1 && bad.length === 0, `${nPub} yayınlı, ${r.map((x) => x.status).join("/")}`);

    // §6
    const pubId = (await prisma.priceList.findFirstOrThrow({ where: { customerId: t.customerId, currency: "USD", status: "PUBLISHED" } })).id;
    const other = [c1.id, c2.id].find((x) => x !== pubId)!;
    const raw = await hata(() => prisma.$executeRaw`UPDATE "price_lists" SET "status" = 'PUBLISHED', "publishedAt" = now(), "archivedAt" = NULL WHERE "id" = ${other}::uuid`);
    check("§6 ⭐ DB seddi: ikinci PUBLISHED doğrudan yazılamaz", raw !== null);
  } finally {
    await prisma.priceList.updateMany({ where: { customerId: t.customerId }, data: { revisionOfId: null } });
    await teklifFiksturSil(t);
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
