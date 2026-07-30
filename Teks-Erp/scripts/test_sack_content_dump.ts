// =============================================================================
// Test: Çuval İÇERİK DÖKÜMÜ (getContentDump) — top bazlı döküm
// Çalıştır: npx tsx scripts/test_sack_content_dump.ts
//
// Doğrulananlar:
//   1. Seçilen her çuval için TOP BAZLI satırlar döner (barkod + kumaş + renk + en +
//      metre + kalite) — çeki listesinin GRUPLU özeti değil
//   2. rollCount / totalQty içerikle tutarlı; Decimal alanlar NUMBER olarak döner
//      (istemcide Number(...) sarmaya gerek kalmasın)
//   3. Çuvalın KENDİ müşteri/şubesi + brüt kg + notu döner (döküm başlığı için)
//   4. Kartelalar ayrı dizide döner
//   5. Müşterisiz (genel stok) çuval → customer null, hata YOK
//   6. Boş seçim → 400; 201 çuval → 400 (üst sınır)
//   7. Sıralama: sevkiyat bazında GRUPLU (sevkiyata bağlı önce, depodaki sonda)
//   8. ⭐ getSackContents artık çuvalın KENDİ customer/branch'ini döner (sevkiyat
//      yokken de) — editör dökümü bayat prop'a mahkûm kalmasın
//   9. ⭐ REGRESYON: moveRollsToSack FARKLI müşterinin depo çuvalına taşımayı KABUL
//      eder — UI hedef seçicisi bu davranışa dayanıyor (müşteri eşleşmesi aramaz);
//      sevkiyattaki çuvala 409
// =============================================================================

