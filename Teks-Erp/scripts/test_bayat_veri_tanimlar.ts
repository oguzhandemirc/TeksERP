// =============================================================================
// BEKÇİ — BAYAT VERİ KORUMASI: renk · ürün PATCH'i ve fiyat yazımında isteğe bağlı `expectedUpdatedAt` (V5c, 2026-11-13)
// =============================================================================
// Koşum: DATABASE_URL='postgresql://…/<ad>_test' npx tsx scripts/test_bayat_veri_tanimlar.ts
//
//   §1 ⭐ alan YOKKEN eski davranış (renk · ürün · fiyat geçer); bozuk ISO 400
//   §2 doğru sürümle geçer, yanıt yeni sürüm verir (renk · ürün · fiyat değişimi yeni satır)
//   §3 bayat sürümle 409 `details.code = STALE_RECORD`, kayıt değişmez (renk · ürün · fiyat); fiyatta satır yokken
//      sürüm 409; belirsiz tekrar (aynı gövde, eski sürüm) 409 → istemci taze okur
//   §4 sürümle birlikte pasife alma/liste değişimi 400 (renk `isActive:false` · ürün `isActive` · `allowedColorIds`)
//   §5 ⭐ eşzamanlı iki fiyat yazımı aynı sürümle: yalnız biri geçer (anahtar kilidi + sürüm)
//
// ⭐ NEGATİF SONDA (2026-11-13, ölçüldü): renkte `updateCore`a versionWhere geçirilmedi → 2 ❌ (§3a §3b); üründe
//    aynı → 2 ❌ (§3c §3d); fiyatta `assertRowVersion` çağrısı kaldırıldı → 5 ❌ (§3e–§3h §5a). Geri alındı.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { colorService } from "../src/routes/color.routes";
import { itemService } from "../src/routes/item.routes";
import { itemPriceService } from "../src/services/item-price.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";

const TAG = `TST-BAYATT-${process.pid}`;
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
/** "geçti" | "409:STALE_RECORD" | "400:VALIDATION_ERROR" | "<status>" */
async function sonuc(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "geçti";
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string }; message?: string };
    if (!err.statusCode) return String(err.message).slice(0, 120);
    return err.details?.code ? `${err.statusCode}:${err.details.code}` : String(err.statusCode);
  }
}

const colorIds: string[] = [];
const itemIds: string[] = [];

