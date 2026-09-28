// =============================================================================
// TEST: promoteCustomerAliases batch (N+1 → 2 sorgu) — PR-1
// Çalıştır: npx tsx scripts/test_order_alias_promote.ts
// =============================================================================
// OrderService.create → promoteCustomerAliases: satır-bazlı 2N findUnique yerine
// benzersiz item/color için TEK varlık-okuması + yalnız eksik olanları upsert.
// Davranış birebir: terfi olur; dedup (ilk-dolu-ad kazanır); mevcut alias EZİLMEZ.
//
// C) KUMAŞA ÖZEL AD VARKEN GENELE TERFİ YOK (MUSTERI-KUMAS-RENK-ADI karar 2):
//    o müşteri + kumaş + renk için kumaşa özel ad varsa satırdaki renk adı o kumaşın
//    bağlamıdır; genel ada yazılsa kumaşa özel adı olmayan bütün kumaşlara sızardı.
//    Sonda (ölçüldü, md5 geri alındı): `!ozel &&` koşulu kaldırılınca C1+C2 kırmızı.
//
// D) Kumaşa özel varlık okuması yalnız RENK adı taşıyan satırda; okuma hata verirse yalnız
//    renk terfisi atlanır, kumaş adı terfisi sürer (delege bellekte sarılır, dosyaya dokunmaz).
// =============================================================================

import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}

const orders = new OrderService({ modelName: "order", tableName: "ORDER", nestedCreateFields: ["lines"] });
let ITEM = "",
  ADMIN = "",
  CUST = "";
const ozelIds: { items: string[]; color: string; extraColors: string[] } = { items: [], color: "", extraColors: [] };
const orderIds: string[] = [];
const stamp = Date.now().toString().slice(-7);

// NOT: item-only (colorId yok) — order-line color validation item.allowedColors'a
// bağlı (orthogonal). color promote yolu item ile BİREBİR simetrik kod; item testi
// batch mantığını (terfi + dedup + ezme-yok) tam kanıtlar.
const itemAlias = (itemId: string) =>
  prisma.customerItemAlias.findUnique({ where: { customerId_itemId: { customerId: CUST, itemId } }, select: { alias: true } });

async function mkOrder(lines: Record<string, unknown>[]): Promise<void> {
  const res = await orders.create(
    { orderNumber: `TST-ALIAS-${stamp}-${orderIds.length}`, customerId: CUST, status: "APPROVED", lines },
    ADMIN
  );
  const id = (res.data as { id?: string } | null)?.id;
  if (id) orderIds.push(id);
}

const genelRenk = () =>
  prisma.customerColorAlias.findUnique({ where: { customerId_colorId: { customerId: CUST, colorId: ozelIds.color } }, select: { alias: true } });