import { RollStatus, RollEntrySource, ShipmentStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { SackSearchService } from "../src/services/sack-search.service";
import { AppError } from "../src/utils/app-error";

const ship = new ShippingService();
const search = new SackSearchService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function expectErr(label: string, fn: () => Promise<unknown>, status: number): Promise<void> {
  let code: number | null = null;
  try { await fn(); } catch (e) { code = e instanceof AppError ? e.statusCode : -1; }
  check(label, code === status, `beklenen ${status}, gelen ${code ?? "(hata YOK)"}`);
}

interface DumpRoll {
  id: string; barcode: string | null; itemName: string; colorName: string | null;
  width: number | null; qty: number; qualityGrade: string | null;
}
interface DumpSack {
  id: string; sackNo: string; seq: number | null; weightKg: number | null; notes: string | null;
  customer: { id: string; name: string } | null;
  branch: { id: string; code: string | null; name: string } | null;
  shipment: { id: string; shipmentNo: string; status: ShipmentStatus } | null;
  rollCount: number; totalQty: number;
  rolls: DumpRoll[];
  swatches: { id: string; barcode: string | null; itemName: string; colorName: string | null }[];
}

const dump = async (ids: string[]): Promise<DumpSack[]> =>
  (await search.getContentDump(ids)).data as DumpSack[];

async function main(): Promise<void> {
  const ts = Date.now();
  // Fixture: seed master-data'sı business-key ile çözülür (hardcoded UUID YASAK).
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { code: "asc" } });
  if (!item) throw new Error("Seed Item bulunamadı — önce `npm run seed`");
  const color = await prisma.color.findFirst({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { code: "asc" } });

  const customer = await prisma.customer.create({
    data: { code: `TST-CDUMP-${ts}`, name: "DÖKÜM TEST MÜŞTERİ" },
    select: { id: true, name: true },
  });
  const otherCustomer = await prisma.customer.create({
    data: { code: `TST-CDUMP2-${ts}`, name: "DÖKÜM TEST MÜŞTERİ 2" },
    select: { id: true, name: true },
  });
  const branch = await prisma.customerBranch.create({
    data: { customerId: customer.id, code: `TSTBR${ts % 100000}`, name: "Döküm Test Şubesi" },
    select: { id: true, code: true, name: true },
  });

  const rollIds: string[] = [];
  const sackIds: string[] = [];
  const swatchIds: string[] = [];
  let shipmentId: string | null = null;

  /** WAREHOUSE'ta satılabilir top üretir (barkodlu) → barkodu döner. */
  const makeRoll = async (qty: number, width: number, grade = "1.KALITE"): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-CDUMP-${ts}-${Math.floor(Math.random() * 1e9)}`,
        itemId: item.id, colorId: color?.id ?? null, width,
        initialQty: qty, currentQty: qty,
        status: RollStatus.WAREHOUSE, qualityGrade: grade,
        entrySource: RollEntrySource.SUPPLIER_RECEIPT,
      },
      select: { id: true, barcode: true },
    });
    rollIds.push(r.id);
    return r.barcode!;
  };

  try {
    // ── Kurulum: iki çuval (biri müşterili+şubeli, biri müşterisiz) ────────────
    const openedA = await ship.openSack({ customerId: customer.id, branchId: branch.id });
    const sackA = (openedA.data as { id: string; sackNo: string });
    sackIds.push(sackA.id);

    const openedB = await ship.openSack({});
    const sackB = (openedB.data as { id: string; sackNo: string });
    sackIds.push(sackB.id);

    const bc1 = await makeRoll(700, 280);
    const bc2 = await makeRoll(640.5, 280, "2.KALITE");
    const bc3 = await makeRoll(520, 240);
    await ship.scanIntoSack({ sackId: sackA.id, barcode: bc1 });
    await ship.scanIntoSack({ sackId: sackA.id, barcode: bc2 });
    await ship.scanIntoSack({ sackId: sackB.id, barcode: bc3 });

    await ship.weighSack({ sackId: sackA.id, weightKg: 412.5 });
    await ship.setSackNotes(sackA.id, "Kenar hatası şüphesi — kontrol edilecek", undefined);

    const swatch = await prisma.swatch.create({
      data: {
        cardNumber: `TST-CD-${ts}`, barcode: `TST-CDSW-${ts}`,
        itemId: item.id, colorId: color?.id ?? null, sackId: sackA.id,
      },
      select: { id: true },
    });
    swatchIds.push(swatch.id);

    // ── 1-4) Müşterili çuvalın dökümü ─────────────────────────────────────────
    const d1 = await dump([sackA.id, sackB.id]);
    check("0) iki çuval döner", d1.length === 2, `${d1.length}`);
    const a = d1.find((s) => s.id === sackA.id)!;
    const b = d1.find((s) => s.id === sackB.id)!;

    check("1a) top bazlı satır sayısı", a.rolls.length === 2, `${a.rolls.length}`);
    check("1b) barkodlar satır bazında döner", a.rolls.every((r) => !!r.barcode) && a.rolls.some((r) => r.barcode === bc1));
    check("1c) kumaş adı satırda", a.rolls.every((r) => r.itemName === item.name));
    check("1d) renk adı satırda", a.rolls.every((r) => r.colorName === (color?.name ?? null)));
    check("1e) kalite satır bazında (gruplanmadı)",
      a.rolls.some((r) => r.qualityGrade === "1.KALITE") && a.rolls.some((r) => r.qualityGrade === "2.KALITE"));

    check("2a) rollCount içerikle tutarlı", a.rollCount === 2, `${a.rollCount}`);
    check("2b) totalQty toplamı doğru", Math.abs(a.totalQty - 1340.5) < 0.001, `${a.totalQty}`);
    check("2c) metre NUMBER tipinde", a.rolls.every((r) => typeof r.qty === "number"));
    check("2d) en NUMBER tipinde", a.rolls.every((r) => typeof r.width === "number"), `${typeof a.rolls[0]?.width}`);
    check("2e) kg NUMBER tipinde", typeof a.weightKg === "number", `${typeof a.weightKg}`);

    check("3a) çuvalın kendi müşterisi döner", a.customer?.id === customer.id);
    check("3b) çuvalın şubesi + ihracat kodu döner", a.branch?.id === branch.id && a.branch?.code === branch.code);
    check("3c) brüt kg döner", Math.abs((a.weightKg ?? 0) - 412.5) < 0.001, `${a.weightKg}`);
    check("3d) not TAM metin döner", a.notes === "Kenar hatası şüphesi — kontrol edilecek");
    check("3e) sackNo döner", a.sackNo === sackA.sackNo);

    check("4a) kartela ayrı dizide", a.swatches.length === 1 && a.swatches[0]!.barcode === `TST-CDSW-${ts}`);
    check("4b) kartela topların arasına karışmadı", a.rolls.every((r) => r.barcode !== `TST-CDSW-${ts}`));
    check("4c) kartelasız çuvalda boş dizi", b.swatches.length === 0);

    // ── 5) Müşterisiz çuval ───────────────────────────────────────────────────
    check("5a) müşterisiz çuval → customer null", b.customer === null);
    check("5b) müşterisiz çuval → branch null", b.branch === null);
    check("5c) müşterisiz çuvalın içeriği yine döner", b.rolls.length === 1 && Math.abs(b.totalQty - 520) < 0.001);
    check("5d) tartılmamış çuval → weightKg null", b.weightKg === null);
    check("5e) notsuz çuval → notes null", b.notes === null);

    // ── 6) Sınırlar ───────────────────────────────────────────────────────────
    // NOT: sınır DEDUPE SONRASI sayıya bakar (getPickList ile aynı) — gerçek maliyet
    // ayrı çuval sayısıdır. Bu yüzden 201 AYRI id üretilir; aynı id'yi 201 kez
    // göndermek meşru bir tek-çuval isteğidir ve reddedilmemeli (6c).
    await expectErr("6a) boş seçim → 400", () => search.getContentDump([]), 400);
    await expectErr(
      "6b) 201 AYRI çuval → 400",
      () => search.getContentDump(Array.from({ length: 201 }, () => crypto.randomUUID())),
      400,
    );
    const dupe = await dump([sackA.id, sackA.id, sackA.id]);
    check("6c) mükerrer id tekilleşir", dupe.length === 1, `${dupe.length}`);

    // ── 7) getSackContents kendi müşteri/şubesini döner ───────────────────────
    const contentsB = (await search.getSackContents(sackB.id)).data as {
      customer: unknown; branch: unknown; shipment: unknown;
    };
    check("7a) müşterisiz+sevkiyatsız çuvalda customer alanı VAR (null)",
      "customer" in contentsB && contentsB.customer === null);
    check("7b) branch alanı VAR (null)", "branch" in contentsB && contentsB.branch === null);

    const contentsA = (await search.getSackContents(sackA.id)).data as {
      customer: { id: string } | null; branch: { id: string; code: string | null } | null;
    };
    check("7c) çuvalın KENDİ müşterisi döner (sevkiyattan bağımsız)", contentsA.customer?.id === customer.id);
    check("7d) çuvalın KENDİ şubesi + kodu döner",
      contentsA.branch?.id === branch.id && contentsA.branch?.code === branch.code);

    // ── 8) REGRESYON: cross-customer taşıma SERBEST ───────────────────────────
    // Sevkiyat kurulmadan ÖNCE koşar: sevk onayı varsayılan KAPALI olduğu için
    // createShipment çuvalı anında DISPATCHED yapar ve geri alınamaz.
    const openedC = await ship.openSack({ customerId: otherCustomer.id });
    const sackC = (openedC.data as { id: string; sackNo: string });
    sackIds.push(sackC.id);

    const movedRoll = (await prisma.roll.findFirst({
      where: { sackId: sackA.id }, select: { id: true },
    }))!;
    const mv = await ship.moveRollsToSack(
      { sackId: sackA.id, rollIds: [movedRoll.id], targetSackId: sackC.id },
      undefined,
    );
    check("8a) FARKLI müşterinin çuvalına taşıma KABUL edilir",
      (mv.data as { moved: number }).moved === 1, `moved=${(mv.data as { moved: number }).moved}`);
    const afterMove = await prisma.roll.findUnique({ where: { id: movedRoll.id }, select: { sackId: true } });
    check("8b) top gerçekten hedef çuvalda", afterMove?.sackId === sackC.id);

    // Müşterisiz çuvala taşıma da serbest (ekran görüntüsündeki senaryo).
    const mv2 = await ship.moveRollsToSack(
      { sackId: sackC.id, rollIds: [movedRoll.id], targetSackId: sackB.id },
      undefined,
    );
    check("8c) MÜŞTERİSİZ çuvala taşıma KABUL edilir", (mv2.data as { moved: number }).moved === 1);

    // ── 9) Sevkiyat sonrası: sıralama + shipment alanı + hedef 409 ─────────────
    // sackB sevk edilir (onay kapalı → anında DISPATCHED).
    const created = await ship.createShipment({ sackIds: [sackB.id], customerId: customer.id }, undefined);
    shipmentId = (created.data as { id: string }).id;

    // orderBy [{shipmentId asc}, {seq asc}]: Postgres ASC'de NULL'ları SONA koyar →
    // sevkiyata bağlı çuvallar önce ve sevkiyat bazında GRUPLU, depodakiler sonda.
    // Amaç zaten gruplama (aynı sevkin çuvalları yan yana), null-önce değil.
    const ordered = await dump([sackA.id, sackB.id]);
    check("9a) sevkiyata bağlı çuval önce, depodaki sonda",
      ordered[0]!.id === sackB.id && ordered[1]!.id === sackA.id, `ilk=${ordered[0]!.sackNo}`);
    check("9b) sevkiyattaki çuvalın sevkiyatı döner", ordered[0]!.shipment?.id === shipmentId);
    check("9c) depodaki çuvalın shipment'ı null", ordered[1]!.shipment === null);

    const stillFree = (await prisma.roll.findFirst({ where: { sackId: sackA.id }, select: { id: true } }))!;
    await expectErr(
      "9d) sevkiyattaki çuvala taşıma → 409",
      () => ship.moveRollsToSack({ sackId: sackA.id, rollIds: [stillFree.id], targetSackId: sackB.id }, undefined),
      409,
    );
  } finally {
    // Cleanup — test kendi yarattığını siler. Sıra: sack↔shipment bağını çöz, sonra sil.
    if (swatchIds.length) await prisma.swatch.updateMany({ where: { id: { in: swatchIds } }, data: { sackId: null, shipmentId: null } });
    if (sackIds.length) await prisma.sack.updateMany({ where: { id: { in: sackIds } }, data: { shipmentId: null, seq: null } });
    if (rollIds.length) await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } });
    if (swatchIds.length) await prisma.swatch.deleteMany({ where: { id: { in: swatchIds } } });
    if (rollIds.length) await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    if (rollIds.length) await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    if (rollIds.length) await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    if (sackIds.length) await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } });
    if (sackIds.length) await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    await prisma.shipmentOrder.deleteMany({ where: { shipment: { customerId: { in: [customer.id, otherCustomer.id] } } } });
    await prisma.shipment.deleteMany({ where: { customerId: { in: [customer.id, otherCustomer.id] } } });
    await prisma.customerBranch.deleteMany({ where: { customerId: customer.id } });
    await prisma.customer.deleteMany({ where: { id: { in: [customer.id, otherCustomer.id] } } });
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
