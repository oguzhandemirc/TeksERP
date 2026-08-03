// =============================================================================
// Test: Saha #13 — ürün/renk adı normalize standardı
// Çalıştır: npx tsx scripts/test_name_normalization.ts
// Doğrulananlar:
//   1. Saf fonksiyon: ürün uppercase (tr i→İ), renk sayı-başta + BOŞLUK korunur
//      (2026-07-27: tire standardı kalktı — saha renk adında boşluk istedi;
//      legacy tireli ad idempotent kalır) + karşılaştırma katlamaları
//   2. ItemService.create/update adı BÜYÜK yazar
//   3. ColorService.create/update adı normalize yazar ("beyaz 055"→"055 BEYAZ")
//   4. İdempotans: normalize edilmiş ad tekrar normalize'de değişmez
// =============================================================================
import prisma from "../src/lib/prisma";
import { ItemService } from "../src/services/item.service";
import { ColorService } from "../src/services/color.service";
import {
  normalizeItemName,
  normalizeColorName,
  foldNameForCompare,
  foldColorNameForCompare,
} from "../src/services/helpers/name-normalize.helper";
import { buildWhereClause } from "../src/utils/query-parser";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

async function main() {
  const ts = Date.now();

  // --- 1) Saf fonksiyon birim kontrolleri ---
  check(
    "Ürün: tr uppercase + boşluk sadeleştirme",
    normalizeItemName("  ipliği   boyalı  saten ") === "İPLİĞİ BOYALI SATEN",
    normalizeItemName("  ipliği   boyalı  saten "),
  );
  check("Renk: sayı başa + boşluk korunur", normalizeColorName("beyaz 055") === "055 BEYAZ");
  check("Renk: çok kelime boşluklu", normalizeColorName("krem gümüş") === "KREM GÜMÜŞ");
  check("Renk: legacy tireli ad idempotent", normalizeColorName("055-BEYAZ") === "055-BEYAZ");
  check("Renk: yeni biçim idempotent", normalizeColorName("055 BEYAZ") === "055 BEYAZ");
  check(
    "Renk: çoklu sayı sırası korunur",
    normalizeColorName("12 lacivert 7") === "12 7 LACİVERT",
    normalizeColorName("12 lacivert 7"),
  );
  check(
    "Fold: legacy tireli ≡ yeni boşluklu",
    foldColorNameForCompare("055-BEYAZ") === foldColorNameForCompare("beyaz 055"),
  );
  check(
    "Fold: KREM-GÜMÜŞ ≡ krem gümüş",
    foldColorNameForCompare("KREM-GÜMÜŞ") === foldColorNameForCompare("krem gümüş"),
  );
  check(
    "Genel fold: 'Mavi' ≡ ' MAVİ ' (tr i→İ)",
    foldNameForCompare("Mavi") === foldNameForCompare(" MAVİ "),
  );

  // --- 2) Servis yolları ---
  const itemSvc = new ItemService({
    modelName: "item",
    tableName: "ITEM",
    searchFields: ["code", "name"],
  });
  const colorSvc = new ColorService({
    modelName: "color",
    tableName: "COLOR",
    searchFields: ["code", "name"],
  });

  let itemId: string | null = null;
  let colorId: string | null = null;

  // Çökmüş bir önceki koşumdan kalan fixture varsa temizle. YALNIZ kendi kod
  // önekimiz silinir — fabrika master-verisine dokunulmaz.
  await prisma.color.deleteMany({ where: { code: { startsWith: "TST-NRM-C-" } } }).catch(() => {});
  await prisma.item.deleteMany({ where: { code: { startsWith: "TST-NRM-" } } }).catch(() => {});

  try {
    // ⚠️ Fixture adları ÇAKIŞAMAZ olmalı. Eskiden "krem gümüş" / "beyaz 055" gibi
    // gerçekçi adlar kullanılıyordu; dev DB fabrikanın canlı yedeğiyle değiştirilince
    // gerçek bir "KREM GÜMÜŞ" rengiyle (RNK-260717-3376) çakıştı ve ad-mükerrer
    // guard'ı testi komple düşürdü. "TSNRM" öneki fabrika verisinde bulunamaz;
    // normalize kuralları (boşluk korunur, tr-BÜYÜK, salt-rakam blok başa) aynen
    // sınanmaya devam eder.
    const itemRes = await itemSvc.create(
      { code: `TST-NRM-${ts}`, name: "tsnrm saha ürünü", itemType: "FABRIC", unit: "MT" },
      undefined,
    );
    const item = itemRes.data as { id: string; name: string };
    itemId = item.id;
    check("ItemService.create adı BÜYÜK yazdı", item.name === "TSNRM SAHA ÜRÜNÜ", item.name);

    await itemSvc.update(item.id, { name: "tsnrm güncel isim" }, undefined);
    const itemAfter = await prisma.item.findUnique({
      where: { id: item.id },
      select: { name: true },
    });
    check(
      "ItemService.update adı BÜYÜK yazdı",
      itemAfter?.name === "TSNRM GÜNCEL İSİM",
      itemAfter?.name ?? "",
    );

    const colorRes = await colorSvc.create(
      { code: `TST-NRM-C-${ts}`, name: "tsnrmbeyaz 055" },
      undefined,
    );
    const color = colorRes.data as { id: string; name: string };
    colorId = color.id;
    check("ColorService.create normalize etti", color.name === "055 TSNRMBEYAZ", color.name);

    await colorSvc.update(color.id, { name: "tsnrm krem gümüş" }, undefined);
    const colorAfter = await prisma.color.findUnique({
      where: { id: color.id },
      select: { name: true },
    });
    check(
      "ColorService.update normalize etti",
      colorAfter?.name === "TSNRM KREM GÜMÜŞ",
      colorAfter?.name ?? "",
    );

    // --- 3) Arama: tr-upper varyantı (İ/ı katlanmaz, query-parser OR'u kapatır) ---
    await colorSvc.update(color.id, { name: "tssiyah deneme" }, undefined); // → TSSİYAH DENEME
    const searchHit = await prisma.color.findMany({
      where: {
        id: color.id,
        ...buildWhereClause({}, ["name"], "tssiyah"),
      },
      select: { id: true },
    });
    check("Arama 'tssiyah' BÜYÜK 'TSSİYAH …' kaydını buldu (tr-upper OR)", searchHit.length === 1);

    await colorSvc.update(color.id, { name: "tskırmızı deneme" }, undefined); // → TSKIRMIZI DENEME
    const searchHit2 = await prisma.color.findMany({
      where: {
        id: color.id,
        ...buildWhereClause({}, ["name"], "tskırmızı"),
      },
      select: { id: true },
    });
    check("Arama 'tskırmızı' BÜYÜK 'TSKIRMIZI …' kaydını buldu (ı→I)", searchHit2.length === 1);

    const noVariant = buildWhereClause({}, ["name"], "beyaz") as { OR: unknown[] };
    check("Saf-ascii olmayan harf yoksa ekstra OR clause yok", noVariant.OR.length === 1);
  } finally {
    if (colorId) {
      await prisma.customerColorAlias.deleteMany({ where: { colorId } });
      await prisma.color.delete({ where: { id: colorId } }).catch(() => {});
    }
    if (itemId) await prisma.item.delete({ where: { id: itemId } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
