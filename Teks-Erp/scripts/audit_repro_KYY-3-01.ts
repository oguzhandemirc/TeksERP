// =============================================================================
// AUDIT REPRO — KYY-3-01: Sevk onayı (performDispatchTx) sipariş kaleminin
// istenen metrajını AŞAN sevki hiçbir katmanda engellemiyor (INV-SEV-08).
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
// Beklenen (sağlıklı sistem): 100 m istenen kaleme iki PLANNED sevkiyat kurulup
//   ikisi de sevk edilince ya ikinci sevk 409 almalı ya da shippedQty <= 100
//   (+ tolerans) kalmalı.
// Gözlenen: aşağıdaki log (audit/repro/KYY-3-01.log)
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_KYY-3-01.ts
// =============================================================================
import "dotenv/config";
function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production") throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "", db = "";
  try { const u = new URL(url); host = u.hostname.toLowerCase(); db = decodeURIComponent(u.pathname.replace(/^\//, "")); } catch { throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)"); }
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db") throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();
import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { ensureTestAdmin } from "./fixture-test-user";

const STAMP = `AUDITREPRO-KYY301-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const N = (v: unknown) => Number(v);
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function main(): Promise<void> {
  console.log(`=== AUDIT REPRO KYY-3-01 — damga ${STAMP} ===`);
  const admin = await ensureTestAdmin();
  const customer = await prisma.customer.create({ data: { code: `${STAMP}-C`, name: `${STAMP} MUSTERI` }, select: { id: true } });
  const item = await prisma.item.create({ data: { code: `${STAMP}-I`, name: `${STAMP} KUMAS`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const color = await prisma.color.create({ data: { code: `${STAMP}-K`, name: `${STAMP} EKRU` }, select: { id: true } });
  const order = await prisma.order.create({ data: { orderNumber: `${STAMP}-O`, customerId: customer.id, status: "APPROVED" }, select: { id: true } });
  const line = await prisma.orderLine.create({ data: { orderId: order.id, itemId: item.id, colorId: color.id, quantity: 100, width: 330 }, select: { id: true } });

  // İKİ AYRI PLANNED SEVKİYAT, ikisi de AYNI kalemin TAMAMINI tahsis ediyor.
  // (Gerçek yol: iki planlamacı aynı açık kalem için ayrı ayrı sevkiyat kurar;
  //  `computeSackAllocations` need = quantity - shippedQty ve shippedQty yalnız
  //  DISPATCHED'i sayar → iki PLANNED sevkiyat aynı 100 m'yi iki kez tahsis eder.)
  const mkShipment = async (n: number) => {
    const sh = await prisma.shipment.create({ data: { shipmentNo: `${STAMP}-S${n}`, customerId: customer.id, status: "PLANNED", destination: "DOMESTIC" }, select: { id: true } });
    const sk = await prisma.sack.create({ data: { sackNo: `${STAMP}-CV${n}`, customerId: customer.id, shipmentId: sh.id, seq: 1, weightKg: 40 }, select: { id: true } });
    await prisma.roll.create({ data: { barcode: `${STAMP}-R${n}`, itemId: item.id, colorId: color.id, status: "WAREHOUSE", currentQty: 100, initialQty: 100, width: 330, entrySource: "SUPPLIER_RECEIPT", shipmentId: sh.id, sackId: sk.id } });
    await prisma.shipmentOrder.create({ data: { shipmentId: sh.id, orderId: order.id, isActive: true } });
    await prisma.sackAllocation.create({ data: { sackId: sk.id, orderLineId: line.id, qty: 100 } });
    return { shipmentId: sh.id, sackId: sk.id };
  };
  const s1 = await mkShipment(1);
  const s2 = await mkShipment(2);
  // 3. sevkiyat: "çuvalsız DISPATCHED" (INV-SEV-13) yarışı için.
  const s3 = await mkShipment(3);

  try {
    // ---------------------------------------------------------------------
    console.log("\n[A] İKİ EŞZAMANLI SEVK ONAYI — aynı kalemin tamamı iki kez sevk ediliyor");
    const res = await Promise.allSettled([
      shippingService.dispatchShipment(s1.shipmentId, { plateNumber: "34AUD01" }, admin.id),
      shippingService.dispatchShipment(s2.shipmentId, { plateNumber: "34AUD02" }, admin.id),
    ]);
    const ok = res.filter((r) => r.status === "fulfilled").length;
    const errs = res.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => (r.reason as Error).message);
    console.log(`   sonuç: ${ok} başarılı, ${errs.length} hata ${errs.length ? JSON.stringify(errs) : ""}`);

    // Ölçüm commit SONRASI, DB'DEN.
    const l = await prisma.orderLine.findUnique({ where: { id: line.id }, select: { quantity: true, shippedQty: true } });
    const o = await prisma.order.findUnique({ where: { id: order.id }, select: { status: true, shippedQty: true } });
    console.log(`   OrderLine: istenen=${N(l?.quantity)} shippedQty=${N(l?.shippedQty)} · Order: ${o?.status} shippedQty=${N(o?.shippedQty)}`);
    check(
      "INV-SEV-08 — satır sevki istenen metrajı aşmıyor",
      N(l?.shippedQty) <= N(l?.quantity) + 5,
      `shippedQty=${N(l?.shippedQty)} > quantity=${N(l?.quantity)}`,
    );
    check("fazla sevk kullanıcıya bir hata/uyarı ile bildirildi", errs.length > 0, "iki sevk de sessizce başarılı");
    check("sipariş durumu fazla sevki yansıtıyor (COMPLETED değil)", o?.status !== "COMPLETED", `status=${o?.status}`);

    // ---------------------------------------------------------------------
    console.log("\n[B] SEVK ONAYI ∥ SON ÇUVALI ÇIKARMA — INV-SEV-13 (boş sevkiyat sevk edilemez)");
    console.log("    (dispatchShipment 'boş sevkiyat' kontrolünü tx ÖNCESİ yapar; claim tx içinde tekrar bakmaz)");
    let bosSevk = 0, deneme = 0;
    for (let i = 0; i < 25; i++) {
      // her turda s3'ü PLANNED + tek çuvallı duruma geri kur
      await prisma.shipment.update({ where: { id: s3.shipmentId }, data: { status: "PLANNED", dispatchedAt: null } });
      await prisma.sack.update({ where: { id: s3.sackId }, data: { shipmentId: s3.shipmentId, seq: 1 } });
      await prisma.roll.updateMany({ where: { sackId: s3.sackId }, data: { shipmentId: s3.shipmentId, status: "WAREHOUSE", preShipStatus: null } });
      await prisma.printedDocument.deleteMany({ where: { sourceId: s3.shipmentId } });
      deneme++;
      const r = await Promise.allSettled([
        shippingService.dispatchShipment(s3.shipmentId, { plateNumber: "34AUD03" }, admin.id),
        shippingService.removeSackFromShipment(s3.shipmentId, s3.sackId, admin.id),
      ]);
      const st = await prisma.shipment.findUnique({ where: { id: s3.shipmentId }, select: { status: true } });
      const sackCount = await prisma.sack.count({ where: { shipmentId: s3.shipmentId } });
      if (st?.status === "DISPATCHED" && sackCount === 0) {
        bosSevk++;
        console.log(`   ⚠️ tur ${i + 1}: sevkiyat DISPATCHED ama 0 çuval — ${r.map((x) => x.status).join("/")}`);
      }
    }
    check("INV-SEV-13 — çuvalsız DISPATCHED sevkiyat üretilemedi", bosSevk === 0, `${bosSevk}/${deneme} turda üretildi`);
  } finally {
    console.log("\n--- temizlik ---");
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [s1.shipmentId, s2.shipmentId, s3.shipmentId] } } });
    await prisma.rollReturn.deleteMany({ where: { customerId: customer.id } });
    await prisma.sackAllocation.deleteMany({ where: { orderLineId: line.id } });
    await prisma.shipmentOrder.deleteMany({ where: { orderId: order.id } });
    await prisma.rollVariance.deleteMany({ where: { roll: { itemId: item.id } } });
    await prisma.roll.deleteMany({ where: { itemId: item.id } });
    await prisma.sack.deleteMany({ where: { customerId: customer.id } });
    await prisma.shipment.deleteMany({ where: { customerId: customer.id } });
    await prisma.orderLine.deleteMany({ where: { orderId: order.id } });
    await prisma.order.deleteMany({ where: { id: order.id } });
    await prisma.color.deleteMany({ where: { id: color.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [s1.shipmentId, s2.shipmentId, s3.shipmentId, order.id, line.id] } } });
  }

  console.log(`\n=== Sonuç: ${pass} korundu, ${fail} İHLAL ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); await pool.end(); process.exit(1); });
