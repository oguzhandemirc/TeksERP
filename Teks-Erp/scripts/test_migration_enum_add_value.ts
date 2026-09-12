// =============================================================================
// ENUM `ADD VALUE` MIGRATION BEKÇİSİ — sürüm gecesini kurtaran üç kural
// =============================================================================
// PostgreSQL `ALTER TYPE … ADD VALUE` ile eklenen bir enum değeri AYNI
// TRANSACTION İÇİNDE KULLANILAMAZ (PG 55P04: "unsafe use of new value of enum
// type"). Prisma her migration dosyasını TEK transaction'da koşar. Yani:
//
//   ALTER TYPE "X" ADD VALUE 'YENI';
//   UPDATE "t" SET "c" = 'YENI';        ← 55P04, migration YARIDA kalır
//
// Sahadaki bedeli: `migrate deploy` sürüm gecesinde yarıda durur, DB yarı
// göçmüş kalır ve dönüş yolu YEDEKTEN RESTORE'dur (migration geri alınamaz).
//
// Kural bugüne kadar yalnız `docs/RECETELER.md`de ve altı migration dosyasının
// yorumunda yaşıyordu — MEKANİK KAPISI YOKTU. Bu bekçi o kapıdır.
//
// ÜÇ KONTROL (yeni/dokunulan dosyada ZORUNLU):
//   ① `IF NOT EXISTS` yazılır — defter dışı elle açılmış bir değer varsa
//      (canlıda olur: hotfix, elle SQL) `migrate deploy` düşmesin.
//   ② Dosya YALNIZ `ADD VALUE` ifadeleri taşır — başka hiçbir ifade (INSERT ·
//      UPDATE · DEFAULT · CHECK · CAST · CREATE) aynı dosyaya girmez.
//   ③ Eklenen literal aynı dosyanın başka bir ifadesinde GEÇMEZ (②'nin
//      kaçamadığı hâli: iki ADD VALUE + bir CHECK aynı dosyada).
//
// ⚠️ DEVRALINAN İHLALLER BASELINE'DA DONAR (lint tavanı kalıbı): repoda bugün
// 12 dosyada `IF NOT EXISTS` yok, 8 dosyada ADD VALUE başka ifadelerle aynı
// dosyada (ölçüm 2026-09-12, bu dosyanın kendi ayrıştırıcısıyla).
//
// ⚠️⚠️ BU DOSYALAR DÜZELTİLMEZ — "temizleyeyim" DEME. Hepsi canlıda UYGULANMIŞ
// migration'lardır; uygulanmış bir dosyanın içeriğini değiştirmek checksum'ı
// bozar ve sahada `migrate deploy`u DURDURUR (arıza, düzeltme değil). Kural
// İLERİYE DÖNÜKTÜR: geçmişi yeniden yazmak değil, YENİ dosyada tekrarlamamak.
// Baseline İKİ YÖNLÜ denetlenir: listede olup artık ihlal etmeyen satır da
// KIRMIZI verir (ölü muaf → liste bayatlamış demektir).
//
// ⚠️ NEGATİF SONDA BELLEK İÇİNDE (§6): gerçek `prisma/migrations/` dizinine
// sahte dosya YAZILMAZ. Orada unutulan bir dosya `migrate deploy`i bozar ve
// bu bekçinin varlık sebebiyle aynı sınıfta bir hata üretirdi. Bu yüzden
// kontrol SAF FONKSİYONDUR (`ihlalleriBul`) ve sonda ona uydurma dosya verir.
//
// Salt-okunur: DB'ye dokunmaz, HTTP atmaz.
// Koşum: npx tsx scripts/run-all-tests.ts migration_enum_add_value
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";

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

const MIGRATIONS = path.resolve(__dirname, "../prisma/migrations");

/**
 * DEVRALINAN İHLALLER — uygulanmış migration'lar, değiştirilemez (checksum).
 * Kural YENİ dosyalarda zorunludur. Satırlar ölçümle üretildi (2026-09-12).
 */
