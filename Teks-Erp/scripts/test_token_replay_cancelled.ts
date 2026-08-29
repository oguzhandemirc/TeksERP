// =============================================================================
// BEKÇİ — İPTAL EDİLMİŞ KAYDIN TOKEN'I REPLAY EDİLEMEZ (2026-08-29 / T1-006)
// Çalıştır: npx tsx scripts/test_token_replay_cancelled.ts
// =============================================================================
// İdempotency'nin DÖRDÜNCÜ durumu: "yazıldı ama SONRADAN İPTAL EDİLDİ".
// Üç durum her yerde ele alınıyordu (hiç yazılmadı · aynı yük · başka yük);
// dördüncüsü yalnız `tambur-manual`da vardı ve orada bile İKİ KEZ elle
// yazılmıştı. Diğer üç replay okuyucusunda (KK1 ham giriş · açık kumaş ·
// sipariş) HİÇ yoktu → sunucu `success:true` + iptal edilmiş kaydın kimliğini
// dönüyordu. Operatör 100 m kumaşın kaydolduğunu sanıyor; top hiçbir envanter
// sekmesinde görünmüyor, hata da görünmüyor, kimse aramıyor.
//
// Ölçüm (saha kopyası): `clientToken` taşıyan 227 iptal/fire top = 227 canlı
// "yeniden oynatılabilir" token.
//
// §1 KK1 ham giriş     — iptal edilmiş topun token'ı → 409 ENTRY_CANCELLED
// §2 Fire (SCRAP)      — aynı kapı ("vardı, gitti" de kapanmış bir denemedir)
// §3 Sipariş           — iptal edilmiş siparişin token'ı → 409 ORDER_CANCELLED
// §4 REGRESYON         — iptal EDİLMEMİŞ kaydın replay'i BAYT BAYT aynı
// §5 Tek kaynak        — kural elle kopyalanmamış (AST/metin)
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { RollStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
type Hata = { message: string; code?: string; statusCode?: number } | null;
async function hataOf(fn: () => Promise<unknown>): Promise<Hata> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { message: string; statusCode?: number; details?: { code?: string } };
    return { message: err.message, code: err.details?.code, statusCode: err.statusCode };
  }
}

const ts = Date.now();
const inv = new InventoryService();
const rollIds: string[] = [];
let itemId = "";
let customerId = "";
let userId = "";

async function girisYap(token: string, qty = 100) {
  return inv.createInitialEntry(
    { itemId, initialQty: qty, width: 250, clientToken: token },
    userId,
  );
}

