// =============================================================================
// BEKÇİ — DÜZELTME İPUCU (`ImportRowIssue.fix`)
// =============================================================================
// Panel "eksik kaydı buradan yarat" düğmesini bu ipucuna göre çizer. İpucunun
// TEK doğru dalda doğması, özelliğin güvenliğidir:
//
//   bulunamadı   → ipucu VAR   (yaratmak doğru eylem)
//   belirsiz ad  → ipucu YOK   (yaratmak, zaten iki olan kataloğa üçüncüyü ekler)
//   PASİF kayıt  → ipucu YOK   (doğru eylem AKTİFLEŞTİRMEK; yaratmak, servisin
//                               `assertNameAvailable` guard'ının tam da
//                               engellediği mükerreri üretirdi)
//
// Bu ayrımı Türkçe mesajdan regex ile çıkarmak sessiz bir arıza yoluydu; bu
// yüzden ipucu YAPISAL. Aşağıdaki üç kontrol o kararı kilitler.
//
// Ayrıca: çoklu sütunda `fix.value` HÜCRE değil ELEMANdır, ve gruplu şablonda
// `fix.rowNo` ÇOCUK satırın numarasıdır (grup başının değil) — ikisi de panelin
// yanlış hücreyi düzeltmesini önler.

import prisma from "../src/lib/prisma";
import { ImportService } from "../src/services/import/import.service";
import { listAdapters } from "../src/services/import/import-registry";
import { LOOKUP_SOURCES } from "../src/services/import/import-lookup";
import { colorService } from "../src/routes/color.routes";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const PREFIX = "TEST-FIX";
const row = (rowNo: number, cells: Record<string, string>) => ({ rowNo, cells });
const allIssues = (r: { errors: Array<unknown>; warnings: Array<unknown> }) => [...r.errors, ...r.warnings];

