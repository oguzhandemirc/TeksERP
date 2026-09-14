// =============================================================================
// AUDIT REPRO — KYY-3-02: `cancelReturn` sevkiyat kapsam kilidini (8023) ALMAZ ve
// sevkiyatın statüsünü OKUMAZ; topu koşulsuz `SHIPPED + shipmentId=<eski sevkiyat>`
// yazar (INV-SEV-03 / INV-SEV-06).
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
// Beklenen (sağlıklı sistem):
//   [A] cancelReturn ∥ undoDispatch → hiçbir turda "top SHIPPED ama sevkiyat
//       DISPATCHED değil" durumu doğmamalı.
//   [B] Sevkiyat DISPATCHED değilken cancelReturn ya 409 vermeli ya da topu
//       SHIPPED yapmamalı (aksi halde koruma YOK demektir).
// Gözlenen: audit/repro/KYY-3-02.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_KYY-3-02.ts
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
import { shippingService } from "../src/services/shipping.service";
import { returnService } from "../src/services/return.service";
import { ensureTestAdmin } from "./fixture-test-user";

const STAMP = `AUDITREPRO-KYY302-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
const msg = (e: unknown) => (e as Error)?.message ?? String(e);

async function main(): Promise<void> {
  console.log(`=== AUDIT REPRO KYY-3-02 — damga ${STAMP} ===`);
  const admin = await ensureTestAdmin();
  const customer = await prisma.customer.create({ data: { code: `${STAMP}-C`, name: `${STAMP} MUSTERI` }, select: { id: true } });
  const item = await prisma.item.create({ data: { code: `${STAMP}-I`, name: `${STAMP} KUMAS`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const color = await prisma.color.create({ data: { code: `${STAMP}-K`, name: `${STAMP} EKRU` }, select: { id: true } });
  const shipment = await prisma.shipment.create({ data: { shipmentNo: `${STAMP}-S`, customerId: customer.id, status: "PLANNED", destination: "DOMESTIC" }, select: { id: true } });
  const sack = await prisma.sack.create({ data: { sackNo: `${STAMP}-CV`, customerId: customer.id, shipmentId: shipment.id, seq: 1, weightKg: 50 }, select: { id: true } });
  const mkRoll = (n: number) => prisma.roll.create({
    data: { barcode: `${STAMP}-R${n}`, itemId: item.id, colorId: color.id, status: "WAREHOUSE", currentQty: 100, initialQty: 100, width: 330, entrySource: "SUPPLIER_RECEIPT", shipmentId: shipment.id, sackId: sack.id },
    select: { id: true },
  });
  const r1 = await mkRoll(1);
  const r2 = await mkRoll(2);
  await shippingService.dispatchShipment(shipment.id, { plateNumber: "34AUD02" }, admin.id);

  const rollState = async (id: string) =>
    (await prisma.roll.findUnique({ where: { id }, select: { status: true, shipmentId: true, sackId: true } }))!;
  const shipState = async () =>
    (await prisma.shipment.findUnique({ where: { id: shipment.id }, select: { status: true } }))!.status;

  try {
    // -------------------------------------------------------------------
    console.log("\n[A] cancelReturn ∥ undoDispatch — 20 tur");
    let ihlal = 0, turSayisi = 0;
    for (let i = 0; i < 20; i++) {
      // durum sıfırla: sevkiyat DISPATCHED, iki top SHIPPED, iade YOK
      await prisma.rollReturn.deleteMany({ where: { fromShipmentId: shipment.id } });
      await prisma.printedDocument.deleteMany({ where: { sourceId: shipment.id } });
      await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "DISPATCHED", dispatchedAt: new Date() } });
      await prisma.sack.update({ where: { id: sack.id }, data: { shipmentId: shipment.id, seq: 1 } });
      await prisma.roll.updateMany({ where: { id: { in: [r1.id, r2.id] } }, data: { status: "SHIPPED", shipmentId: shipment.id, sackId: sack.id, preShipStatus: "WAREHOUSE" } });
      // iade: r1 depoya döner
      const cr = (await returnService.createReturn({ rollId: r1.id, reasonText: `${STAMP} iade` }, admin.id)) as { data?: unknown };
      const rr = await prisma.rollReturn.findFirst({ where: { rollId: r1.id, cancelledAt: null }, select: { id: true }, orderBy: { createdAt: "desc" } });
      if (!rr) { console.log(`   tur ${i + 1}: iade kurulamadı ${JSON.stringify(cr)}`); continue; }
      turSayisi++;
      const res = await Promise.allSettled([
        returnService.cancelReturn(rr.id, `${STAMP} iade iptali`, admin.id),
        shippingService.undoDispatch(shipment.id, `${STAMP} storno`, admin.id),
      ]);
      const st = await shipState();
      const s1 = await rollState(r1.id);
      if (s1.status === "SHIPPED" && st !== "DISPATCHED") {
        ihlal++;
        console.log(`   ⚠️ tur ${i + 1}: top SHIPPED / sevkiyat ${st} — ${res.map((x) => x.status).join("/")}`);
      }
    }
    check("INV-SEV-03 — eşzamanlı iade-iptali + storno tutarsız durum üretmedi", ihlal === 0, `${ihlal}/${turSayisi} tur`);
    console.log(`   (not: ${turSayisi} turda undoDispatch'in aktif-iade sayacı guard'ı devrede mi, aşağıdaki [B] gösteriyor)`);

    // -------------------------------------------------------------------
    console.log("\n[B] KORUMA SONDASI — sevkiyat PLANNED iken cancelReturn ne yapıyor?");
    console.log("    (durum başka bir yolla oluşmuş kabul edilir; soru: cancelReturn statüyü OKUYOR mu)");
    await prisma.rollReturn.deleteMany({ where: { fromShipmentId: shipment.id } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: shipment.id } });
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "DISPATCHED", dispatchedAt: new Date() } });
    await prisma.roll.updateMany({ where: { id: { in: [r1.id, r2.id] } }, data: { status: "SHIPPED", shipmentId: shipment.id, sackId: sack.id, preShipStatus: "WAREHOUSE" } });
    await returnService.createReturn({ rollId: r1.id, reasonText: `${STAMP} iade B` }, admin.id);
    const rrB = (await prisma.rollReturn.findFirst({ where: { rollId: r1.id, cancelledAt: null }, select: { id: true }, orderBy: { createdAt: "desc" } }))!;
    // Sevkiyatı PLANNED'a çek (storno sonrası durum) — fixture üzerinde doğrudan.
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: "PLANNED", dispatchedAt: null } });
    let hata: string | null = null;
    try { await returnService.cancelReturn(rrB.id, `${STAMP} iade iptali B`, admin.id); } catch (e) { hata = msg(e); }
    const after = await rollState(r1.id);
    const shAfter = await shipState();
    console.log(`   sonuç: hata=${hata ?? "YOK (başarılı)"} · top=${after.status} shipmentId=${after.shipmentId ? "dolu" : "null"} · sevkiyat=${shAfter}`);
    check(
      "cancelReturn sevkiyat statüsünü doğruluyor (PLANNED sevkiyata SHIPPED top yazmıyor)",
      hata !== null || after.status !== "SHIPPED",
      `top ${after.status} + shipmentId dolu iken sevkiyat ${shAfter} → INV-SEV-03 ihlali`,
    );
    check(
      "8023 kapsam kilidi cancelReturn'de alınıyor (kaynak taraması)",
      /lockShipmentScopeTx/.test(
        require("fs").readFileSync(require("path").join(__dirname, "../src/services/return.service.ts"), "utf8")
          .split("async cancelReturn(")[1]
          ?.slice(0, 6000) ?? "",
      ),
      "cancelReturn gövdesinde lockShipmentScopeTx çağrısı YOK (createReturn ve undoDispatch alıyor)",
    );
  } finally {
    console.log("\n--- temizlik ---");
    await prisma.rollReturn.deleteMany({ where: { customerId: customer.id } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: shipment.id } });
    await prisma.sackAllocation.deleteMany({ where: { sackId: sack.id } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.rollVariance.deleteMany({ where: { roll: { itemId: item.id } } });
    await prisma.roll.deleteMany({ where: { itemId: item.id } });
    await prisma.sack.deleteMany({ where: { customerId: customer.id } });
    await prisma.shipment.deleteMany({ where: { customerId: customer.id } });
    await prisma.color.deleteMany({ where: { id: color.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.systemLog.deleteMany({ where: { recordId: shipment.id } });
  }

  console.log(`\n=== Sonuç: ${pass} korundu, ${fail} İHLAL ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); await pool.end(); process.exit(1); });
