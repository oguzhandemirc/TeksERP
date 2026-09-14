// TEST: Envanter "Fasonda" fason görünürlüğü — üç yüzeyin (özet ucu, liste
// include'u, liste filtresi) F85 açık-kalem tanımını PAYLAŞTIĞINI ve sayıların
// birbirinden SAPMADIĞINI doğrular.
//
// FİXTURE: kendi fason sevkini yaratır — gerçek firmalı, kategorili (adımın
// `requiredCategoryId`si) ve fire kalitede bir topu olan açık kalem. Ortamdaki
// AT_SUBCONTRACTOR toplarına bağlanmaz: veri yokken "firmalı top yok" diye
// 7 kontrol her temiz DB'de atlanıyordu. Invariant'lar hâlâ DB'nin TAMAMI
// üzerinde ölçülür (fixture yalnız kümenin boş kalmamasını sağlar); silme
// `finally`de ve yalnız kendi ürettiği kimliklere bağlı.
//
// Çalıştır: npx tsx scripts/test_fason_visibility.ts
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { atlamaDefteri } from "./lib/atlama";
import { InventoryService } from "../src/services/inventory.service";
import { Request } from "express";

const TAG = `TEST-FV-${Date.now()}`;
const ids = {
  category: null as string | null,
  sub: null as string | null,
  station: null as string | null,
  wo: null as string | null,
  step: null as string | null,
  batch: null as string | null,
  dispatch: null as string | null,
  dispatchItems: [] as string[],
  rolls: [] as string[],
};

/** Açık fason kalemi: firma (tek kategorili) → adım (requiredCategory) → sevk → 2 top (biri fire). */
async function fixtureKur(scrapCode: string, scrapGradeId: string): Promise<void> {
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  if (!item) throw new Error("Seed fixture eksik: PATOS (npm run seed:fixtures)");
  const kategori = await prisma.subcontractorCategory.create({
    data: { code: `${TAG}-K`, name: `Fason görünürlük ${TAG}` },
    select: { id: true },
  });
  ids.category = kategori.id;
  const sub = await prisma.subcontractor.create({
    data: { code: `${TAG}-F`, name: `Fason firma ${TAG}`, categories: { create: [{ categoryId: kategori.id }] } },
    select: { id: true },
  });
  ids.sub = sub.id;
  const station = await prisma.station.create({
    data: { code: `${TAG}-STN`, name: `Fason istasyonu ${TAG}`, type: "EXTERNAL" },
    select: { id: true },
  });
  ids.station = station.id;
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" },
    select: { id: true },
  });
  ids.wo = wo.id;
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, requiredCategoryId: kategori.id },
    select: { id: true },
  });
  ids.step = step.id;
  const batch = await prisma.batch.create({ data: { batchNumber: `${TAG}-B`, workOrderId: wo.id }, select: { id: true } });
  ids.batch = batch.id;
  const dispatch = await prisma.subcontractorDispatch.create({
    data: { dispatchNo: `${TAG}-SD`, workOrderId: wo.id, batchId: batch.id, stepId: step.id, subcontractorId: sub.id },
    select: { id: true },
  });
  ids.dispatch = dispatch.id;
  const toplar: Array<{ qty: number; fire: boolean }> = [{ qty: 120, fire: false }, { qty: 35, fire: true }];
  for (const [i, t] of toplar.entries()) {
    const r = await prisma.roll.create({
      data: {
        itemId: item.id, initialQty: t.qty, currentQty: t.qty, status: "AT_SUBCONTRACTOR",
        entrySource: "SUPPLIER_RECEIPT", barcode: `${TAG}-R${i}`,
        ...(t.fire ? { qualityGrade: scrapCode, qualityGradeId: scrapGradeId } : {}),
      },
      select: { id: true },
    });
    ids.rolls.push(r.id);
    const di = await prisma.subcontractorDispatchItem.create({
      data: { dispatchId: dispatch.id, rollId: r.id, dispatchedQty: t.qty },
      select: { id: true },
    });
    ids.dispatchItems.push(di.id);
  }
}

/** Teardown — yalnız kendi ürettiği kimlikler, FK sırasıyla. */
async function fixtureTemizle(): Promise<void> {
  if (ids.dispatchItems.length) await prisma.subcontractorDispatchItem.deleteMany({ where: { id: { in: ids.dispatchItems } } });
  if (ids.dispatch) await prisma.subcontractorDispatch.deleteMany({ where: { id: ids.dispatch } });
  if (ids.rolls.length) await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
  if (ids.batch) await prisma.batch.deleteMany({ where: { id: ids.batch } });
  if (ids.step) await prisma.workOrderStep.deleteMany({ where: { id: ids.step } });
  if (ids.wo) await prisma.workOrder.deleteMany({ where: { id: ids.wo } });
  if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
  if (ids.sub) await prisma.subcontractor.deleteMany({ where: { id: ids.sub } });
  if (ids.category) await prisma.subcontractorCategory.deleteMany({ where: { id: ids.category } });
}

