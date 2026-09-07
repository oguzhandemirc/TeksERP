// =============================================================================
// BEKÇİ — ÇUVAL İÇERİĞİNDE ÜÇ AD YAN YANA (2026-09-07 saha isteği)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts sack_contents_uc_ad
//
// ⭐ NEDEN: çuvalın içi, mal sevk edilmeden önceki SON bakış anıdır ve orada üç
//    ad ayrışabilir — ① bizdeki (canlı kayıt) ② müşterideki (alias kademesi)
//    ③ TOPUN ÜSTÜNDEKİ KÂĞITTA YAZAN (`lastLabelSnapshot`, baskı anında donmuş).
//    Bugüne dek üçünü yan yana gösteren hiçbir ekran yoktu; kullanıcı bunu
//    istedi ("üçünü karşılaştırsak nasıl olur").
//
// NE ÖLÇER — üçü de UYDURULMAMALI:
//   §2 müşteri karşılığı VARSA döner, YOKSA `null` döner. ⚠️ BİZİM adımız
//      "müşterideki ad" diye BASILMAZ (2026-09-06 kullanıcı düzeltmesi: çoğu
//      müşteri bizim adımızı kullanır; uydurma alias defteri kirletir).
//   §3 etiket adı SNAPSHOT'tan gelir, canlı veriden TÜRETİLMEZ. Türetilseydi
//      ölçmek istediğimiz ayrışma (kâğıt ↔ kayıt) tam olarak gizlenirdi.
//   §4 hiç basılmamış etiket ile bayat etiket AYRI durumlardır.
//
// ⭐ NEGATİF SONDA (2026-09-07, ölçüldü): ① alias yokken bizim adımız
//    döndürülünce §2 KIRMIZI ② `etiket` canlı `item.name`den kurulunca §3
//    KIRMIZI ③ `lastLabelSnapshot` select'ten düşünce §3 KIRMIZI.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { RollStatus, RollEntrySource } from "@prisma/client";
import { SackSearchService } from "../src/services/sack-search.service";

const search = new SackSearchService();
const TS = Date.now();
const P = `TEST-UCAD-${TS}`;
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

let CUSTOMER = "";
let ITEM_A = "";
let ITEM_B = "";
let COLOR = "";
let SACK = "";
const rollIds: string[] = [];

interface Icerik {
  rolls: {
    barcode: string | null;
    item: { name: string };
    color: { name: string } | null;
    musterideki: { itemName: string | null; colorName: string | null };
    etiket: { itemName: string | null; colorName: string | null; customerName: string | null; printedAt: string | null } | null;
  }[];
}

async function topKur(itemId: string, barkod: string): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: barkod, itemId, colorId: COLOR, width: 150,
      initialQty: 100, currentQty: 100, status: RollStatus.WAREHOUSE,
      qualityGrade: "1.KALITE", entrySource: RollEntrySource.SUPPLIER_RECEIPT,
      sackId: SACK,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  return r.id;
}

