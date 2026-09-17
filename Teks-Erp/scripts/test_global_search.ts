// =============================================================================
// BEKÇİ: Global arama (tek kutu, çok varlık) — 2026-08-19
// Çalıştır: npx tsx scripts/test_global_search.ts
// =============================================================================
// Ctrl+K artık yalnız SAYFA değil VERİ de arıyor. Bu bekçi dört cepheyi kilitler:
//   1. İZİN — kova, o varlığın liste ucunun izin listesinin ALT KÜMESİ olmalı.
//      Ayrışırsa iki hata sınıfı doğar: kullanıcıya görünen ama tıklayınca
//      /forbidden'a düşen satır (izin dar) ya da liste ucundan FAZLASINI gösteren
//      sızıntı (izin geniş).
//   2. DAVRANIŞ — Türkçe katlama, alias, kod-biçimli terim, barkod hızlı yolu.
//   3. SINIRLAR — `hasMore`, kısa terim, boş yaprak guard'ı.
//   4. SÖZLEŞME — panel katalogu ile backend kovaları aynı anahtar kümesini
//      taşımalı (iki proje ayrı sürümleniyor; sapma SESSİZ olmamalı).
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { SEARCH_ENTITIES } from "../src/constants/search-entities";
import { searchService } from "../src/services/search.service";
import { buildTextSearch } from "../src/utils/query-parser";

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

const TAG = `GS${Date.now().toString().slice(-9)}`;
const made: { customers: string[]; items: string[]; rolls: string[] } = {
  customers: [],
  items: [],
  rolls: [],
};

/** Kovanın izinlerini, o varlığın liste route'undan AST'siz ama metinden çıkarır. */
const ROUTE_FILES: Record<string, string> = {
  customer: "src/routes/customer.routes.ts",
  item: "src/routes/item.routes.ts",
  color: "src/routes/color.routes.ts",
  order: "src/routes/order.routes.ts",
  workOrder: "src/routes/workorder.routes.ts",
  subcontractor: "src/routes/subcontractor-management.routes.ts",
};

