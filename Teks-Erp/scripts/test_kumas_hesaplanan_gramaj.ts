// =============================================================================
// KUMAŞ HESAPLANAN GRAMAJ BEKÇİSİ — `GET /api/items/:id/computed-gsm` (Seyitoğlu temel, 2026-11-11)
// =============================================================================
// Sözleşme: {rawWidthCm, warpGPerM, weftGPerM, totalGPerM, gsm, enteredRawGsm, diffPct}, her alan
// number|null; kg/m maliyet motorunun `yarnUsagePerM(…, {includeWaste:false})`inden (tek kaynak).
//   §1 tam yapı: gsm = elle hesap (çözgü N·d/9e6/(1−t) + atkı p·100·L·Σsⱼdⱼ/9e6) ÷ (en/100)
//   §2 fire payı değişince gsm DEĞİŞMEZ (fireler hariç); fireli kullanım değişir
//   §3 varsayılan `yarnUsagePerM` bayt-aynı (includeWaste yok = true = fireli eski formül)
//   §4 ürün yazma yolu panel biçimi: "300.5" NOKTALI METİN kabul; null temizler; diffPct doğru
//   §5 eksik veri → null (0 ya da hata değil); kumaş olmayan kart → kg alanları null
//   §6 ürün yok → 404; route `item:read` kapılı ve `/api/items`ten önce bağlı
//
// NEGATİF SONDA — 2026-11-11 koşuldu (cp + geri alma):
//   servisteki `{ includeWaste: false }` sökülünce → §1a/§2a ❌ · `layersOk` şartı sökülmedi (katman
//   bekçisi `test_cozgu_katman_motor` ölçer) · route izni `item:write` yapılınca → §6b ❌
// Koşum: npx tsx scripts/test_kumas_hesaplanan_gramaj.ts
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ItemType, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { itemService } from "../src/routes/item.routes";
import { computedGsmForItem } from "../src/services/fabric-gsm.service";
import { buildCostInput, loadCostStructureSourcesTx } from "../src/services/helpers/cost-assembler.helper";
import { yarnUsagePerM } from "../src/services/helpers/fabric-cost.helper";
import { ensureTestAdmin } from "./fixture-test-user";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const r2 = (d: Prisma.Decimal): number => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
const SRC = join(__dirname, "..", "src");

// Fikstür: 9600 tel × 75 den, take-up %6; atkı 28/cm, tarak eni 310 cm, 150 + 300 den (1:1); ham en 300
const WARP_G = D(9600).mul(75).div(9_000_000).div(D(1).minus("0.06")).mul(1000);
const WEFT_G = D(28).mul(100).mul("3.1").mul(D(150).plus(300).div(2)).div(9_000_000).mul(1000);
const TOTAL_G = WARP_G.plus(WEFT_G);
// Tarak eni yoksa atkı boyu maliyet yedeğiyle ham en + kenar payı = 304 cm (`buildCostInput` §4)
const WEFT_304_G = D(28).mul(100).mul("3.04").mul(D(150).plus(300).div(2)).div(9_000_000).mul(1000);

let f: MaliyetFikstur | null = null;
const extra: string[] = [];

async function usage(itemId: string, includeWaste?: boolean) {
  const src = await loadCostStructureSourcesTx(prisma as unknown as Prisma.TransactionClient, [itemId]);
  const input = buildCostInput(src, { itemId });
  return { input, u: includeWaste === undefined ? yarnUsagePerM(input) : yarnUsagePerM(input, { includeWaste }) };
}