async function run(): Promise<void> {
  CUSTOMER = (await prisma.customer.create({ data: { code: `${P}-C`, name: `${P} MUSTERI` }, select: { id: true } })).id;
  ITEM_A = (await prisma.item.create({ data: { code: `${P}-IA`, name: `${P} KUMAS-A`, itemType: "FABRIC" }, select: { id: true } })).id;
  ITEM_B = (await prisma.item.create({ data: { code: `${P}-IB`, name: `${P} KUMAS-B`, itemType: "FABRIC" }, select: { id: true } })).id;
  COLOR = (await prisma.color.create({ data: { code: `${P}-CL`, name: `${P} RENK` }, select: { id: true } })).id;
  SACK = (await prisma.sack.create({ data: { sackNo: `${P}-S`, customerId: CUSTOMER }, select: { id: true } })).id;

  // A ürününün müşteri karşılığı VAR, B'ninki YOK — ayrımı ölçebilelim.
  await prisma.customerItemAlias.create({ data: { customerId: CUSTOMER, itemId: ITEM_A, alias: `${P} MUSTERI-URUN-A` } });
  await prisma.customerColorAlias.create({ data: { customerId: CUSTOMER, colorId: COLOR, alias: `${P} MUSTERI-RENK` } });

  const rA = await topKur(ITEM_A, `${P}-R-A`);   // alias VAR · etiket DENORMALIZE
  await topKur(ITEM_B, `${P}-R-B`);              // alias YOK  · etiket HİÇ basılmamış
  const rC = await topKur(ITEM_A, `${P}-R-C`);   // alias VAR  · etiket MİNİMAL niyet

  // ETİKET SNAPSHOT'LARI — üç farklı hâl.
  await prisma.roll.update({
    where: { id: rA },
    data: {
      labelPrintedAt: new Date("2026-09-01T10:00:00.000Z"),
      lastLabelSnapshot: {
        printedAt: "2026-09-01T10:00:00.000Z",
        customerId: CUSTOMER,
        customerName: `${P} ETIKET-MUSTERI`,
        itemName: `${P} ETIKETTE-URUN`,
        colorName: `${P} ETIKETTE-RENK`,
        operatorName: "operator",
      },
    },
  });
  await prisma.roll.update({
    where: { id: rC },
    // Minimal NİYET snapshot'ı (kesim anında yazılan biçim) — ad YOK.
    data: { labelPrintedAt: new Date("2026-09-02T10:00:00.000Z"), lastLabelSnapshot: { customerId: CUSTOMER } },
  });

  const d = (await search.getSackContents(SACK)).data as Icerik;
  const sat = (bar: string) => d.rolls.find((r) => r.barcode === `${P}-R-${bar}`)!;

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  console.log("\n§1 — körlük zemini");
  check("üç top da döküme geldi", d.rolls.length === 3, `${d.rolls.length} top`);
  check("bizdeki ad (canlı kayıt) dönüyor", sat("A").item.name === `${P} KUMAS-A`, sat("A").item.name);

  // ── §2 MÜŞTERİDEKİ AD ─────────────────────────────────────────────────────
  console.log("\n§2 — müşterideki ad: varsa döner, YOKSA null (bizimki maskelenmez)");
  check("⭐ karşılığı OLAN üründe müşteri adı dönüyor",
    sat("A").musterideki.itemName === `${P} MUSTERI-URUN-A`, `${sat("A").musterideki.itemName}`);
  check("⭐ karşılığı OLMAYAN üründe `null` — BİZİM adımız basılmıyor",
    sat("B").musterideki.itemName === null, `${sat("B").musterideki.itemName}`);
  check("renk karşılığı da çözülüyor",
    sat("A").musterideki.colorName === `${P} MUSTERI-RENK`, `${sat("A").musterideki.colorName}`);

  // ── §3 ETİKETTE YAZAN ─────────────────────────────────────────────────────
  console.log("\n§3 — etikette yazan: SNAPSHOT'tan, canlı veriden DEĞİL");
  const eA = sat("A").etiket;
  check("⭐ denormalize snapshot'ta ad SNAPSHOT'tan geliyor",
    eA?.itemName === `${P} ETIKETTE-URUN` && eA?.colorName === `${P} ETIKETTE-RENK`,
    JSON.stringify(eA));
  check("⭐ etiket adı CANLI kayıttan TÜRETİLMİYOR (ayrışma görünür kalıyor)",
    eA?.itemName !== sat("A").item.name);
  check("etiketteki müşteri adı da dönüyor (yanlış müşteriye basılmış top görünsün)",
    eA?.customerName === `${P} ETIKET-MUSTERI`);
  check("baskı tarihi dönüyor", !!eA?.printedAt);

  // ── §4 ÜÇ AYRI HÂL ────────────────────────────────────────────────────────
  console.log("\n§4 — 'etiket yok' ile 'adsız snapshot' AYRI durumlar");
  check("⭐ hiç basılmamış etikette `etiket` null", sat("B").etiket === null, JSON.stringify(sat("B").etiket));
  const eC = sat("C").etiket;
  check("⭐ minimal niyet snapshot'ında ad UYDURULMUYOR (null döner)",
    eC !== null && eC.itemName === null && eC.colorName === null, JSON.stringify(eC));
  check("minimal snapshot'ta da baskı tarihi var (etiket VAR ama adı bilinmiyor)", !!eC?.printedAt);
}

async function teardown(): Promise<void> {
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
  await prisma.sack.deleteMany({ where: { id: SACK } }).catch(() => {});
  await prisma.customerItemAlias.deleteMany({ where: { customerId: CUSTOMER } }).catch(() => {});
  await prisma.customerColorAlias.deleteMany({ where: { customerId: CUSTOMER } }).catch(() => {});
  await prisma.item.deleteMany({ where: { id: { in: [ITEM_A, ITEM_B] } } }).catch(() => {});
  await prisma.color.deleteMany({ where: { id: COLOR } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { id: CUSTOMER } }).catch(() => {});
}

run()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    await teardown().catch((e) => console.error("teardown hatası:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
