// =============================================================================
// ÜRÜN KARTI D4b ALANLARI BEKÇİSİ (Seyitoğlu ürün kartı denetimi, 2026-11-25)
// =============================================================================
//   §1 kumaş ticari alanları (top boyu · asgari sipariş · bakım talimatı) yazılır, null temizler
//   §2 tip dışı DOLU değer 400 (kumaşa büküm, ipliğe top boyu, kumaşa asgari stok); null her tipte serbest
//   §3 iplik teknik alanları: filament/kat/büküm tam sayı + sınır, yön S/Z, parlaklık üç değer; büküm 0 = bükümsüz
//   §4 asgari stok iplik ve sarfta, > 0
//   §5 sarf birimi (K9): doğuşta seçilir, hareketsizken değişir; stok hareketi varken ITEM_UNIT_LOCKED; enum dışı 400
//   §6 DB CHECK ikinci hat: servis atlanınca da tip dışı / sınır dışı değer reddedilir
//
// NEGATİF SONDA — 2026-11-25 koşuldu (cp + geri alma):
//   `readYarnSpecFields` tip kapısı sökülünce → §2b ❌ (kumaşa büküm yazıldı, CHECK 500'e düştü) ·
//   `assertUnitChangeAllowed` hareket sayımı sökülünce → §5c ❌ (hareketli sarfın birimi değişti)
// Koşum: npx tsx scripts/test_urun_karti_alanlar.ts
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { itemService } from "../src/routes/item.routes";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

async function errCode(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { details?: { code?: string }; statusCode?: number; message?: string };
    return err.details?.code ?? `HTTP${err.statusCode ?? "?"}:${err.message ?? ""}`;
  }
}

async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

const TAG = `TEST-UKA-${Date.now().toString(36).toUpperCase()}`;
const items: string[] = [];
const moves: string[] = [];

