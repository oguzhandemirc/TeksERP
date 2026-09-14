// =============================================================================
// SABİT ADLI FİKSTÜR — bir bekçi, ÇÖKTÜKTEN SONRA yeniden koşulabilmelidir
// =============================================================================
// NEDEN VAR (ölçüldü 2026-09-14, gerçek vaka): `test_roll_relabel` renkleri
// `name: "RLB MAVİ"` diye SABİT adla yaratıyordu (yalnız KOD `${ts}` taşıyordu).
// 6e'nin FK kusurunda bekçi çöktü ⇒ `finally` temizliği koşmadı ⇒ iki renk DB'de
// kaldı ⇒ sonraki her koşum katlanmış-ad tekillik indeksinde **P2002** verdi ve
// ASIL FK HATASINI MASKELEDİ. Yerelde P2002, CI'da FK — aynı bekçi, iki imza.
// ⇒ Sabit adlı fikstür yalnız "temiz değil" değildir: **bir sonraki kırmızının
//   TEŞHİSİNİ bozar.** Antidot: `scripts/lib/fikstur-imzasi.ts` ya da değere
//   koşum başına benzersiz bir damga (`${ts}`).
//
// ⚠️ YÜKLEM ALTI DARALTMADAN GEÇTİ — sayı 1032 → 29 (hepsi ölçülmüş):
//   ① `name:`/`code:` literali (her yerde)                        1032 / 258 dosya
//      gürültü: iddia nesneleri, DB'ye hiç gitmeyen HTML fikstürleri
//   ② yalnız `create`/`upsert` çağrısının DENGELİ PARANTEZ penceresinde   262 / 83
//   ③ kolon O MODELİN TABLOSUNDA gerçekten tekil mi                       53 / 29
//      (önceki hâl "herhangi bir tabloda `name` tekil mi" diyordu: 147 yanlış)
//   ④ `upsert` ÇIKARILDI — sabit tekil değerle upsert DOĞRU kalıptır             35
//   ⑤ ŞEMA bileşik tekilleri çıkarıldı — `@@unique([customerId, code])`te kod
//      sabit olsa da taze müşteri varsa çakışma YOK
//   ⑥ SQL/fonksiyonel indeksler TUPLE olarak okundu — `(propertyId, code)`      29
//      bileşiktir. ⑤'i şema katmanında düzeltip ⑥'yı SQL katmanında bırakmıştım:
//      *aynı kusur bir katman aşağıda tekrarlıyordu.*
// ⭐ KONTROL GRUBU: 6e düzeltmesini indirince (`ea3942c7`) `test_roll_relabel`
//    listeden ÇIKTI (0 eşleşme), düzeltilmemiş kardeşi `test_roll_relabel_context`
//    (`color.name = "RLBC MAVİ"`, birebir aynı kalıp) DURDU. Tarayıcı sınıfı
//    görüyor ve düzeltilince görmeyi bırakıyor.
//
// Koşum: npx tsx scripts/test_fikstur_sabit_ad.ts   (DB GEREKMEZ)
// =============================================================================
import { git } from "./lib/git";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { atlamaDefteri } from "./lib/atlama";
import { curumeKolu } from "./lib/circir-kolu";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

const KOK = path.resolve(__dirname, "..");
const REPO = path.resolve(KOK, "..");
const BU_DOSYA = "Teks-Erp/scripts/test_fikstur_sabit_ad.ts";

