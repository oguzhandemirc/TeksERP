// =============================================================================
// KUMAŞ AÇIĞI HAM/MAMUL METRE BEKÇİSİ (Seyitoğlu I3, 2026-11-12)
// =============================================================================
// Üretim dengesinin `malzemeAcigi`ı MAMUL metredir (talep/depo mamul); ham stok HAM metredir (terbiyede çeker).
// Çıkarmadan önce ham, tek çözücünün çekmesiyle mamul karşılığına çevrilir (`materialGapFinishedM`); iplik
// ihtiyacı açığı `rawMetersFromFinished` ile ham metreye çevirince doğru sonuç (U/(1−s) − H)/(1−w) çıkar.
//   §0 statik: denge helper'ı ve `resolveLengthShrinkPct`i çağırır, elle `ham + yarı mamul` çıkarması yok
//   §1 saf: çekme yok/0/≥100 → bugünkü ifade (bayt-eşit); %6 → ham × 0,94; yarı mamul çevrilmez; kenet 0
//   §2 DB çekme 0: açık ve iplik metresi bugünküyle AYNI (bayt-eşit)
//   §3 DB çekme %6, H=1000: açık 3860 (önce 3800); iplik farkı H·s/(1−s)/(1−w) ≈ 63,83 (w=0) · 67,19 (w=5)
//   §4 yapı çekmesi boş → tarifenin tipik çekmesi (%4) aynı çözücüden
//   §5 diğer denge kolonları (talep/depo/üretimde/üretilecek/ham/yarı mamul) çekmeden bağımsız
// NEGATİF SONDA — 2026-11-12 koşuldu (cp + geri alma):
//   helper'da çekme dalı bugünkü ifadeye döndürülünce (`return max(0, U − (H + Y))` koşulsuz) → §1b/§3a/§3b/§3c/§4 ❌ (5)
//   denge serviste `shrinkPct: null` sabitlenince → §0b/§3a/§3b/§3c/§4 ❌ (5)
// Koşum: npx tsx scripts/test_malzeme_acigi_cekme.ts (kendi _test DB'n)
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, RollEntrySource, RollStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ProductionBalanceService, type BalanceGroup } from "../src/services/production-balance.service";
import { yarnNeedReport } from "../src/services/reports/yarn-need.report.service";
import { finishedMetersFromRaw, materialGapFinishedM, rawMetersFromFinished } from "../src/services/helpers/raw-need.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
/** Düzeltmeden ÖNCEKİ ifade (bugünkü davranışın tanığı). */
const eski = (u: Prisma.Decimal, h: Prisma.Decimal, y: Prisma.Decimal) => Prisma.Decimal.max(0, u.minus(h.plus(y)));