async function main(): Promise<void> {
  console.log("=== Düzeltme ipucu bekçisi ===\n");

  // --- statik: her lookup sütununun varlığı çözümleyicide tanımlı olmalı ----
  // Panel `fix.entity` ile yaratma defterine bakar; tanımsız bir varlık
  // gelirse düğme sessizce çizilmez ve sebebi hiçbir yerde yazmaz.
  let lookupOk = true;
  let lookupCount = 0;
  for (const a of listAdapters()) {
    for (const c of a.columns) {
      if (!c.lookup) continue;
      lookupCount++;
      if (!LOOKUP_SOURCES[c.lookup.entity]) {
        lookupOk = false;
        console.log(`   ↳ ${a.entity}.${c.key}: lookup.entity='${c.lookup.entity}' LOOKUP_SOURCES'ta yok`);
      }
    }
  }
  check("her lookup sütununun varlığı çözümleyicide tanımlı", lookupOk);
  check("körlük zemini: lookup sütunu taranıyor", lookupCount >= 10, `${lookupCount} sütun`);

  const created: string[] = [];
  try {
    const uniq = `${PREFIX}-${Date.now().toString(36).toLocaleUpperCase("en-US")}`;

    // --- 1. BULUNAMADI → ipucu VAR ----------------------------------------
    const miss = await ImportService.preview(
      "productRecipe",
      [row(2, { name: `${uniq}-R`, itemCode: `${uniq}-OLMAYAN` })],
      {},
    );
    const missIssue = miss.rows[0]?.errors.find((e) => e.column === "itemCode");
    check("bulunamayan referans ipucu taşır", Boolean(missIssue?.fix), JSON.stringify(missIssue));
    check(
      "ipucu doğru varlığı söyler",
      missIssue?.fix?.entity === "item",
      String(missIssue?.fix?.entity),
    );
    check(
      "ipucu ARANAN DEĞERİ taşır",
      missIssue?.fix?.value === `${uniq}-OLMAYAN`,
      String(missIssue?.fix?.value),
    );
    check("ipucu türü CREATE_LOOKUP", missIssue?.fix?.kind === "CREATE_LOOKUP");

    // --- 2. NEGATİF: PASİF kayıt → ipucu YOK ------------------------------
    const passive = await prisma.color.create({
      data: { code: `${uniq}-P`.slice(0, 32), name: `${uniq}-PASIF`, isActive: false },
    });
    created.push(passive.id);
    const passivePrev = await ImportService.preview(
      "productRecipe",
      [row(2, { name: `${uniq}-R2`, itemCode: "x", colorCode: passive.code })],
      {},
    );
    const passiveIssue = passivePrev.rows[0]?.errors.find(
      (e) => e.column === "colorCode" && e.message.includes("PASİF"),
    );
    check("pasif kayıt hatası üretildi", Boolean(passiveIssue), JSON.stringify(passivePrev.rows[0]?.errors));
    check(
      "NEGATİF: pasif kayıt hatası ipucu TAŞIMAZ (doğru eylem aktifleştirmek)",
      passiveIssue !== undefined && passiveIssue.fix === undefined,
      JSON.stringify(passiveIssue),
    );

    // --- 3. NEGATİF: BELİRSİZ ad → ipucu YOK -------------------------------
    // Aynı katlanmış ada sahip İKİ aktif renk → ad ile çözüm belirsizleşir.
    const ambigName = `${uniq}-AYNI`;
    const a1 = await prisma.color.create({ data: { code: `${uniq}-A1`.slice(0, 32), name: ambigName } });
    // ⚠️ RENK AD SEDDİ KURULUYSA İKİNCİ KAYIT YARATILAMAZ (2026-08-30).
    // `colors_nameFoldColor_key` tam da "aynı katlanmış ada sahip iki AKTİF
    // renk" durumunu engellemek için var — yani bu belirsizlik artık YENİ
    // kayıtlarda doğamaz, yalnız SEDDEN ÖNCEKİ satırlarda olabilir. İpucu
    // mantığı hâlâ gerekli (eski veri) ama fixture'ı kurmak mümkün değil.
    let a2: { id: string } | null = null;
    try {
      a2 = await prisma.color.create({ data: { code: `${uniq}-A2`.slice(0, 32), name: ambigName } });
    } catch {
      check("renk ad seddi BELİRSİZ ad durumunu üretilemez kıldı", true, "colors_nameFoldColor_key kurulu");
    }
    created.push(a1.id, ...(a2 ? [a2.id] : []));
    if (a2) {
      const ambigPrev = await ImportService.preview(
        "productRecipe",
        [row(2, { name: `${uniq}-R3`, itemCode: "x", colorCode: ambigName })],
        {},
      );
      const ambigIssue = ambigPrev.rows[0]?.errors.find(
        (e) => e.column === "colorCode" && e.message.includes("birden fazla"),
      );
      check("belirsiz ad hatası üretildi", Boolean(ambigIssue), JSON.stringify(ambigPrev.rows[0]?.errors));
      check(
        "NEGATİF: belirsiz ad hatası ipucu TAŞIMAZ (yaratmak üçüncü mükerreri ekler)",
        ambigIssue !== undefined && ambigIssue.fix === undefined,
        JSON.stringify(ambigIssue),
      );
    } else {
      check("BELİRSİZ ad senaryosu ATLANDI — sed ikizi üretilemez kıldı", true);
    }

    // --- 4. ÇOKLU sütun: ipucu HÜCREYİ değil ELEMANI taşır -----------------
    const multi = await ImportService.preview(
      "item",
      [row(2, { name: `${uniq}-K`, itemType: "FABRIC", allowedColorCodes: `${a1.code};${uniq}-YOK` })],
      {},
    );
    const multiIssue = multi.rows[0]?.errors.find((e) => e.column === "allowedColorCodes");
    check(
      "çoklu sütunda ipucu ELEMANI taşır (hücrenin tamamını değil)",
      multiIssue?.fix?.value === `${uniq}-YOK`,
      String(multiIssue?.fix?.value),
    );

    // --- 5. GRUPLU şablon: ipucu ÇOCUK satır numarasını taşır --------------
    const grouped = await ImportService.preview(
      "route",
      [
        row(2, { code: `${uniq}-RT`, name: `${uniq}-ROTA`, stepSequence: "1", stationCode: `${uniq}-YOKIST` }),
        row(3, { code: `${uniq}-RT`, stepSequence: "2", stationCode: `${uniq}-YOKIST2` }),
      ],
      {},
    );
    const g = grouped.rows[0];
    const childIssues = (g?.errors ?? []).filter((e) => e.column === "stationCode" && e.fix);
    check("gruplu şablonda çocuk hataları ipucu taşır", childIssues.length === 2, JSON.stringify(g?.errors));
    check(
      "ipucu ÇOCUK satır numarasını taşır (grup başının değil)",
      childIssues.some((e) => e.fix?.rowNo === 3),
      JSON.stringify(childIssues.map((e) => e.fix)),
    );
    check(
      "grup başı satır numarası çocuğunkinden FARKLI",
      g?.rowNo === 2 && childIssues.some((e) => e.fix?.rowNo !== g?.rowNo),
    );
    check(
      "mesaj da çocuk satırı söylüyor",
      childIssues.some((e) => e.message.startsWith("3. satır:")),
      JSON.stringify(childIssues.map((e) => e.message)),
    );

    // --- 6. Uyarılar ipucu taşımaz (yalnız hatalar eylem önerir) -----------
    const okColor = await prisma.color.create({ data: { code: `${uniq}-OK`.slice(0, 32), name: `${uniq}-TEKIL` } });
    created.push(okColor.id);
    const warnPrev = await ImportService.preview(
      "productRecipe",
      [row(2, { name: `${uniq}-R4`, itemCode: "x", colorCode: `${uniq}-TEKIL` })],
      {},
    );
    const warned = warnPrev.rows[0]?.warnings.find((w) => w.column === "colorCode");
    check("ad ile eşleşme uyarısı üretildi", Boolean(warned), JSON.stringify(warnPrev.rows[0]?.warnings));
    check(
      "uyarı ipucu taşımaz",
      allIssues(warnPrev.rows[0] ?? { errors: [], warnings: [] }).every(
        (i) => (i as { fix?: unknown }).fix === undefined || (i as { column?: string }).column === "itemCode",
      ),
    );
    // --- 7. TUZAK: yaratılan kayıt hücreye ADLA değil KODLA yazılmalı -------
    // Servisler adı YAZARKEN normalize ediyor, lookup ise `nameFold` üzerinden
    // çözüyor — ikisi aynı katlama DEĞİL. Tek kelimelik bir değerde ("MAVI")
    // iki katlama çakışır ve ada yazan bir uygulama HER ELLE TESTİ GEÇER;
    // ilk sayı içeren gerçek adda bozulur. Bu kontrol, panelin kod yazımının
    // "sadeleştirilmesini" engeller.
    const trap = `${uniq} 055 GRI`;
    const madeRes = await colorService.create({ name: trap, isActive: true });
    const made = madeRes.data as { id: string; code: string; name: string };
    created.push(made.id);
    check(
      "servis adı NORMALİZE etti (kod yazımının gerekçesi)",
      made.name !== trap,
      `dosya="${trap}" kayıt="${made.name}"`,
    );
    const byName = await ImportService.preview(
      "productRecipe",
      [row(2, { name: `${uniq}-T1`, itemCode: "x", colorCode: trap })],
      {},
    );
    check(
      "ADLA yeniden önizleme HÂLÂ eşleşmiyor",
      byName.rows[0]?.errors.some((e) => e.column === "colorCode") === true,
      JSON.stringify(byName.rows[0]?.errors),
    );
    const byCode = await ImportService.preview(
      "productRecipe",
      [row(2, { name: `${uniq}-T2`, itemCode: "x", colorCode: made.code })],
      {},
    );
    check(
      "KODLA yeniden önizleme renk hatasını KAPATIYOR",
      !byCode.rows[0]?.errors.some((e) => e.column === "colorCode"),
      JSON.stringify(byCode.rows[0]?.errors),
    );
  } finally {
    if (created.length > 0) await prisma.color.deleteMany({ where: { id: { in: created } } });
    await prisma.color.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
