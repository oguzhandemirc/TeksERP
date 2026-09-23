// =============================================================================
// MIGRATION SIRASI — "sonra doğan tabloya önce dokunma" kapısı (2026-09-23)
// =============================================================================
// NEDEN VAR: `20260923120000_number_series_separator2` `number_series_lines`
// tablosuna `ALTER TABLE` yazıyordu; o tabloyu yaratan migration
// (`20260923200000_number_series_line`) sıralamada ONDAN SONRA geliyor. Parça
// parça uygulanan geliştirici veritabanlarında hata GÖRÜNMEDİ (tablo, ALTER
// koştuğunda elle/başka sırayla zaten vardı); TEMİZ bir veritabanında
// `migrate deploy` `42P01 relation "number_series_lines" does not exist` ile
// düştü ve migration FAILED durumunda kaldı (ölçüldü 2026-09-23, boş DB).
//
// Sahada bedeli: kurulum ya da güncelleme yarıda kalır, geri alma = yedekten
// restore. CI bu sınıfı zaten yakalar (servis konteyneri her koşumda TAZE
// `teks_ci` veritabanı + `migrate deploy`), ama CI PUSH'tan sonra konuşur;
// bu bekçi DB'siz ve saniyenin altında, yani COMMIT KAPISINDA konuşur.
//
// SORU: her ifade, dokunduğu tabloyu KENDİSİNDEN ÖNCE (ya da aynı dosyada daha
// yukarıda) yaratılmış buluyor mu? Deploy sırası dizin adının leksikografik
// sırasıdır — bu dosya da tam olarak onu kullanır.
//
// KAPSAM (beyan): TABLOLAR ve GÖRÜNÜMLER. Enum tipleri, fonksiyonlar ve
// uzantılar kapsam DIŞIDIR — bugüne kadar o sınıfta bir ihlal ölçülmedi ve
// tip kullanımını metinden ayırt etmek (kolon tipi mi, dizge mi) bu tarayıcının
// yanlış pozitif riskini kaldırdığı yerin ötesine geçiyor. Kapsam dışı olmak
// "sorun yok" demek değildir, "bu kapı onu ÖLÇMEZ" demektir.
//
// Koşum: npx tsx scripts/run-all-tests.ts migration_order
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
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

const MIGRATIONS_DIR = join(__dirname, "..", "prisma", "migrations");

/** Katalog/şema nesneleri — migration'ın yaratması beklenmez. */
const SISTEM = /^(pg_|information_schema\.|pg_catalog\.)/i;