async function main(): Promise<void> {
  console.log("\n=== Kumaş hesaplanan gramaj ===\n");
  const admin = await ensureTestAdmin();
  f = await fiksturKur("TEST-GSM-");

  // §1 tam yapı (yapı satırı yok → fireler PARAMETRE; gramaj firesiz olduğundan önemsiz)
  const a = await computedGsmForItem(f.fabricId);
  check(
    "§1a ⭐ gsm = elle hesap (çözgü + atkı g/m ÷ 3 m)",
    a.gsm === r2(TOTAL_G.div(3)) && a.warpGPerM === r2(WARP_G) && a.weftGPerM === r2(WEFT_G) && a.totalGPerM === r2(TOTAL_G) && a.rawWidthCm === 300,
    JSON.stringify(a),
  );
  check("§1b girilen ham gramaj yok → enteredRawGsm ve diffPct null", a.enteredRawGsm === null && a.diffPct === null);

  // §2 fire payları değişir (yapı: çözgü %2,5, atkı %3) → gramaj aynı, fireli kullanım farklı
  const before = (await usage(f.fabricId)).u.warp?.kgPerM;
  await altinYapiYaz(f);
  await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { warpWastePct: D(9), weftWastePct: D(7) } });
  const b = await computedGsmForItem(f.fabricId);
  const after = (await usage(f.fabricId)).u.warp?.kgPerM;
  check("§2a ⭐ fire %9/%7 yapılınca gsm değişmez (fireler hariç)", b.gsm === a.gsm && b.totalGPerM === a.totalGPerM, `${a.gsm} → ${b.gsm}`);
  check("§2b kontrol: fireli kullanım değişti (sonda gerçekten fireyi oynattı)", !!before && !!after && !before.eq(after));

  // §3 varsayılan çağrı = includeWaste:true = eski formül (N·d/9e6/(1−t)/(1−f))
  const { u: def } = await usage(f.fabricId);
  const { u: tru } = await usage(f.fabricId, true);
  const { u: net } = await usage(f.fabricId, false);
  const expWarp = D(9600).mul(75).div(9_000_000).div(D(1).minus("0.06")).div(D(1).minus("0.09"));
  check("§3a varsayılan `yarnUsagePerM` bayt-aynı (fireli, eski formül)", !!def.warp && def.warp.kgPerM.eq(expWarp) && JSON.stringify(def) === JSON.stringify(tru), def.warp?.kgPerM.toString());
  check("§3b includeWaste:false çözgüsü = fireli × (1 − f)", !!net.warp && r2(net.warp.kgPerM.mul(1000)) === r2(WARP_G));

  // §4 ürün yazma yolu — panel NOKTALI METİN gönderir, silinince null
  await itemService.update(f.fabricId, { rawWidthCm: "300.5", rawGsm: "110.5", finishedGsm: "95.25" }, admin.id);
  const row = await prisma.item.findUnique({ where: { id: f.fabricId }, select: { rawWidthCm: true, rawGsm: true, finishedGsm: true } });
  check("§4a ürün yazma \"300.5\" / \"110.5\" / \"95.25\" metinlerini kabul eder", row?.rawWidthCm?.toString() === "300.5" && row?.rawGsm?.toString() === "110.5" && row?.finishedGsm?.toString() === "95.25", JSON.stringify(row));
  const c = await computedGsmForItem(f.fabricId);
  const gsmC = TOTAL_G.div(D("300.5").div(100));
  check("§4b en 300,5 → gsm = toplam ÷ 3,005", c.gsm === r2(gsmC) && c.rawWidthCm === 300.5, JSON.stringify(c));
  check("§4c ⭐ diffPct = (girilen − hesaplanan) ÷ hesaplanan × 100", c.enteredRawGsm === 110.5 && c.diffPct === r2(D("110.5").minus(gsmC).div(gsmC).mul(100)), String(c.diffPct));
  await itemService.update(f.fabricId, { rawGsm: null, rawWidthCm: null }, admin.id);
  const d = await computedGsmForItem(f.fabricId);
  check("§4d null temizler → enteredRawGsm/diffPct null; en yok → gsm null, g/m duruyor", d.enteredRawGsm === null && d.diffPct === null && d.gsm === null && d.rawWidthCm === null && d.totalGPerM === r2(TOTAL_G), JSON.stringify(d));

  // §5 eksik veri
  const noWarp = await prisma.item.create({
    data: { code: `${f.tag}-NW`, name: `${f.tag} çözgüsüz`, itemType: ItemType.FABRIC, weftSpecId: f.weftSpecId, rawWidthCm: D(300), rawGsm: D(100) },
    select: { id: true },
  });
  extra.push(noWarp.id);
  const e = await computedGsmForItem(noWarp.id);
  check("§5a çözgü kartı yok → warpGPerM/totalGPerM/gsm/diffPct null; atkı (tarak eni yok → ham en + 4 cm pay) ve girilen değer duruyor", e.warpGPerM === null && e.totalGPerM === null && e.gsm === null && e.diffPct === null && e.weftGPerM === r2(WEFT_304_G) && e.enteredRawGsm === 100, JSON.stringify(e));
  const y = await computedGsmForItem(f.warpYarnId);
  check("§5b kumaş olmayan kart → hata yok, kg alanları null", y.warpGPerM === null && y.weftGPerM === null && y.gsm === null);

  // §6 404 + route kapısı
  let status: number | null = null;
  try {
    await computedGsmForItem("00000000-0000-4000-8000-000000000000");
  } catch (err) {
    status = (err as { statusCode?: number }).statusCode ?? null;
  }
  check("§6a ürün yok → 404", status === 404, String(status));
  const route = readFileSync(join(SRC, "routes", "item-computed-gsm.routes.ts"), "utf8");
  const app = readFileSync(join(SRC, "app.ts"), "utf8");
  const gsmAt = app.indexOf('app.use("/api/items/:id/computed-gsm"');
  const itemsAt = app.search(/app\.use\("\/api\/items",/);
  check("§6b route kapısı dosya başında: router.use(verifyToken, requirePermission(\"item:read\"))", /router\.use\(verifyToken,\s*requirePermission\("item:read"\)\)/.test(route));
  check("§6c app.ts: computed-gsm, /api/items'ten ÖNCE bağlı", gsmAt >= 0 && itemsAt >= 0 && gsmAt < itemsAt, `${gsmAt} / ${itemsAt}`);
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ Beklenmeyen hata:", e);
  })
  .finally(async () => {
    try {
      if (extra.length) await prisma.item.deleteMany({ where: { id: { in: extra } } });
      if (f) await fiksturSil(f);
    } catch (e) {
      fail++;
      console.error("❌ Temizlik hatası:", e);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
