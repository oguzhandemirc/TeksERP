// =============================================================================
// BEKÇİ: Okutulan barkod BÜYÜK/küçük harften bağımsız bulunur (2026-08-17)
// Çalıştır: npx tsx scripts/test_scan_code_case.ts
// =============================================================================
// SAHA VAKASI: Kâğıda BÜYÜK harfle basılan barkod, el tarayıcısından KÜÇÜK harf
// geliyordu (klavye-taklidi düzen / Caps Lock inversiyonu — bizim kontrolümüzde
// değil). Tam-eşleşme aramaları yalnız `.trim()` yapıyordu → top "yok" görünüyor,
// operatör sevkiyatı tamamlayamıyordu. Ölçüldü: `T130826F0230` bulunuyor,
// `t130826f0230` bulunmuyordu.
//
// Kayıtlı kodların TAMAMI büyük harf (rolls/traveler_cards/sacks: 0 istisna) →
// düzeltilen VERİ değil GİRDİ. Tek kapı: `normalizeScanCode`.
//
// İKİ CEPHE:
//   A) DAVRANIŞ — okutma yüzeyleri küçük/karışık harfle de bulur.
//   B) MEKANİK  — `src/` içinde yardımcıyı ATLAYAN yeni bir tam-eşleşme araması
//      eklenirse test kırmızı verir. (A) tek başına yetmez: yarın eklenen bir
//      okutma ucu bugünkü testlerin hiçbirine dokunmaz ve saha hatası sessizce
//      geri gelir — bu vakanın tamamı zaten öyle doğdu.
//
// ⚠️ ÇÖZÜM `mode:"insensitive"` DEĞİL: ILIKE'a çevirir, `barcode` unique index'i
// devre dışı kalır ve her okutma seq scan olur. Bu testin (C) bölümü çözümün
// index'i koruduğunu EXPLAIN ile kanıtlar — yoksa "çalışıyor" ile "hızlı
// çalışıyor" aynı yeşile çıkar.
// =============================================================================
import fs from "fs";
import path from "path";
import prisma, { pool } from "../src/lib/prisma";
import { ItemType, ItemUnit, RollStatus } from "@prisma/client";
import { normalizeScanCode } from "../src/utils/code-format";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { InventoryService } from "../src/services/inventory.service";
import { ReturnService } from "../src/services/return.service";
import { SackSearchService } from "../src/services/sack-search.service";
import { TamburService } from "../src/services/tambur.service";

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

const SUFFIX = `SCC${Date.now().toString().slice(-8)}`;
const cleanup: { rollIds: string[]; itemId?: string } = { rollIds: [] };

// ── A) Saf yardımcı ─────────────────────────────────────────────────────────
function testHelper(): void {
  console.log("\n── A) normalizeScanCode ──");
  check("küçük → BÜYÜK", normalizeScanCode("t130826f0230") === "T130826F0230");
  check("baş/son boşluk temizlenir", normalizeScanCode("  T1  ") === "T1");
  check("karışık yazım tekleşir", normalizeScanCode("Ie1207260001") === "IE1207260001");
  check("zaten büyükse değişmez", normalizeScanCode("CV1207260001") === "CV1207260001");
  // ⚠️ Türkçe yerel büyütme ASCII barkodu BOZAR: "i" → "İ". Barkodlarımız ASCII.
  check(
    "Türkçe yerel büyütme KULLANILMIYOR (i → I, İ değil)",
    normalizeScanCode("ie1207") === "IE1207",
    normalizeScanCode("ie1207"),
  );
}