/** Koşum başına benzersiz OLMAYAN değer yazılabilen kolon adları. */
const KOLON = "(name|code|barcode|username|sackNo|batchNumber|orderNumber|workOrderNumber|documentNo|beamNo)";
const YAZMA = /(?:prisma|tx|db)\.(\w+)\.(create|upsert|createMany|createManyAndReturn)\s*\(/g;

export type Tekillik = {
  /** TEK ALANLI `@unique` — literal tek başına çakışır. */
  tekAlan: Set<string>;
  /** Bileşik `@@unique([a,b])` — alan → diğer üyeler. */
  bilesik: Map<string, string[]>;
  tablo: string;
};

/** Şemadan delege → tekillik. Yorum satırları (`///`) ELENİR. */
export function semaTekillik(sema: string): Map<string, Tekillik> {
  const out = new Map<string, Tekillik>();
  for (const m of sema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const govde = m[2]
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    const tekAlan = new Set<string>();
    const bilesik = new Map<string, string[]>();
    for (const a of govde.matchAll(/^\s{2}(\w+)\s+\S+.*@unique/gm)) tekAlan.add(a[1]);
    for (const a of govde.matchAll(/@@unique\(\[([^\]]+)\]/g)) {
      const uyeler = a[1].split(",").map((x) => x.trim());
      if (uyeler.length === 1) tekAlan.add(uyeler[0]);
      else for (const f of uyeler) bilesik.set(f, uyeler.filter((u) => u !== f));
    }
    const tablo = /@@map\("([^"]+)"\)/.exec(govde)?.[1] ?? m[1];
    out.set(m[1].charAt(0).toLowerCase() + m[1].slice(1), { tekAlan, bilesik, tablo });
  }
  return out;
}

/**
 * Migration SQL'lerinden tablo → TEKİL indeks TUPLE'ları.
 * ⚠️ TUPLE, küme DEĞİL: `(propertyId, code)` bileşiktir ve `code` tek başına
 * tekil değildir. Bu ayrım ⑥'nın kendisi.
 */
export function sqlTekilTuplelar(sqlMetinleri: string[]): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  for (const sql of sqlMetinleri) {
    for (const u of sql.matchAll(/CREATE\s+UNIQUE\s+INDEX[^;]*?ON\s+"?(\w+)"?\s*\(([^;]*?)\)\s*(WHERE[^;]*)?;/gis)) {
      const uyeler = [...u[2].matchAll(/"(\w+)"/g)].map((x) => x[1]);
      if (uyeler.length === 0) continue;
      if (!out.has(u[1])) out.set(u[1], []);
      out.get(u[1])!.push(uyeler);
    }
  }
  return out;
}

export type Site = { cagri: string; delege: string; alan: string; deger: string; pencere: string; satir: number };

/**
 * Bir yazma sitesi TEHLİKE mi? SAF — girdi metin, çıktı karar; sondalar sentetik
 * girdiyle dosya içinde koşar (K sınıfı).
 */
export function tehlikeMi(s: Site, tekillik: Map<string, Tekillik>, sqlTuple: Map<string, string[][]>): boolean {
  // ④ `upsert` sabit tekil değerle DOĞRU kalıptır: ikinci koşum çakışmaz, günceller.
  if (s.cagri === "upsert") return false;
  // Koşum başına benzersiz değer (şablon + interpolasyon) tehlike değildir.
  if (s.deger.startsWith("`") && s.deger.includes("${")) return false;
  const t = tekillik.get(s.delege);
  if (!t) return false;
  const literal = (alan: string): boolean =>
    new RegExp(`\\b${alan.replace(/Fold$/, "")}\\s*:\\s*("[^"]*"|'[^']*'|\`[^\`$]*\`)`).test(s.pencere);
  // TEK ALANLI tekillik: literal tek başına çakışır.
  if (t.tekAlan.has(s.alan)) return true;
  // ⑤ ŞEMA bileşiği: ancak DİĞER üyeler de sabitse çakışır.
  const diger = t.bilesik.get(s.alan);
  if (diger && diger.length > 0 && diger.every(literal)) return true;
  // ⑥ SQL/fonksiyonel indeks — TUPLE olarak.
  const tuplelar = sqlTuple.get(t.tablo) ?? [];
  const iceren = tuplelar.filter((x) => x.includes(s.alan) || x.includes(`${s.alan}Fold`));
  if (iceren.some((x) => x.length === 1)) return true;
  return iceren.some(
    (x) => x.length > 1 && x.filter((u) => u !== s.alan && u !== `${s.alan}Fold`).every(literal),
  );
}

