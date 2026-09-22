// =============================================================================
// One-off: §18 tarihsel ad-mükerrerlerini temizle (2026-08-02)
// Çalıştır: npx tsx scripts/fix_duplicate_master_data.ts          (dry-run)
//           npx tsx scripts/fix_duplicate_master_data.ts --apply  (gerçekten siler)
//
// NEDEN: ad-mükerrer guard'ı 2026-07-30'da geldi (`8442aef`); bu 3 çift 16-23
// Temmuz'da, korumadan ÖNCE açılmış. Guard tasarım gereği yalnız YENİ mükerreri
// engeller, geriye dönük temizlemez. Kalıcı silme burada meşru: master-data
// hard-delete kök CLAUDE.md'de bilinçli istisna olarak listeli ve fabrika verisi
// henüz yalnız tanım+sipariş girişinden ibaret (kullanıcı onayı 2026-08-02).
//
// ⚠️ RENKTE FK KORUMASI YOK: rolls/order_lines/work_orders.colorId hepsi
// ON DELETE SET NULL — yani yanlış rengi silmek hata VERMEZ, sessizce gerçek
// kayıtların rengini boşaltır. hardDelete'in P2003 guard'ı renkleri korumaz.
// Bu yüzden silme öncesi her FK kaynağı tek tek sayılır ve sıfır değilse iptal.
// (Üründe FK'lar RESTRICT olduğu için oradaki koruma zaten çalışıyor.)
// =============================================================================
import prisma from "../src/lib/prisma";
import { pool } from "../src/lib/prisma";
import { ItemService } from "../src/services/item.service";
import { ColorService } from "../src/services/color.service";

const APPLY = process.argv.includes("--apply");

const itemService = new ItemService({
  modelName: "item",
  tableName: "ITEM",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  duplicateNameField: "name",
  entityLabel: "ürün",
});

const colorService = new ColorService({
  modelName: "color",
  tableName: "COLOR",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  uniqueField: "code",
  autoCode: { series: "color" },
});

/** Silinecek / korunacak çiftler — iş anahtarıyla (kod) çözülür, UUID gömülmez. */
const PAIRS = [
  { kind: "item" as const, keepCode: "BGR150SEFFAF", dropCode: "bgr150seffaf",
    why: "korunan kayıtta 1 sipariş kalemi var; silinen tamamen referanssız" },
  { kind: "color" as const, keepCode: "RNK-260717-8123", dropCode: "RNK-260722-9804",
    why: "ikisi de üretimde kullanılmamış — ilk açılan (17 Tem) korunur" },
  { kind: "color" as const, keepCode: "RNK-260717-3977", dropCode: "RNK-260723-3608",
    why: "ikisi de üretimde kullanılmamış — ilk açılan (17 Tem) korunur" },
];

/** Renge işaret eden HER FK kaynağı (station_colors hariç — pivot, cascade). */
async function colorRefs(id: string) {
  return {
    rolls: await prisma.roll.count({ where: { colorId: id } }),
    order_lines: await prisma.orderLine.count({ where: { colorId: id } }),
    work_orders: await prisma.workOrder.count({ where: { targetColorId: id } }),
    product_recipes: await prisma.productRecipe.count({ where: { colorId: id } }),
    item_allowed_colors: await prisma.itemAllowedColor.count({ where: { colorId: id } }),
    customer_color_aliases: await prisma.customerColorAlias.count({ where: { colorId: id } }),
    swatches: await prisma.swatch.count({ where: { colorId: id } }),
    swatch_stock_reductions: await prisma.swatchStockReduction.count({ where: { colorId: id } }),
    roll_returns: await prisma.rollReturn.count({ where: { colorId: id } }),
    subcontractor_receipts: await prisma.subcontractorReceipt.count({ where: { appliedColorId: id } }),
  };
}

/** Ürüne işaret eden HER FK kaynağı. */
async function itemRefs(id: string) {
  return {
    rolls: await prisma.roll.count({ where: { itemId: id } }),
    order_lines: await prisma.orderLine.count({ where: { itemId: id } }),
    work_orders: await prisma.workOrder.count({ where: { targetItemId: id } }),
    product_recipes: await prisma.productRecipe.count({ where: { itemId: id } }),
    item_allowed_colors: await prisma.itemAllowedColor.count({ where: { itemId: id } }),
    item_allowed_properties: await prisma.itemAllowedProperty.count({ where: { itemId: id } }),
    customer_item_aliases: await prisma.customerItemAlias.count({ where: { itemId: id } }),
    swatches: await prisma.swatch.count({ where: { itemId: id } }),
    swatch_stock_reductions: await prisma.swatchStockReduction.count({ where: { itemId: id } }),
    roll_returns: await prisma.rollReturn.count({ where: { itemId: id } }),
  };
}

