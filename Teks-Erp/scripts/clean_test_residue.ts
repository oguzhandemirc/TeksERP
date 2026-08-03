// =============================================================================
// Test artığı temizleyici — çökmüş/yarım kalan koşumlardan kalan fixture'lar
// Çalıştır: npx tsx scripts/clean_test_residue.ts          (dry-run, sadece rapor)
//           npx tsx scripts/clean_test_residue.ts --apply  (gerçekten siler)
//
// NEDEN VAR: dev veritabanı artık fabrikanın canlı yedeği. Testler kendi
// yarattığını `finally`/`teardown` içinde siler — ama koşucu 180sn'de SIGTERM
// gönderdiğinde o blok HİÇ çalışmaz. Kalan satırlar iki zarar verir:
//   1. `test_consistency` §18 (aktif master-data ad mükerreri) kalıcı kırmızıya
//      döner ve GERÇEK bir mükerrer bulgusu bu gürültünün içinde kaybolur.
//   2. `TEST-SINV-*` toplar WAREHOUSE/AT_KARTELA statüsünde kalır → Envanter
//      ekranlarında hayalet stok olarak görünür.
//
// ⚠️ GÜVENLİK — SADECE KOD/BARKOD ÖNEKİ: silme kararı yalnız aşağıdaki test
// öneklerine bakar. AD'a göre HİÇBİR silme yapılmaz (ad eşleşmesi fabrika kaydını
// da yakalardı). Fabrika verisinin kodları bu önekleri taşımaz.
//
// Silinemeyen satır SESSİZCE ATLANMAZ, raporlanır: bir fixture'ın neden
// silinemediği ("şu top hâlâ o rengi kullanıyor") testin temizlik sırasındaki
// gerçek bir hatasına işaret edebilir.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");

/** Test fixture önekleri — TEK KAYNAK. Yeni bir test öneki doğarsa buraya ekle. */
const ROLL_BARCODE_PREFIXES = ["TEST-SINV-R", "TST-ADS-R", "TEST-AEX-R", "TST-AR-R"];
const ORDER_NO_PREFIXES = ["TST-ADS-ORD"];
const ITEM_CODE_PREFIXES = ["TST-NRM-", "TEST-SINV-I-", "TST-AEX-"];
const COLOR_CODE_PREFIXES = ["TST-ADS-C-", "TST-NRM-C-", "TST-AR-C-", "TST-AEX-C-"];
const CUSTOMER_CODE_PREFIXES = ["TST-ADS-", "TST-AEX-"];

const orPrefix = (field: string, prefixes: string[]) =>
  prefixes.map((p) => ({ [field]: { startsWith: p } }));

let planned = 0;
let deleted = 0;
let blocked = 0;