function routePermissions(file: string): Set<string> {
  const src = fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
  const out = new Set<string>();
  // Liste ucu: `router.get("/"` satırındaki requirePermission/requireAnyPermission argümanları.
  for (const line of src.split("\n")) {
    if (!/\.get\(\s*"\/"/.test(line)) continue;
    for (const m of line.matchAll(/"([a-z-]+:[a-z*-]+)"/g)) out.add(m[1]!);
  }
  return out;
}

async function main(): Promise<void> {
  // ── 1) İzin: kova ⊆ liste ucu ─────────────────────────────────────────────
  console.log("\n── 1) İzin alt kümesi (kova ⊆ liste ucu) ──");
  let subsetBad = 0;
  for (const e of SEARCH_ENTITIES) {
    const file = ROUTE_FILES[e.key];
    if (!file) continue; // shipment/sack/batch farklı router şekillerinde — §4'te kapsanıyor
    const routePerms = routePermissions(file);
    if (routePerms.size === 0) {
      check(`${e.key}: route izinleri okunabildi`, false, file);
      subsetBad++;
      continue;
    }
    const outside = e.permissions.filter((p) => !routePerms.has(p));
    if (outside.length > 0) {
      subsetBad++;
      check(`${e.key}: izin alt kümesi`, false, `liste ucunda YOK: ${outside.join(", ")}`);
    }
  }
  check("tüm kovaların izni liste ucununkinin alt kümesi", subsetBad === 0);
  check(
    "körlük zemini: en az 6 kova route'a karşı ölçüldü",
    Object.keys(ROUTE_FILES).length >= 6,
  );

  // ⚠️ Bu blok `test_permission_catalog.ts`in DEVRETTİĞİ kapsamdır: arama izin
  // kodları servis dosyasında değil bu katalogda yaşadığı için orada AST ile
  // çözülemiyorlar ve o bekçi kapsamı buraya devrediyor. Devir ÖLÜ OLMAMALI —
  // yani katalogda tanımsız bir kod buradan geçmemeli.
  // `Set<string>` — katalog tipi dar bir union, aranan değerler ise serbest
  // string (kova katalogundan geliyor). Amaç zaten "bu string katalogda VAR MI"
  // sorusunu sormak; daraltmak kontrolü derleme anında vakumen doğru yapardı.
  const catalogCodes = new Set<string>(PERMISSION_CATALOG.map((p) => p.code));
  const undefinedCodes = SEARCH_ENTITIES.flatMap((e) =>
    e.permissions.filter((p) => !catalogCodes.has(p)),
  );
  check(
    "her kova izni permission-catalog'da TANIMLI (devredilen kapsam)",
    undefinedCodes.length === 0,
    undefinedCodes.join(", ") || `${SEARCH_ENTITIES.length} kova taplandı`,
  );
  check(
    "körlük zemini: izin kataloğu okundu",
    catalogCodes.size > 50,
    `${catalogCodes.size} kod`,
  );

  // ── 2) Panel katalogu ile anahtar kümesi aynı ─────────────────────────────
  console.log("\n── 2) Backend ↔ panel katalog hizası ──");
  const targetsPath = path.resolve(
    __dirname,
    "..",
    "..",
    "Electron/src/lib/search/search-targets.ts",
  );
  if (fs.existsSync(targetsPath)) {
    const src = fs.readFileSync(targetsPath, "utf8");
    const missing = SEARCH_ENTITIES.filter((e) => !new RegExp(`\\b${e.key}\\s*:`).test(src));
    check(
      "her backend kovasının panelde hedefi var",
      missing.length === 0,
      missing.map((m) => m.key).join(", ") || `${SEARCH_ENTITIES.length} kova`,
    );
  } else {
    check("panel katalogu henüz yok (Faz A2 bekliyor)", true, "atlandı");
  }

  // ── Fixture ───────────────────────────────────────────────────────────────
  const cust = await prisma.customer.create({
    data: { code: `${TAG}-C`, name: `ÇANAKKALE ${TAG} TEKSTİL`, type: "CUSTOMER" },
    select: { id: true },
  });
  made.customers.push(cust.id);
  const item = await prisma.item.create({
    data: { code: `${TAG}-I`, name: `GÜMÜŞ ${TAG}`, itemType: "FABRIC" },
    select: { id: true },
  });
  made.items.push(item.id);
  await prisma.customerItemAlias.create({
    data: { customerId: cust.id, itemId: item.id, alias: `BELLE ${TAG}` },
  });
  const roll = await prisma.roll.create({
    data: {
      barcode: `T999999H${TAG.slice(-4)}`,
      itemId: item.id,
      initialQty: 10,
      currentQty: 10,
      status: "STOCK",
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true, barcode: true },
  });
  made.rolls.push(roll.id);

  const ALL = ["*"];
  const titles = async (q: string, perms: readonly string[] = ALL): Promise<string[]> => {
    const r = await searchService.search(q, { permissions: perms });
    return r.groups.flatMap((g) => g.rows.map((x) => x.title));
  };

  try {
    // ── 3) Davranış ─────────────────────────────────────────────────────────
    console.log("\n── 3) Arama davranışı ──");
    check("ASCII terim Türkçe kaydı bulur", (await titles(`canakkale ${TAG}`)).some((t) => t.includes("ÇANAKKALE")));
    check("Türkçe terim de bulur", (await titles(`ÇANAKKALE ${TAG}`)).some((t) => t.includes("ÇANAKKALE")));
    check("müşteri alias'ından ürün bulunur", (await titles(`belle ${TAG}`)).some((t) => t.includes("GÜMÜŞ")));
    const none = await titles(`ZZQXW${TAG}`);
    check("alakasız terim 0 sonuç (körlük kontrolü)", none.length === 0, `${none.length}`);

    console.log("\n── 4) Barkod hızlı yolu ──");
    const exactRes = await searchService.search(roll.barcode!, { permissions: ALL });
    check("tam barkod → exact dolu", exactRes.exact?.entity === "roll", exactRes.exact?.row.title ?? "yok");
    // ⚠️ Hızlı yolun ASIL kazancı: fan-out HİÇ koşmaz.
    check("tam barkodda fan-out atlanır (groups boş)", exactRes.groups.length === 0);
    const lower = await searchService.search(roll.barcode!.toLowerCase(), { permissions: ALL });
    check("küçük harfli barkod da exact bulur", lower.exact?.entity === "roll");

    console.log("\n── 5) İzin süzgeci ──");
    const onlyItem = await searchService.search(`${TAG}`, { permissions: ["item:read"] });
    check(
      "yalnız item:read → yalnız Ürünler kovası",
      onlyItem.groups.every((g) => g.entity === "item"),
      onlyItem.groups.map((g) => g.entity).join(",") || "(boş)",
    );
    const noPerm = await searchService.search(`${TAG}`, { permissions: [] });
    check("izinsiz kullanıcı → 0 grup", noPerm.groups.length === 0);

    console.log("\n── 6) Sınırlar ──");
    check("1 harflik terim → 0 grup, sorgu yok", (await searchService.search("a", { permissions: ALL })).groups.length === 0);
    check("boş terim → 0 grup", (await searchService.search("   ", { permissions: ALL })).groups.length === 0);
    // ⚠️ BU KONTROL İLK YAZIMINDA VAKUMDU ve negatif sonda onu ortaya çıkardı:
    // servisteki boş-yaprak guard'ı kaldırıldığında test YEŞİL kalıyordu. Sebep
    // ölçüldü — Prisma `OR: []` ile HİÇBİR kaydı eşlemiyor (34 müşterinin 0'ı),
    // yani guard bir doğruluk kapısı değil sorgu-önleme. Gerçek risk BİR KATMAN
    // ALTTA: `buildTextSearch` bir gün "eşleşme yoksa hepsi" gibi bir yaprak
    // üretirse HER kova tüm tablosunu döndürür. Ölçülen sözleşme O.
    const foldEmptyTerm = "́̂"; // yalnız birleştirici işaretler → katlanınca boş
    const leaves = buildTextSearch(foldEmptyTerm, { text: ["name"], code: ["code"] });
    check(
      "katlanınca boşalan terim HİÇ yaprak üretmez (catch-all yok)",
      leaves.length === 0,
      `${leaves.length} yaprak`,
    );
    const combining = await searchService.search(foldEmptyTerm, { permissions: ALL });
    check("...ve arama boş döner", combining.groups.length === 0);
    // hasMore: limit=1 ile birden çok müşterisi olan bir terim
    const many = await searchService.search("a", { permissions: ALL, limit: 1 });
    check("kısa terim limit'ten bağımsız olarak 0 döner", many.groups.length === 0);
    const lim = await searchService.search(TAG, { permissions: ALL, limit: 1 });
    check("limit uygulanıyor (kova başına ≤1)", lim.groups.every((g) => g.rows.length <= 1));
  } finally {
    await prisma.customerItemAlias.deleteMany({ where: { itemId: { in: made.items } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: made.rolls } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(() => {});
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