const svc = new InventoryService();
// pageSize 500 = MAX_PAGE_SIZE; AT_SUBCONTRACTOR kümesi dev DB'de bunun altında.
const reqOf = (q: Record<string, string>) =>
  ({ query: { pageSize: "500", ...q } } as unknown as Request);

let pass = 0;
let fail = 0;
// Atlama SAYI ile beyan edilir; sessiz `console.log` koşucuya ulaşmaz.
const ATLAMA = atlamaDefteri(() => {
  fail++;
});
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main(): Promise<void> {
  console.log("\n=== Fason görünürlüğü (Envanter → Fasonda) ===\n");

  const scrap = await roleGrade("SCRAP");
  await fixtureKur(scrap.code, scrap.id);

  // --- 1) Özet ucu: SQL çalışır + şekil doğru ---
  const summary = (await svc.getRollSubcontractorSummary()).data;
  check("özet ucu SQL'i hatasız çalışır ve şekli döndürür",
    Array.isArray(summary.bySubcontractor) &&
      Array.isArray(summary.byCategory) &&
      typeof summary.total?.rollCount === "number");

  const sumCat = summary.byCategory.reduce((a, c) => a + c.rollCount, 0);
  const sumFirm = summary.bySubcontractor.reduce((a, f) => a + f.rollCount, 0);
  const qtyCat = Math.round(summary.byCategory.reduce((a, c) => a + c.totalQty, 0) * 10) / 10;

  // --- 2) Toplam tutarlılığı: total == Σcat == Σfirm == DB sayımı (FIRE-hariç) ---
  // ⚠️ Referans sayım KODU DEĞİL ROLÜ sorar. Kod yazılsaydı, kataloğu farklı olan
  // bir kurulumda `not: "FIRE"` HİÇBİR satırı elemez: servis fireyi doğru dışlar,
  // bu sayım dışlamaz ve kontrol ya sahte kırmızı ya sahte yeşil verir.
  const scrapCode = scrap.code;
  const dbCount = await prisma.roll.count({
    where: {
      status: "AT_SUBCONTRACTOR",
      OR: [{ qualityGrade: null }, { qualityGrade: { not: scrapCode } }],
    },
  });
  // KÖRLÜK ZEMİNİ: fire DIŞLAMASI, dışlanacak top yoksa hiçbir şey kanıtlamaz.
  const dbScrapAtSub = await prisma.roll.count({
    where: { status: "AT_SUBCONTRACTOR", qualityGrade: scrapCode },
  });
  check("total.rollCount == Σ byCategory == Σ bySubcontractor",
    summary.total.rollCount === sumCat && sumCat === sumFirm,
    `total=${summary.total.rollCount} Σcat=${sumCat} Σfirm=${sumFirm}`);
  check("total.rollCount == DB AT_SUBCONTRACTOR sayımı (FIRE-hariç)",
    summary.total.rollCount === dbCount, `özet=${summary.total.rollCount} db=${dbCount}`);
  check("total.totalQty == Σ byCategory.totalQty",
    summary.total.totalQty === qtyCat, `total=${summary.total.totalQty} Σcat=${qtyCat}`);

  // --- 2b) FIRE-parite: includeFire=true evreni FIRE'ı da sayar (liste toggle'ıyla hizalı) ---
  const withFire = (await svc.getRollSubcontractorSummary(true)).data;
  const dbAll = await prisma.roll.count({ where: { status: "AT_SUBCONTRACTOR" } });
  check("includeFire=false == DB(FIRE-hariç) & includeFire=true == DB(tüm AT_SUBCONTRACTOR)",
    summary.total.rollCount === dbCount && withFire.total.rollCount === dbAll,
    `haric=${summary.total.rollCount}/${dbCount} tüm=${withFire.total.rollCount}/${dbAll}`);
  check("includeFire=true sayısı >= includeFire=false (FIRE toplar eklenir, çıkmaz)",
    withFire.total.rollCount >= summary.total.rollCount);
  // Yukarıdaki iki fire kontrolü, fasonda fire top YOKKEN iki tarafı aynı sayıya
  // indirir ve VAKUMEN geçer. Fixture bir fire topu yarattı: sayım 0 ise dışlama
  // değil FİXTURE bozuktur → kırmızı (körlük zemini).
  check("körlük zemini: fasonda fire top VAR (fixture)", dbScrapAtSub > 0, `${dbScrapAtSub} top`);
  check("fire topu includeFire=false evreninde SAYILMIYOR", withFire.total.rollCount - summary.total.rollCount === dbScrapAtSub,
    `fark=${withFire.total.rollCount - summary.total.rollCount} fire=${dbScrapAtSub}`);

  // --- 3) Grup alanları iyi biçimli ---
  check("her firma grubu: rollCount>0 & totalQty sonlu & (id yoksa name='Bilinmiyor')",
    summary.bySubcontractor.every(
      (f) =>
        f.rollCount > 0 &&
        Number.isFinite(f.totalQty) &&
        (f.subcontractorId !== null || f.name === "Bilinmiyor") &&
        (f.oldestDays === null || f.oldestDays >= 0),
    ));
  check("her kategori grubu: rollCount>0 & (id yoksa name='Bilinmiyor')",
    summary.byCategory.every(
      (c) => c.rollCount > 0 && (c.categoryId !== null || c.name === "Bilinmiyor"),
    ));

  // --- 4) Liste include'u: AT_SUBCONTRACTOR satırlarında dispatchItems şekli ---
  const list: any = await svc.findAllRolls(reqOf({ "filter[status]": "AT_SUBCONTRACTOR" }));
  const rows: any[] = list.data;
  check("liste satır sayısı DB sayımıyla uyumlu (FIRE-hariç default)",
    rows.length === dbCount, `liste=${rows.length} db=${dbCount}`);
  const withFirm = rows.filter((r) => r.dispatchItems?.[0]?.dispatch?.subcontractor);
  check("include: firma taşıyan satır sayısı == Σ (gerçek firmalı özet grupları)",
    withFirm.length ===
      summary.bySubcontractor
        .filter((f) => f.subcontractorId !== null)
        .reduce((a, f) => a + f.rollCount, 0),
    `include=${withFirm.length}`);
  check("include: her firmalı satırda dispatchNo + subcontractor.id/name dolu",
    withFirm.every((r) => {
      const d = r.dispatchItems[0].dispatch;
      return d.dispatchNo && d.subcontractor.id && d.subcontractor.name;
    }));

  // --- 5) Filtre + stats paritesi — fixture firması özete DÜŞMÜŞ olmalı ---
  const realFirm = summary.bySubcontractor.find((f) => f.subcontractorId === ids.sub);
  check("fixture firması özette (gerçek firmalı grup)", realFirm !== undefined,
    realFirm ? `${realFirm.rollCount} top` : `firma özete düşmedi — açık kalem tanımı (F85) fixture'ı görmüyor`);
  if (realFirm) {
    const filtered: any = await svc.findAllRolls(
      reqOf({ "filter[status]": "AT_SUBCONTRACTOR", "filter[subcontractorId]": realFirm.subcontractorId! }),
    );
    const fdata: any[] = filtered.data;
    check("filtre[subcontractorId]: liste sayısı == özet firma sayısı",
      fdata.length === realFirm.rollCount, `liste=${fdata.length} özet=${realFirm.rollCount}`);
    check("filtre[subcontractorId]: dönen her top gerçekten o firmada",
      fdata.every((r) => r.dispatchItems?.[0]?.dispatch?.subcontractor?.id === realFirm.subcontractorId));

    const stats = (
      await svc.getRollStats(
        reqOf({ "filter[status]": "AT_SUBCONTRACTOR", "filter[subcontractorId]": realFirm.subcontractorId! }),
      )
    ).data;
    check("stats paritesi: getRollStats.totalCount == filtreli findAllRolls",
      stats.totalCount === fdata.length, `stats=${stats.totalCount} liste=${fdata.length}`);

    const empty: any = await svc.findAllRolls(
      reqOf({
        "filter[status]": "AT_SUBCONTRACTOR",
        "filter[subcontractorId]": "00000000-0000-0000-0000-000000000000",
      }),
    );
    check("var olmayan firma filtresi boş küme döndürür", empty.data.length === 0);
  }

  // --- 6) Kategori filtresi paritesi — adımın requiredCategory'si özete DÜŞMÜŞ olmalı ---
  const realCat = summary.byCategory.find((c) => c.categoryId === ids.category);
  check("fixture kategorisi özette (adımın requiredCategory'si)", realCat !== undefined,
    realCat ? `${realCat.rollCount} top` : "kategori özete düşmedi — COALESCE(requiredCategoryId, tek kategori) fixture'ı görmüyor");
  if (realCat) {
    const catFiltered: any = await svc.findAllRolls(
      reqOf({ "filter[status]": "AT_SUBCONTRACTOR", "filter[subcontractorCategoryId]": realCat.categoryId! }),
    );
    check("filtre[subcontractorCategoryId]: liste sayısı == özet kategori sayısı",
      catFiltered.data.length === realCat.rollCount,
      `liste=${catFiltered.data.length} özet=${realCat.rollCount}`);
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e instanceof Error ? e.message : e);
    fail++;
  })
  .finally(async () => {
    try {
      await fixtureTemizle();
    } catch (e) {
      console.error("temizlik hatası:", e instanceof Error ? e.message : e);
      fail++;
    }
    // Koşucu `Sonuç:` ekini okur — atlama beyanı ancak bu satırda görünür.
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===\n`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
