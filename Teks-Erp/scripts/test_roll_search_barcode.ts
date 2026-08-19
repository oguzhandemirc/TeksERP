// =============================================================================
// BEKÇİ: Top listesi aramasında BARKOD normalize edilir (2026-08-19)
// Çalıştır: npx tsx scripts/test_roll_search_barcode.ts
// =============================================================================
// Barkod listede TAM EŞİTLİKLE aranıyor (unique index seek; `contains` 300k
// satırda 21-87ms seq scan, `equals` 0.3ms — gerekçe `inventory.service.ts`
// içinde yazılı). Doğru karar, ama tam eşitlik girdiyi normalize etmeyi ZORUNLU
// kılar: el tarayıcısı barkodu KÜÇÜK harfle gönderebiliyor (2026-08-17 saha
// vakası) ve kâğıda BÜYÜK basılan kodla eşleşmez.
//
// 2026-08-19 denetiminde bulundu: `rolls/barcode/:barcode` ucu, tambur, çuval
// arama ve batch-trace `normalizeScanCode`'dan geçiyordu; LİSTE ARAMASI tek
// istisnaydı. Yani operatör tarayıcıyla listede arayınca sıfır sonuç alıyordu.
//
// ⚠️ Bu dosya `buildRollWhere`'i değil GERÇEK sorguyu ölçer — where nesnesini
// doğrulamak, "normalize edildi ama yanlış kolona yazıldı" sınıfını kaçırırdı.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { Prisma } from "@prisma/client";
import { buildTextSearch } from "../src/utils/query-parser";
import { normalizeScanCode } from "../src/utils/code-format";

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

const TAG = `RSB${Date.now().toString().slice(-8)}`;
const BARCODE = `T${TAG}H0001`; // BÜYÜK — kâğıda basılan biçim
const created: { rolls: string[]; items: string[] } = { rolls: [], items: [] };

/**
 * Liste aramasının WHERE'inin barkod dalı — `inventory.service.buildRollWhere`
 * ile AYNI şekilde kurulur. Servisin kendisini çağırmak `Request` sahtelemesi
 * ister; ölçmek istediğimiz şey tek bir dal.
 */
function rollSearchWhere(search: string): Prisma.RollWhereInput {
  return {
    OR: [
      { barcode: normalizeScanCode(search) },
      ...buildTextSearch<Prisma.RollWhereInput>(search, {
        text: ["item.name", "color.name", "item.customerAliases.some.alias"],
        code: ["item.code"],
      }),
    ],
  };
}

async function findBySearch(search: string): Promise<string[]> {
  const rows = await prisma.roll.findMany({
    where: { AND: [{ id: { in: created.rolls } }, rollSearchWhere(search)] },
    select: { barcode: true },
  });
  return rows.map((r) => r.barcode ?? "");
}

async function main(): Promise<void> {
  const item = await prisma.item.create({
    data: { code: `${TAG}-I`, name: `RSB KUMAŞ ${TAG}`, itemType: "FABRIC" },
    select: { id: true },
  });
  created.items.push(item.id);
  const roll = await prisma.roll.create({
    data: {
      barcode: BARCODE,
      itemId: item.id,
      initialQty: 100,
      currentQty: 100,
      status: "STOCK",
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true },
  });
  created.rolls.push(roll.id);

  try {
    console.log("\n── Barkod araması ──");
    check("BÜYÜK harfle bulunur (kâğıttaki biçim)", (await findBySearch(BARCODE)).includes(BARCODE));
    // ⚠️ ASIL İDDİA: bu satır 2026-08-19'a kadar BOŞ dönüyordu.
    check(
      "KÜÇÜK harfle de bulunur (el tarayıcısı biçimi)",
      (await findBySearch(BARCODE.toLowerCase())).includes(BARCODE),
      BARCODE.toLowerCase(),
    );
    check(
      "baştaki/sondaki boşluk kırpılır",
      (await findBySearch(`  ${BARCODE.toLowerCase()}  `)).includes(BARCODE),
    );
    check("alakasız barkod eşleşmez", (await findBySearch(`T00000000H9999`)).length === 0);

    console.log("\n── Ürün adı araması bozulmadı ──");
    check(
      "küçük harfli TÜRKÇE ürün adı hâlâ buluyor",
      (await findBySearch(`rsb kumas ${TAG}`)).includes(BARCODE),
      "katlama yolu barkod düzeltmesinden etkilenmedi",
    );
  } finally {
    await prisma.roll.deleteMany({ where: { id: { in: created.rolls } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: created.items } } }).catch(() => {});
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
