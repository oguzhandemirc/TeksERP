// =============================================================================
// BEKÇİ — TEDARİKÇİ KİMLİĞİNİN TEK ADRESİ KART (rol modeli faz 2, dilim E; 5e ölçümü, dilim A ile aynı sınıf)
// =============================================================================
// Delik: alış siparişi / mal kabul (`supplier-party.helper`) ve hazır alınan levent (`createWarpBeam` PURCHASED)
// bağlı bir fasona `subcontractorId` yazıyordu — kartı varken aynı firmanın ikinci adresi yeniden doğuyordu (göç
// geçmişi toplar, bu yol geleceği açık bırakırdı). Kural: fason bacağı YAZIMDA `resolvePartyToCardTx` (cari hesapla
// AYNI helper) ile karta çözülür; bağsız profil eskisi gibi (varsayılan = bugünkü); okuma iki bacağı da kabul eder.
// §1 bağlı fason → alış siparişi `supplierId = kart`, `subcontractorId` null (kart pasifse 400 — kart kimliktir)
// §2 bağlı fason → mal kabul fişi aynı; bağsız fason → eski yol (`subcontractorId`)
// §3 sipariş↔fiş uyumu ÇÖZÜMDEN SONRA: göç öncesi sipariş (`subcontractorId` bağlı profil) + fişte aynı fason → uyumlu,
//    fiş KARTA yazar; fiş tedarikçisiz → siparişten ÇÖZÜLMÜŞ miras (kart); başka tedarikçi → 400 uyumsuz
// §4 bağlı fason → PURCHASED levent `supplierId = kart`; bağsız → eski yol; SUBCONTRACT kökeni DOKUNULMAZ (fasoncu kalır)
// §5 `resolvePartyToCardTx` tek helper: `supplier-party` ve `warp-beam` servisleri ondan okur (kaynak taraması, kopya yok)
// Negatif sonda (kırmızı görüldü): `resolveSupplierParty` çözüm satırı `declared`a döndürülünce §1/§2/§3 ❌;
// `resolvePurchasedPartyToCard` `return p` yapınca §4 ❌.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; temizlik yalnız `temizle`de.
// Koşum: npx tsx scripts/test_supplier_party_tek_adres.ts
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WarpBeamOrigin } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { purchaseOrderService } from "../src/services/purchase-order.service";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✓" : "✗ FAIL:"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const status = (e: unknown) => (e instanceof AppError ? e.statusCode : -1);
async function hata(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

const T = `TESTTEKADRES${Date.now().toString(36).toUpperCase()}`;
const orderIds: string[] = [];
const receiptIds: string[] = [];
const beamIds: string[] = [];
let itemId = "";
let warehouseId = "";
let specId = "";
let yarnId = "";

async function kartVeProfil(suffix: string, aktifKart = true): Promise<{ customerId: string; subcontractorId: string }> {
  const kart = await prisma.customer.create({
    data: { code: `${T}-${suffix}`, name: `${T} ${suffix}`, isCustomerRole: false, isSupplierRole: true, isSubcontractorRole: true, isActive: aktifKart },
    select: { id: true },
  });
  const prof = await prisma.subcontractor.create({ data: { code: `${T}-${suffix}-F`, name: `${T} ${suffix}`, customerId: kart.id }, select: { id: true } });
  return { customerId: kart.id, subcontractorId: prof.id };
}
type Taraf = { supplierId: string | null; subcontractorId: string | null };
const tarafStr = (t: Taraf | null) => `sup=${t?.supplierId?.slice(0, 8) ?? "-"} sub=${t?.subcontractorId?.slice(0, 8) ?? "-"}`;
async function siparis(p: { supplierId?: string; subcontractorId?: string }): Promise<{ id: string } & Taraf> {
  const r = (await purchaseOrderService.create({ ...p, lines: [{ itemId, qty: 10 }] })).data as unknown as { id: string };
  orderIds.push(r.id);
  const row = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: r.id }, select: { supplierId: true, subcontractorId: true } });
  return { id: r.id, ...row };
}
async function fis(p: { supplierId?: string; subcontractorId?: string; purchaseOrderId?: string }): Promise<{ id: string } & Taraf> {
  const r = (await goodsReceiptService.create({ warehouseId, ...p })).data as { id: string };
  receiptIds.push(r.id);
  const row = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: r.id }, select: { supplierId: true, subcontractorId: true } });
  return { id: r.id, ...row };
}
async function levent(p: { originKind: WarpBeamOrigin; supplierId?: string; subcontractorId?: string }): Promise<Taraf> {
  const r = await createWarpBeam({ warpSpecId: specId, plannedLengthM: 50, ...p });
  beamIds.push(r.data.id);
  return prisma.warpBeam.findUniqueOrThrow({ where: { id: r.data.id }, select: { supplierId: true, subcontractorId: true } });
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU: ${engel}`);
  try {
    const item = await prisma.item.create({ data: { code: `${T}-K`, name: `${T} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
    itemId = item.id;
    const yarn = await prisma.item.create({ data: { code: `${T}-IP`, name: `${T} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
    yarnId = yarn.id;
    const spec = await prisma.warpSpec.create({ data: { code: `${T}-CK`, name: `${T} çözgü`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } });
    specId = spec.id;
    const wh = await prisma.warehouse.create({ data: { code: `${T}-D`, name: `${T} depo` }, select: { id: true } });
    warehouseId = wh.id;
    const bagsiz = await prisma.subcontractor.create({ data: { code: `${T}-BAGSIZ`, name: `${T} Bagsiz` }, select: { id: true } });

    console.log("\n§1 alış siparişi");
    const a = await kartVeProfil("A");
    const po1 = await siparis({ subcontractorId: a.subcontractorId });
    check("⭐ bağlı fasona sipariş → supplierId = kart, subcontractorId null", po1.supplierId === a.customerId && po1.subcontractorId === null, tarafStr(po1));
    const po2 = await siparis({ subcontractorId: bagsiz.id });
    check("bağsız fasona sipariş → eski yol (subcontractorId)", po2.supplierId === null && po2.subcontractorId === bagsiz.id, tarafStr(po2));
    const pasif = await kartVeProfil("P", false);
    const e1 = await hata(() => siparis({ subcontractorId: pasif.subcontractorId }));
    check("bağlı profilin KARTI pasifse 400 (kart kimliktir)", status(e1) === 400 && msg(e1).includes("pasif"), msg(e1));
    const e1b = await hata(() => siparis({ supplierId: a.customerId, subcontractorId: a.subcontractorId }));
    check("ikisi birden → 400 (XOR çağıranda, çözümden önce)", status(e1b) === 400, msg(e1b));

    console.log("\n§2 mal kabul fişi");
    const gr1 = await fis({ subcontractorId: a.subcontractorId });
    check("⭐ bağlı fasona fiş → supplierId = kart, subcontractorId null", gr1.supplierId === a.customerId && gr1.subcontractorId === null, tarafStr(gr1));
    const gr2 = await fis({ subcontractorId: bagsiz.id });
    check("bağsız fasona fiş → eski yol", gr2.supplierId === null && gr2.subcontractorId === bagsiz.id, tarafStr(gr2));
    const gr0 = await fis({});
    check("tedarikçisiz fiş bayt-bayt aynı (iki bacak boş)", gr0.supplierId === null && gr0.subcontractorId === null);

    console.log("\n§3 sipariş ↔ fiş uyumu çözümden SONRA (göç öncesi sipariş bağlı fasonu subcontractorId ile taşır)");
    // Göç öncesi satır: profil BAĞSIZKEN sipariş açılır (subcontractorId yazılır), SONRA kart bağlanır (göç).
    const bKart = await prisma.customer.create({ data: { code: `${T}-B`, name: `${T} B`, isCustomerRole: false, isSupplierRole: true, isSubcontractorRole: true }, select: { id: true } });
    const b = { customerId: bKart.id };
    const bProf = await prisma.subcontractor.create({ data: { code: `${T}-B-F`, name: `${T} B` }, select: { id: true } });
    const poEski = await siparis({ subcontractorId: bProf.id });
    await prisma.subcontractor.update({ where: { id: bProf.id }, data: { customerId: b.customerId } });
    check("zemin: göç öncesi siparişte subcontractorId dolu, profil artık bağlı", poEski.subcontractorId === bProf.id && poEski.supplierId === null);
    const grUyum = await fis({ subcontractorId: bProf.id, purchaseOrderId: poEski.id });
    check("⭐ fişte aynı fason + eski sipariş → UYUMLU (400 yok), fiş KARTA yazdı", grUyum.supplierId === b.customerId && grUyum.subcontractorId === null, tarafStr(grUyum));
    const grMiras = await fis({ purchaseOrderId: poEski.id });
    check("⭐ tedarikçisiz fiş siparişten ÇÖZÜLMÜŞ miras aldı (kart, fason bacağı değil)", grMiras.supplierId === b.customerId && grMiras.subcontractorId === null, tarafStr(grMiras));
    const e3 = await hata(() => fis({ subcontractorId: a.subcontractorId, purchaseOrderId: poEski.id }));
    check("başka tedarikçi (a) + sipariş (b) → 400 uyumsuz", status(e3) === 400 && msg(e3).includes("aynı değil"), msg(e3));

    console.log("\n§4 hazır alınan levent (PURCHASED)");
    const wb1 = await levent({ originKind: WarpBeamOrigin.PURCHASED, subcontractorId: a.subcontractorId });
    check("⭐ bağlı fasondan alınan levent → supplierId = kart, subcontractorId null", wb1.supplierId === a.customerId && wb1.subcontractorId === null, tarafStr(wb1));
    const wb2 = await levent({ originKind: WarpBeamOrigin.PURCHASED, subcontractorId: bagsiz.id });
    check("bağsız fasondan alınan levent → eski yol", wb2.supplierId === null && wb2.subcontractorId === bagsiz.id, tarafStr(wb2));
    const wb3 = await levent({ originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: a.subcontractorId });
    check("SUBCONTRACT kökeni dokunulmaz: fasoncu bağlı olsa da subcontractorId kalır (işi yapan taraf, alış değil)", wb3.subcontractorId === a.subcontractorId && wb3.supplierId === null, tarafStr(wb3));

    console.log("\n§5 tek helper (kaynak taraması)");
    const kok = join(__dirname, "..", "src", "services");
    const oku = (p: string) => readFileSync(join(kok, p), "utf8");
    const helperKullanan = ["helpers/supplier-party.helper.ts", "helpers/finance.helper.ts", "warp-beam.service.ts", "cari.service.ts", "invoice.service.ts"].filter((p) => /resolvePartyToCardTx/.test(oku(p)));
    check("⭐ `resolvePartyToCardTx` beş yazma yüzeyinden okunur (supplier-party · finance · warp-beam · cari · invoice)", helperKullanan.length === 5, helperKullanan.join(","));
    const kopya = ["helpers/supplier-party.helper.ts", "helpers/finance.helper.ts", "warp-beam.service.ts"].filter((p) => /subcontractor\.findUnique\([^)]*select:\s*\{\s*customerId:\s*true\s*\}/.test(oku(p)));
    check("profil→kart okuması KOPYALANMADI (yalnız party-card.helper'da)", kopya.length === 0 && /subcontractor\.findUnique/.test(oku("helpers/party-card.helper.ts")), kopya.join(","));
  } catch (e) {
    fail++;
    console.log(`  ✗ FAIL: beklenmeyen hata — ${msg(e).slice(0, 300)}`);
  } finally {
    await temizle();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
}

async function temizle(): Promise<void> {
  if (beamIds.length > 0) {
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
  }
  if (receiptIds.length > 0) {
    await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } });
  }
  if (orderIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (specId) await prisma.warpSpec.deleteMany({ where: { id: specId } });
  if (yarnId) await prisma.item.deleteMany({ where: { id: yarnId } });
  if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
  if (warehouseId) await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
  await prisma.subcontractor.deleteMany({ where: { code: { startsWith: T } } });
  await prisma.customer.deleteMany({ where: { code: { startsWith: T } } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