// ── B) Davranış — gerçek okutma yüzeyleri ───────────────────────────────────
async function testLookups(): Promise<void> {
  console.log("\n── B) Okutma yüzeyleri küçük harfle de bulur ──");

  const item = await prisma.item.create({
    data: {
      code: `TEST-ITM-${SUFFIX}`,
      name: `Test Kumaş ${SUFFIX}`,
      unit: ItemUnit.MT,
      itemType: ItemType.FABRIC,
    },
    select: { id: true },
  });
  cleanup.itemId = item.id;

  // Barkod ÜRETİM biçiminde: büyük harf + rakam (kâğıda basılan hâli).
  const barcode = `T${SUFFIX}A1`.toUpperCase();
  const roll = await prisma.roll.create({
    data: {
      barcode,
      itemId: item.id,
      initialQty: 100,
      currentQty: 100,
      status: RollStatus.WAREHOUSE,
    },
    select: { id: true },
  });
  cleanup.rollIds.push(roll.id);

  const inv = new InventoryService();
  const ret = new ReturnService();
  const sackSearch = new SackSearchService();

  const upper = await inv.findRollByBarcode(barcode);
  check("top ucu: BÜYÜK harf (kâğıttaki) bulur", upper.data?.id === roll.id);

  const lower = await inv.findRollByBarcode(barcode.toLowerCase());
  check(
    "top ucu: küçük harf (tabancadan) BULUR",
    lower.data?.id === roll.id,
    "asıl saha hatası buydu",
  );

  const spaced = await inv.findRollByBarcode(`  ${barcode.toLowerCase()}  `);
  check("top ucu: boşluklu + küçük harf bulur", spaced.data?.id === roll.id);

  // Etiket/Düzelt yolu — barkodsuz açık kumaş için rollId dalı da var, o dal
  // normalize edilmemeli (uuid'yi büyütmek onu bozardı).
  const ctxLower = await inv.getRelabelContext({ barcode: barcode.toLowerCase() });
  check("Düzelt bağlamı: küçük harf bulur", Boolean(ctxLower.data));
  const ctxById = await inv.getRelabelContext({ rollId: roll.id });
  check("Düzelt bağlamı: rollId dalı BOZULMADI", Boolean(ctxById.data), "uuid büyütülmüyor");

  /**
   * İade/konum yüzeyleri topu BULDUKTAN SONRA iş kuralı uygulayabilir (örn.
   * "sevk edilmemiş top iade alınamaz"). Bizi ilgilendiren tek şey topun
   * BULUNMASI — bu yüzden "bulunamadı" ile "bulundu ama kural reddetti"
   * ayrıştırılır. Sadece `data` dolu mu diye bakmak, iş kuralı değişince testi
   * ilgisiz bir sebeple kırmızıya düşürürdü.
   */
  /**
   * LİSTE ARAMASI da bir okutma yüzeyidir (2026-08-19 saha vakası):
   * "top listede yok ama yan panelde açılıyor" — çünkü okutma yolu normalize
   * ediyor, liste süzgeci etmiyordu. Ana top listesi o gün düzeltildi, Tambur
   * çıktı listesi ATLANMIŞTI ve arıza sahadan geri geldi. Yüzeyi ADIYLA koruyan
   * kontrol bu; mekanik bölüm (D) kuralı, bu bölüm ise SONUCU ölçer.
   */
  const tambur = new TamburService();
  const outRoll = await prisma.roll.create({
    data: {
      barcode: `T${SUFFIX}B2`.toUpperCase(),
      itemId: item.id,
      initialQty: 50,
      currentQty: 50,
      status: RollStatus.WAREHOUSE,
      entrySource: "TAMBUR_SPLIT",
    },
    select: { id: true, barcode: true },
  });
  cleanup.rollIds.push(outRoll.id);

  // `barcode` şemada nullable (barkodsuz açık kumaş olabilir) ama bu top
  // hemen yukarıda BARKODLU yaratıldı; testin ölçtüğü şey zaten barkod
  // aramasının harf duyarsızlığı — barkod yoksa sonda anlamsızdır.
  if (!outRoll.barcode) throw new Error("Fixture hatası: çıkış topu barkodsuz doğdu");
  const outBarcode: string = outRoll.barcode;
  const listUpper = await tambur.listRecentOutputRolls({ search: outBarcode });
  const listLower = await tambur.listRecentOutputRolls({ search: outBarcode.toLowerCase() });
  const hit = (r: { data?: unknown }): boolean =>
    Array.isArray(r.data) && (r.data as { id: string }[]).some((x) => x.id === outRoll.id);
  check("Tambur çıktı listesi: BÜYÜK harf bulur", hit(listUpper));
  check(
    "Tambur çıktı listesi: küçük harf BULUR",
    hit(listLower),
    "sahadan gelen arıza tam buydu",
  );

  const found = async (fn: () => Promise<{ data?: unknown }>): Promise<boolean> => {
    try {
      return Boolean((await fn()).data);
    } catch (e) {
      const msg = (e as Error).message;
      return !/bulunamadı|bulunamadi/i.test(msg);
    }
  };

  check(
    "iade okutması: küçük harf bulur",
    await found(() => ret.lookupForReturn(barcode.toLowerCase())),
  );
  check(
    "çuval arama (top konumu): küçük harf bulur",
    await found(() => sackSearch.locateRoll(barcode.toLowerCase())),
  );

  // NEGATİF KONTROL: gerçekten olmayan bir kod "bulunamadı" DEMELİ. Yoksa
  // yukarıdaki iki kontrol vakumen yeşil kalırdı (her hata "bulundu" sayılırdı).
  check(
    "olmayan kod gerçekten bulunamıyor (kontrol kör değil)",
    !(await found(() => ret.lookupForReturn(`YOK${SUFFIX}`))),
  );
}