async function withSettings<T>(values: Record<string, boolean | number>, fn: () => Promise<T>): Promise<T> {
  const keys = Object.keys(values);
  const before = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  try {
    for (const k of keys) await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: values[k] }, update: { value: values[k] } });
    return await fn();
  } finally {
    for (const k of keys) {
      const b = before.find((x) => x.key === k);
      if (b) await prisma.systemSetting.update({ where: { key: k }, data: { value: b.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.delete({ where: { key: k } });
    }
  }
}

function bolum0(): void {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const bal = strip(readFileSync(join(__dirname, "../src/services/production-balance.service.ts"), "utf8"));
  check("§0a Denge kumaş açığını YALNIZ `materialGapFinishedM` ile hesaplar (elle ham + yarı mamul çıkarması yok)",
    bal.includes("materialGapFinishedM(") && !/\.minus\(\s*grp\.ham\.plus\(/.test(bal) && !/ham\.plus\(\s*grp\.yariMamul\s*\)/.test(bal));
  check("§0b Denge çekmeyi tek çözücüden okur (`resolveLengthShrinkPct(`) ve helper'a geçirir",
    bal.includes("resolveLengthShrinkPct(") && /shrinkPct:\s*shrinkByItem\.get\(/.test(bal));
  const helper = readFileSync(join(__dirname, "../src/services/helpers/raw-need.helper.ts"), "utf8");
  check("§0c Formüller tek dosyada: `materialGapFinishedM` ve `finishedMetersFromRaw` çözücü dosyasından dışa verilir",
    /export function materialGapFinishedM\(/.test(helper) && /export function finishedMetersFromRaw\(/.test(helper));
}

function bolum1(): void {
  const U = D(5000), H = D(1000), Y = D(200);
  const same = [null, undefined, 0, "0", 100, -3].every((s) => materialGapFinishedM({ toProduceM: U, rawStockM: H, semiFinishedM: Y, shrinkPct: s }).toString() === eski(U, H, Y).toString());
  check("§1a ⭐ Çekme yok/0/≥100/negatif → bugünkü ifade, bayt-eşit (3800)", same);
  const g6 = materialGapFinishedM({ toProduceM: U, rawStockM: H, semiFinishedM: Y, shrinkPct: 6 });
  check("§1b ⭐ Çekme %6: 5000 − 200 − 1000 × 0,94 = 3860", g6.toString() === "3860", g6.toString());
  const ySemi = materialGapFinishedM({ toProduceM: U, rawStockM: D(0), semiFinishedM: Y, shrinkPct: 6 });
  check("§1c Yarı mamul çevrilmez (boyalı gelir): 5000 − 200 = 4800; ham × 0,94 = 940", ySemi.toString() === "4800" && finishedMetersFromRaw(1000, 6)?.toString() === "940", ySemi.toString());
  const kenet = materialGapFinishedM({ toProduceM: D(900), rawStockM: H, semiFinishedM: D(0), shrinkPct: 6 });
  check("§1d Kenet: ham karşılığı (940) üretilecekten (900) büyük → 0", kenet.toString() === "0", kenet.toString());
  const tur = rawMetersFromFinished(finishedMetersFromRaw(1000, 6), 6, null)!;
  check("§1e Ters çift: rawMetersFromFinished(finishedMetersFromRaw(1000)) = 1000", tur.toString() === "1000", tur.toString());
}

interface Olcum { g: BalanceGroup; kumas: Prisma.Decimal }

async function olc(f: MaliyetFikstur, s: number | null, w: number): Promise<Olcum> {
  await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { lengthShrinkPct: s === null ? null : D(s) } });
  const ayar = { [SETTING_KEYS.MALIYET_ENABLED]: true, [SETTING_KEYS.PRODUCTION_ENABLED]: true, [SETTING_KEYS.DOKUMA_ENABLED]: true, [SETTING_KEYS.DOKUMA_WEAVING_WASTE_PCT]: w };
  return withSettings(ayar, async () => {
    const g = ((await new ProductionBalanceService().getBalance({ itemId: f.fabricId })).data ?? []).find((x) => x.itemId === f.fabricId)!;
    const r = await yarnNeedReport({ netle: true, leventDus: false, urunId: f.fabricId });
    return { g, kumas: D(r.ozet.kumasMetre) };
  });
}

async function bolumlerDb(f: MaliyetFikstur): Promise<void> {
  const s0 = await olc(f, 0, 0);
  const s0w5 = await olc(f, 0, 5);
  check("§2a ⭐ Çekme 0: kumaş açığı bugünkü ifadeyle bayt-eşit (3800)",
    !!s0.g && s0.g.malzemeAcigi.toString() === eski(s0.g.uretilecek, s0.g.ham, s0.g.yariMamul).toString() && s0.g.malzemeAcigi.toString() === "3800", s0.g?.malzemeAcigi.toString());
  check("§2b Çekme 0: iplik ham metresi bugünkü (w=0 → 3800,0 · w=5 → 4000,0)", s0.kumas.toFixed(1) === "3800.0" && s0w5.kumas.toFixed(1) === "4000.0", `${s0.kumas} / ${s0w5.kumas}`);

  const s6 = await olc(f, 6, 0);
  const s6w5 = await olc(f, 6, 5);
  check("§3a ⭐ Çekme %6, H=1000: kumaş açığı 3860 mamul metre (önce 3800)", s6.g.malzemeAcigi.toString() === "3860", s6.g.malzemeAcigi.toString());
  const dogru0 = rawMetersFromFinished(D(5000).minus(200), 6, null)!.minus(1000);
  const once0 = rawMetersFromFinished(3800, 6, null)!;
  const fark0 = s6.kumas.minus(once0);
  check("§3b ⭐ İplik ham metresi (U/(1−s) − H) = 4106,4; önceki 4042,6'ya göre fark ≈ H·s/(1−s) = 63,83",
    s6.kumas.toFixed(1) === dogru0.toFixed(1) && fark0.minus(D(1000).mul("0.06").div("0.94")).abs().lte("0.06"), `${s6.kumas} fark=${fark0.toFixed(2)}`);
  const once5 = rawMetersFromFinished(3800, 6, 5)!;
  const fark5 = s6w5.kumas.minus(once5);
  check("§3c Dokuma firesi %5: fark ≈ H·s/(1−s)/(1−w) = 67,19 (beklenen yönde, artış)",
    fark5.gt(0) && fark5.minus(D(1000).mul("0.06").div("0.94").div("0.95")).abs().lte("0.06"), `${s6w5.kumas} fark=${fark5.toFixed(2)}`);

  const tarife = await olc(f, null, 0);
  check("§4 Yapı çekmesi boş → tarifenin tipik çekmesi %4: açık 5000 − 200 − 960 = 3840", tarife.g.malzemeAcigi.toString() === "3840", tarife.g.malzemeAcigi.toString());

  const kolonlar = (g: BalanceGroup) => [g.talep, g.depo, g.uretimde, g.uretilecek, g.ham, g.yariMamul].map(String).join("|");
  check("§5 Diğer denge kolonları çekmeden bağımsız (talep/depo/üretimde/üretilecek/ham/yarı mamul aynı)",
    kolonlar(s0.g) === kolonlar(s6.g) && kolonlar(s0.g) === kolonlar(tarife.g), kolonlar(s6.g));
}

async function main(): Promise<void> {
  console.log("=== KUMAŞ AÇIĞI HAM/MAMUL METRE BEKÇİSİ (I3) ===");
  bolum0();
  bolum1();
  assertGelistirmeVeritabani("test_malzeme_acigi_cekme");
  const f = await fiksturKur("MAC");
  const tag = { startsWith: `${f.tag}-` };
  try {
    await altinYapiYaz(f);
    const cust = await prisma.customer.create({ data: { code: `${f.tag}-M`, name: `${f.tag} müşteri` }, select: { id: true } });
    await prisma.order.create({ data: { orderNumber: `${f.tag}-S`, customerId: cust.id, lines: { create: [{ itemId: f.fabricId, quantity: D(5000) }] } } });
    const wh = await fixtureWarehouseId();
    // 1000 m HAM (KK1 girişi) + 200 m YARI MAMUL — aynı kumaş, renksiz.
    for (const [i, q, semi] of [[0, 1000, false], [1, 200, true]] as const) {
      await prisma.roll.create({
        data: {
          warehouseId: wh, barcode: `${f.tag}-R${i}`, itemId: f.fabricId, initialQty: q, currentQty: q, status: RollStatus.STOCK,
          entrySource: semi ? RollEntrySource.SEMI_FINISHED : RollEntrySource.SUPPLIER_RECEIPT,
        },
      });
    }
    await bolumlerDb(f);
  } finally {
    await prisma.roll.deleteMany({ where: { barcode: tag } });
    await prisma.orderLine.deleteMany({ where: { order: { orderNumber: tag } } });
    await prisma.order.deleteMany({ where: { orderNumber: tag } });
    await prisma.customer.deleteMany({ where: { code: tag } });
    await fiksturSil(f);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
