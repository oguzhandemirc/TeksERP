// =============================================================================
// AUDIT REPRO — KYY-3-04: `attachRolls` (quickStart / "Yeniden Üretime Al") iş emri
// statüsünü tx DIŞINDA okur; top claim'i iş emrine HİÇ bakmaz → iptal edilen iş
// emrine top bağlanabilir (INV-STK-12: "canlı ama kimsenin okutamadığı top").
// `manualMove` aynı deseni taşır (`manualMoveWoBlockReason` pre-tx).
// Ortam: SADECE dev DB. Beklenen (sağlıklı sistem): hiçbir turda IN_PRODUCTION top
//   CANCELLED iş emrinin adımına bağlanmamalı.
// Gözlenen: audit/repro/KYY-3-04.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_KYY-3-04.ts
// @temizlik-scripti: denetim repro'su: silme, önceki kesilmiş koşumun KENDİ damgasını süpürer ve turlar arasında senaryoyu sıfırlar — sonda değil ÖN KOŞUL
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
import { WorkOrderService } from "../src/services/workorder.service";
import { ensureTestAdmin } from "./fixture-test-user";

const STAMP = `AUDITREPRO-KYY304-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
const short = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 120).replace(/\s+/g, " ");

async function main(): Promise<void> {
  console.log(`=== AUDIT REPRO KYY-3-04 — damga ${STAMP} ===`);
  const admin = await ensureTestAdmin();
  const svc = new WorkOrderService();
  const item = await prisma.item.create({ data: { code: `${STAMP}-I`, name: `${STAMP} KUMAS`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const color = await prisma.color.create({ data: { code: `${STAMP}-K`, name: `${STAMP} EKRU` }, select: { id: true } });
  const station = await prisma.station.create({ data: { code: `${STAMP}-ST`.slice(0, 32), name: `${STAMP} TAMBUR`, type: "INTERNAL", kind: "TAMBUR" }, select: { id: true } });
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${STAMP}-WO`.slice(0, 64), type: "STOCK_PRODUCTION", status: "PLANNED", targetItemId: item.id, width: 330 },
    select: { id: true },
  });
  const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: "PENDING" }, select: { id: true } });
  const barcodes: string[] = [];
  for (let i = 0; i < 3; i++) {
    const b = `${STAMP}-R${i}`;
    await prisma.roll.create({ data: { barcode: b, itemId: item.id, colorId: color.id, status: "WAREHOUSE", currentQty: 100, initialQty: 100, width: 330, entrySource: "SUPPLIER_RECEIPT" } });
    barcodes.push(b);
  }

  const reset = async () => {
    await prisma.rollMovement.deleteMany({ where: { workOrderStepId: step.id } });
    await prisma.roll.updateMany({ where: { itemId: item.id }, data: { status: "WAREHOUSE", currentStepId: null, producedInStepId: null, batchId: null } });
    await prisma.batch.deleteMany({ where: { workOrderId: wo.id } });
    await prisma.workOrderStep.update({ where: { id: step.id }, data: { status: "PENDING", startedAt: null, completedAt: null } });
    await prisma.workOrder.update({ where: { id: wo.id }, data: { status: "PLANNED", cancelledAt: null, cancelledById: null, cancelReason: null } });
  };

  let ihlal = 0;
  const ornek: string[] = [];
  try {
    console.log("\n[A] attachRolls ∥ softDelete(iş emri iptali) — 25 tur");
    for (let i = 0; i < 25; i++) {
      await reset();
      const res = await Promise.allSettled([
        svc.attachRolls(wo.id, barcodes, admin.id),
        svc.softDelete(wo.id, admin.id, {}),
      ]);
      const woNow = (await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { status: true } }))!;
      const stuck = await prisma.roll.count({ where: { currentStepId: step.id, status: "IN_PRODUCTION" } });
      if (woNow.status === "CANCELLED" && stuck > 0) {
        ihlal++;
        if (ornek.length < 5) ornek.push(`tur ${i + 1}: WO=CANCELLED, adımda ${stuck} IN_PRODUCTION top — ${res.map((r) => r.status === "fulfilled" ? "ok" : "err:" + short((r as PromiseRejectedResult).reason)).join(" | ")}`);
      }
    }
    ornek.forEach((l) => console.log(`   ⚠️ ${l}`));
    check("INV-STK-12 — iptal edilmiş iş emrinin adımında canlı top yok", ihlal === 0, `${ihlal}/25 tur`);

    console.log("\n[B] KORUMA SONDASI — WO zaten CANCELLED iken attachRolls ne yapıyor? (tx içi guard var mı)");
    await reset();
    await prisma.workOrder.update({ where: { id: wo.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    let hata: string | null = null;
    try { await svc.attachRolls(wo.id, barcodes, admin.id); } catch (e) { hata = short(e); }
    const stuck2 = await prisma.roll.count({ where: { currentStepId: step.id, status: "IN_PRODUCTION" } });
    console.log(`   sonuç: hata=${hata ?? "YOK"} · adımda ${stuck2} IN_PRODUCTION top`);
    check("pre-tx guard tek savunma değil (tx içinde de statü doğrulanıyor)", hata !== null && stuck2 === 0, "yalnız pre-tx okuma korunuyor");
  } finally {
    console.log("\n--- temizlik ---");
    await prisma.rollMovement.deleteMany({ where: { workOrderStepId: step.id } });
    await prisma.rollOperation.deleteMany({ where: { workOrderStepId: step.id } });
    await prisma.rollVariance.deleteMany({ where: { roll: { itemId: item.id } } });
    await prisma.roll.updateMany({ where: { itemId: item.id }, data: { currentStepId: null, producedInStepId: null, batchId: null } });
    await prisma.roll.deleteMany({ where: { itemId: item.id } });
    await prisma.batch.deleteMany({ where: { workOrderId: wo.id } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: wo.id } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: wo.id } });
    await prisma.workOrder.deleteMany({ where: { id: wo.id } });
    await prisma.station.deleteMany({ where: { id: station.id } });
    await prisma.color.deleteMany({ where: { id: color.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
    await prisma.systemLog.deleteMany({ where: { recordId: wo.id } });
  }
  console.log(`\n=== Sonuç: ${pass} korundu, ${fail} İHLAL ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); await pool.end(); process.exit(1); });