/** `"public"."foo"` · `"foo"` · `foo` → `foo` (küçük harf, şema atılır). */
function tabloAdi(ham: string): string {
  const parcalar = ham.split(".").map((p) => p.replace(/"/g, "").trim());
  return (parcalar[parcalar.length - 1] ?? "").toLowerCase();
}

/**
 * Yorumları ve dizge sabitlerini TEMİZLER — `--` bir yorum başlangıcı mı yoksa
 * bir dizgenin içinde mi, bunu ayırt etmeden tarayan bir kapı, açıklama
 * satırındaki örnek SQL'i gerçek ifade sanardı (bu depoda migration başlıkları
 * uzun ve SQL doludur).
 */
function sqlTemizle(metin: string): string {
  let cikti = "";
  let i = 0;
  let dizgede = false;
  let dolarEtiket: string | null = null;
  while (i < metin.length) {
    const iki = metin.slice(i, i + 2);
    if (dolarEtiket) {
      if (metin.startsWith(dolarEtiket, i)) {
        cikti += " ".repeat(dolarEtiket.length);
        i += dolarEtiket.length;
        dolarEtiket = null;
        continue;
      }
      // $$ … $$ gövdesi GERÇEK SQL'dir (DO bloğu) — olduğu gibi taşınır.
      cikti += metin[i];
      i++;
      continue;
    }
    if (dizgede) {
      if (metin[i] === "'") dizgede = false;
      cikti += metin[i] === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    const dolar = metin.slice(i).match(/^\$[A-Za-z_]*\$/);
    if (dolar) {
      dolarEtiket = dolar[0];
      cikti += " ".repeat(dolarEtiket.length);
      i += dolarEtiket.length;
      continue;
    }
    if (metin[i] === "'") {
      dizgede = true;
      cikti += " ";
      i++;
      continue;
    }
    if (iki === "--") {
      while (i < metin.length && metin[i] !== "\n") {
        cikti += " ";
        i++;
      }
      continue;
    }
    if (iki === "/*") {
      const son = metin.indexOf("*/", i + 2);
      const bit = son === -1 ? metin.length : son + 2;
      for (let j = i; j < bit; j++) cikti += metin[j] === "\n" ? "\n" : " ";
      i = bit;
      continue;
    }
    cikti += metin[i];
    i++;
  }
  return cikti;
}

const AD = `("?[A-Za-z_][\\w$]*"?(?:\\s*\\.\\s*"?[A-Za-z_][\\w$]*"?)?)`;

interface Olay {
  yer: number;
  tur: "yarat" | "kullan" | "dusur" | "yenidenAdlandir";
  tablo: string;
  hedef?: string;
  ifade: string;
}

function olaylariTopla(sql: string): Olay[] {
  const olaylar: Olay[] = [];
  const ekle = (re: RegExp, tur: Olay["tur"], ifade: string, grup = 1) => {
    for (const m of sql.matchAll(re)) {
      const ham = m[grup];
      if (!ham) continue;
      olaylar.push({
        yer: m.index ?? 0,
        tur,
        tablo: tabloAdi(ham),
        ...(tur === "yenidenAdlandir" ? { hedef: tabloAdi(m[2] ?? "") } : {}),
        ifade,
      });
    }
  };

  // YARATANLAR
  ekle(new RegExp(`\\bCREATE\\s+(?:UNLOGGED\\s+|GLOBAL\\s+|LOCAL\\s+|TEMP(?:ORARY)?\\s+)*TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${AD}`, "gi"), "yarat", "CREATE TABLE");
  ekle(new RegExp(`\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:MATERIALIZED\\s+|TEMP(?:ORARY)?\\s+)*VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${AD}`, "gi"), "yarat", "CREATE VIEW");

  // KULLANANLAR — tablo o anda VAR OLMALI
  ekle(new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${AD}`, "gi"), "kullan", "ALTER TABLE");
  ekle(new RegExp(`\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"?[A-Za-z_][\\w$]*"?\\s+)?ON\\s+(?:ONLY\\s+)?${AD}`, "gi"), "kullan", "CREATE INDEX");
  ekle(new RegExp(`\\bREFERENCES\\s+${AD}`, "gi"), "kullan", "REFERENCES");
  ekle(new RegExp(`\\bINSERT\\s+INTO\\s+${AD}`, "gi"), "kullan", "INSERT INTO");
  ekle(new RegExp(`\\bDELETE\\s+FROM\\s+${AD}`, "gi"), "kullan", "DELETE FROM");
  // ⚠️ UPDATE'in ÜÇ YALANCI ARKADAŞI var ve üçü de bu depoda GEÇİYOR:
  // `ON UPDATE CASCADE` (FK eylemi) · `ON CONFLICT DO UPDATE SET` (upsert) ·
  // `BEFORE INSERT OR UPDATE ON "rolls"` (trigger olayı). Üçünü de ayırt eden
  // ölçüt ifadenin KUYRUĞUDUR: gerçek bir UPDATE ifadesinde tablo adını
  // (ve varsa takma adını) `SET` izler. Yalnız ÖNCEKİ kelimeye bakan bir eleme
  // ölçüldü ve YETMEDİ — trigger satırında "on" ve "or" tablo adı sanıldı.
  for (const m of sql.matchAll(
    new RegExp(`\\bUPDATE\\s+(?:ONLY\\s+)?${AD}(?:\\s+(?:AS\\s+)?"?[A-Za-z_][\\w$]*"?)?\\s+SET\\b`, "gi"),
  )) {
    const ham = m[1];
    if (!ham) continue;
    olaylar.push({ yer: m.index ?? 0, tur: "kullan", tablo: tabloAdi(ham), ifade: "UPDATE" });
  }

  // DÜŞÜRENLER / AD DEĞİŞTİRENLER
  ekle(new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${AD}`, "gi"), "dusur", "DROP TABLE");
  ekle(new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${AD}\\s+RENAME\\s+TO\\s+${AD}`, "gi"), "yenidenAdlandir", "RENAME TO");

  return olaylar.sort((a, b) => a.yer - b.yer);
}

function main(): void {
  const dizinler = readdirSync(MIGRATIONS_DIR)
    .filter((d) => statSync(join(MIGRATIONS_DIR, d)).isDirectory())
    .sort(); // = deploy sırası
  check("prisma/migrations okunabildi", dizinler.length > 0, `${dizinler.length} migration`);

  const varOlan = new Set<string>();
  const ihlaller: string[] = [];
  let kullanimSayisi = 0;

  for (const dizin of dizinler) {
    const yol = join(MIGRATIONS_DIR, dizin, "migration.sql");
    let ham: string;
    try {
      ham = readFileSync(yol, "utf8");
    } catch {
      // Dosyasız migration dizini ayrı bir bekçinin (`check-migrations`) konusu.
      continue;
    }
    const sql = sqlTemizle(ham);
    for (const olay of olaylariTopla(sql)) {
      if (SISTEM.test(olay.tablo)) continue;
      if (olay.tur === "yarat") {
        varOlan.add(olay.tablo);
      } else if (olay.tur === "dusur") {
        varOlan.delete(olay.tablo);
      } else if (olay.tur === "yenidenAdlandir") {
        varOlan.delete(olay.tablo);
        if (olay.hedef) varOlan.add(olay.hedef);
      } else {
        kullanimSayisi++;
        if (!varOlan.has(olay.tablo)) {
          ihlaller.push(`${dizin} → ${olay.ifade} "${olay.tablo}" (tablo bu noktada HENÜZ YOK)`);
        }
      }
    }
  }

  // KÖRLÜK ZEMİNİ: hiç kullanım görmediyse tarayıcı bozuk demektir; "0 ihlal"
  // o zaman bir ölçüm değil, bir sessizliktir.
  check(
    "tarayıcı gerçekten ifade gördü (körlük zemini)",
    kullanimSayisi > 100,
    `${kullanimSayisi} tablo kullanımı, ${varOlan.size} yaşayan tablo`,
  );

  check(
    "her migration yalnız KENDİSİNDEN ÖNCE yaratılmış tablolara dokunuyor",
    ihlaller.length === 0,
    ihlaller.length ? `${ihlaller.length} ihlal` : "",
  );
  for (const i of ihlaller) console.log(`   ⛔ ${i}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) {
    console.log(
      "\nDÜŞTÜYSE: bir migration, kendisinden SONRA doğan bir tabloya dokunuyor.\n" +
        "Temiz bir veritabanında `migrate deploy` 42P01 ile DÜŞER ve migration FAILED kalır.\n" +
        "Çare: ifadeyi, tabloyu yaratan migration'dan SONRA gelen YENİ bir migration'a taşı\n" +
        "(`ADD COLUMN IF NOT EXISTS` ile idempotent yaz; ara durumdaki DB'lerde no-op olur).\n" +
        "Uygulanmış dosyayı düzenlemenin bedeli ÖLÇÜLDÜ: `migrate deploy` ve `migrate status`\n" +
        "checksum farkını umursamaz (yalnız `migrate dev` konuşur, o da bu depoda yasak).",
    );
  }
  process.exit(fail > 0 ? 1 : 0);
}

main();