async function main() {
  console.log(APPLY ? "== UYGULAMA MODU (kalıcı siler) ==" : "== DRY-RUN (yazmaz; --apply ile uygula) ==");

  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) throw new Error("admin kullanıcısı bulunamadı — audit userId'si çözülemedi");

  let blocked = 0;
  const plan: { kind: "item" | "color"; id: string; label: string }[] = [];

  for (const p of PAIRS) {
    // Delegate'leri tek değişkende birleştirme — Item|Color union'ı çağrılabilir
    // değil (TS2349) ve `npm test`in typecheck kapısını düşürür. Dalları ayır.
    const keep =
      p.kind === "item"
        ? await prisma.item.findFirst({ where: { code: p.keepCode } })
        : await prisma.color.findFirst({ where: { code: p.keepCode } });
    const drop =
      p.kind === "item"
        ? await prisma.item.findFirst({ where: { code: p.dropCode } })
        : await prisma.color.findFirst({ where: { code: p.dropCode } });

    console.log(`\n── ${p.kind === "item" ? "ÜRÜN" : "RENK"}: ${keep?.name ?? drop?.name ?? "?"} ──`);
    if (!keep || !drop) {
      console.log(`  ⏭  atlandı — çift artık yok (keep=${!!keep} drop=${!!drop}); muhtemelen zaten temizlendi`);
      continue;
    }
    console.log(`  KORUNUR : ${keep.code}  (${keep.createdAt.toISOString().slice(0, 10)})`);
    console.log(`  SİLİNİR : ${drop.code}  (${drop.createdAt.toISOString().slice(0, 10)})`);
    console.log(`  gerekçe : ${p.why}`);

    const refs = p.kind === "item" ? await itemRefs(drop.id) : await colorRefs(drop.id);
    const nonZero = Object.entries(refs).filter(([, n]) => n > 0);
    if (nonZero.length > 0) {
      console.log(`  ❌ İPTAL — silinecek kayda atıf var: ${nonZero.map(([t, n]) => `${t}=${n}`).join(", ")}`);
      blocked++;
      continue;
    }
    console.log(`  ✓ atıf yok (${Object.keys(refs).length} FK kaynağı tarandı)`);

    // Renkte station_colors CASCADE ile gider — korunan ikiz aynı istasyonları
    // kapsamıyorsa yetkinlik sessizce kaybolur. Kapsamıyorsa iptal.
    if (p.kind === "color") {
      const dropSt = await prisma.stationColor.findMany({ where: { colorId: drop.id }, select: { stationId: true } });
      const keepSt = await prisma.stationColor.findMany({ where: { colorId: keep.id }, select: { stationId: true } });
      const keepSet = new Set(keepSt.map((s) => s.stationId));
      const lost = dropSt.filter((s) => !keepSet.has(s.stationId));
      if (lost.length > 0) {
        console.log(`  ❌ İPTAL — ${lost.length} istasyon yetkinliği korunan renkte YOK (cascade ile kaybolurdu)`);
        blocked++;
        continue;
      }
      console.log(`  ✓ istasyon yetkinliği korunan renkte de var (${dropSt.length} satır cascade ile düşecek, kayıp yok)`);
    }

    plan.push({ kind: p.kind, id: drop.id, label: `${drop.code} — ${drop.name}` });
  }

  console.log(`\n=== PLAN: ${plan.length} kayıt kalıcı silinecek, ${blocked} iptal ===`);
  for (const x of plan) console.log(`  • ${x.kind}: ${x.label}`);

  if (!APPLY) {
    console.log("\n(dry-run — hiçbir şey yazılmadı)");
    return blocked;
  }

  for (const x of plan) {
    const svc = x.kind === "item" ? itemService : colorService;
    const res = await svc.hardDelete(x.id, admin.id);
    console.log(`  ${res.success ? "✅" : "❌"} ${x.label} — ${res.message}`);
    if (!res.success) blocked++;
  }
  console.log(`\n✅ Uygulandı: ${plan.length} kayıt silindi (audit'e admin olarak düştü)`);
  return blocked;
}

main()
  .then(async (blocked) => {
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = blocked > 0 ? 1 : 0;
  })
  .catch(async (e) => {
    console.error("HATA:", e);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = 1;
  });
