// =============================================================================
// test_teklif_gorunurluk — MAL-4 maliyet görünürlüğü (sürüm detayı · hesaplayıcı fiyatı · dönüşüm yanıtı)
// =============================================================================
//   §1 ⭐ `GET /api/cost/items/:itemId/versions/:versionId` satır dökümüyle; başka ürünün sürümü → 404
//   §2 ⭐ `POST /api/cost/preview` + `pricing` → `teklifFiyati` = `suggestUnitPrice` (kâr varsayılanı aktif set);
//      pricing yoksa null; kur yoksa öneri null + eksik FX_RATE_MISSING (1'e düşmez)
//   §4 ⭐ (MAL-5) `suresiDoldu` görünüm bayrağı · revizyon zinciri/ürün adı include'u · aktör adları
//   §3 ⭐ dönüşüm rotası yanıtı `sendQuoteJson` (→ `quoteViewFor`) üzerinden; `cost:read` yoksa maliyet alanları düşer
// Çalıştır: npx tsx scripts/test_teklif_gorunurluk.ts (yalnız test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { createStandardCostVersion, getStandardCostVersion } from "../src/services/standard-cost.service";
import { previewCost } from "../src/services/cost-calc.service";
import { suggestUnitPrice } from "../src/services/helpers/fabric-cost.helper";
import { quoteViewFor } from "../src/services/helpers/quote-view.helper";
import { convertQuoteToOrder } from "../src/services/sales-quote-convert.service";
import { getQuote, quoteActors } from "../src/services/sales-quote.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { altinYapiYaz, fiksturKur, fiksturSil } from "./lib/maliyet-fikstur";
import { teklifFiksturKur, teklifFiksturSil, teklifYaz } from "./lib/teklif-fikstur";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
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
  assertGelistirmeVeritabani("test_teklif_gorunurluk");
  const m = await fiksturKur("TKG");
  const t = await teklifFiksturKur("TKG");
  try {
    await altinYapiYaz(m);
    const v = await createStandardCostVersion(m.fabricId, { fxRates: { USD: "34" }, reason: "görünürlük testi" });
    const d = (await getStandardCostVersion(m.fabricId, v.id)) as { id: string; standartTlM: string; satirlar?: unknown[] };
    check("§1a ⭐ sürüm detayı satır dökümüyle", d.id === v.id && Array.isArray(d.satirlar) && d.satirlar.length > 0 && d.standartTlM === "77.0395", `${d.satirlar?.length} satır`);
    const e1 = await getStandardCostVersion(m.warpYarnId, v.id).then(() => null, (e: { statusCode?: number }) => e.statusCode);
    check("§1b başka ürünün altında sürüm → 404", e1 === 404);

    const markup = (await prisma.costParameterSet.findUniqueOrThrow({ where: { id: m.paramId }, select: { defaultMarkupPct: true } })).defaultMarkupPct;
    const p = await previewCost({ itemId: m.fabricId, fxRates: { USD: "34" }, pricing: { currency: "USD", fxRate: "34" } });
    const exp = suggestUnitPrice({ costPerMTry: D(p.sonuc!.standartTlM), markupPct: markup, fxRate: D(34) })!;
    check("§2a ⭐ teklifFiyati = suggestUnitPrice (kâr aktif setten)", p.teklifFiyati?.oneriBirimFiyat === exp.toFixed(4) && p.teklifFiyati.karYuzde === markup.toFixed(2), JSON.stringify(p.teklifFiyati));
    const p2 = await previewCost({ itemId: m.fabricId, fxRates: { USD: "34" }, pricing: { currency: "TRY", markupPct: "10" } });
    const exp2 = suggestUnitPrice({ costPerMTry: D(p2.sonuc!.standartTlM), markupPct: D(10), fxRate: D(1) })!;
    check("§2b TRY → kur 1, gövde kârı", p2.teklifFiyati?.oneriBirimFiyat === exp2.toFixed(4) && p2.teklifFiyati.kur === "1");
    const p3 = await previewCost({ itemId: m.fabricId, fxRates: { USD: "34" } });
    check("§2c pricing yok → teklifFiyati null", p3.teklifFiyati === null);
    const p4 = await withSetting(SETTING_KEYS.FINANCE_ENABLED, false, () => previewCost({ itemId: m.fabricId, fxRates: { USD: "34" }, pricing: { currency: "EUR" } }));
    check("§2d ⭐ kur yok → öneri null + FX_RATE_MISSING (1'e düşmez)", p4.teklifFiyati?.oneriBirimFiyat === null && p4.teklifFiyati.eksik === "FX_RATE_MISSING", JSON.stringify(p4.teklifFiyati));

    const src = fs.readFileSync(path.join(__dirname, "../src/routes/quote.routes.ts"), "utf8");
    const block = src.slice(src.indexOf('router.post("/:id/convert"'));
    const body = block.slice(0, block.indexOf("}));"));
    check("§3a ⭐ dönüşüm rotası yanıtı sendQuoteJson üzerinden", /sendQuoteJson\(req, res\)\([^)]*out\.quote/.test(body) && !/res\.status\([^)]*\)\.json/.test(body));
    const qid = await teklifYaz(t, "ACCEPTED", { itemId: m.fabricId });
    const out = await convertQuoteToOrder(qid, { clientToken: randomUUID() }, { permissions: ["quote:convert", "order:write"] });
    const view = quoteViewFor({ permissions: ["quote:read", "quote:convert"] }).quote(out.quote) as Record<string, unknown> & { lines: Array<Record<string, unknown>> };
    check("§3b `cost:read` yok → dönüşüm yanıtında maliyet ve iç not yok", view.lines.every((l) => !("costPerMTry" in l) && !("costSnapshot" in l)) && !("totalCostTry" in view) && !("internalNote" in view));
    // §4 (MAL-5): "süresi doldu" panelde tarih karşılaştırılarak değil, görünümün bayrağıyla; detay aktör adları.
    const expQ = await teklifYaz(t, "SENT", { validDays: -2 });
    const expRec = await getQuote(expQ);
    const ev = quoteViewFor({ permissions: ["quote:read"] }).quote(expRec) as Record<string, unknown>;
    const live = quoteViewFor({ permissions: ["quote:read"] }).quote(await getQuote(await teklifYaz(t, "SENT", { validDays: 10 }))) as Record<string, unknown>;
    check("§4a ⭐ görünüm `suresiDoldu` bayrağı (SENT + geçmiş geçerlilik) — panel hesaplamaz", ev.suresiDoldu === true && live.suresiDoldu === false, `${String(ev.suresiDoldu)}/${String(live.suresiDoldu)}`);
    check("§4b detay include'u revizyon zinciri + kalem ürün/renk adı taşır", "revisionOf" in expRec && "revisedTo" in expRec && expRec.lines.every((l) => "item" in l && "color" in l));
    const actors = await quoteActors({ ...expRec, sentById: expRec.createdById ?? null });
    check("§4c aktör adları yalnız mevcut kimliklerden (boş kimlik → boş harita)", typeof actors === "object" && Object.keys(await quoteActors({ createdById: null, sentById: null, acceptedById: null, rejectedById: null, cancelledById: null, convertedById: null })).length === 0);
  } finally {
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
    process.exit(fail > 0 ? 1 : 0);
  });
