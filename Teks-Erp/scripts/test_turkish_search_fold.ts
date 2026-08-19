// =============================================================================
// BEKÇİ: Türkçe-duyarsız arama UÇTAN UCA (2026-08-19 — yeniden yazıldı)
// Çalıştır: npx tsx scripts/test_turkish_search_fold.ts
// =============================================================================
// ⚠️ BU DOSYA ESKİDEN SAF BİR BİRİM TESTİYDİ ve yanlış bir dünya modeli kurmuştu:
// ILIKE'ı "yalnız ASCII katlar" diye modelleyip üretilen varyant SAYISINI
// sayıyordu. İki kusuru vardı: (1) model dev DB'sinde YANLIŞTI (ICU locale
// altında ILIKE ü/ş/ğ'yi katlıyor; C locale'de katlamıyor — yani davranış
// ortama bağlıydı ve test ikisini de temsil etmiyordu), (2) uygulamanın
// GERÇEKTEN kayıt bulup bulmadığını hiç ölçmüyordu.
//
// Artık soru tek: OPERATÖR NE YAZARSA YAZSIN KAYDI BULUYOR MU? Bu yüzden test
// gerçek satır yazar, gerçek servis çağırır ve gerçek sonucu sayar.
//
// Katlamanın KENDİSİ ayrı bekçide: `test_fold_contract.ts` (JS ≡ SQL, tüm BMP).
// Burada ölçülen şey o katlamanın SORGU YOLUNA doğru bağlandığı.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { buildTextSearch } from "../src/utils/query-parser";
import { CustomerService } from "../src/services/customer.service";
import { Prisma } from "@prisma/client";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const TAG = `TSF${Date.now().toString().slice(-9)}`;
const created: string[] = [];