// ── C) Index korunuyor mu (çözümün ASIL bedeli) ─────────────────────────────
/**
 * Plancının index'i SEÇMESİ için gereken asgari satır — ÖLÇÜLDÜ, uydurulmadı.
 *
 * ⚠️ ÖLÇÜM (2026-09-13, PG 16.15, `rolls` tablosu, `ANALYZE` sonrası):
 *   toplam 101 → Seq Scan · 131 → Seq Scan · 181 → Seq Scan
 *   toplam 200 → Index Scan using rolls_barcode_key · 281 → Index · 581 → Index
 * ⇒ dönüş noktası ~190. Eşik 500 seçildi: **≈2,6× pay**, çünkü sayı satır
 *   genişliğine ve `relpages`e bağlıdır, salt satır sayısına değil.
 */
const PLAN_ESIGI = 500;
const DOLGU_ON_EKI = "SCCPLAN-";

/**
 * C) bölümünün ÖN KOŞULUNU KURAR — ortamdan BEKLEMEZ.
 *
 * ⚠️ GEREKÇE `e77714b4`TEN DEVRALINDI, YENİDEN ÖLÇÜLMEDİ. d5 dört tur aynı
 * soruyu sordu ve İKİ teşhisi de ÖLÇEREK DÜŞÜRDÜ:
 *   (1) "ORTAM — plancı KÜÇÜK tabloda index kullanmaz"  ⇒ DÜŞTÜ: CI'ın planı
 *       `cost=0.00..112.03` geldi, yani tablo küçük DEĞİL.
 *   (2) "ARALIKLI"                                       ⇒ DÜŞTÜ: ✅✅❌❌ salınım
 *       değil temiz bir GEÇİŞ (sıklık defterinin kuralı: ③ SÜRÜKLENME).
 * AYAKTA KALAN ADAY TEŞHİS: seq scan maliyeti ≈ `relpages` ⇒ CI'ın tablosu da
 * 112 sayfa; YERELDE AYNI SAYFA SAYISINDA plancı INDEX seçiyor. ⇒ ***Fark
 * SAYFADA değil İSTATİSTİKTE: CI'ın efemer DB'sinde `ANALYZE` hiç koşmuyor,
 * plancı BAYAT `reltuples` görüyor.*** (Bekçiler top yaratıp siliyor, silinen
 * satırlar sayfaları bırakıyor, autovacuum yetişmiyor — `test_audit_depth` ile
 * aynı kök.)
 *
 * ⇒ Bu yüzden ön koşulun ASIL parçası dolgu satırı DEĞİL **`ANALYZE`**dir;
 *   dolgu yalnız istatistiğin index'i seçtirecek kadar CANLI satır görmesini
 *   garanti eder (ölçüm aşağıda). İkisi AYRI gerekçedir ve ikisi de gerekir.
 * ⇒ *Bir bekçinin yeşili, bekçinin DIŞINDAKİ bir duruma bağlıysa o bekçi
 *   kendine yetmiyordur.*
 * ⚠️ `e77714b4`ün getirdiği "kırmızı kendi TEŞHİSİNİ taşır" davranışı AYNEN
 *   KORUNUR — ön koşul onun üstüne biner: teşhis kalır, kırmızı gider.
 */
async function planOnKosuluKur(itemId: string): Promise<{ once: number; sonra: number }> {
  const once = await prisma.roll.count();
  const eksik = PLAN_ESIGI - once;
  if (eksik > 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO rolls (id, barcode, "itemId", "initialQty", "currentQty", "qualityGrade",
                          width, status, "entrySource", "createdAt", "updatedAt")
       SELECT gen_random_uuid(), '${DOLGU_ON_EKI}' || g, $1::uuid, 1, 1, '1.KALITE', 100,
              'WAREHOUSE', 'SUPPLIER_RECEIPT', now(), now()
       FROM generate_series(1, ${eksik}) g`,
      itemId,
    );
  }
  // ⚠️ `ANALYZE` ŞART: satır eklemek yetmez, plancı BAYAT istatistikle karar verir.
  await prisma.$executeRawUnsafe(`ANALYZE rolls`);
  return { once, sonra: await prisma.roll.count() };
}

async function planOnKosuluKaldir(): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM rolls WHERE barcode LIKE '${DOLGU_ON_EKI}%'`);
  await prisma.$executeRawUnsafe(`ANALYZE rolls`);
}