async function main(): Promise<void> {
  console.log("\n=== Ürün kartı D4b alanları ===\n");
  const admin = await ensureTestAdmin();
  const mk = async (suffix: string, body: Record<string, unknown>): Promise<string> => {
    const res = (await itemService.create({ name: `${TAG} ${suffix}`, ...body }, admin.id, { notify: false })) as { data?: { id?: string } };
    const id = res.data?.id;
    if (!id) throw new Error(`kart doğmadı: ${suffix}`);
    items.push(id);
    return id;
  };
  const row = (id: string) => prisma.item.findUniqueOrThrow({ where: { id } });

  // §1 kumaş
  const fabric = await mk("KUMAS", { itemType: "FABRIC", standardRollLengthM: "50", minOrderQty: "1000,5", careInstructions: "30 °C yıkama, düşük ısı ütü" });
  let f = await row(fabric);
  check("§1a kumaşa top boyu / asgari sipariş / bakım doğuşta yazıldı",
    f.standardRollLengthM?.toString() === "50" && f.minOrderQty?.toString() === "1000.5" && f.careInstructions === "30 °C yıkama, düşük ısı ütü",
    JSON.stringify({ l: f.standardRollLengthM, m: f.minOrderQty, c: f.careInstructions }));
  await itemService.update(fabric, { standardRollLengthM: null, minOrderQty: "", careInstructions: "  " }, admin.id);
  f = await row(fabric);
  check("§1b null / boş metin temizler", f.standardRollLengthM === null && f.minOrderQty === null && f.careInstructions === null);
  check("§1c top boyu 0 → 400", (await errCode(() => itemService.update(fabric, { standardRollLengthM: "0" }, admin.id)))?.startsWith("HTTP400") === true);

  // §2 tip kapısı
  const yarn = await mk("IPLIK", { itemType: "YARN", unit: "KG" });
  check("§2a ipliğe top boyu → ITEM_FABRIC_STRUCTURE_FABRIC_ONLY",
    (await errCode(() => itemService.update(yarn, { standardRollLengthM: "50" }, admin.id))) === "ITEM_FABRIC_STRUCTURE_FABRIC_ONLY");
  check("§2b kumaşa büküm → ITEM_YARN_SPEC_YARN_ONLY",
    (await errCode(() => itemService.update(fabric, { yarnTwistTpm: 800 }, admin.id))) === "ITEM_YARN_SPEC_YARN_ONLY");
  check("§2c kumaşa asgari stok → ITEM_MIN_STOCK_TYPE",
    (await errCode(() => itemService.update(fabric, { minStockQty: "10" }, admin.id))) === "ITEM_MIN_STOCK_TYPE");
  check("§2d iplik doğuşunda bakım talimatı → ITEM_FABRIC_STRUCTURE_FABRIC_ONLY",
    (await errCode(() => mk("IPLIK2", { itemType: "YARN", careInstructions: "x" }))) === "ITEM_FABRIC_STRUCTURE_FABRIC_ONLY");
  check("§2e tip dışı alana null serbest (eski/genel form temizliği)",
    (await errCode(() => itemService.update(fabric, { yarnPly: null, minStockQty: null }, admin.id))) === null);

  // §3 iplik teknik alanları
  await itemService.update(yarn, { yarnFilamentCount: "24", yarnPly: 2, yarnTwistTpm: "800", yarnTwistDirection: "S", yarnLuster: "SEMI_DULL" }, admin.id);
  let y = await row(yarn);
  check("§3a filament/kat/büküm/yön/parlaklık yazıldı",
    y.yarnFilamentCount === 24 && y.yarnPly === 2 && y.yarnTwistTpm === 800 && y.yarnTwistDirection === "S" && y.yarnLuster === "SEMI_DULL",
    JSON.stringify({ f: y.yarnFilamentCount, p: y.yarnPly, t: y.yarnTwistTpm, d: y.yarnTwistDirection, l: y.yarnLuster }));
  await itemService.update(yarn, { yarnTwistTpm: 0 }, admin.id);
  y = await row(yarn);
  check("§3b büküm 0 (bükümsüz) kabul", y.yarnTwistTpm === 0);
  check("§3c kat 0 → 400", (await errCode(() => itemService.update(yarn, { yarnPly: 0 }, admin.id)))?.startsWith("HTTP400") === true);
  check("§3d filament 2,5 (kesirli) → 400", (await errCode(() => itemService.update(yarn, { yarnFilamentCount: "2.5" }, admin.id)))?.startsWith("HTTP400") === true);
  check("§3e büküm yönü X → YARN_TWIST_DIRECTION_INVALID",
    (await errCode(() => itemService.update(yarn, { yarnTwistDirection: "X" }, admin.id))) === "YARN_TWIST_DIRECTION_INVALID");
  check("§3f parlaklık MATT → YARN_LUSTER_INVALID", (await errCode(() => itemService.update(yarn, { yarnLuster: "MATT" }, admin.id))) === "YARN_LUSTER_INVALID");

  // §4 asgari stok
  await itemService.update(yarn, { minStockQty: "250.5" }, admin.id);
  y = await row(yarn);
  check("§4a ipliğe asgari stok yazıldı", y.minStockQty?.toString() === "250.5");
  check("§4b asgari stok 0 → 400", (await errCode(() => itemService.update(yarn, { minStockQty: "0" }, admin.id)))?.startsWith("HTTP400") === true);

  // §5 sarf birimi
  const cons = await mk("SARF", { itemType: "CONSUMABLE", unit: "KG", minStockQty: "20" });
  let c = await row(cons);
  check("§5a sarf doğuşta KG + asgari stok", c.unit === "KG" && c.minStockQty?.toString() === "20");
  await itemService.update(cons, { unit: "MT" }, admin.id);
  c = await row(cons);
  check("§5b hareketsiz sarfın birimi değişir", c.unit === "MT");
  const mv = await prisma.consumableMovement.create({ data: { itemId: cons, kind: "RECEIPT_IN", qty: 1 }, select: { id: true } });
  moves.push(mv.id);
  check("§5c stok hareketi olan sarfın birimi → ITEM_UNIT_LOCKED",
    (await errCode(() => itemService.update(cons, { unit: "KG" }, admin.id))) === "ITEM_UNIT_LOCKED");
  check("§5d aynı birimle kayıt serbest (form her kayıtta birimi gönderir)",
    (await errCode(() => itemService.update(cons, { unit: "MT", name: `${TAG} SARF` }, admin.id))) === null);
  check("§5e enum dışı birim → ITEM_UNIT_INVALID", (await errCode(() => itemService.update(cons, { unit: "LT" }, admin.id))) === "ITEM_UNIT_INVALID");

  // §6 DB CHECK ikinci hat (servis atlanır)
  check("§6a ipliğe top boyu DB'de reddedilir", await rejects(() => prisma.item.update({ where: { id: yarn }, data: { standardRollLengthM: 50 } })));
  check("§6b kumaşa asgari stok DB'de reddedilir", await rejects(() => prisma.item.update({ where: { id: fabric }, data: { minStockQty: 5 } })));
  check("§6c kat 0 DB'de reddedilir", await rejects(() => prisma.item.update({ where: { id: yarn }, data: { yarnPly: 0 } })));
  check("§6d sarfa parlaklık DB'de reddedilir", await rejects(() => prisma.item.update({ where: { id: cons }, data: { yarnLuster: "BRIGHT" } })));
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    try {
      if (moves.length) await prisma.consumableMovement.deleteMany({ where: { id: { in: moves } } });
      if (items.length) await prisma.item.deleteMany({ where: { id: { in: items } } });
    } catch (e) {
      console.error("temizlik:", e);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
