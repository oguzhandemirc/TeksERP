// =============================================================================
// Test: Sevkiyat DETAYI da BRÜT'tür — çuval içeriği iade sonrası boşalmaz
// Çalıştır: npx tsx scripts/test_shipment_detail_gross.ts
//
// ÜÇÜNCÜ VE SON YÜZEY. `test_dispatch_report_gross.ts` fişi/irsaliyeyi,
// `test_shipment_list_gross.ts` listeyi kilitledi; bu test ÇUVAL İÇERİĞİNİ
// kilitler — 2026-08-02 brüt kararının atlanmış tarafı.
//
// SAHA VAKASI (SVK0308260001, 2026-08-03): sevk edildi, 4 top (212 m) iade
// alındı. `RollReturn` topun `sackId` VE `shipmentId` alanlarını NULL'ladığı
// (return.service.ts:322-325) için detay ekranı iki çuvalı da "Eşleşen top yok ·
// 0 top" gösterdi, üst sayaçlar "Top 0 · Toplam Metraj 0 m" oldu. Aynı sevkiyatın
// irsaliyesi 4 top diyordu. "Hangi çuvalda ne gitti" cevabı geriye dönük değişti.
//
// Kilitlenen sözleşmeler:
//   1) İade edilen top ÇUVALIN İÇİNDE kalır ve `returned` ile İŞARETLENİR.
//   2) `sacks[].rollCount` + `productSummary` BRÜT (çuval kg'si zaten brüt).
//   3) `summary.rollCount` / `totalMeters` BRÜT → LİSTE ile birebir aynı rakam.
//   4) `summary.totalKg` DEĞİŞMEZ (iade `Sack.weightKg`'a dokunmuyor; geri-ekleme
//      yapmak çift sayardı).
//   5) İade satırı `sackId = prevSackId` taşır — üst `rolls` dizisinde "çuvalsız"
//      kümesine sızmaz.
//   6) PLANNED sevkiyatta yanıt DEĞİŞMEZ (iade `roll.status=SHIPPED` istediği için
//      PLANNED'da RollReturn doğamaz; ekstra kod dalı da yok).
//   7) İade İPTAL edilince işaret kalkar, top canlıya döner, sayılar AYNI kalır.
//   8) Aynı top İKİ KEZ sayılmaz (canlı + iade kesişimi dedup'lanır).
//
// NEGATİF ÖZELLİK YERLEŞİK: [2]/[3] "raporlanan ≠ canlı" olduğunu da doğrular —
// geri-ekleme kaldırılırsa kırmızı verir (ön koşul kontrolleriyle birlikte).
//
// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `shipping.service.ts:4386` içindeki
//    `...freshReturnRows.map(toReturnedRow)` satırı çıkarıldı (brüt → net) →
//    ÜÇ kontrol KIRMIZI. Geri konunca 33/33 yeşil.
//    ⚠️ Sonda YALNIZ BU bekçiyi kırdı: liste ve rapor brütü AYRI kod yollarından
//    üretiyor ve kendi sondalarını taşıyor (`test_shipment_list_gross`,
//    `test_dispatch_report_gross`). Üç yüzey = üç ayrı hesap = üç ayrı sonda.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { returnService } from "../src/services/return.service";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

interface DetailRoll {
  id: string;
  barcode: string | null;
  currentQty: unknown;
  sackId?: string | null;
  returned?: { returnId: string; returnedAt: Date; reasonName: string | null } | null;
}
interface DetailSack {
  id: string;
  rolls: DetailRoll[];
  rollCount: number;
  returnedCount: number;
  returnedQty: unknown;
  productSummary: { rollCount: number; totalQty: unknown }[];
}
interface Detail {
  data: {
    rolls: DetailRoll[];
    sacks: DetailSack[];
    returnedRolls: { id: string; prevSackId: string | null }[];
    summary: {
      rollCount: number;
      totalMeters: unknown;
      totalKg: unknown;
      returnedCount: number;
      returnedMeters: unknown;
    };
  };
}

const N = (v: unknown) => Number(v);