async function kumasaOzelTerfi(): Promise<void> {
  console.log("\n=== C) kumaşa özel ad varken genele terfi yok ===");
  for (const k of ["X", "Y"]) {
    const it = await prisma.item.create({ data: { code: `TST-ALIAS-I${k}-${stamp}`, name: `TST ALIAS KUMAS ${k} ${stamp}`, itemType: "FABRIC" }, select: { id: true } });
    ozelIds.items.push(it.id);
  }
  ozelIds.color = (await prisma.color.create({ data: { code: `TST-ALIAS-K-${stamp}`, name: `TST ALIAS EKRU ${stamp}` }, select: { id: true } })).id;
  const [X, Y] = ozelIds.items;
  await prisma.customerItemColorAlias.create({ data: { customerId: CUST, itemId: X, colorId: ozelIds.color, alias: "X-OZEL" } });

  await mkOrder([{ itemId: X, colorId: ozelIds.color, width: 150, quantity: 10, customerColorName: "SATIR-X" }]);
  check("C1 ⭐ kumaşa özel adı olan kumaşın satır adı GENELE terfi edilmedi", (await genelRenk()) === null, (await genelRenk())?.alias ?? "yok");

  await mkOrder([
    { itemId: X, colorId: ozelIds.color, width: 150, quantity: 10, customerColorName: "SATIR-X2" },
    { itemId: Y, colorId: ozelIds.color, width: 150, quantity: 10, customerColorName: "SATIR-Y" },
  ]);
  check("C2 ⭐ aynı renkte kumaşa özel adı OLMAYAN kumaşın adı terfi eder (bugünkü kural)",
    (await genelRenk())?.alias === "SATIR-Y", (await genelRenk())?.alias ?? "yok");
  const ozel = await prisma.customerItemColorAlias.findFirst({ where: { customerId: CUST, itemId: X }, select: { alias: true } });
  check("C3 terfi kumaşa özel adı YAZMAZ (yalnız elle girilir)", ozel?.alias === "X-OZEL", ozel?.alias ?? "yok");

  console.log("\n=== D) varlık okuması yalnız renk adayında; hatası kumaş terfisini düşürmez ===");
  const K2 = (await prisma.color.create({ data: { code: `TST-ALIAS-K2-${stamp}`, name: `TST ALIAS BEJ ${stamp}` }, select: { id: true } })).id;
  ozelIds.extraColors.push(K2);
  const d = prisma.customerItemColorAlias as unknown as { findMany: (...a: unknown[]) => Promise<unknown> };
  const orig = d.findMany;
  let cagri = 0;
  let atsin = false;
  d.findMany = async (...a: unknown[]) => {
    cagri++;
    if (atsin) throw new Error("sonda: varlık okuması düştü");
    return orig.apply(d, a);
  };
  try {
    await mkOrder([{ itemId: Y, colorId: K2, width: 150, quantity: 10, customerItemName: "Y-KUMAS" }]);
    check("D1 renk adı olmayan satırlar kumaşa özel varlık okuması YAPMAZ", cagri === 0, `çağrı=${cagri}`);
    atsin = true;
    await mkOrder([{ itemId: X, colorId: K2, width: 150, quantity: 10, customerItemName: "X-KUMAS", customerColorName: "X-BEJ" }]);
    const xKumas = await itemAlias(X);
    const k2Genel = await prisma.customerColorAlias.findUnique({ where: { customerId_colorId: { customerId: CUST, colorId: K2 } }, select: { alias: true } });
    check("D2 ⭐ okuma hatası KUMAŞ adı terfisini düşürmez", xKumas?.alias === "X-KUMAS", xKumas?.alias ?? "yok");
    check("D2 okuma hatasında RENK terfisi atlanır (kumaşa özel var mı bilinmiyor)", k2Genel === null, k2Genel?.alias ?? "yok");
  } finally {
    d.findMany = orig;
  }
}

async function main(): Promise<void> {
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS").id;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  const cust = await prisma.customer.create({ data: { code: `TST-ALIAS-C-${stamp}`, name: `Alias Test Müşteri ${stamp}` } });
  CUST = cust.id;

  try {
    console.log("\n=== promoteCustomerAliases batch ===");

    // A) 2 satır aynı item → terfi + dedup (ilk-dolu-ad kazanır)
    await mkOrder([
      { itemId: ITEM, width: 150, quantity: 100, customerItemName: "MUST-PATOS" },
      { itemId: ITEM, width: 150, quantity: 50, customerItemName: "DUP-IGNORE" },
    ]);
    check("item alias terfi edildi (ilk ad)", (await itemAlias(ITEM))?.alias === "MUST-PATOS", (await itemAlias(ITEM))?.alias ?? "yok");
    const itemAliasCount = await prisma.customerItemAlias.count({ where: { customerId: CUST, itemId: ITEM } });
    check("dedup: tek item alias satırı", itemAliasCount === 1, `count=${itemAliasCount}`);

    // B) aynı müşteri+item, yeni ad → MEVCUT alias EZİLMEZ (existing → skip)
    await mkOrder([{ itemId: ITEM, width: 150, quantity: 30, customerItemName: "NEW-NAME" }]);
    check("mevcut item alias ezilmedi", (await itemAlias(ITEM))?.alias === "MUST-PATOS", (await itemAlias(ITEM))?.alias ?? "yok");

    await kumasaOzelTerfi();
  } finally {
    const lines = await prisma.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    await prisma.orderLine.deleteMany({ where: { id: { in: lines.map((l) => l.id) } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customerItemAlias.deleteMany({ where: { customerId: CUST } });
    await prisma.customerColorAlias.deleteMany({ where: { customerId: CUST } });
    await prisma.customerItemColorAlias.deleteMany({ where: { customerId: CUST } });
    await prisma.customer.deleteMany({ where: { id: CUST } });
    if (ozelIds.items.length) await prisma.item.deleteMany({ where: { id: { in: ozelIds.items } } });
    if (ozelIds.color) await prisma.color.deleteMany({ where: { id: ozelIds.color } });
    if (ozelIds.extraColors.length) await prisma.color.deleteMany({ where: { id: { in: ozelIds.extraColors } } });
    console.log("(test verisi temizlendi)");
  }

  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