// ⚠️ LİSTELER BEKÇİNİN KENDİ AYRIŞTIRICISIYLA ÜRETİLDİ (2026-09-12), kabuk
// sayımıyla DEĞİL: `grep -c ";"` yorum içindeki noktalı virgülü de sayıyor ve
// dört dosyayı yanlışlıkla ihlal gösteriyordu. Ölü muaf kontrolü (§5b) tam da
// bu sınıfı yakalar — baseline üretimi ile ölçüm AYNI koddan geçmelidir.
const BASELINE_IF_NOT_EXISTS_YOK: ReadonlySet<string> = new Set([
  "20260531014923_shipping_label_redesign",
  "20260601030715_add_sack_cancelled_status",
  "20260601110343_shipping_loose_remodel",
  "20260604141753_kartela_fason_redesign",
  "20260607175324_add_at_door_shipment_status",
  "20260715154754_roll_entry_source_manual_entry",
  "20260716010000_add_workorder_superseded_status",
  "20260813090000_warehouse_and_goods_receipt",
  "20260813150000_warehouse_doc_types",
  "20260817004721_fabrika_talep_2026_08_17",
  "20260817121448_traveler_card_doc_versions",
  "20260901173733_uzaktan_erisim_totp",
]);

const BASELINE_TEK_IFADE_DEGIL: ReadonlySet<string> = new Set([
  "20260531014923_shipping_label_redesign",
  "20260601110343_shipping_loose_remodel",
  "20260604141753_kartela_fason_redesign",
  "20260614130000_subcontractor_direct_ship",
  "20260727210000_documents_expansion",
  "20260813090000_warehouse_and_goods_receipt",
  "20260817004721_fabrika_talep_2026_08_17",
  "20260901173733_uzaktan_erisim_totp",
]);

export interface MigrationDosyasi {
  ad: string;
  sql: string;
}

export interface Ihlal {
  ad: string;
  tur: "IF_NOT_EXISTS_YOK" | "TEK_IFADE_DEGIL" | "LITERAL_AYNI_DOSYADA";
  ayrinti: string;
}

/** SQL yorumlarını söker (satır içi `--` ve blok `/* *​/`). */
function yorumlariSok(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, "");
}

/** Noktalı virgülle biten ifadeleri sayar (boş parçalar atılır). */
function ifadeler(sqlYorumsuz: string): string[] {
  return sqlYorumsuz
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const ADD_VALUE_RE = /ALTER\s+TYPE\s+"?[\w.]+"?\s+ADD\s+VALUE/i;
/** Yakalar: 1 = enum TİPİ, 2 = eklenen literal. Tip lazım çünkü 55P04 yalnız
 *  AYNI tipin yeni değeri kullanıldığında doğar (başka bir enum'un eşadlı
 *  değeri masumdur — `CREATE TYPE "SackStatus" … 'SHIPPED'` vakası). */
const ADD_VALUE_LITERAL_RE =
  /ALTER\s+TYPE\s+"?([\w.]+)"?\s+ADD\s+VALUE(?:\s+IF\s+NOT\s+EXISTS)?\s+'([^']+)'/gi;

/**
 * SAF KONTROL — dosya listesi alır, ihlal listesi döner. Bekçi bunu gerçek
 * dizinle, negatif sonda ise uydurma dosyalarla çağırır (aynı kod yolu).
 */
