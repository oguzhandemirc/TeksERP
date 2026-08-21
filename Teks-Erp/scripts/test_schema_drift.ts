// =============================================================================
// ŞEMA DRIFT KAPISI — repo şeması (`schema.prisma`) ile CANLI DB'nin eşitliği
//
// NEDEN VAR (2026-07-31 denetim bulgusu): bu eşitliği doğrulayan HİÇBİR kapı yoktu.
// `npm test` uygulama davranışını ölçüyordu, `test_db_invariants.ts` şema-DIŞI
// nesneleri koruyordu, `test_migration_hygiene.ts` migration DEFTERİNİ (dizin ↔
// `_prisma_migrations`) karşılaştırıyordu — ama "şemanın kendisi DB'de gerçekten
// bu mu?" sorusunu kimse sormuyordu.
//
// Kaçırdığı somut senaryo (2026-07-30'da fiilen yaşandı, bkz. CLAUDE.md):
//   1. Elle bir migration yazılır, `prisma db execute` ile dev'e uygulanır.
//   2. `git add` UNUTULUR.
//   3. Dev'de her şey normal görünür: dizinde dosya var + `_prisma_migrations`'ta
//      "uygulandı" satırı var + uygulama çalışıyor.
//   4. `migrate deploy` YALNIZ dizindeki (commit'li) dosyaları uygular → canlıda o
//      adım HİÇ koşmaz, üstelik deploy "başarılı" der.
//   5. O kolonu/kısıtı okuyan her yol canlıda P2022/500 verir; teşhis saatler alır.
// Aynı sınıfın ikinci hâli: bir migration'ın SQL'i dev'e uygulanır ama dizindeki
// dosyaya yazılmaz (16 migration `migrate resolve` ile "uygulandı" işaretli —
// `resolve` SQL'in koştuğunu DOĞRULAMAZ, yalnız deftere satır yazar).
//
// Bu dosya soruyu tersinden sorar: **datasource'taki DB'den datamodel'e giden
// fark NEDİR?** Fark = "DB'yi şemaya getirmek için koşması gereken SQL". Boş
// olmalı; boş değilse yalnız aşağıda BELGELENEN farklar kabul edilir.
//
// ⚠️ BEKLENEN LİSTE DEĞİŞİRSE BU TEST DE GÜNCELLENMELİ. Liste bilinçli olarak
// "izin verilenler" (allowlist) biçimindedir: yeni bir kasıtlı drift doğduğunda
// test KIRMIZI olur ve seni buraya, gerekçeyi yazmaya zorlar. Bir farkı buraya
// eklemek "bu farkın canlıda kalmasını KABUL EDİYORUM" beyanıdır — gerçek bir
// eksik migration'ı susturmak için ASLA kullanma; doğru tepki migration yazmaktır.
// (Emsal: `sacks_customerId_fkey` 2026-08-01'e kadar bu listeye AİT SANILIYORDU;
//  meğer `onDelete` datamodel'de temsil EDİLEBİLİR bir farkmış ve canlı DB aylardır
//  RESTRICT taşıyormuş → 20260801030000_sack_customer_fk_setnull ile kapatıldı.)
//
// Salt-okunur: `migrate diff` yalnız introspect eder, DDL ÇALIŞTIRMAZ. Üretim
// DB'sine karşı da güvenle koşar.
// Koşum: npx tsx scripts/test_schema_drift.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BEKLENEN (KASITLI) DRIFT — allowlist
//
// Bu iki composite FK Prisma datamodel'inde TEMSİL EDİLEMEZ (çok kolonlu +
// DEFERRABLE INITIALLY DEFERRED). Raw SQL migration ile kurulurlar, bu yüzden
// `migrate diff` onları "datamodel'de yok" sanıp her seferinde DROP etmek ister.
// `schema.prisma:2710-2711`: "ASLA uygulama — `migrate dev --create-only` kullan,
// üretilen DropForeignKey satırlarını SİL."
//
// DEFERRED olmaları load-bearing: tx içinde `sackId` ve `shipmentId` ayrı
// UPDATE'lerle yazılır, ara durum geçici olarak tutarsızdır. Varlıklarını
// `test_db_invariants.ts` §3 ayrıca doğrular — yani "drift beklenen" ile "nesne
// hâlâ yerinde" iki AYRI kapıdır ve biri diğerinin yerine geçmez.
//
// Karşılaştırma SIRASIZ (küme): `migrate diff` ifade sırasını garanti etmez.
// ─────────────────────────────────────────────────────────────────────────────
const EXPECTED_DRIFT: Array<{ sql: string; why: string }> = [
  {
    sql: `ALTER TABLE "rolls" DROP CONSTRAINT "rolls_sackId_shipmentId_consistency_fkey"`,
    why: "top ↔ çuval ↔ sevkiyat DEFERRABLE composite FK — datamodel'de temsil edilemez",
  },
  {
    sql: `ALTER TABLE "swatches" DROP CONSTRAINT "swatches_sackId_shipmentId_consistency_fkey"`,
    why: "kartela ↔ çuval ↔ sevkiyat DEFERRABLE composite FK — datamodel'de temsil edilemez",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TOLERE EDİLEN (GEÇİCİ) DRIFT — "olabilir de olmayabilir de", KIRMIZI DEĞİL ⚠️
// ─────────────────────────────────────────────────────────────────────────────
// 28. migration (`20260821150000_name_fold_unique_live`) 2026-08-22'den beri
// YUMUŞAK KAPIDIR: mükerrer taşıyan tabloda `<t>_nameFold_key` partial UNIQUE'i
// ATLAR (NOTICE). Şema `@@unique([nameFold])` dediği için `migrate diff` o tabloda
// "CREATE UNIQUE INDEX … (nameFold)" ister — prod'da (ve prod kopyalarında)
// temizlik + enforce bitene dek BEKLENEN bir farktır; dev/CI'da (temiz) hiç
// görünmez. EXPECTED_DRIFT'e koyamayız (orada "kaybolursa KIRMIZI" kuralı var ve
// dev'de index kurulu olduğu için her zaman kaybolurdu). Bu yüzden üçüncü küme:
// görünürse ⚠️ ile listelenir, sayılmaz. Enforce tamamlanınca liste SİLİNMELİ
// (test_db_invariants §1 aynı index'leri "eksikse kırmızı" ile zaten izliyor —
// yani sed kaybı sessiz kalmaz; bu tolerans yalnız drift kapısını susturur).
const TOLERATED_DRIFT: Array<{ sql: string; why: string }> = [
  "customers",
  "items",
  "subcontractors",
].map((t) => ({
  sql: `CREATE UNIQUE INDEX "${t}_nameFold_key" ON "${t}"("nameFold")`,
  why: "yumuşak kapı (mükerrer varken atlandı) — temizlik + enforce bekliyor",
}));

/** Boşluk/satır sonu farklarına dayanıklı normalize (tek boşluk, sondaki ; yok). */
function norm(sql: string): string {
  return sql.replace(/\s+/g, " ").replace(/;\s*$/, "").trim();
}

/**
 * `migrate diff` çıktısını SQL ifadelerine böler.
 * Yorum satırları (`-- DropForeignKey`) ve boş satırlar atılır; kalan metin `;`
 * ile ayrılır. Çıktı `-o` ile DOSYAYA yazıldığı için Prisma'nın stdout'a bastığı
 * "Loaded Prisma config from ..." gibi banner satırları karışmaz — stdout'u
 * ayrıştırmak kırılgan olurdu.
 */
function parseStatements(script: string): string[] {
  return script
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map(norm)
    .filter((s) => s.length > 0);
}

function main(): void {
  console.log("\n=== Şema drift kapısı (repo schema.prisma ↔ canlı DB) ===");

  const dir = mkdtempSync(join(tmpdir(), "teks-drift-"));
  const outFile = join(dir, "drift.sql");
  try {
    // `--from-config-datasource` = prisma.config.ts'teki DATABASE_URL (CANLI DB)
    // `--to-schema`              = repo'daki datamodel
    // Yön önemli: FROM=DB, TO=şema → üretilen SQL "DB'yi şemaya getirir".
    // (Prisma 7.7'de eski `--to-schema-datamodel` bayrağı KALDIRILDI; kullanılırsa
    //  komut usage basıp exit 1 verir — aşağıdaki exit-kodu kontrolü bunu yakalar.)
    // `--exit-code`: 0 = fark yok · 2 = fark var · 1 = HATA. Üçü ayrı ele alınmalı,
    // yoksa "DB'ye bağlanamadım" sessizce "fark yok" gibi okunur.
    const res = spawnSync(
      "npx",
      [
        "prisma",
        "migrate",
        "diff",
        "--from-config-datasource",
        "--to-schema",
        "prisma/schema.prisma",
        "--script",
        "--exit-code",
        "-o",
        outFile,
      ],
      {
        encoding: "utf8",
        cwd: join(__dirname, ".."),
        env: process.env,
        timeout: 120_000,
        // Windows'ta `npx` = `npx.cmd`; shell olmadan çözülemez (run-all-tests.ts
        // ile aynı gerekçe).
        shell: process.platform === "win32",
      }
    );

    const status = res.status;
    const stderr = (res.stderr ?? "").trim();
    const ranOk = !res.error && (status === 0 || status === 2);
    check(
      "prisma migrate diff çalıştı",
      ranOk,
      ranOk
        ? `çıkış kodu ${status} (${status === 0 ? "fark yok" : "fark var"})`
        : `çıkış kodu ${status}${res.error ? ` / ${(res.error as { code?: string }).code}` : ""} — ` +
          `komut HATA verdi (DB erişimi? bayrak adı değişmiş olabilir): ${stderr.slice(0, 400)}`
    );
    if (!ranOk) return;

    const script = status === 0 ? "" : readFileSync(outFile, "utf8");
    const statements = parseStatements(script);
    const seen = new Set(statements);

    // ── 1) Beklenen kasıtlı drift hâlâ orada mı? ──
    // KIRMIZI, çünkü kaybolması iki şeyden biri demektir ve ikisi de insan kararı
    // ister: (a) FK canlıda DÜŞMÜŞ — sed kayboldu, `test_db_invariants.ts` §3 de
    // kırmızı olmalı; (b) Prisma artık bu yapıyı temsil edebiliyor / şema değişti —
    // o zaman bu allowlist satırı SİLİNMELİ. Sessiz geçerse "beklenen liste" bayatlar.
    for (const exp of EXPECTED_DRIFT) {
      const found = seen.has(norm(exp.sql));
      check(
        `beklenen drift duruyor: ${exp.sql.slice(0, 72)}`,
        found,
        found
          ? exp.why
          : "BEKLENEN DRIFT KAYBOLDU — ya composite FK canlıda düşmüş (test_db_invariants.ts §3'e bak) " +
            "ya da artık gerekmiyor. İkisi de bu dosyadaki allowlist'in güncellenmesini gerektirir."
      );
    }

    // ── 2) Allowlist DIŞI fark var mı? ──
    // Asıl kapı bu: buraya düşen her ifade, repo şemasında olup canlı DB'de
    // OLMAYAN (ya da tersi) gerçek bir yapıdır → eksik/commit edilmemiş migration.
    const expectedSet = new Set(EXPECTED_DRIFT.map((e) => norm(e.sql)));
    const toleratedMap = new Map(TOLERATED_DRIFT.map((e) => [norm(e.sql), e.why]));
    const tolerated = statements.filter((s) => toleratedMap.has(s));
    for (const s of tolerated) {
      console.log(`⚠️  tolere edilen geçici drift: ${s.slice(0, 80)} — ${toleratedMap.get(s)}`);
    }
    const unexpected = statements.filter((s) => !expectedSet.has(s) && !toleratedMap.has(s));
    check(
      "allowlist dışı şema farkı yok",
      unexpected.length === 0,
      unexpected.length === 0
        ? `${statements.length} ifadenin tamamı belgelenmiş kasıtlı${tolerated.length ? ` (+${tolerated.length} tolere edilen geçici)` : ""} drift`
        : `${unexpected.length} BELGESİZ fark:\n` + unexpected.map((s) => `      ${s};`).join("\n")
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) {
    console.log(
      "\nDÜŞTÜYSE sırayla bak:\n" +
        "  1. `git status prisma/migrations` — commit edilmemiş bir migration var mı?\n" +
        "     (aynı sınıfı `npm run check:migrations` git tarafından da yakalar)\n" +
        "  2. `npx tsx scripts/test_migration_hygiene.ts` — DB'de var/dizinde yok, pending,\n" +
        "     ya da elle `resolve` edilmiş migration?\n" +
        "  3. Fark GERÇEKSE: eksik adımı bir migration olarak YAZ (git add → uygula →\n" +
        "     doğrula). Farkı bu dosyadaki allowlist'e eklemek yalnız Prisma'nın\n" +
        "     datamodel'de TEMSİL EDEMEDİĞİ yapılar için meşrudur."
    );
  }
}

main();
process.exit(fail > 0 ? 1 : 0);
