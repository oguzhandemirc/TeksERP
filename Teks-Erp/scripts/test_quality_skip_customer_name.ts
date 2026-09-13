// =============================================================================
// BEKÇİ — "bu kalitede MÜŞTERİDEKİ AD basılmaz" (QualityGrade.skipCustomerName)
// =============================================================================
// Çalıştır: npx tsx scripts/run-all-tests.ts quality_skip_customer_name
//
// Kullanıcı kararı: "a1 kumaşlarda kim için çıkarsa çıksın bizdeki adı yazsın."
//
// ⚠️ NEDEN BU BEKÇİ VERİYİ KENDİ KURAR — ölçüldü 2026-09-13:
//   sevk edilmiş 2.174 topun TAMAMI 1.KALITE; karışık (sevkiyat,ürün,renk) grubu
//   0/168. Yani özelliğin devreye gireceği durum bu fabrikada HİÇ YAŞANMAMIŞ.
//   Zengin ortamda aramak onu bulamaz; MUTASYONLA (fikstürle) ölçülür.
//
// ÖLÇÜLENLER
//   §0 POZİTİF KONTROL — fikstür gerçekten KARIŞIK satır kurdu mu (§1'den ÖNCE)
//   §1 KARIŞIK satır (1.KALITE + işaretli, aynı ürün+renk) → BİZİM adımız,
//      sütun DURUR, diğer satırlar ETKİLENMEZ
//   §2 SAF 1.KALITE satırı → müşterinin adı (regresyon: politika fazla yakalamıyor)
//   §3 SAF işaretli satır → bizim adımız
//   §4 ÇEKİ satırı TOP başınadır: aynı çuvalda iki top, iki farklı sonuç
//   §5 ETİKET aynı kararı verir (ev kuralı: ad zinciri etiketle AYNI)
//
// NEGATİF SONDA — ÖLÇÜLDÜ, ve İKİ kez koşuldu çünkü ilki YANLIŞ SORUYU ölçtü:
//   ① Katalogdaki damga kaldırıldı → bekçi ÖN KOŞULDA düştü (0 geçti, 1 başarısız).
//      Bu "davranış bozuldu" DEĞİL "fikstür kurulamadı"dır; §1/§3/§4/§5'e hiç
//      ulaşmadı. Bir sondanın kırmızısı, SEBEBİ ölçülmeden kanıt sayılmaz.
//   ② Politika KODU etkisizleştirildi (`skips()` hep false) → 6 geçti, 4 başarısız;
//      düşenler tam olarak §1 · §3 · §4 · §5, §0 (pozitif kontrol) ve §2 (regresyon)
//      YEŞİL kaldı ⇒ sonda yalnız politikanın yönettiği dalları düşürüyor.
//      Geri alma `cp` + `shasum -c` ile doğrulandı.
// =============================================================================
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { ShippingService } from "../src/services/shipping.service";
import { LabelService } from "../src/services/label.service";
import { RollStatus } from "@prisma/client";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const ts = Date.now().toString().slice(-8);
const ALIAS_ITEM = `TST-MUSTERI-ADI-${ts}`;

const rollIds: string[] = [];
const itemIds: string[] = [];
let colorId = "";
let customerId = "";
let sackId = "";
let shipmentId = "";

interface DocProduct { name: string; customerName: string | null }
interface DocCeki { rollId: string; customerDesen: string | null }