export function ihlalleriBul(dosyalar: MigrationDosyasi[]): Ihlal[] {
  const out: Ihlal[] = [];
  for (const { ad, sql } of dosyalar) {
    const temiz = yorumlariSok(sql);
    if (!ADD_VALUE_RE.test(temiz)) continue;

    const tumIfadeler = ifadeler(temiz);
    const addValueIfadeleri = tumIfadeler.filter((s) => ADD_VALUE_RE.test(s));

    // ① IF NOT EXISTS
    const ifNotExistsSiz = addValueIfadeleri.filter((s) => !/ADD\s+VALUE\s+IF\s+NOT\s+EXISTS/i.test(s));
    if (ifNotExistsSiz.length > 0) {
      out.push({
        ad,
        tur: "IF_NOT_EXISTS_YOK",
        ayrinti: `${ifNotExistsSiz.length} ifade — elle açılmış değer varsa deploy DÜŞER`,
      });
    }

    // ② dosyada başka ifade var mı
    if (tumIfadeler.length !== addValueIfadeleri.length) {
      out.push({
        ad,
        tur: "TEK_IFADE_DEGIL",
        ayrinti: `${tumIfadeler.length} ifade / ${addValueIfadeleri.length} ADD VALUE — yeni değeri kullanan ifade aynı tx'te 55P04 verir`,
      });
    }

    // ③ eklenen literal başka bir ifadede KULLANILIYOR mu
    // ⚠️ `CREATE TYPE … AS ENUM (…)` ifadeleri DIŞARIDA: orada geçen eşadlı
    // değer BAŞKA bir enum'un kendi tanımıdır ve 55P04 üretmez (ölçüldü:
    // 20260531014923 dosyasında `SackStatus`ün 'SHIPPED'i, `RollStatus`e
    // eklenen 'SHIPPED' ile karıştırılıyordu — yanlış pozitif).
    const literaller = [...temiz.matchAll(ADD_VALUE_LITERAL_RE)].map((m) => m[2]!);
    const digerIfadeler = tumIfadeler.filter(
      (s) => !ADD_VALUE_RE.test(s) && !/CREATE\s+TYPE\s+"?[\w.]+"?\s+AS\s+ENUM/i.test(s),
    );
    const kullanilan = literaller.filter((lit) =>
      digerIfadeler.some((s) => s.includes(`'${lit}'`)),
    );
    if (kullanilan.length > 0) {
      out.push({
        ad,
        tur: "LITERAL_AYNI_DOSYADA",
        ayrinti: `aynı dosyada KULLANILAN değer(ler): ${[...new Set(kullanilan)].join(", ")}`,
      });
    }
  }
  return out;
}

function gercekDosyalar(): MigrationDosyasi[] {
  return fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      ad: e.name,
      dosya: path.join(MIGRATIONS, e.name, "migration.sql"),
    }))
    .filter((x) => fs.existsSync(x.dosya))
    .map((x) => ({ ad: x.ad, sql: fs.readFileSync(x.dosya, "utf8") }));
}

