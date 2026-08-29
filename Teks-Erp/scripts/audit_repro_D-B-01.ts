// =============================================================================
// AUDIT REPRO — D-B-01: İPTAL EDİLMİŞ kaydın clientToken'ı replay edilince
//                       sunucu "success: true" + o kaydın kimliğini dönüyor mu?
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
// Beklenen (sağlıklı sistem): 409 `ENTRY_CANCELLED` (KK1) / `ORDER_CANCELLED`
//   (sipariş) — beceri §8 "idempotency 4. durumu"; SubcontractorReceipt ve
//   TamburManual bu davranışı ZATEN uyguluyor (referans karşılaştırma).
// Gözlenen: çalıştırınca doldur — log audit/repro/D-B-01.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_D-B-01.ts
// =============================================================================
import "dotenv/config";
function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "", db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch { throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)"); }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import { randomUUID } from "crypto";
import prisma from "../src/lib/prisma";
import { RollStatus, ItemType, OrderStatus } from "@prisma/client";
import { InventoryService } from "../src/services/inventory.service";
import { orderService } from "../src/routes/order.routes";

const STAMP = `AUDITREPRO-D-B-01-${randomUUID().slice(0, 6).toUpperCase()}`;
let fail = 0;
const ok = (m: string) => console.log(`✅ ${m}`);
const bad = (m: string) => { fail++; console.log(`❌ ${m}`); };
const info = (m: string) => console.log(`   ${m}`);