async function testIndexPreserved(): Promise<void> {
  console.log("\n── C) Unique index korunuyor ──");
  if (!cleanup.itemId) {
    fail++;
    console.log("❌ C) ÖN KOŞUL KURULAMADI — fikstür kalemi yok; index yüklemi ÖLÇÜLMEDİ");
    return;
  }
  const sayim = await planOnKosuluKur(cleanup.itemId);
  console.log(
    `   ön koşul KURULDU: ${sayim.once} → ${sayim.sonra} satır + ANALYZE ` +
      `(eşik ${PLAN_ESIGI}; ölçüldü: 181 satırda Seq Scan, 200'de Index)`,
  );
  const rows = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
    `EXPLAIN SELECT id FROM rolls WHERE barcode = 'T130826F0230'`,
  );
  const plan = rows.map((r) => r["QUERY PLAN"]).join(" ");
  const indexKullaniyor = /Index/i.test(plan) && !/Seq Scan/i.test(plan);

  // ⚠️ KIRMIZI KENDİ TEŞHİSİNİ TAŞISIN (2026-09-13). Bu yüklem CI'da DÖRT turdur
  // izleniyor ve iki kez sınıfı yanlış kondu:
  //   ①  "ORTAM — plancı küçük tabloda index kullanmaz"  ← `cost=0.00..1.02` (≈1 sayfa)
  //   ②  "ARALIKLI"                                       ← ✅✅❌❌ görülünce
  // Ama dördüncü turda plan `cost=0.00..112.03` geldi: tablo artık KÜÇÜK DEĞİL,
  // yani ① açıklaması ÖLDÜ. Ve karşı-örnek (ILIKE) ile TAM AYNI planı verdi —
  // iki farklı sorgu aynı planı veriyorsa `barcode` için hiçbir index
  // kullanılmıyor demektir.
  //
  // Hangi açıklamanın doğru olduğu CI'ın DB'sinden okunmadan bilinemez ve o DB
  // EFEMER — koşum bitince yok. ⇒ Teşhis, kırmızının KENDİSİYLE birlikte
  // basılmalı; yoksa her turda aynı soruyu yeniden soruyoruz.
  //   *Bir kırmızı, sınıflandırılabilmesi için gereken veriyi yanında taşımalıdır.*
  let teshis = "";
  if (!indexKullaniyor) {
    try {
      const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes WHERE tablename='rolls' AND indexdef ILIKE '%barcode%'`,
      );
      const ist = await prisma.$queryRawUnsafe<{ reltuples: number; relpages: number }[]>(
        `SELECT reltuples::int AS reltuples, relpages FROM pg_class WHERE relname='rolls'`,
      );
      const n = await prisma.roll.count();
      teshis =
        `\n      ↳ TEŞHİS: barcode index'i = ${idx.length ? idx.map((i) => i.indexname).join(",") : "YOK ⛔"}` +
        ` · gerçek satır = ${n} · plancının gördüğü reltuples = ${ist[0]?.reltuples ?? "?"}` +
        ` · relpages = ${ist[0]?.relpages ?? "?"}` +
        `\n      ↳ index YOKSA şema/migration sorunu · index VARSA istatistik bayat (ANALYZE koşmamış)` +
        ` — ikisi AYRI kalem, "ortam" tek başına ikisini de açıklamaz`;
    } catch (e) {
      // Teşhis SORGUSU düşerse sessiz kalma: teşhisin yokluğu da bir bilgidir.
      teshis = `\n      ↳ TEŞHİS ALINAMADI: ${(e as Error).message.slice(0, 90)}`;
    }
  }
  check("tam eşleşme INDEX kullanıyor (Seq Scan değil)", indexKullaniyor, plan.slice(0, 80) + teshis);

  const ilike = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
    `EXPLAIN SELECT id FROM rolls WHERE barcode ILIKE 'T130826F0230'`,
  );
  const ilikePlan = ilike.map((r) => r["QUERY PLAN"]).join(" ");
  // Bu satır bir KARŞI-ÖRNEKTİR: mode:"insensitive" seçilseydi plan buydu.
  // Kırmızı vermesi beklenmiyor, gerekçeyi ölçülebilir kılıyor.
  console.log(`  ℹ️ karşı-örnek (ILIKE / mode:"insensitive"): ${ilikePlan.slice(0, 80)}`);
}