async function main(): Promise<void> {
  const item = await prisma.item.create({
    data: { code: `TST-TRC-${ts}`, name: `Test Token Replay ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  itemId = item.id;
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  check("fixture hazır (admin)", Boolean(admin));
  if (!admin) return;
  userId = admin.id;

  // ═══ §1 — KK1 ham giriş: iptal edilmiş topun token'ı ═══
  console.log("\n=== §1: KK1 ham giriş — iptal edilmiş token ===");
  const token1 = randomUUID();
  const r1 = (await girisYap(token1)).data as { id: string };
  rollIds.push(r1.id);
  await prisma.roll.update({ where: { id: r1.id }, data: { status: RollStatus.CANCELLED } });

  const e1 = await hataOf(() => girisYap(token1));
  check("§1: iptal edilmiş topun token'ı REDDEDİLDİ", e1 !== null, e1?.message?.slice(0, 60) ?? "SESSİZ BAŞARI!");
  check("§1: MAKİNE-OKUR kod + 409", e1?.code === "ENTRY_CANCELLED" && e1?.statusCode === 409, `${e1?.code ?? "—"} / ${e1?.statusCode ?? "—"}`);
  check(
    "§1: mesaj ne yapılacağını söylüyor (formu yeniden aç)",
    Boolean(e1?.message.includes("yeniden aç")),
  );
  const sayi1 = await prisma.roll.count({ where: { clientToken: token1 } });
  check("§1: ikinci top DOĞMADI (token hâlâ tek kayda ait)", sayi1 === 1, `${sayi1} kayıt`);

  // ═══ §2 — FİRE de kapanmış bir denemedir ═══
  console.log("\n=== §2: fire (SCRAP) edilmiş topun token'ı ===");
  const token2 = randomUUID();
  const r2 = (await girisYap(token2)).data as { id: string };
  rollIds.push(r2.id);
  await prisma.roll.update({ where: { id: r2.id }, data: { status: RollStatus.SCRAP } });
  const e2 = await hataOf(() => girisYap(token2));
  check("§2: fire edilmiş topun token'ı da REDDEDİLDİ", e2?.code === "ENTRY_CANCELLED", e2?.code ?? "SESSİZ BAŞARI!");

  // ═══ §3 — sipariş ═══
  console.log("\n=== §3: sipariş — iptal edilmiş token ===");
  const cus = await prisma.customer.create({
    data: { code: `TST-TRC-CUS-${ts}`, name: `Test Token Replay Müşteri ${ts}` },
    select: { id: true },
  });
  customerId = cus.id;
  // ⚠️ ÜRETİMDEKİ örneğin ta kendisi kullanılır (`routes/order.routes.ts`).
  // Elle kurulan bir yapılandırma `defaultInclude`u taşımaz → replay `lines`ı
  // okuyamaz, özdeşlik kontrolü yanlış çalışır ve bekçi ÜRÜNÜ değil kendi
  // kurulumunu ölçer (ilk yazımda tam bu oldu: canlı sipariş replay'i sahte
  // CLIENT_TOKEN_COLLISION verdi).
  const { orderService: orderSvc } = await import("../src/routes/order.routes");
  const token3 = randomUUID();
  const govde = { customerId, clientToken: token3, lines: [{ itemId, quantity: 120 }] };
  const o1 = (await orderSvc.create(govde, userId)).data as { id: string };
  await prisma.order.update({ where: { id: o1.id }, data: { status: "CANCELLED" } });

  const e3 = await hataOf(() => orderSvc.create(govde, userId));
  check("§3: iptal edilmiş siparişin token'ı REDDEDİLDİ", e3 !== null, e3?.message?.slice(0, 60) ?? "SESSİZ BAŞARI!");
  check("§3: MAKİNE-OKUR kod + 409", e3?.code === "ORDER_CANCELLED" && e3?.statusCode === 409, `${e3?.code ?? "—"} / ${e3?.statusCode ?? "—"}`);
  const sayi3 = await prisma.order.count({ where: { clientToken: token3 } });
  check("§3: ikinci sipariş DOĞMADI", sayi3 === 1, `${sayi3} kayıt`);

  // ═══ §4 — REGRESYON: canlı kaydın replay'i DEĞİŞMEDİ ═══
  console.log("\n=== §4: regresyon — iptal EDİLMEMİŞ kaydın replay'i ===");
  const token4 = randomUUID();
  const r4 = (await girisYap(token4)).data as { id: string };
  rollIds.push(r4.id);
  const tekrar = await girisYap(token4);
  const r4b = tekrar.data as { id: string };
  check("§4: canlı topun replay'i hâlâ BAŞARILI", tekrar.success === true);
  check("§4: aynı kaydı dönüyor (yeni top doğmuyor)", r4b.id === r4.id);
  check("§4: mesaj hâlâ idempotent retry diyor", Boolean(tekrar.message?.includes("idempotent")), tekrar.message?.slice(0, 50) ?? "");

  const token5 = randomUUID();
  const o5 = (await orderSvc.create({ customerId, clientToken: token5, lines: [{ itemId, quantity: 50 }] }, userId)).data as { id: string };
  const o5b = (await orderSvc.create({ customerId, clientToken: token5, lines: [{ itemId, quantity: 50 }] }, userId)).data as { id: string };
  check("§4: canlı siparişin replay'i hâlâ aynı kaydı dönüyor", o5b.id === o5.id);

  // ═══ §5 — kural TEK KAYNAKTA, elle kopyalanmamış ═══
  console.log("\n=== §5: tek kaynak (elle kopya yasağı) ===");
  const svcDir = join(__dirname, "../src/services");
  const dosyalar: string[] = [];
  const gez = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) gez(p);
      else if (e.name.endsWith(".ts")) dosyalar.push(p);
    }
  };
  gez(svcDir);
  // KÖRLÜK ZEMİNİ: tarama boşa düşerse "ihlal yok" ile "hiçbir şeye bakılmadı"
  // aynı yeşile çıkardı.
  check("§5: servis ağacı tarandı (körlük zemini)", dosyalar.length > 40, `${dosyalar.length} dosya`);
  const kopya = dosyalar.filter((f) => {
    if (f.endsWith("token-replay.helper.ts")) return false;
    return readFileSync(f, "utf8").includes('code: "ENTRY_CANCELLED"');
  });
  check(
    "§5: `ENTRY_CANCELLED` yalnız TEK KAYNAKTA üretiliyor",
    kopya.length === 0,
    kopya.map((f) => f.split("/").pop()).join(", ") || "elle kopya yok",
  );
  const kullanan = dosyalar.filter((f) => readFileSync(f, "utf8").includes("assertRollReplayAlive("));
  check("§5: kuralı KULLANAN yol sayısı beklenen (>=3 dosya)", kullanan.length >= 3, kullanan.map((f) => f.split("/").pop()).join(", "));
}

async function cleanup(): Promise<void> {
  const tokenRolls = await prisma.roll.findMany({ where: { itemId }, select: { id: true } }).catch(() => []);
  const ids = [...new Set([...rollIds, ...tokenRolls.map((r) => r.id)])];
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await prisma.orderLine.deleteMany({ where: { order: { customerId } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { customerId } }).catch(() => {});
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => {});
  if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
}

main()
  .catch((err) => {
    console.error("Beklenmeyen hata:", err);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