/** Bir dosyadaki yazma sitelerini çıkarır (yorumlar OFSET KORUNARAK soyulur). */
export function siteler(kaynak: string): Site[] {
  const temiz = kaynak
    .split("\n")
    .map((l) => (/^\s*\*/.test(l) ? " ".repeat(l.length) : l.replace(/\/\/.*$/, (m) => " ".repeat(m.length))))
    .join("\n");
  const out: Site[] = [];
  for (const m of temiz.matchAll(YAZMA)) {
    let derinlik = 0;
    let i = m.index + m[0].length - 1;
    let son = i;
    for (; i < temiz.length && i - m.index < 1200; i++) {
      if (temiz[i] === "(") derinlik++;
      else if (temiz[i] === ")") {
        derinlik--;
        if (derinlik === 0) {
          son = i;
          break;
        }
      }
    }
    const pencere = temiz.slice(m.index, son + 1);
    // ⚠️ İÇ İÇE `create` BLOĞU DIŞ MODELE ATFEDİLMEZ (ea ölçtü 2026-09-14):
    // `labelTemplate.create({ data: { name: `…${ts}`, variants: { create: [{ name: "100x70" }] } } })`
    // — dıştaki ad damgalıdır, içteki varyant adının tekilliği BAŞKA bir modelin
    // bileşik kısıtıdır. Pencere tabanlı atıf üçünü de `labelTemplate.name`
    // sanıyordu. ⇒ İlk gömülü ilişki-create'inden SONRASI KESİLİR: tanınmayan
    // model için iddia edilmez (§2h ilkesi).
    const gomulu = /\b(create|createMany|connectOrCreate)\s*:/.exec(pencere.slice(m[0].length));
    const kapsam = gomulu ? pencere.slice(0, m[0].length + gomulu.index) : pencere;
    for (const k of kapsam.matchAll(new RegExp(`\\b${KOLON}\\s*:\\s*(\`[^\`]*\`|"[^"]*"|'[^']*')`, "g"))) {
      out.push({
        cagri: m[2],
        delege: m[1],
        alan: k[1],
        deger: k[2],
        pencere: kapsam,
        satir: temiz.slice(0, m.index).split("\n").length,
      });
    }
  }
  return out;
}

/**
 * TABAN — ölçüldü 2026-09-14 (29 site / 18 dosya).
 * ⛔ Ölçen DÜŞÜRMEZ: düşüşü yönetici oturum tren sonunda yazar.
 * ⚠️ Bu bir kusur sayısıdır (yardımcısızlık değil): her üye bir bekçinin
 * çöküşten sonra yeniden koşulamaz olması demek. Antidot `lib/fikstur-imzasi.ts`
 * ya da değere koşum damgası; `upsert` kalıbı da meşru bir çıkış.
 */
// ⚠️ 29 → 22: İÇ İÇE `create` bloğunun dış modele atfedilmesi düzeltildi
// (ea üç vaka bildirdi, ölçüm YEDİ gösterdi — sınıf bildirilenden genişti).
// 22 → 1 (2026-09-14, entegratör 1e): ea 9 · d5 12 · 6e 1 · 82 3 site aynı gece düzeltildi; birleşik ağaçta ölçüldü.
// 1 → 0 (2026-09-14, entegratör 1e): son site (prisma_validation_message §4) d5 `5c0e488d` ile damgalandı; borçsuz.
const TABAN = 0;