async function main(): Promise<void> {
  console.log(`\n=== AUDIT REPRO D-B-01 — iptal edilmiş kaydın token replay'i (${STAMP}) ===\n`);

  const item = await prisma.item.create({
    data: { code: `AR1${STAMP.slice(-6)}`, name: `${STAMP} KUMAS`, itemType: ItemType.FABRIC },
  });
  const customer = await prisma.customer.create({ data: { code: `AR1C${STAMP.slice(-5)}`, name: `${STAMP} MUSTERI` } });
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });

  // ── §1 KK1 ham giriş (inventory.service.createInitialEntry) ───────────────
  console.log("── §1 KK1 ham giriş: token → top → top İPTAL → aynı token ile tekrar\n");
  const invSvc = new InventoryService();
  const token1 = randomUUID();
  const first = await invSvc.createInitialEntry(
    { itemId: item.id, initialQty: 100, clientToken: token1 },
    user?.id,
  );
  const rollId = (first.data as { id: string }).id;
  const barcode = (first.data as { barcode: string | null }).barcode;
  info(`1. giriş: barkod ${barcode} (id ${rollId.slice(0, 8)})`);

  // Topu İPTAL et (sahadaki 227 CANCELLED+token'lı topun durumu — Q-STK-10).
  await prisma.roll.update({
    where: { id: rollId },
    data: { status: RollStatus.CANCELLED, cancelledAt: new Date(), cancelReason: `${STAMP} repro` },
  });
  info("top CANCELLED'a çekildi (sahada bu 227 topta gerçek bir durumdur)");

  let kk1Replay: { success?: boolean; message?: string } | null = null;
  let kk1Err: unknown = null;
  try {
    kk1Replay = await invSvc.createInitialEntry(
      { itemId: item.id, initialQty: 100, clientToken: token1 },
      user?.id,
    );
  } catch (e) { kk1Err = e; }

  if (kk1Err) {
    const code = (kk1Err as { details?: { code?: string } })?.details?.code ?? "-";
    ok(`KK1 replay REDDEDİLDİ (${code}) — 4. durum kapalı`);
  } else {
    bad(`KK1 replay "success: ${kk1Replay?.success}" döndü → mesaj: "${kk1Replay?.message}"`);
    const replayRoll = (kk1Replay as { data?: unknown } | undefined)?.data as
      | { id: string; status: RollStatus }
      | undefined;
    info(`dönen kaydın DB'deki güncel statüsü: ${replayRoll?.status}`);
    const live = await prisma.roll.findUnique({ where: { id: rollId }, select: { status: true } });
    info(`DB'den taze okuma: ${live?.status} → operatör "top kayıtlı" görür, envanterde YOK`);
  }

  // ── §2 Sipariş (order.service.create) ────────────────────────────────────
  console.log("\n── §2 Sipariş: token → sipariş → sipariş İPTAL → aynı token ile tekrar\n");
  const orderSvc = orderService;
  const token2 = randomUUID();
  const lines = [{ itemId: item.id, quantity: 50 }];
  let orderId: string | null = null;
  try {
    const o = await orderSvc.create(
      { customerId: customer.id, lines, clientToken: token2 } as never,
      user?.id,
    );
    orderId = ((o.data as { id?: string })?.id) ?? null;
    info(`1. sipariş: ${(o.data as { orderNumber?: string })?.orderNumber} (id ${orderId?.slice(0, 8)})`);
  } catch (e) {
    info(`sipariş oluşturulamadı (fixture sınırı): ${(e as Error).message}`);
  }

  if (orderId) {
    await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.CANCELLED } });
    info("sipariş CANCELLED'a çekildi");
    let ordErr: unknown = null;
    let ordReplay: { success?: boolean; message?: string; data?: unknown } | null = null;
    try {
      ordReplay = await orderSvc.create(
        { customerId: customer.id, lines, clientToken: token2 } as never,
        user?.id,
      );
    } catch (e) { ordErr = e; }
    if (ordErr) {
      const code = (ordErr as { details?: { code?: string } })?.details?.code ?? "-";
      ok(`Sipariş replay REDDEDİLDİ (${code})`);
    } else {
      bad(`Sipariş replay "success: ${ordReplay?.success}" döndü → "${ordReplay?.message}"`);
      const st = (ordReplay?.data as { status?: string })?.status;
      info(`dönen siparişin statüsü: ${st} — kullanıcı "Sipariş oluşturuldu" görür, sipariş İPTAL`);
    }
  }

  // ── §3 REFERANS: aynı 4. durumu DOĞRU uygulayan yol (tambur manuel top) ──
  console.log("\n── §3 Referans: `tambur-manual.service` 409 ENTRY_CANCELLED (kod okuması)\n");
  info("tambur-manual.service.ts:1039-1060 ve :1382-1400 → iptal edilmiş kayıtta 409;");
  info("subcontractor.service.ts:2356-2362 → RECEIPT_CANCELLED. Desen repoda MEVCUT.");

  console.log(`\n=== SONUÇ: ${fail} kırmızı ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => { console.error("REPRO HATASI:", e); process.exitCode = 2; })
  .finally(async () => {
    // Temizlik — FK sırasına göre, YALNIZ kendi damgamız.
    try {
      const items = await prisma.item.findMany({ where: { name: { startsWith: STAMP } }, select: { id: true } });
      const itemIds = items.map((i) => i.id);
      const custs = await prisma.customer.findMany({ where: { name: { startsWith: STAMP } }, select: { id: true } });
      const custIds = custs.map((c) => c.id);
      const rolls = await prisma.roll.findMany({ where: { itemId: { in: itemIds } }, select: { id: true } });
      const rollIds = rolls.map((r) => r.id);
      if (rollIds.length) {
        await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      }
      const orders = await prisma.order.findMany({ where: { customerId: { in: custIds } }, select: { id: true } });
      const orderIds = orders.map((o) => o.id);
      if (orderIds.length) {
        await prisma.orderLineRequiredProperty.deleteMany({ where: { orderLine: { orderId: { in: orderIds } } } });
        await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      }
      await prisma.systemLog.deleteMany({ where: { recordId: { in: [...itemIds, ...custIds, ...rollIds, ...orderIds] } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
      console.log("temizlik tamam");
    } catch (e) {
      console.error("TEMİZLİK HATASI (elle bak):", (e as Error).message, "damga:", STAMP);
    }
    await prisma.$disconnect();
  });
