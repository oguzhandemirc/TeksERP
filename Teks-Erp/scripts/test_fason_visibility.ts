// TEST: Envanter "Fasonda" fason görünürlüğü — üç yüzeyin (özet ucu, liste
// include'u, liste filtresi) F85 açık-kalem tanımını PAYLAŞTIĞINI ve sayıların
// birbirinden SAPMADIĞINI doğrular.
//
// SALT-OKUR: fixture yaratmaz/mutasyon yapmaz — paylaşılan dev DB'sindeki mevcut
// AT_SUBCONTRACTOR toplarına karşı invariant kontrolü yapar (dispatch/receive
// akışı test_consecutive_fason.ts + test_fason_*.ts'te ayrıca kapsanır; buradaki
// değişiklikler yalnız OKUMA yollarına dokunduğu için invariant testi yeterli ve
// kırılgan değil). AT_SUBCONTRACTOR topu yoksa şekil-kontrolüyle geçer.
//
// Çalıştır: npx tsx scripts/test_fason_visibility.ts
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { atlamaDefteri } from "./lib/atlama";
import { InventoryService } from "../src/services/inventory.service";
import { Request } from "express";

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
  const scrapCode = (await roleGrade("SCRAP")).code;
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
  // ⚠️ Yukarıdaki iki fire kontrolü, fasonda fire top YOKKEN her iki tarafı da aynı
  // sayıya indirir ve VAKUMEN geçer — yeşilleri "dışlama çalışıyor" demez.
  // Bu bir ARIZA değil VERİ durumudur (ölçüldü: fabrika kopyasında da 0) ⇒ kırmızı
  // değil, BEYAN.
  if (dbScrapAtSub === 0) {
    ATLAMA.atla(
      "fire-dışlama kapsaması",
      `fasonda '${scrapCode}' rolünde top yok — iki fire kontrolü vakumen geçti`,
      2,
    );
  }

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

  // --- 5) Filtre + stats paritesi (gerçek firmalı top varsa) ---
  const realFirm = summary.bySubcontractor.find((f) => f.subcontractorId !== null);
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
  } else {
    ATLAMA.atla("filtre/stats paritesi", "gerçek firmalı AT_SUBCONTRACTOR topu yok", 4);
  }

  // --- 6) Kategori filtresi paritesi (gerçek kategorili top varsa) ---
  const realCat = summary.byCategory.find((c) => c.categoryId !== null);
  if (realCat) {
    const catFiltered: any = await svc.findAllRolls(
      reqOf({ "filter[status]": "AT_SUBCONTRACTOR", "filter[subcontractorCategoryId]": realCat.categoryId! }),
    );
    check("filtre[subcontractorCategoryId]: liste sayısı == özet kategori sayısı",
      catFiltered.data.length === realCat.rollCount,
      `liste=${catFiltered.data.length} özet=${realCat.rollCount}`);
  } else {
    ATLAMA.atla("kategori filtresi paritesi", "gerçek kategorili AT_SUBCONTRACTOR topu yok", 1);
  }

  // Koşucu `Sonuç:` ekini okur — atlama beyanı ancak bu satırda görünür.
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===\n`);
}

main()
  .catch((e) => {
    console.error("HATA:", e instanceof Error ? e.message : e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