function main(): void {
  console.log("\n=== Sabit adlı fikstür (çöküşten sonra yeniden koşulabilirlik) ===\n");
  const sema = readFileSync(path.join(KOK, "prisma/schema.prisma"), "utf8");
  const tekillik = semaTekillik(sema);
  const migDizin = path.join(KOK, "prisma/migrations");
  const sqlMetinleri: string[] = [];
  for (const d of readdirSync(migDizin)) {
    try {
      sqlMetinleri.push(readFileSync(path.join(migDizin, d, "migration.sql"), "utf8"));
    } catch {
      /* migration.sql'i olmayan dizin — yok sayılır */
    }
  }
  const sqlTuple = sqlTekilTuplelar(sqlMetinleri);

  const dosyalar = git(["ls-files", "--cached", "--others", "--exclude-standard", "Teks-Erp/scripts"], { cwd: REPO })
    .trim()
    .split("\n")
    .filter((f) => /\/test_[a-z0-9_]+\.ts$/.test(f))
    // ⚠️ ARAÇ, GÖZLEDİĞİ KÜMENİN İÇİNDE OLAMAZ: §3 sondaları deseni ÖRNEK olarak
    // taşımak zorunda. Muafiyet kapsam daraltması değil ÖLÇÜM KOŞULUDUR.
    .filter((f) => f !== BU_DOSYA);

  const tehlikeler: string[] = [];
  for (const f of dosyalar) {
    const kaynak = readFileSync(path.join(REPO, f), "utf8");
    for (const s of siteler(kaynak)) {
      if (tehlikeMi(s, tekillik, sqlTuple)) {
        tehlikeler.push(`${f.replace("Teks-Erp/", "")}:${s.satir} ${s.delege}.${s.alan}=${s.deger.slice(0, 26)}`);
      }
    }
  }

  // ── §0 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  console.log("§0 — körlük zemini");
  check("§0a taranan bekçi sayısı makul", dosyalar.length > 400, `${dosyalar.length} bekçi`);
  check("§0b şema okundu", tekillik.size > 80, `${tekillik.size} model`);
  check("§0c migration tekil indeksleri okundu", sqlTuple.size > 5, `${sqlTuple.size} tablo`);
  console.log("");

  // ── §1 CIRCIR ─────────────────────────────────────────────────────────────
  console.log("§1 — sabit adlı fikstür cırcırı");
  check(
    "§1a ARTMADI",
    tehlikeler.length <= TABAN,
    tehlikeler.length <= TABAN
      ? `${tehlikeler.length} ≤ ${TABAN}`
      : `${tehlikeler.length} > ${TABAN} ⇒ YENİ sabit adlı fikstür var.\n      ÜYELERİN TAMAMI ` +
          `(taban yalnız bir SAYI olduğu için HANGİSİNİN yeni olduğunu söyleyemem — kendi diff'inle ` +
          `karşılaştır; ama çare her biri için aynı: değere koşum damgası ekle ya da \`lib/fikstur-imzasi.ts\`):\n      ` +
          tehlikeler.join("\n      "),
  );
  if (tehlikeler.length > 0 && tehlikeler.length <= TABAN) {
    // ⚠️ YEŞİLKEN DE BORÇ GÖRÜNÜR: taban sıfır değilse kapı "temiz" demiyor,
    // "arttırmadın" diyor. Üyeleri basmazsak borç sayıya dönüşür ve adres kaybolur.
    console.log(`   ⓘ duran borç (${tehlikeler.length}): ${tehlikeler.join(" · ")}`);
  }
  curumeKolu(check, ATLAMA.atla, "§1b ⭐ taban ÇÜRÜMEDİ (düştüyse sabiti yönetici indirir)", tehlikeler.length, TABAN);
  console.log("");

  // ── §2 SONDALAR — altı daraltmanın her biri ───────────────────────────────
  console.log("§2 — sondalar (altı daraltmanın kontrol grupları)");
  const T = new Map<string, Tekillik>([
    ["renk", { tekAlan: new Set(["code"]), bilesik: new Map(), tablo: "renkler" }],
    ["sube", { tekAlan: new Set(), bilesik: new Map([["code", ["musteriId"]]]), tablo: "subeler" }],
    ["deger", { tekAlan: new Set(), bilesik: new Map(), tablo: "degerler" }],
  ]);
  const S = new Map<string, string[][]>([
    ["renkler", [["nameFold"]]],
    ["degerler", [["propertyId", "code"]]],
  ]);
  const site = (o: Partial<Site>): Site => ({
    cagri: "create",
    delege: "renk",
    alan: "code",
    deger: '"X"',
    pencere: '{ code: "X" }',
    satir: 1,
    ...o,
  });

  check("§2a ⭐ TEK ALANLI tekile literal → TEHLİKE", tehlikeMi(site({}), T, S));
  check(
    "§2b ⭐ ④ `upsert` → tehlike DEĞİL (idempotent, doğru kalıp)",
    !tehlikeMi(site({ cagri: "upsert" }), T, S),
  );
  check(
    "§2c ⭐ koşum damgalı şablon → tehlike DEĞİL",
    !tehlikeMi(site({ deger: "`X-${ts}`" }), T, S),
  );
  check(
    "§2d ⭐ ⑤ ŞEMA bileşiği, diğer üye DEĞİŞKEN → tehlike DEĞİL",
    !tehlikeMi(site({ delege: "sube", pencere: '{ code: "A1", musteriId: cust.id }' }), T, S),
  );
  check(
    "§2e ⭐ ⑤ ŞEMA bileşiği, diğer üye de SABİT → TEHLİKE",
    tehlikeMi(site({ delege: "sube", pencere: '{ code: "A1", musteriId: "sabit" }' }), T, S),
  );
  check(
    "§2f ⭐ ⑥ SQL TUPLE bileşiği, diğer üye DEĞİŞKEN → tehlike DEĞİL",
    !tehlikeMi(site({ delege: "deger", pencere: '{ code: "2-KAT", propertyId: prop.id }' }), T, S),
  );
  check(
    "§2g ⭐ ⑥ SQL tek üyeli TUPLE (nameFold) → TEHLİKE",
    tehlikeMi(site({ alan: "name", deger: '"MAVİ"', pencere: '{ name: "MAVİ" }' }), T, S),
  );
  check(
    "§2h ③ tanınmayan delege → tehlike DEĞİL (tablo bilinmiyorsa iddia edilmez)",
    !tehlikeMi(site({ delege: "bilinmeyen" }), T, S),
  );
  check(
    "§2i ② pencere: yazma çağrısı DIŞINDAKİ literal sayılmaz",
    siteler('const beklenen = { name: "X" };\nconsole.log(beklenen);').length === 0,
  );
  check(
    "§2j ② yazma çağrısı İÇİNDEKİ literal sayılır",
    siteler('await prisma.renk.create({ data: { name: "X" } });').length === 1,
  );
  check(
    "§2l ⭐ İÇ İÇE create dış modele ATFEDİLMEZ (varyant adı ≠ şablon adı)",
    (() => {
      const s2 = siteler(
        'await prisma.labelTemplate.create({ data: { name: `T-${ts}`, variants: { create: [{ name: "100x70" }] } } });',
      );
      // Dıştaki (damgalı) ad GELİR, içteki varyant adı GELMEZ.
      return s2.length === 1 && s2[0]!.deger.includes("${ts}") && !s2.some((x) => x.deger.includes("100x70"));
    })(),
    "pencere tabanlı atıf üç vakayı yanlış sınıflamıştı; ölçüm YEDİ gösterdi",
  );
  check(
    "§2m iç içe create YOKSA dıştaki literal sayılır (kesme fazla kesmiyor)",
    siteler('await prisma.renk.create({ data: { name: "MAVİ", kod: 1 } });').length === 1,
  );
  check("§2k ① satır yorumu sayılmaz", siteler('// await prisma.renk.create({ data: { name: "X" } })').length === 0);
  console.log("");

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
