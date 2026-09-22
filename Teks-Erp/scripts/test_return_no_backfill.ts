// =============================================================================
// İADE BELGE NO — GERİ DOLDURMA BUGÜNKÜ DEĞERİN BİREBİR AYNISI (Faz C2)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts return_no_backfill   (DB GEREKİR)
//
// ⭐ NEDEN VAR: iade belge no her okumada `id`den TÜRETİLİYORDU; kolona alındı
//    ve geçmiş geri dolduruldu. Geri doldurma BİR BAYT bile kayarsa, müşteride
//    basılı duran bir belgenin numarası programda başka görünür — bu işin
//    başlatan cümlesinin ta kendisi ("programda p-2 yazarken çıktı p20260202
//    görmemeliyiz").
//
// ⚠️ BEKLENEN DEĞER BAĞIMSIZ ÜRETİLİR: doğrulayan yol (PostgreSQL `to_char` +
//    `substr`) ile üreten yol (TS `returnDocumentNo`) AYRI araçlardır. Aynı
//    fonksiyonu iki kez çağırmak "araç gözlenenin içinde" olurdu ve hiçbir şey
//    ölçmezdi.
//
//   §1 İki araç aynı cevabı veriyor (gün · ay · yıl · id kuyruğu · büyük harf)
//   §2 ⭐ SAAT DİLİMİ TUZAĞI: gece yarısından sonra İstanbul'da ERTESİ gün olan
//      UTC damgaları — çıplak `to_char` bir ÖNCEKİ günü yazardı
//   §3 ⭐ Ölçülen ifade, MIGRATION'DA YAZAN ifadenin ta kendisi (metin kontrolü)
//   §4 Kolon nullable + partial unique (eski/yeni biçim yan yana yaşayabilsin)
//   §5 Canlı satırlar varsa onlar da birebir (varsa; sayı BEYAN edilir)
//   §6 ⭐ `returnGroupId` TEK YAZARLI — üye satırdaki numara KOPYASI bayatlayamaz
//   §7 ⭐ Numara BELGE BAŞINA bir kez üretilir ve TÜM grup satırlarına yazılır
//
// ⚠️ KAPSAM BEYANI: §7 YAPISAL bir kontroldür (kaynak metni), davranışsal değil.
//    Davranışsal kapsama çok kalemli GERÇEK bir iade fikstürü ister (top +
//    sevkiyat zinciri) ve `test_belge_ekran_ayni`nin İADE DALINA aittir; o dal
//    inene kadar burası TEK kapıdır. "Yeşil ≠ kapsandı" — hangi yönden
//    kapsandığı burada yazılı.
//
// ⭐ NEGATİF SONDA ✓B3 (2026-09-22, ölçüldü): migration'daki
//    `AT TIME ZONE 'Europe/Istanbul'` silinince §2 ❌ · `upper(...)` kaldırılınca
//    §1 ❌ · `substr(...,1,6)` → `substr(...,1,8)` yapılınca §1 ❌.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma from "../src/lib/prisma";
import { returnDocumentNo } from "../src/services/return.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

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

const MIGRATION = join(
  __dirname,
  "..",
  "prisma",
  "migrations",
  "20260922210000_roll_return_number",
  "migration.sql",
);

/** Migration'ın geri doldurma ifadesi — METİNDEN çıkarılır, elle kopyalanmaz. */
function backfillExpression(sql: string): string {
  // `SET "returnNo" = <ifade> FROM …` — ifade FROM'da biter (join'li UPDATE).
  const govde = sql.split(/SET\s+"returnNo"\s*=/i)[1]?.split(/\n\s*FROM\s/i)[0]?.split(";")[0] ?? "";
  return govde.replace(/\s+/g, " ").trim();
}

/**
 * Aynı ifadeyi TEK SATIR için koşturur — sütun referansları parametreye çevrilir.
 * ⚠️ Takma ad (`l."createdAt"`) da yakalanır: geri doldurma belge ÇAPASINDAN
 * (lider satır) okuduğu için ifade artık join'li ve aliaslı.
 */
async function sqlile(expr: string, createdAt: Date, id: string): Promise<string> {
  const parametreli = expr
    .replace(/(?:[a-z]\.)?"createdAt"/g, "$1::timestamptz")
    .replace(/(?:[a-z]\.)?"id"::text/g, "$2::text")
    .replace(/(?:[a-z]\.)?"id"/g, "$2");
  const rows = await prisma.$queryRawUnsafe<Array<{ v: string }>>(
    `SELECT ${parametreli} AS v`,
    createdAt,
    id,
  );
  return rows[0]?.v ?? "";
}

const ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
/** Saat dilimi tuzağını da içeren vektörler — UTC ile İstanbul günü AYRIŞIR. */
const VEKTORLER: Array<{ ad: string; at: Date; id: string }> = [
  { ad: "gündüz", at: new Date("2026-09-22T10:00:00.000Z"), id: ID },
  { ad: "⭐ UTC 21:30 → İstanbul ERTESİ gün 00:30", at: new Date("2026-09-21T21:30:00.000Z"), id: ID },
  { ad: "⭐ kış saati, UTC 22:00 → İstanbul ertesi gün 01:00", at: new Date("2026-01-05T22:00:00.000Z"), id: ID },
  { ad: "yaz ortası", at: new Date("2026-06-15T09:00:00.000Z"), id: "00ffAB12-0000-0000-0000-000000000000" },
  { ad: "yıl dönümü", at: new Date("2025-12-31T22:30:00.000Z"), id: ID },
];

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(engel);
    process.exit(1);
  }

  const sql = readFileSync(MIGRATION, "utf-8");
  const expr = backfillExpression(sql);

  // ── §3 Ölçülen ifade MIGRATION'DAKİ ifade ─────────────────────────────
  check("§3 ⭐ geri doldurma ifadesi migration METNİNDEN okundu (elle kopyalanmadı)",
    expr.includes("IADE-") && expr.includes("to_char") && expr.includes("substr"),
    expr.slice(0, 80));
  check("§3 körlük zemini: migration dosyası gerçekten okundu", sql.length > 500, `${sql.length} bayt`);

  // ── §1 + §2 İki araç aynı cevabı veriyor ──────────────────────────────
  const farklar: string[] = [];
  for (const v of VEKTORLER) {
    const sqlCevap = await sqlile(expr, v.at, v.id);
    const tsCevap = returnDocumentNo(v.at, v.id);
    const label = v.ad.startsWith("⭐") ? `§2 ${v.ad}` : `§1 ${v.ad}`;
    check(`${label}`, sqlCevap === tsCevap, `SQL ${sqlCevap} ↔ TS ${tsCevap}`);
    if (sqlCevap !== tsCevap) farklar.push(v.ad);
  }
  check("§1 körlük zemini: vektörler gerçekten koştu ve boş değil",
    VEKTORLER.length >= 5 && returnDocumentNo(VEKTORLER[0]!.at, ID).startsWith("IADE-"));

  // ── §4 Kolon sözleşmesi ────────────────────────────────────────────────
  const kolon = await prisma.$queryRaw<Array<{ is_nullable: string }>>`
    SELECT is_nullable FROM information_schema.columns
     WHERE table_name = 'roll_returns' AND column_name = 'returnNo'`;
  check("§4 `returnNo` NULLABLE (eski ve yeni biçim yan yana yaşar)",
    kolon[0]?.is_nullable === "YES", kolon[0]?.is_nullable ?? "kolon YOK");
  const idx = await prisma.$queryRaw<Array<{ indexdef: string }>>`
    SELECT indexdef FROM pg_indexes
     WHERE tablename = 'roll_returns' AND indexname = 'roll_returns_returnNo_doc_key'`;
  const def = idx[0]?.indexdef ?? "";
  check("§4 UNIQUE var ve NULL'ları muaf tutuyor", def.includes("UNIQUE") && def.includes("IS NOT NULL"),
    def || "index YOK");
  // ⚠️ TEKİLLİK BELGE BAŞINA: yalnız `IS NULL` demek grupların TAMAMINI (lideri
  // dahil) dışarıda bırakırdı — grup yazımı `where: { id: { in: createdIds } }`
  // ile lideri de kapsıyor, yani liderin `returnGroupId`i KENDİ id'si.
  check("§4 ⭐ yüklem BELGE ÇAPASINI seçiyor (tekil iade YA DA lider)",
    def.includes(`"returnGroupId" IS NULL`) && def.includes(`"returnGroupId" = id`), def || "index YOK");

  // ── §6 `returnGroupId` TEK YAZARLI — kopya bayatlamasın ────────────────
  // (a) seçeneğinin tek yapısal riski: `returnGroupId` sonradan değişirse üye
  // satırlardaki numara KOPYASI yalanlanır. Bugün tek yazar var; ikinci bir
  // yazar doğarsa ("iadeyi başka gruba taşı" gibi) bu değişmez SESSİZCE kırılır.
  const kaynak = readFileSync(join(__dirname, "..", "src", "services", "return.service.ts"), "utf-8");
  // ⚠️ YÜKLEM YAZMA ÇAĞRISINA ÇAPALANIR, düz metne değil: ilk yazımda `returnGroupId:`
  // geçen HER satır sayılıyordu ve YANIT GÖVDESİNDEKİ alan (`:688`) de yazar
  // sanılmıştı. Sınıfı belli bir yüklem: `rollReturn` üstünde bir YAZMA çağrısı ve
  // onun argümanında `returnGroupId`.
  const YAZMA = /(?:tx|prisma|db)\.rollReturn\.(?:create|createMany|update|updateMany|upsert)\s*\(/g;
  const yazarlar: Array<{ no: number }> = [];
  for (const m of kaynak.matchAll(YAZMA)) {
    const pencere = kaynak.slice(m.index ?? 0, (m.index ?? 0) + 500);
    if (/returnGroupId:/.test(pencere)) {
      yazarlar.push({ no: kaynak.slice(0, m.index).split("\n").length });
    }
  }
  check("§6 ⭐ `RollReturn.returnGroupId`in TEK yazarı var (kopya bayatlayamaz)",
    yazarlar.length === 1, yazarlar.map((x) => `satır ${x.no}`).join(", ") || "0 yazar");
  check("§6 körlük zemini: tarayıcı yazarı gerçekten buluyor", yazarlar.length > 0);

  // ── §7 Numara BELGE BAŞINA bir kez üretilir ve TÜM satırlara yazılır ───
  // ⚠️ Bu kol YAPISAL (kaynak metni), DAVRANIŞSAL değil — beyan ediyorum.
  // Davranışsal kapsama çok kalemli GERÇEK bir iade fikstürü ister (top +
  // sevkiyat zinciri) ve `test_belge_ekran_ayni`nin iade dalına aittir.
  // O dal inene kadar burası tek kapıdır.
  // ⚠️ "Döngü dışında"nın YAPISAL kanıtı: `leaderId` döngü BİTTİKTEN sonra
  // atanıyor (`createdIds[0]`), dolayısıyla ondan SONRA gelen bir çağrı
  // zorunlu olarak döngünün dışındadır. "Tek çağrı" tek başına yetmezdi —
  // döngü içindeki bir çağrı da metinde bir kez görünür.
  const cagriSayisi = (kaynak.match(/nextSeriesNo\("returnDoc"/g) ?? []).length;
  const liderIdx = kaynak.indexOf("const leaderId = createdIds[0]");
  const uretimIdx = kaynak.indexOf("await nextReturnDocNoTx(tx)");
  check("§7 numara üretimi tek kaynaktan ve DÖNGÜNÜN DIŞINDA",
    cagriSayisi === 1 && liderIdx > 0 && uretimIdx > liderIdx,
    `${cagriSayisi} çağrı · lider@${liderIdx} < üretim@${uretimIdx}`);
  const yazim = kaynak.match(/data: \{ returnNo \}/);
  const yazimSatiri = yazim
    ? kaynak.slice(Math.max(0, (yazim.index ?? 0) - 160), (yazim.index ?? 0) + 40)
    : "";
  check("§7 ⭐ numara TÜM grup satırlarına yazılıyor (yalnız lidere DEĞİL)",
    /id: \{ in: createdIds \}/.test(yazimSatiri), yazimSatiri.replace(/\s+/g, " ").slice(-90));

  // ── §5 Canlı satırlar ──────────────────────────────────────────────────
  const canli = await prisma.rollReturn.findMany({ select: { id: true, createdAt: true, returnNo: true } });
  const kayan = canli.filter((r) => r.returnNo !== returnDocumentNo(r.createdAt, r.id));
  check("§5 canlı satırların hepsi birebir", kayan.length === 0,
    kayan.length > 0 ? kayan.slice(0, 3).map((r) => r.id).join(", ") : `${canli.length} satır`);
  if (canli.length === 0) {
    console.log("   ⚠️ §5 BU DB'DE VAKUMEN YEŞİL: `roll_returns` boş. Asıl yük §1–§3'te;" +
      " geri doldurma ifadesi orada BAĞIMSIZ araçla karşılaştırılıyor.");
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