async function cleanup(): Promise<void> {
  const ids = [...colorIds, ...itemIds];
  if (ids.length) await prisma.systemLog.deleteMany({ where: { recordId: { in: ids } } });
  if (itemIds.length) {
    await prisma.itemPrice.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (colorIds.length) await prisma.color.deleteMany({ where: { id: { in: colorIds } } });
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== BAYAT VERİ KORUMASI — TANIMLAR ===\n");
  const admin = await ensureTestAdmin();
  try {
    const renk = async (): Promise<string> => {
      const r = (await colorService.create({ name: `${TAG} ${colorIds.length + 1} MAVI` }, admin.id)) as { data: { id: string } };
      colorIds.push(r.data.id);
      return r.data.id;
    };
    const urun = async (): Promise<string> => {
      const r = (await itemService.create({ name: `${TAG} KUMAS ${itemIds.length + 1}`, itemType: "FABRIC", unit: "MT" }, admin.id)) as { data: { id: string } };
      itemIds.push(r.data.id);
      return r.data.id;
    };
    const renkSurum = async (id: string) => (await prisma.color.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } })).updatedAt.toISOString();
    const urunSurum = async (id: string) => (await prisma.item.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } })).updatedAt.toISOString();
    const fiyatYaz = (itemId: string, price: number, expectedUpdatedAt?: string | null) =>
      itemPriceService.upsert({ itemId, kind: "SALE", currency: "TRY", price, expectedUpdatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : null }, admin.id);
    const yururluk = (itemId: string) => prisma.itemPrice.findFirst({ where: { itemId, kind: "SALE", currency: "TRY", customerId: null, revokedAt: null }, select: { id: true, price: true, updatedAt: true } });

    // ── §1 alan yokken ──
    console.log("── §1 alan yokken eski davranış ──");
    const c1 = await renk();
    const i1 = await urun();
    check("§1a renk: sürümsüz güncelleme geçer", (await sonuc(() => colorService.update(c1, { hex: "#112233" }, admin.id))) === "geçti");
    check("§1b ürün: sürümsüz güncelleme geçer", (await sonuc(() => itemService.update(i1, { name: `${TAG} KUMAS 1B` }, admin.id))) === "geçti");
    check("§1c fiyat: sürümsüz yazım geçer (ilk tanım)", (await sonuc(() => fiyatYaz(i1, 10))) === "geçti");
    check("§1d renk: bozuk ISO 400 VALIDATION_ERROR", (await sonuc(() => colorService.update(c1, { hex: "#223344", expectedUpdatedAt: "dün" }, admin.id))) === "400:VALIDATION_ERROR");
    check("§1e ürün: `expectedUpdatedAt: null` = gönderilmemiş", (await sonuc(() => itemService.update(i1, { name: `${TAG} KUMAS 1E`, expectedUpdatedAt: null }, admin.id))) === "geçti");

    // ── §2 doğru sürüm ──
    console.log("\n── §2 doğru sürümle geçer ──");
    const vc = await renkSurum(c1);
    const rc = (await colorService.update(c1, { hex: "#334455", expectedUpdatedAt: vc }, admin.id)) as { data: { hex: string; updatedAt: Date } };
    check("§2a renk doğru sürümle geçer, yanıt yeni updatedAt", rc.data.hex === "#334455" && rc.data.updatedAt.toISOString() > vc);
    const vi = await urunSurum(i1);
    const ri = (await itemService.update(i1, { name: `${TAG} KUMAS 2B`, expectedUpdatedAt: vi }, admin.id)) as { data: { name: string; updatedAt: Date } };
    check("§2b ürün doğru sürümle geçer", ri.data.name.includes("2B") && ri.data.updatedAt.toISOString() > vi);
    const p0 = await yururluk(i1);
    check("§2c fiyat doğru sürümle geçer, yeni satır doğar", (await sonuc(() => fiyatYaz(i1, 12, p0!.updatedAt.toISOString()))) === "geçti" && (await yururluk(i1))!.id !== p0!.id);

    // ── §3 bayat sürüm ──
    console.log("\n── §3 bayat sürümle 409 STALE_RECORD ──");
    check("§3a renk: bayat sürüm 409 STALE_RECORD", (await sonuc(() => colorService.update(c1, { hex: "#445566", expectedUpdatedAt: vc }, admin.id))) === "409:STALE_RECORD");
    check("§3b renk değişmedi", (await prisma.color.findUniqueOrThrow({ where: { id: c1 } })).hex === "#334455");
    check("§3c ürün: bayat sürüm 409 STALE_RECORD", (await sonuc(() => itemService.update(i1, { name: `${TAG} KUMAS 3C`, expectedUpdatedAt: vi }, admin.id))) === "409:STALE_RECORD");
    check("§3d ürün değişmedi", (await prisma.item.findUniqueOrThrow({ where: { id: i1 } })).name.includes("2B"));
    check("§3e fiyat: bayat sürüm (eski satır) 409 STALE_RECORD", (await sonuc(() => fiyatYaz(i1, 15, p0!.updatedAt.toISOString()))) === "409:STALE_RECORD");
    check("§3f fiyat değişmedi", new Prisma.Decimal((await yururluk(i1))!.price).equals(12));
    const i3 = await urun();
    check("§3g fiyat: satır yokken sürüm 409 (bakarken silinmiş)", (await sonuc(() => fiyatYaz(i3, 5, new Date().toISOString()))) === "409:STALE_RECORD");
    const p3 = await yururluk(i1);
    await fiyatYaz(i1, 20, p3!.updatedAt.toISOString());
    check("§3h belirsiz tekrar (aynı gövde, eski sürüm) 409 — istemci taze okur", (await sonuc(() => fiyatYaz(i1, 20, p3!.updatedAt.toISOString()))) === "409:STALE_RECORD");

    // ── §4 pasife alma ve liste ──
    console.log("\n── §4 sürümle pasife alma / liste 400 ──");
    check("§4a renk: `isActive:false` + sürüm 400", (await sonuc(async () => colorService.update(c1, { isActive: false, expectedUpdatedAt: await renkSurum(c1) }, admin.id))) === "400:VALIDATION_ERROR");
    check("§4b ürün: `isActive` + sürüm 400", (await sonuc(async () => itemService.update(i1, { isActive: false, expectedUpdatedAt: await urunSurum(i1) }, admin.id))) === "400:VALIDATION_ERROR");
    check("§4c ürün: `allowedColorIds` + sürüm 400", (await sonuc(async () => itemService.update(i1, { allowedColorIds: [], expectedUpdatedAt: await urunSurum(i1) }, admin.id))) === "400:VALIDATION_ERROR");
    check("§4d renk ve ürün aktif kaldı", (await prisma.color.findUniqueOrThrow({ where: { id: c1 } })).isActive && (await prisma.item.findUniqueOrThrow({ where: { id: i1 } })).isActive);

    // ── §5 eşzamanlı ──
    console.log("\n── §5 eşzamanlı iki fiyat yazımı ──");
    const p5 = await yururluk(i1);
    const v5 = p5!.updatedAt.toISOString();
    const iki = await Promise.all([sonuc(() => fiyatYaz(i1, 31, v5)), sonuc(() => fiyatYaz(i1, 32, v5))]);
    const acik = await prisma.itemPrice.count({ where: { itemId: i1, kind: "SALE", currency: "TRY", customerId: null, revokedAt: null } });
    check("§5a aynı sürümle yalnız biri geçer, tek yürürlükteki satır", iki.filter((x) => x === "geçti").length === 1 && acik === 1, iki.join(" · "));
  } finally {
    await cleanup().catch((e) => {
      fail++;
      console.log(`❌ temizlik — ${String(e).slice(0, 300)}`);
    });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exitCode = 1;
});