function main(): void {
  console.log("=== ENUM `ADD VALUE` MIGRATION BEKÇİSİ ===\n");

  const dosyalar = gercekDosyalar();
  const addValueTasiyan = dosyalar.filter((d) => ADD_VALUE_RE.test(yorumlariSok(d.sql)));

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  check("§1a Körlük zemini: migration dizini okundu", dosyalar.length >= 200, `n=${dosyalar.length}`);
  check(
    "§1b Körlük zemini: ADD VALUE taşıyan dosyalar bulundu",
    addValueTasiyan.length >= 20,
    `n=${addValueTasiyan.length}`,
  );

  const ihlaller = ihlalleriBul(dosyalar);

  // ── §2/§3/§4 ⭐ YENİ İHLAL YOK ────────────────────────────────────────────
  const yeni = (tur: Ihlal["tur"], baseline: ReadonlySet<string>): Ihlal[] =>
    ihlaller.filter((i) => i.tur === tur && !baseline.has(i.ad));

  const yeniIfNotExists = yeni("IF_NOT_EXISTS_YOK", BASELINE_IF_NOT_EXISTS_YOK);
  check(
    "§2 ⭐ Her ADD VALUE `IF NOT EXISTS` taşıyor (baseline dışı)",
    yeniIfNotExists.length === 0,
    yeniIfNotExists.map((i) => `${i.ad}: ${i.ayrinti}`).join(" · "),
  );

  const yeniTekIfade = yeni("TEK_IFADE_DEGIL", BASELINE_TEK_IFADE_DEGIL);
  check(
    "§3 ⭐ ADD VALUE dosyası YALNIZ ADD VALUE taşıyor (baseline dışı)",
    yeniTekIfade.length === 0,
    yeniTekIfade.map((i) => `${i.ad}: ${i.ayrinti}`).join(" · "),
  );

  // ③ literal kullanımı için baseline YOK: bugün tek bir dosyada bile yok ve
  // en tehlikeli hâl budur (55P04'ün doğrudan tetikleyicisi).
  const literalIhlali = ihlaller.filter((i) => i.tur === "LITERAL_AYNI_DOSYADA");
  check(
    "§4 ⭐ Eklenen enum literali AYNI dosyanın başka ifadesinde kullanılmıyor",
    literalIhlali.length === 0,
    literalIhlali.map((i) => `${i.ad}: ${i.ayrinti}`).join(" · "),
  );

  // ── §5 BASELINE BAYATLIK DENETİMİ (iki yönlü) ─────────────────────────────
  const mevcutAdlar = new Set(dosyalar.map((d) => d.ad));
  const oluDosya = [...BASELINE_IF_NOT_EXISTS_YOK, ...BASELINE_TEK_IFADE_DEGIL].filter(
    (ad) => !mevcutAdlar.has(ad),
  );
  check("§5a Baseline'da ölü dosya adı yok", oluDosya.length === 0, oluDosya.join(", "));

  const ihlalEdenler = new Set(ihlaller.map((i) => `${i.tur}|${i.ad}`));
  const oluMuaf = [
    ...[...BASELINE_IF_NOT_EXISTS_YOK].filter((ad) => !ihlalEdenler.has(`IF_NOT_EXISTS_YOK|${ad}`)),
    ...[...BASELINE_TEK_IFADE_DEGIL].filter((ad) => !ihlalEdenler.has(`TEK_IFADE_DEGIL|${ad}`)),
  ];
  check(
    "§5b Baseline'da ÖLÜ MUAF yok (artık ihlal etmeyen satır listede kalmaz)",
    oluMuaf.length === 0,
    oluMuaf.join(", "),
  );

  // ── §6 ⭐ NEGATİF SONDA (bellek içi — gerçek dizine dosya yazılmaz) ───────
  const sonda1 = ihlalleriBul([
    { ad: "TEST-sonda-1", sql: `ALTER TYPE "X" ADD VALUE 'YENI';` },
  ]);
  check(
    "§6a Sonda: `IF NOT EXISTS` olmayan dosya YAKALANIYOR",
    sonda1.some((i) => i.tur === "IF_NOT_EXISTS_YOK"),
  );

  const sonda2 = ihlalleriBul([
    {
      ad: "TEST-sonda-2",
      sql: `ALTER TYPE "X" ADD VALUE IF NOT EXISTS 'YENI';\nUPDATE "t" SET "c" = 'YENI';`,
    },
  ]);
  check(
    "§6b Sonda: aynı dosyada başka ifade + literal kullanımı YAKALANIYOR (55P04 senaryosu)",
    sonda2.some((i) => i.tur === "TEK_IFADE_DEGIL") &&
      sonda2.some((i) => i.tur === "LITERAL_AYNI_DOSYADA"),
  );

  const sonda3 = ihlalleriBul([
    {
      ad: "TEST-sonda-3",
      sql: `-- ALTER TYPE "X" ADD VALUE 'YORUMDA';\nALTER TYPE "X" ADD VALUE IF NOT EXISTS 'A';\nALTER TYPE "X" ADD VALUE IF NOT EXISTS 'B';`,
    },
  ]);
  check(
    "§6c Sonda: doğru yazılmış çok değerli dosya TEMİZ (yorumdaki kalıp kırmızı vermez)",
    sonda3.length === 0,
    sonda3.map((i) => `${i.tur}`).join(", "),
  );

  // ⚠️ YANLIŞ POZİTİF SONDASI (ölçülmüş vaka, 20260531014923): BAŞKA bir enum'un
  // tanımında eşadlı bir değer geçmesi 55P04 üretmez — kırmızı vermemeli.
  // Bu sonda olmasaydı §4'ü "her literal aramasını kıs" diye gevşetmek cazip
  // olurdu ve gerçek ihlal de görünmez hâle gelirdi.
  const sonda4 = ihlalleriBul([
    {
      ad: "TEST-sonda-4",
      sql:
        `CREATE TYPE "SackStatus" AS ENUM ('OPEN', 'CLOSED', 'SHIPPED');\n` +
        `ALTER TYPE "RollStatus" ADD VALUE IF NOT EXISTS 'SHIPPED';`,
    },
  ]);
  check(
    "§6d Sonda: BAŞKA enum'un eşadlı değeri (CREATE TYPE içinde) literal ihlali SAYILMAZ",
    !sonda4.some((i) => i.tur === "LITERAL_AYNI_DOSYADA"),
    sonda4.map((i) => i.tur).join(", "),
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