async function findCustomers(term: string): Promise<string[]> {
  const leaves = buildTextSearch<Prisma.CustomerWhereInput>(term, {
    text: ["name"],
    code: ["code", "taxNumber"],
  });
  if (leaves.length === 0) return [];
  const rows = await prisma.customer.findMany({
    where: { AND: [{ code: { startsWith: "TSF" } }, { OR: leaves }] },
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

async function main(): Promise<void> {
  const svc = new CustomerService({
    modelName: "customer",
    tableName: "CUSTOMER",
    searchFields: ["name"],
    codeSearchFields: ["code", "taxNumber", "exportCode"],
    uniqueField: "code",
    duplicateNameField: "name",
    entityLabel: "müşteri",
  });
  // Fixture: aynı fabrikada gerçekten yan yana duran yazımlar.
  const NAMES = [
    `GÜMÜŞOĞLU TEKSTİL ${TAG}`,
    `ÇİSEM KUMAŞ ${TAG}`,
    `IŞIK ÖRME ${TAG}`,
    `AKTOŞ2 ${TAG}`,
    `ÖZ ŞAHİN TEKSTİL ${TAG}`,
  ];
  for (let i = 0; i < NAMES.length; i++) {
    const c = await prisma.customer.create({
      data: { code: `TSF-${TAG}-${i}`, name: NAMES[i], type: "CUSTOMER" },
      select: { id: true },
    });
    created.push(c.id);
  }

  try {
    // ── 1) ASCII yazımla Türkçe kaydı bulmak ────────────────────────────────
    console.log("\n── 1) ASCII terim → Türkçe kayıt ──");
    const cases: Array<[string, string]> = [
      ["gumusoglu", "GÜMÜŞOĞLU"],
      ["GUMUSOGLU", "GÜMÜŞOĞLU"],
      ["cisem", "ÇİSEM"],
      ["CISEM", "ÇİSEM"],
      ["Çisem", "ÇİSEM"],
      ["ÇİSEM", "ÇİSEM"],
      ["isik", "IŞIK"],
      ["ışık", "IŞIK"],
      ["ISIK", "IŞIK"],
      ["oz sahin", "ÖZ ŞAHİN"],
      ["ÖZ ŞAHİN", "ÖZ ŞAHİN"],
    ];
    for (const [term, expect] of cases) {
      const hits = await findCustomers(term);
      check(`"${term}" → ${expect}`, hits.some((h) => h.includes(expect)), `${hits.length} sonuç`);
    }

    // ── 2) Rakamlı ürün adı KOD hızlı yoluna kaçmıyor ───────────────────────
    // Eski motorda "aktos2" kod-biçimli sayılıp Türkçe katlamayı ATLIYORDU ve
    // "AKTOŞ2" bulunamıyordu. Tekstilde rakamlı ad kuraldır.
    console.log("\n── 2) Rakamlı ad kod yoluna kaçmıyor ──");
    const aktos = await findCustomers("aktos2");
    check('"aktos2" → AKTOŞ2', aktos.some((h) => h.includes("AKTOŞ2")), `${aktos.length} sonuç`);

    // ── 3) Çok kelimeli terim: sıra önemsiz ────────────────────────────────
    console.log("\n── 3) Çok kelimeli arama (AND, sıradan bağımsız) ──");
    const a = await findCustomers("oz sahin");
    const b = await findCustomers("sahin oz");
    check("kelime sırası sonucu değiştirmiyor", a.length > 0 && a.length === b.length, `${a.length} / ${b.length}`);
    const c = await findCustomers("sahin gumusoglu");
    check("iki kelime AND'lenir (aynı kayıtta olmalı)", c.length === 0, `${c.length} sonuç`);

    // ── 4) Alakasız terim eşleşmiyor (katlama her şeyi eşitlemiyor) ────────
    console.log("\n── 4) Körlük kontrolü ──");
    const none = await findCustomers(`BURSAXYZ ${TAG}`);
    check("alakasız terim 0 sonuç", none.length === 0, `${none.length}`);

    // ── 5) LIKE jokerleri terimden düşer ───────────────────────────────────
    // ⚠️ Prisma `contains` jokerleri KAÇIRMAZ: temizlenmeseydi "%" araması
    // TÜM kayıtları döndürürdü (ölçüldü 2026-08-19).
    console.log("\n── 5) Joker karakter sızıntısı ──");
    const pct = await findCustomers("%");
    check('"%" tüm tabloyu döndürmüyor', pct.length === 0, `${pct.length} sonuç`);
    const underscore = await findCustomers("_isem");
    check('"_isem" joker olarak yorumlanmıyor', underscore.some((h) => h.includes("ÇİSEM")), `${underscore.length}`);

    // ── 6) Mükerrer kontrolü ASCII katlıyor (kullanıcı kararı D3) ──────────
    console.log("\n── 6) Mükerrer: ŞAHİN ≡ SAHIN ──");
    let dupErr: unknown = null;
    try {
      await svc.create(
        { code: `TSF-${TAG}-DUP`, name: `OZ SAHIN TEKSTIL ${TAG}`, type: "CUSTOMER" },
        undefined,
      );
    } catch (e) {
      dupErr = e;
    }
    const msg = dupErr instanceof Error ? dupErr.message : "";
    check("'OZ SAHIN' → 'ÖZ ŞAHİN' ile çakışıyor (409)", msg.includes("zaten var"), msg.slice(0, 90));
    if (!dupErr) {
      const stray = await prisma.customer.findFirst({
        where: { code: `TSF-${TAG}-DUP` },
        select: { id: true },
      });
      if (stray) created.push(stray.id);
    }

    // ── 7) Gölge kolon gerçekten yazıldı mı ────────────────────────────────
    console.log("\n── 7) Gölge kolon (DB üretimi) ──");
    const row = await prisma.$queryRawUnsafe<Array<{ name: string; fold: string }>>(
      `SELECT name, "nameFold" AS fold FROM customers WHERE code = $1`,
      `TSF-${TAG}-0`,
    );
    check(
      "nameFold DB tarafından üretildi",
      row[0]?.fold === `gumusoglu tekstil ${TAG.toLowerCase()}`,
      row[0]?.fold ?? "YOK",
    );
  } finally {
    await prisma.customer.deleteMany({ where: { id: { in: created } } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