// ── D) MEKANİK — yardımcıyı atlayan yeni arama var mı ───────────────────────
// Kaynak metni tarar. "Bugün düzelttim" ile "bir daha bozulamaz" arasındaki fark
// bu bölüm; (B) yalnız BUGÜN bilinen yüzeyleri ölçer.
function testMechanical(): void {
  console.log("\n── D) Yardımcıyı atlayan tam-eşleşme araması ──");

  const SRC = path.join(__dirname, "..", "src");
  const files: string[] = [];
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts")) files.push(p);
    }
  })(SRC);

  // Körlük zemini: tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye bakılmadı"
  // aynı yeşile çıkar.
  check("körlük zemini: en az 100 kaynak dosya tarandı", files.length >= 100, `${files.length} dosya`);

  /**
   * Aranan biçim: `{ barcode: <ifade> }` / `{ sackNo: … }` / `{ cardNumber: … }`
   * — yani KOD ile TAM EŞLEŞME. `contains`/`in`/`startsWith` gibi biçimler
   * kapsam dışı (onlar ya ILIKE'tır ya da dizi yolu, ayrıca ele alınır).
   *
   * ⚠️ KISAYOL YAZIM (`{ barcode }`) DE YAKALANIR ve bu satır LOAD-BEARING:
   * hatanın ORİJİNAL biçimi tam olarak buydu (`where: { barcode }`). İlk yazımda
   * yalnız `ad: değer` biçimi taranıyordu ve negatif sonda bunu kanıtladı —
   * normalize kaldırıldığında davranış testleri kırmızı verdi ama bu mekanik
   * bölüm YEŞİL kaldı, yani gelecekteki regresyonu göremeyecekti.
   */
  const EXACT = /\{\s*(barcode|sackNo|cardNumber)\s*(?::\s*([A-Za-z_$][\w$.]*))?\s*[,}]/g;

  /** Gerekçeli muaflar — kod DEĞİL, kaydın kendi alanından okunan değerler. */
  const EXEMPT_IDENTS = new Set([
    "true", // select: { barcode: true }
    "false",
    "bc", // üretilen yeni barkod (yazma yolu)
    "reserved",
    "newBarcode",
  ]);

  /**
   * Yardımcının KENDİ dosyası muaf: başlık açıklamasında hatalı biçimi örnek
   * olarak gösteriyor ("… yalnız `where: { barcode: code }` yapıyordu"). Tarayıcı
   * yorum/kod ayrımı yapmıyor; ayrımı eklemek bu bekçiyi bir TS parser'ına
   * bağımlı kılardı, kazanç ise tek dosyalık bir muaf.
   */
  const EXEMPT_FILES = new Set([path.join("utils", "code-format.ts")]);

  /**
   * ⚠️ YORUMLAR SÖKÜLÜR — bu satır load-bearing ve pahalı öğrenildi.
   * Bağlam testi (`where:` ile eşleşme ARASINDA yalnız ayraç olabilir) yorum
   * görünce eşleşmeyi "arama değil" sayıp ATLIYOR. Yani tam da riskli yerler —
   * yanına neden yazılmış aramalar — bekçiden muaf oluyordu. Üstelik 300
   * karakterlik geriye-bakış penceresini uzun bir açıklama tek başına taşırıyor.
   * Blok yorum ve SATIR BAŞI `//` sökülür; satır ortasındaki `//` bırakılır
   * (string içindeki URL'i kesip aynı satırdaki gerçek bir ihlali gizlerdi).
   */
  const stripComments = (t: string): string =>
    t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, "");

  const violations: string[] = [];
  let scanned = 0;
  for (const file of files) {
    if (EXEMPT_FILES.has(path.relative(SRC, file))) continue;
    const src = stripComments(fs.readFileSync(file, "utf8"));
    // Yalnız `where:` bağlamındaki eşleşmeler ilgilendiriyor — `select:`/`data:`
    // içindeki `barcode: true` bir arama değildir.
    for (const m of src.matchAll(EXACT)) {
      // Kısayol yazımda değişken adı = alan adı (`{ barcode }` → `barcode`).
      const ident = m[2] ?? m[1]!;
      if (EXEMPT_IDENTS.has(ident)) continue;
      /**
       * ARAMA mı DEĞİL mi — eşleşen `{`, bir `where:`in DOĞRUDAN içinde olmalı.
       *
       * İki naif deneme yetmedi (ikisini de negatif sonda düşürdü):
       *   ① "yakında `where` geçiyor mu" → `update({ where: { id }, data: { barcode } })`
       *      yazma yolunu ihlal saydı.
       *   ② "en yakın anahtar `where:` mi" → audit `newData: { sackNo: … }` ve hata
       *      `details: { barcode: … }` nesnelerini ihlal saydı (aralarında
       *      data:/select: geçmiyordu).
       * Doğru ölçüt: `where:` ile eşleşme arasında YALNIZ ayraç ve iç içe filtre
       * anahtarları (OR/AND/NOT/is/some/every) bulunabilir.
       */
      const before = src.slice(Math.max(0, m.index! - 600), m.index!);
      /**
       * ⚠️ İKİ YAZIM VAR ve ilk sürüm yalnız birincisini görüyordu:
       *   ① nesne literali → `where: { ... }`
       *   ② SONRADAN ATAMA → `where.OR = [ { barcode: search } ]`
       * ②'yi kaçırmak teorik değil, ÖLÇÜLDÜ: 2026-08-19'da üç yüzey
       * (`listRecentOutputRolls`, `listSwatches`, `getSwatchStats`) tam bu biçimde
       * normalize etmeden kalmıştı ve bu bekçi YEŞİL veriyordu — arıza sahadan
       * geldi ("top listede yok ama yan panelde açılıyor"), bekçiden değil.
       * Liste araması `where` nesnesini adım adım kurduğu için ② en yaygın yazım.
       */
      const CTX = /where[A-Za-z0-9_$]*\s*(?::|\.\s*(?:OR|AND|NOT)\s*=)/g;
      let lastWhere = -1;
      let lastWhereLen = 0;
      for (const c of before.matchAll(CTX)) {
        lastWhere = c.index!;
        lastWhereLen = c[0].length;
      }
      if (lastWhere < 0) continue;
      const between = before.slice(lastWhere + lastWhereLen);
      if (!/^[\s{[\]]*((OR|AND|NOT|is|some|every)\s*:\s*[\s{[]*)*$/.test(between)) continue;
      scanned++;
      // Kabul edilen iki biçim: ifadenin kendisi normalize eder, YA DA aynı
      // dosyada o değişken normalize edilerek atanmıştır.
      const inline = m[0].includes("normalizeScanCode");
      const assigned = new RegExp(
        `(const|let)\\s+${ident.split(".")[0]}\\s*=[^;]*normalizeScanCode`,
      ).test(src);
      const paramNormalized = new RegExp(`${ident}\\s*=\\s*normalizeScanCode`).test(src);
      if (!inline && !assigned && !paramNormalized) {
        violations.push(`${path.relative(SRC, file)} → { ${m[1]}: ${ident} }`);
      }
    }
  }

  check("körlük zemini: en az 8 tam-eşleşme araması bulundu", scanned >= 8, `${scanned} arama`);
  check(
    "her tam-eşleşme araması normalizeScanCode'dan geçiyor",
    violations.length === 0,
    violations.length ? violations.join(" · ") : `${scanned} arama temiz`,
  );
}

async function main(): Promise<void> {
  console.log("=== Okutma kodu büyük/küçük harf bekçisi ===");
  // ⚠️ İLK İFADE: bu bekçi artık C) bölümünde ÖN KOŞUL KURUYOR (dolgu satırı +
  // `ANALYZE rolls`) ve `ANALYZE` tablo istatistiğini GLOBAL etkiler.
  const dbEngeli = hedefDbEngeli();
  if (dbEngeli) {
    console.error(`❌ DURDURULDU: ${dbEngeli}`);
    fail++;
    return;
  }
  try {
    testHelper();
    await testLookups();
    await testIndexPreserved();
    testMechanical();
  } catch (err) {
    fail++;
    console.error("Beklenmeyen hata:", err);
  } finally {
    await planOnKosuluKaldir().catch((e: unknown) => {
      console.log(`  ⚠️ TEMİZLİK DÜŞTÜ: plan dolgusu — ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    });

    await prisma.rollOperation.deleteMany({ where: { rollId: { in: cleanup.rollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: cleanup.rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: cleanup.rollIds } } }).catch(() => {});
    if (cleanup.itemId) await prisma.item.deleteMany({ where: { id: cleanup.itemId } }).catch(() => {});
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