async function main(): Promise<void> {
  const shipping = new ShippingService();
  const labels = new LabelService();

  const normal = await roleGrade("FIRST");
  const marked = await prisma.qualityGrade.findFirst({
    where: { skipCustomerName: true, isActive: true },
    select: { id: true, code: true, name: true },
  });
  if (!marked) {
    throw new Error(
      "Fikstür kurulamadı: katalogda `skipCustomerName` işaretli AKTİF kalite yok. " +
        "Migration `20260913200000_quality_skip_customer_name` uygulandı mı?",
    );
  }
  console.log(`\n=== Müşteri adı politikası — işaretli kalite: ${marked.code} (${marked.name}) ===\n`);

  const warehouseId = await fixtureWarehouseId();
  const customer = await prisma.customer.create({
    data: { code: `TST-MAD-C-${ts}`, name: `TEST MÜŞTERİ AD ${ts}` },
    select: { id: true },
  });
  customerId = customer.id;
  const color = await prisma.color.create({
    data: { code: `TST-MAD-R-${ts}`, name: `TEST RENK ${ts}` },
    select: { id: true },
  });
  colorId = color.id;

  // Üç ürün: karışık · saf normal · saf işaretli. Üçünün de MÜŞTERİDE ADI VAR —
  // yani politika olmasaydı üçü de müşterinin adıyla basılırdı.
  const mk = async (suffix: string): Promise<string> => {
    const it = await prisma.item.create({
      data: { code: `TST-MAD-I-${suffix}-${ts}`, name: `TEST ÜRÜN ${suffix} ${ts}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    itemIds.push(it.id);
    await prisma.customerItemAlias.create({
      data: { customerId, itemId: it.id, alias: `${ALIAS_ITEM}-${suffix}` },
    });
    return it.id;
  };
  const itemMixed = await mk("KARISIK");
  const itemPure = await mk("SAF1");
  const itemMarkedOnly = await mk("SAFISARETLI");

  const mkRoll = async (itemId: string, grade: { id: string; code: string }, n: number): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-MAD-${ts}-${n}`,
        itemId, colorId, width: 150, initialQty: 100, currentQty: 100,
        status: RollStatus.WAREHOUSE, warehouseId,
        qualityGrade: grade.code, qualityGradeId: grade.id,
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    return r.id;
  };

  // KARIŞIK satır: aynı ürün + aynı renk + aynı en ⇒ TEK grup, İKİ kalite.
  const rMixedNormal = await mkRoll(itemMixed, normal, 1);
  const rMixedMarked = await mkRoll(itemMixed, marked, 2);
  const rPure = await mkRoll(itemPure, normal, 3);
  const rMarkedOnly = await mkRoll(itemMarkedOnly, marked, 4);

  const sack = (await shipping.openSack({ customerId })) as { data: { id: string } };
  sackId = sack.data.id;
  for (const id of [rMixedNormal, rMixedMarked, rPure, rMarkedOnly]) {
    const bc = (await prisma.roll.findUniqueOrThrow({ where: { id }, select: { barcode: true } })).barcode!;
    await shipping.scanIntoSack({ sackId, barcode: bc });
  }
  const sh = (await shipping.createShipment({ sackIds: [sackId], customerId })) as { data: { id: string } };
  shipmentId = sh.data.id;

  const rep = (await shipping.getDispatchReport(shipmentId)) as {
    data: { products: DocProduct[]; cekiRows: DocCeki[] };
  };
  const products = rep.data.products;
  const ceki = rep.data.cekiRows;

  // ── §0 POZİTİF KONTROL — fikstür gerçekten karışık satır kurdu mu ───────────
  const mixedRollGrades = await prisma.roll.findMany({
    where: { id: { in: [rMixedNormal, rMixedMarked] } },
    select: { qualityGradeId: true },
  });
  const distinct = new Set(mixedRollGrades.map((r) => r.qualityGradeId));
  check("§0 POZİTİF KONTROL: karışık satır GERÇEKTEN kuruldu (tek grup, iki kalite)",
    distinct.size === 2 && mixedRollGrades.length === 2, `${distinct.size} farklı kalite`);
  const rowOf = (itemSuffix: string): DocProduct | undefined =>
    products.find((p) => p.name.includes(`TEST ÜRÜN ${itemSuffix} ${ts}`));
  const mixedRow = rowOf("KARISIK");
  const pureRow = rowOf("SAF1");
  const markedRow = rowOf("SAFISARETLI");
  check("§0 üç satırın üçü de belgede", !!mixedRow && !!pureRow && !!markedRow,
    `${products.length} ürün satırı`);
  check("§0 karışık satır İKİ topu birden topladı", mixedRow?.name !== undefined && products.length === 3);

  // ── §1 KARIŞIK satır → BİZİM adımız ────────────────────────────────────────
  check("§1 karışık satırda müşteri adı BASILMAZ (fail-safe)",
    mixedRow?.customerName === null, `customerName=${String(mixedRow?.customerName)}`);

  // ── §2 SAF 1.KALITE → müşterinin adı (politika FAZLA yakalamıyor) ──────────
  check("§2 saf 1.KALITE satırında müşteri adı BASILIR (regresyon)",
    typeof pureRow?.customerName === "string" && pureRow.customerName.includes(`${ALIAS_ITEM}-SAF1`),
    String(pureRow?.customerName));

  // ── §3 SAF işaretli satır → bizim adımız ───────────────────────────────────
  check("§3 saf işaretli satırda müşteri adı BASILMAZ",
    markedRow?.customerName === null, `customerName=${String(markedRow?.customerName)}`);

  // ── §4 ÇEKİ satırı TOP başına karar verir ──────────────────────────────────
  const cekiOf = (id: string): DocCeki | undefined => ceki.find((c) => c.rollId === id);
  check("§4 çeki: aynı çuvaldaki normal top müşterinin adını taşır",
    typeof cekiOf(rMixedNormal)?.customerDesen === "string", String(cekiOf(rMixedNormal)?.customerDesen));
  check("§4 çeki: aynı çuvaldaki işaretli top TAŞIMAZ (top başına karar)",
    cekiOf(rMixedMarked)?.customerDesen === null, String(cekiOf(rMixedMarked)?.customerDesen));

  // ── §5 ETİKET aynı kararı verir ────────────────────────────────────────────
  const lblNormal = (await labels.getRollLabel(rPure, { customerId })) as {
    data: { itemName: string; itemNameSource: string };
  };
  const lblMarked = (await labels.getRollLabel(rMarkedOnly, { customerId })) as {
    data: { itemName: string; itemNameSource: string };
  };
  check("§5 etiket: normal topta müşterinin adı (MASTER)",
    lblNormal.data.itemNameSource === "MASTER" && lblNormal.data.itemName.includes(ALIAS_ITEM),
    `${lblNormal.data.itemNameSource} / ${lblNormal.data.itemName}`);
  check("§5 etiket: işaretli topta BİZİM adımız (DEFAULT) — belge ile AYNI karar",
    lblMarked.data.itemNameSource === "DEFAULT" && !lblMarked.data.itemName.includes(ALIAS_ITEM),
    `${lblMarked.data.itemNameSource} / ${lblMarked.data.itemName}`);
}

async function cleanup(): Promise<void> {
  if (shipmentId) {
    await prisma.printedDocument.deleteMany({ where: { sourceId: shipmentId } });
    await prisma.sackAllocation.deleteMany({ where: { sack: { shipmentId } } });
  }
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } });
  if (sackId) await prisma.sack.deleteMany({ where: { id: sackId } });
  if (shipmentId) await prisma.shipment.deleteMany({ where: { id: shipmentId } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.customerItemAlias.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  if (colorId) await prisma.color.deleteMany({ where: { id: colorId } });
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
}

main()
  .catch((e) => { console.error("HATA:", e instanceof Error ? e.message : e); fail++; })
  .finally(async () => {
    await cleanup().catch((e) => console.error("temizlik hatası:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===\n`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
