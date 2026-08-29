// =============================================================================
// AUDIT REPRO — S-2-04: `createShipment` replay'i (`readCreateShipmentReplay`,
//   shipping.service.ts:1362-1374) kaydın STATÜSÜNE BAKMAZ. Sevkiyat storno +
//   kapanışla (`undoDispatch {releaseSacks:true}`) CANCELLED olduktan sonra aynı
//   `clientToken` ile gelen tekrar, `success:true` + "Sevkiyat kuruldu (onay
//   bekliyor)" döner. Mal sevk EDİLMEMİŞTİR, çuvallar havuza dönmüştür.
//
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
// Beklenen (sağlıklı sistem): iptal edilmiş kaydın token replay'i 409
//   (repoda emsal var: `tambur-manual.service` ENTRY_CANCELLED,
//   `subcontractor.service` RECEIPT_CANCELLED).
// Gözlenen: (çalıştırınca doldur — log audit/repro/S-2-04.log)
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_S-2-04.ts
//
// Ölçülen değişmez: INV-SYS-03 (idempotency — "iptal edilmiş kaydın replay'i 409").
// Kardeş bekçi: `audit_repro_D-B-01.ts` AYNI sınıfı KK1 topu ve Sipariş için ölçer;
//   Shipment o dosyada YOKTU (K11 H-9: "Order/WO/Sack/Shipment/Receipt/Import
//   bekçisiz"). Bu script o boşluğu kapatır — kopya değil, EKSİK KOLU ölçer.
// Bayrak: `shipping.confirmationEnabled` DEĞİŞTİRİLMEZ; okunup loglanır. Sahada
//   `false` → createShipment tek adımda DISPATCHED üretir, bu yüzden replay'in
//   döndüğü "onay bekliyor" mesajı o rejimde karşılığı OLMAYAN bir cümledir
//   (Sevk Kapısı karosu bayrak kapalıyken hiç çizilmez).
// =============================================================================
import "dotenv/config";

function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "",
    db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import { randomUUID } from "node:crypto";
