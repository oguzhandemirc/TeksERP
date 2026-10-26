// =============================================================================
// test_teklif_numara — MAL-4 teklif + fiyat listesi numarası DOĞUŞTA (servis yolu)
// =============================================================================
//   §1 teklif numarası `nextSeriesNo("salesQuote")` biçiminde (TKF + yıl + 5 hane), ardışık iki teklif sırayla artar
//   §2 aynı token → aynı teklif (yeni numara ÇEKMEZ); token başka müşteriyle → 409 CLIENT_TOKEN_COLLISION
//   §3 revizyon AYNI numarayı taşır (revisionNo+1) ve sayacı ilerletmez (sonraki teklif +1)
//   §4 fiyat listesi numarası FL + yıl + 4 hane; liste revizyonu aynı numara
// Çalıştır: npx tsx scripts/test_teklif_numara.ts (yalnız test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import { createQuote } from "../src/services/sales-quote.service";
import { reviseQuote, sendQuote } from "../src/services/sales-quote-transitions.service";
import { createPriceList, revisePriceList } from "../src/services/price-list.service";
import { teklifFiksturKur, teklifFiksturSil, type TeklifFikstur } from "./lib/teklif-fikstur";
import { assertGelistirmeVeritabani } from "./db-guard";
import { factoryYmd } from "../src/constants/time";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
async function hata(fn: () => Promise<unknown>): Promise<{ status?: number; code?: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string } };
    return { status: err.statusCode, code: err.details?.code };
  }
}
const seq = (no: string): number => Number(no.slice(-5));

async function main(): Promise<void> {
  assertGelistirmeVeritabani("test_teklif_numara");
  const f: TeklifFikstur = await teklifFiksturKur("TKN");
  const other: TeklifFikstur = await teklifFiksturKur("TKN2");
  const listIds: string[] = [];
  const itemIds: string[] = [];
  try {
    const yyyy = factoryYmd().slice(0, 4);
    const t1 = randomUUID();
    const a = await createQuote({ clientToken: t1, customerId: f.customerId, currency: "TRY" });
    const b = await createQuote({ clientToken: randomUUID(), customerId: f.customerId, currency: "TRY" });
    check("§1a ⭐ numara doğuşta: TKF + yıl + 5 hane", new RegExp(`^TKF${yyyy}\\d{5}$`).test(a.quoteNo), a.quoteNo);
    check("§1b ardışık teklif sırayla artar", seq(b.quoteNo) === seq(a.quoteNo) + 1, `${a.quoteNo} → ${b.quoteNo}`);
    check("§1c TL teklifin kuru 1, kaynak boş", a.fxRate.toString() === "1" && a.fxRateSource === null);

    const again = await createQuote({ clientToken: t1, customerId: f.customerId, currency: "TRY" });
    check("§2a ⭐ aynı token → aynı teklif (yeni numara yok)", again.id === a.id && again.quoteNo === a.quoteNo);
    const coll = await hata(() => createQuote({ clientToken: t1, customerId: other.customerId, currency: "TRY" }));
    check("§2b token başka müşteriyle → 409 CLIENT_TOKEN_COLLISION", coll?.status === 409 && coll.code === "CLIENT_TOKEN_COLLISION", JSON.stringify(coll));

    await prisma.salesQuoteLine.create({
      data: {
        quoteId: a.id, lineNo: 1, description: "numara kalemi", quantity: "10", costPerMTry: "50", markupPct: "10", suggestedUnitPrice: "55",
        unitPrice: "55", priceSource: "MANUAL", lineTotal: "550",
        costSnapshot: { schemaVersion: 1 },
      },
    });
    await sendQuote(a.id);
    const rev = await reviseQuote(a.id, { clientToken: randomUUID() });
    check("§3a ⭐ revizyon aynı numara, revisionNo 2", rev.quoteNo === a.quoteNo && rev.revisionNo === 2);
    const c = await createQuote({ clientToken: randomUUID(), customerId: f.customerId, currency: "TRY" });
    check("§3b revizyon sayacı ilerletmez (sonraki +1)", seq(c.quoteNo) === seq(b.quoteNo) + 1, `${b.quoteNo} → ${c.quoteNo}`);

    const l1 = await createPriceList({ clientToken: randomUUID(), name: "numara listesi", customerId: f.customerId, currency: "USD" });
    listIds.push(l1.id);
    check("§4a ⭐ liste numarası FL + yıl + 4 hane", /^FL\d{4}\d{4}$/.test(l1.listNo), l1.listNo);
    const item = await prisma.item.create({ data: { code: `${f.tag}-K`.slice(0, 32), name: `${f.tag} kumaş`, itemType: "FABRIC" }, select: { id: true } });
    itemIds.push(item.id);
    await prisma.priceListLine.create({ data: { priceListId: l1.id, lineNo: 1, itemId: item.id, unitPrice: "1" } });
    await prisma.priceList.update({ where: { id: l1.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    const l2 = await revisePriceList(l1.id, { clientToken: randomUUID() });
    listIds.push(l2.id);
    check("§4b liste revizyonu aynı numara, revisionNo 2, DRAFT", l2.listNo === l1.listNo && l2.revisionNo === 2 && l2.status === "DRAFT");
  } finally {
    await prisma.priceList.updateMany({ where: { id: { in: listIds } }, data: { revisionOfId: null } });
    await teklifFiksturSil(f);
    await teklifFiksturSil(other);
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
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