async function main() {
  const ts = Date.now();
  const admin = await ensureTestAdmin();

  const customer = await prisma.customer.create({
    data: { code: `TST-SDG-${ts}`, name: `TEST SDG MÜŞTERİ ${ts}`, taxNumber: "9998887775" },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-SDG-I-${ts}`, name: `SDG KUMAŞ ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const color = await prisma.color.create({
    data: { code: `TST-SDG-C-${ts}`, name: "SDG EKRU" },
    select: { id: true },
  });

  // İki sevkiyat: biri DISPATCHED (asıl sınama), biri PLANNED (madde 6).
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `TEST-SDG-${ts}`,
      customerId: customer.id,
      status: "DISPATCHED",
      destination: "DOMESTIC",
      dispatchedAt: new Date(),
    },
    select: { id: true },
  });
  const planned = await prisma.shipment.create({
    data: {
      shipmentNo: `TEST-SDG-P-${ts}`,
      customerId: customer.id,
      status: "PLANNED",
      destination: "DOMESTIC",
    },
    select: { id: true },
  });

  const sack = await prisma.sack.create({
    data: { sackNo: `TEST-SDG-SK-${ts}`, customerId: customer.id, shipmentId: shipment.id, seq: 1, weightKg: 60 },
    select: { id: true },
  });
  const plannedSack = await prisma.sack.create({
    data: { sackNo: `TEST-SDG-PSK-${ts}`, customerId: customer.id, shipmentId: planned.id, seq: 1 },
    select: { id: true },
  });

  const mkRoll = (n: number, qty: number, shipId: string, sackId: string, status: "SHIPPED" | "WAREHOUSE") =>
    prisma.roll.create({
      data: {
        barcode: `TEST-SDG-R${n}-${ts}`,
        itemId: item.id,
        colorId: color.id,
        status,
        currentQty: qty,
        initialQty: qty,
        width: 330,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
        shipmentId: shipId,
        sackId,
      },
      select: { id: true, barcode: true },
    });

  const rKeep = await mkRoll(1, 100, shipment.id, sack.id, "SHIPPED");
  const rReturn = await mkRoll(2, 50, shipment.id, sack.id, "SHIPPED");
  const pRoll = await mkRoll(3, 70, planned.id, plannedSack.id, "WAREHOUSE");

  const detail = async (id: string): Promise<Detail["data"]> =>
    ((await shippingService.getShipmentById(id)) as unknown as Detail).data;

  let returnId: string | null = null;

  try {
    // ---------------------------------------------------------------------
    console.log("\n[1] İade ÖNCESİ taban");
    const before = await detail(shipment.id);
    check("taban: çuvalda 2 top", before.sacks[0]?.rollCount === 2, String(before.sacks[0]?.rollCount));
    check("taban: sevkiyat toplamı 150 m", N(before.summary.totalMeters) === 150, String(before.summary.totalMeters));
    check("taban: hiçbir satır iade işaretli değil", before.sacks[0]?.rolls.every((r) => !r.returned) === true);

    const plannedBefore = await detail(planned.id);

    // ---------------------------------------------------------------------
    console.log("\n[2] İade sonrası — ÇUVAL İÇERİĞİ DONUK KALIR");
    returnId = ((await returnService.createReturn(
      { rollId: rReturn.id, reasonText: "TEST — detay brüt sınaması" },
      admin.id,
    )).data as { id: string }).id;

    // Ön koşul: canlı taraf GERÇEKTEN eksildi — yoksa test hiçbir şey ölçmez.
    const liveInSack = await prisma.roll.count({ where: { sackId: sack.id } });
    check("ön koşul — canlı çuval içeriği 1'e düştü", liveInSack === 1, String(liveInSack));

    const after = await detail(shipment.id);
    const sk = after.sacks[0];
    check("çuval BRÜT: 2 top (iade düşürmedi)", sk?.rollCount === 2, String(sk?.rollCount));
    check("brüt ≠ canlı (geri-ekleme fiilen çalıştı)", sk?.rollCount !== liveInSack);
    check("çuval returnedCount = 1", sk?.returnedCount === 1, String(sk?.returnedCount));
    check("çuval returnedQty = 50", N(sk?.returnedQty) === 50, String(sk?.returnedQty));

    const returnedRow = sk?.rolls.find((r) => r.id === rReturn.id);
    check("iade edilen top ÇUVALIN İÇİNDE duruyor", Boolean(returnedRow), returnedRow?.barcode ?? "yok");
    check("iade satırı `returned` ile İŞARETLİ", Boolean(returnedRow?.returned), JSON.stringify(returnedRow?.returned ?? null).slice(0, 80));
    check("iade satırı metrajı sevk anındaki (50 m)", N(returnedRow?.currentQty) === 50, String(returnedRow?.currentQty));
    check("iade satırı sackId = prevSackId (çuvalsız kümesine sızmaz)", returnedRow?.sackId === sack.id, String(returnedRow?.sackId));
    check("kalan top İŞARETSİZ", sk?.rolls.find((r) => r.id === rKeep.id)?.returned == null);
    check("iade satırı SONDA (önce elindeki mal)", sk?.rolls[sk.rolls.length - 1]?.id === rReturn.id);

    check("productSummary BRÜT (2 top)", sk?.productSummary.reduce((n, p) => n + p.rollCount, 0) === 2, String(sk?.productSummary.reduce((n, p) => n + p.rollCount, 0)));
    check("productSummary metrajı BRÜT (150 m)", sk?.productSummary.reduce((n, p) => n + N(p.totalQty), 0) === 150);

    // ---------------------------------------------------------------------
    console.log("\n[3] Üst sayaçlar BRÜT + kg DEĞİŞMEZ");
    check("summary.rollCount = 2 (brüt)", after.summary.rollCount === 2, String(after.summary.rollCount));
    check("summary.totalMeters = 150 (brüt)", N(after.summary.totalMeters) === 150, String(after.summary.totalMeters));
    check("summary.totalKg = 60 (iade tartıya dokunmaz)", N(after.summary.totalKg) === 60, String(after.summary.totalKg));
    check("summary.returnedCount = 1", after.summary.returnedCount === 1, String(after.summary.returnedCount));
    check("summary.returnedMeters = 50", N(after.summary.returnedMeters) === 50, String(after.summary.returnedMeters));
    // ÇİFT SAYIM TUZAĞI: üst dizi ile sayaç AYNI kaynaktan türemeli.
    check("data.rolls.length = summary.rollCount (çift sayım yok)", after.rolls.length === after.summary.rollCount, `${after.rolls.length} vs ${after.summary.rollCount}`);
    // Aynı top iki kez görünmesin (canlı + iade kesişimi).
    const ids = after.rolls.map((r) => r.id);
    check("aynı top İKİ KEZ sayılmıyor", new Set(ids).size === ids.length, `${ids.length} satır / ${new Set(ids).size} benzersiz`);
    // Çuval toplamları sevkiyat toplamıyla tutuyor mu?
    const sackSum = after.sacks.reduce((n, s) => n + s.rollCount, 0);
    check("Σ çuval top adedi = sevkiyat top adedi", sackSum === after.summary.rollCount, `${sackSum} vs ${after.summary.rollCount}`);

    // ---------------------------------------------------------------------
    console.log("\n[4] PLANNED sevkiyat — yanıt DEĞİŞMEDİ");
    const plannedAfter = await detail(planned.id);
    check("PLANNED: çuval içeriği canlı kaldı", plannedAfter.sacks[0]?.rollCount === plannedBefore.sacks[0]?.rollCount, `${plannedAfter.sacks[0]?.rollCount}`);
    check("PLANNED: hiç iade satırı yok", plannedAfter.summary.returnedCount === 0, String(plannedAfter.summary.returnedCount));
    check("PLANNED: top hâlâ çuvalda", plannedAfter.sacks[0]?.rolls.some((r) => r.id === pRoll.id) === true);
    check("PLANNED: hiçbir satır işaretli değil", plannedAfter.sacks[0]?.rolls.every((r) => !r.returned) === true);

    // ---------------------------------------------------------------------
    console.log("\n[5] İade İPTALİ — işaret kalkar, sayılar aynı kalır");
    await returnService.cancelReturn(returnId, "TEST — iptal sınaması", admin.id);
    returnId = null;
    const restored = await detail(shipment.id);
    check("iptal sonrası çuval yine 2 top", restored.sacks[0]?.rollCount === 2, String(restored.sacks[0]?.rollCount));
    check("iptal sonrası returnedCount = 0", restored.sacks[0]?.returnedCount === 0, String(restored.sacks[0]?.returnedCount));
    check("iptal sonrası hiçbir satır işaretli değil", restored.sacks[0]?.rolls.every((r) => !r.returned) === true);
    check("iptal sonrası toplam yine 150 m", N(restored.summary.totalMeters) === 150, String(restored.summary.totalMeters));
    check("iptal sonrası top canlı olarak çuvalda", (await prisma.roll.count({ where: { sackId: sack.id } })) === 2);
  } finally {
    if (returnId) {
      await returnService.cancelReturn(returnId, "TEST cleanup", admin.id).catch(() => {});
    }
    const rollIds = [rKeep.id, rReturn.id, pRoll.id];
    await prisma.rollReturn.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, shipment.id, planned.id] } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [shipment.id, planned.id] } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: [sack.id, plannedSack.id] } } });
    await prisma.sack.deleteMany({ where: { id: { in: [sack.id, plannedSack.id] } } });
    await prisma.shipment.deleteMany({ where: { id: { in: [shipment.id, planned.id] } } });
    await prisma.color.delete({ where: { id: color.id } }).catch(() => {});
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
    console.log("(temizlendi — TEST-SDG fixture'ları silindi)");
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