import { RollStatus, RollEntrySource, ShipmentStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";

const ship = new ShippingService();
const RAND = Math.random().toString(36).slice(2, 8).toUpperCase();
const STAMP = `AUDITREPRO-S-2-04-${RAND}`;

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
const info = (m: string): void => console.log(`   ${m}`);

const createdRolls: string[] = [];
const createdSacks: string[] = [];
const createdShipments: string[] = [];

let itemId = "";
let customerId = "";

async function makeRoll(qty: number): Promise<string> {
  const roll = await prisma.roll.create({
    data: {
      barcode: `${STAMP}-R${Date.now()}${Math.floor(Math.random() * 1e6)}`.toUpperCase().slice(0, 60),
      itemId,
      colorId: null,
      width: 71001,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.WAREHOUSE,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true, barcode: true },
  });
  createdRolls.push(roll.id);
  return roll.barcode!;
}

async function filledSack(barcodes: string[]): Promise<string> {
  const opened = (await ship.openSack({ customerId })) as { data: { id: string } };
  const sackId = opened.data.id;
  createdSacks.push(sackId);
  for (const bc of barcodes) await ship.scanIntoSack({ sackId, barcode: bc });
  return sackId;
}

type CreateResp = {
  success: boolean;
  message?: string;
  data: { id: string; shipmentNo: string; status: ShipmentStatus; dispatched: boolean };
};

async function main(): Promise<void> {
  console.log(`\n=== AUDIT REPRO S-2-04 — Shipment clientToken replay (${STAMP}) ===\n`);

  const flag = await prisma.systemSetting.findUnique({ where: { key: "shipping.confirmationEnabled" } });
  console.log(`shipping.confirmationEnabled = ${JSON.stringify(flag?.value ?? null)} (DEĞİŞTİRİLMEDİ)\n`);

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const cust = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item || !cust) throw new Error("Test verisi yetersiz (Item/Customer yok — npm run seed).");
  itemId = item.id;
  customerId = cust.id;

  const token = randomUUID();
  const bc = await makeRoll(120);
  const sackId = await filledSack([bc]);

  // ── 1) İLK GÖNDERİM ────────────────────────────────────────────────────────
  const first = (await ship.createShipment({
    sackIds: [sackId],
    customerId,
    clientToken: token,
  })) as unknown as CreateResp;
  createdShipments.push(first.data.id);
  info(`1. gönderim: ${first.data.shipmentNo} · status=${first.data.status} · dispatched=${first.data.dispatched}`);

  // ── 2) SEVKİYAT KAPATILIR (storno + kapanış ya da doğrudan iptal) ─────────
  if (first.data.status === ShipmentStatus.DISPATCHED) {
    await ship.undoDispatch(first.data.id, `${STAMP} yanlış sevkiyat`, undefined, { releaseSacks: true });
    info("storno + kapanış uygulandı (undoDispatch releaseSacks:true)");
  } else {
    await ship.cancelShipment(first.data.id);
    info("sevkiyat iptal edildi (cancelShipment)");
  }
  const after = await prisma.shipment.findUniqueOrThrow({
    where: { id: first.data.id },
    select: { status: true },
  });
  const sackNow = await prisma.sack.findUniqueOrThrow({
    where: { id: sackId },
    select: { shipmentId: true },
  });
  const rollNow = await prisma.roll.findFirstOrThrow({
    where: { id: createdRolls[0]! },
    select: { status: true, shipmentId: true },
  });
  info(
    `kapanış sonrası: sevkiyat=${after.status} · çuval.shipmentId=${sackNow.shipmentId ?? "NULL (havuzda)"} ` +
      `· top=${rollNow.status}/${rollNow.shipmentId ?? "NULL"}`,
  );
  check(
    "0) ön koşul: sevkiyat gerçekten CANCELLED ve mal çıkmadı",
    after.status === ShipmentStatus.CANCELLED && rollNow.status !== RollStatus.SHIPPED,
    `status=${after.status} top=${rollNow.status}`,
  );

  // ── 3) AYNI TOKEN İLE TEKRAR (mobil kuyruğun/zaman aşımının tekrar denemesi) ─
  let replay: CreateResp | null = null;
  let replayErr: string | null = null;
  try {
    replay = (await ship.createShipment({
      sackIds: [sackId],
      customerId,
      clientToken: token,
    })) as unknown as CreateResp;
  } catch (e) {
    replayErr = (e as Error).message;
  }

  if (replayErr) {
    info(`replay hata verdi: ${replayErr}`);
    check("1) iptal edilmiş sevkiyatın token replay'i REDDEDİLİYOR (409)", true, replayErr.slice(0, 90));
  } else {
    info(
      `replay yanıtı: success=${replay!.success} · status=${replay!.data.status} ` +
        `· dispatched=${replay!.data.dispatched} · mesaj="${replay!.message ?? ""}"`,
    );
    check(
      "1) iptal edilmiş sevkiyatın token replay'i REDDEDİLİYOR (409)",
      false,
      `success=${replay!.success} + status=${replay!.data.status} döndü — operatör "${replay!.message}" görüyor, ` +
        `oysa mal sevk edilmedi ve çuval havuza döndü`,
    );
    check(
      "2) replay mesajı kaydın GERÇEK durumunu söylüyor (iptal edildiği anlaşılıyor)",
      /iptal|cancel/i.test(replay!.message ?? ""),
      `mesaj="${replay!.message ?? ""}"`,
    );
    // Yeni bir sevkiyat da doğmadı mı? (kimlik ilk kaydın kimliği olmalı)
    check(
      "3) replay yeni sevkiyat üretmedi (kimlik ilk kayıtla aynı)",
      replay!.data.id === first.data.id,
      `${replay!.data.id} vs ${first.data.id}`,
    );
  }

  // ── 4) Kardeş yol — çuval `openSack` replay'i aynı sözleşmede mi? ──────────
  {
    const sackToken = randomUUID();
    const s1 = (await ship.openSack({ customerId, clientToken: sackToken })) as { data: { id: string } };
    createdSacks.push(s1.data.id);
    await ship.removeSack(s1.data.id);
    let s2Err: string | null = null;
    let s2Id: string | null = null;
    try {
      const s2 = (await ship.openSack({ customerId, clientToken: sackToken })) as { data: { id: string } };
      s2Id = s2.data.id;
      createdSacks.push(s2.data.id);
    } catch (e) {
      s2Err = (e as Error).message;
    }
    const stillThere = s2Id ? await prisma.sack.findUnique({ where: { id: s2Id }, select: { id: true } }) : null;
    info(
      `çuval replay: ${s2Err ? `hata=${s2Err.slice(0, 70)}` : `id=${s2Id} · DB'de ${stillThere ? "VAR" : "YOK"}`}`,
    );
    check(
      "4) silinmiş çuvalın token replay'i var olmayan kaydı 'açıldı' diye dönmüyor",
      s2Err !== null || stillThere !== null,
      s2Err ?? `replay silinmiş çuvalın kimliğini döndü (${s2Id})`,
    );
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: createdRolls } } });
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: createdSacks } } });
    await prisma.roll.updateMany({
      where: { id: { in: createdRolls } },
      data: { shipmentId: null, sackId: null },
    });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: createdShipments } } });
    await prisma.sack.deleteMany({ where: { id: { in: createdSacks } } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: createdShipments } } });
    await prisma.shipment.deleteMany({ where: { id: { in: createdShipments } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRolls } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: createdRolls } } });
    await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } });
    await prisma.systemLog.deleteMany({
      where: { recordId: { in: [...createdShipments, ...createdRolls, ...createdSacks] } },
    });
  } catch (e) {
    console.error("Temizlik hatası:", e);
  }
}

main()
  .catch((e) => {
    console.error("REPRO ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