async function phase(label: string, run: () => Promise<number>): Promise<void> {
  if (!APPLY) return;
  try {
    const n = await run();
    if (n > 0) console.log(`  ↳ ${label}: ${n}`);
  } catch (e) {
    blocked++;
    console.log(`  ⚠️  ${label} BAŞARISIZ: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
}

async function main() {
  console.log(APPLY ? "== UYGULAMA MODU (siler) ==" : "== DRY-RUN (yazmaz; --apply ile uygula) ==");

  // ── 1) TOPLAR — bağımlı satırlar önce, FK sırası test teardown'larıyla aynı ──
  const rolls = await prisma.roll.findMany({
    where: { OR: orPrefix("barcode", ROLL_BARCODE_PREFIXES) },
    select: { id: true, barcode: true, status: true },
  });
  console.log(`\n── TOPLAR — ${rolls.length} artık (${ROLL_BARCODE_PREFIXES.join(", ")}) ──`);
  planned += rolls.length;
  if (!APPLY) for (const r of rolls) console.log(`  • ${r.barcode} [${r.status}]`);
  const rollIds = rolls.map((r) => r.id);
  if (rollIds.length > 0) {
    // Çuval/sevkiyat/adım bağlarını KOPAR — aksi halde sack/shipment silinemez.
    await phase("çuval-sevkiyat bağı koparıldı", async () =>
      (await prisma.roll.updateMany({
        where: { id: { in: rollIds } },
        data: { sackId: null, shipmentId: null, currentStepId: null },
      })).count,
    );
    // Kartela zinciri: makbuz kalemi → sevk kalemi → kartela. Sıra ZORUNLU,
    // `kartela_dispatch_items.rollId` RESTRICT (topu doğrudan silmeye izin vermez).
    // Makbuz kalemi topa İKİ yoldan bağlı: tükenen top (`consumedRollId`) ve
    // kaynak sevk kalemi (`sourceDispatchItemId` → o kalemin `rollId`'si). İkisi de
    // temizlenmezse sevk kalemi ya da top silinemez.
    await phase("kartela makbuz kalemleri", async () =>
      (await prisma.kartelaReceiptItem.deleteMany({
        where: {
          OR: [
            { consumedRollId: { in: rollIds } },
            { sourceDispatchItem: { rollId: { in: rollIds } } },
          ],
        },
      })).count,
    );
    await phase("kartela sevk kalemleri", async () =>
      (await prisma.kartelaDispatchItem.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("kartelalar", async () =>
      (await prisma.swatch.deleteMany({ where: { parentRollId: { in: rollIds } } })).count,
    );
    await phase("hata kayıtları", async () =>
      (await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("iade kayıtları", async () =>
      (await prisma.rollReturn.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("hareketler", async () =>
      (await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("operasyonlar", async () =>
      (await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("özellikler", async () =>
      (await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } })).count,
    );
    await phase("çocuk toplar", async () =>
      (await prisma.roll.deleteMany({ where: { parentRollId: { in: rollIds } } })).count,
    );
    await phase("toplar", async () => {
      const n = (await prisma.roll.deleteMany({ where: { id: { in: rollIds } } })).count;
      deleted += n;
      return n;
    });
  }

  // ── 2) SİPARİŞLER ──
  const orders = await prisma.order.findMany({
    where: { OR: orPrefix("orderNumber", ORDER_NO_PREFIXES) },
    select: { id: true, orderNumber: true },
  });
  console.log(`\n── SİPARİŞLER — ${orders.length} artık (${ORDER_NO_PREFIXES.join(", ")}) ──`);
  planned += orders.length;
  if (!APPLY) for (const o of orders) console.log(`  • ${o.orderNumber}`);
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length > 0) {
    await phase("sipariş kalemleri", async () =>
      (await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } })).count,
    );
    await phase("siparişler", async () => {
      const n = (await prisma.order.deleteMany({ where: { id: { in: orderIds } } })).count;
      deleted += n;
      return n;
    });
  }

  // ── 3) MASTER DATA — şubeler müşteriden ÖNCE ──
  const targets = [
    { label: "ŞUBE", model: "customerBranch" as const, where: { customer: { OR: orPrefix("code", CUSTOMER_CODE_PREFIXES) } } },
    { label: "MÜŞTERİ", model: "customer" as const, where: { OR: orPrefix("code", CUSTOMER_CODE_PREFIXES) } },
    { label: "RENK", model: "color" as const, where: { OR: orPrefix("code", COLOR_CODE_PREFIXES) } },
    { label: "ÜRÜN", model: "item" as const, where: { OR: orPrefix("code", ITEM_CODE_PREFIXES) } },
  ];

  for (const t of targets) {
    const delegate = (prisma as unknown as Record<string, {
      findMany: (a: unknown) => Promise<{ id: string; name: string }[]>;
      delete: (a: unknown) => Promise<unknown>;
    }>)[t.model];
    const rows = await delegate.findMany({
      where: t.where,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    console.log(`\n── ${t.label} — ${rows.length} artık ──`);
    planned += rows.length;
    for (const r of rows) {
      if (!APPLY) {
        console.log(`  • ${r.name}`);
        continue;
      }
      try {
        await delegate.delete({ where: { id: r.id } });
        deleted++;
        console.log(`  ✅ ${r.name}`);
      } catch (e) {
        blocked++;
        console.log(
          `  ⚠️  ${r.name} — SİLİNEMEDİ: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`,
        );
      }
    }
  }

  console.log(
    APPLY
      ? `\n=== ${deleted} kayıt silindi, ${blocked} engellendi ===`
      : `\n=== ${planned} kayıt silinecek (dry-run — hiçbir şey yazılmadı) ===`,
  );
  return blocked;
}

main()
  .then(async (b) => {
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = b > 0 ? 1 : 0;
  })
  .catch(async (e) => {
    console.error("HATA:", e);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = 1;
  });
