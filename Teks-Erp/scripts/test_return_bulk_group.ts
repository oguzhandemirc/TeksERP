// =============================================================================
// Test: ÇUVAL BAZLI TOPLU İADE + TEK ÇOK KALEMLİ İRSALİYE
// Çalıştır: npx tsx scripts/test_return_bulk_group.ts
// =============================================================================
// SAHA SORUSU (2026-08-05): "Bir sevkiyatın içinden sadece bir çuvalı iade
// alabilir miyiz?" Alınabiliyordu — ama iade birimi TOP olduğu için 20 toplu
// çuval 20 kez okutmayı VE 20 ayrı iade irsaliyesini gerektiriyordu. Sektörde
// bir iade olayı = BİR çok kalemli belgedir.
//
// Tasarım kararı: DEFTER satır bazında kalır (her top ayrı `RollReturn` — brüt
// kuralı, `prevSackId` geri-ekleme mantığı ve iade raporları buna dayanıyor),
// BELGE grup bazına geçer (`returnGroupId` = grup LİDERİNİN id'si; belge
// `sourceId` olarak lideri kullanır).
//
// Bu bekçi ŞUNLARI kilitler:
//   [1] Çuval kodu okutma: sevk EDİLMİŞ çuvalın iade alınmamış topları döner;
//       depodaki çuval ve olmayan kod SEBEBİYLE reddedilir.
//   [2] Toplu iade N defter satırı doğurur ve hepsi AYNI `returnGroupId`yi taşır.
//   [3] TEK belge doğar (sourceId = lider) — N belge değil.
//   [4] Belge ÇOK KALEMLİDİR (`doc.lines` N kalem taşır).
//   [5] ÜYE id'siyle belge çözülmez → aynı grubun İKİNCİ kopyası doğamaz.
//       (Builder üye id'sinde bilinçli `null` döner; lazy-init aksi halde farklı
//        bir sourceId altında ikinci resmi belge dondururdu.)
//   [6] Liste/detay `documentSourceId` döndürür — istemci `?? id` kuralını
//       kopyalamak zorunda kalmaz (kopyalamayan istemcide "irsaliye yok" sessizliği).
//   [7] Bir kalem iptal → belge REVİZE (v1 SUPERSEDED, v2 ACTIVE, kalem N-1).
//       Tümünü void etmek, iadesi DURAN topların resmi kaydını yok ederdi.
//   [8] SON aktif kalem de iptal → belge VOIDED.
//   [9] TEKİL iade davranışı DEĞİŞMEDİ: `returnGroupId` NULL, `doc.lines` YOK
//       (renderer `[line]`e düşer → eski/tekil belgeler bayt-bayt aynı basılır).
//  [10] Farklı sevkiyatlardan toplar tek belgeye giremez (künye tek olmalı).
//  [11] ATOMİKLİK: gruptaki bir top araya giren başka bir iadeyle kapılmışsa
//       TÜM grup geri sarılır — yarım iade belgesi doğmaz.
//
// Cleanup finally'de; tüm kayıtlar `TEST-` önekli.
// =============================================================================

import prisma, { pool } from "../src/lib/prisma";
import { returnService } from "../src/services/return.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

async function err(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

interface SackLookup {
  sack: { id: string; sackNo: string };
  rolls: { id: string; barcode: string | null }[];
  candidateOrders: unknown[];
}
interface DocSnapshot {
  doc: { lines?: unknown[]; line: unknown };
}

async function docRows(sourceId: string) {
  return prisma.printedDocument.findMany({
    where: { docType: "RETURN_DISPATCH", sourceId },
    orderBy: { version: "asc" },
    select: { version: true, status: true, snapshot: true },
  });
}

async function main() {
  const ts = Date.now();
  const admin = await ensureTestAdmin();

  const customer = await prisma.customer.create({
    data: { code: `TST-BRT-${ts}`, name: `TEST TOPLU İADE MÜŞTERİ ${ts}`, taxNumber: "9998887772" },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-BRT-I-${ts}`, name: `TOPLU İADE KUMAŞ ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const color = await prisma.color.create({
    data: { code: `TST-BRT-C-${ts}`, name: "TOPLU İADE EKRU" },
    select: { id: true },
  });

  const mkShipment = (suffix: string, status: "DISPATCHED" | "PLANNED") =>
    prisma.shipment.create({
      data: {
        shipmentNo: `TEST-BRT-${suffix}-${ts}`,
        customerId: customer.id,
        status,
        destination: "DOMESTIC",
        ...(status === "DISPATCHED" ? { dispatchedAt: new Date() } : {}),
      },
      select: { id: true },
    });
  const shipment = await mkShipment("A", "DISPATCHED");
  const shipmentB = await mkShipment("B", "DISPATCHED");

  const mkSack = (suffix: string, shipmentId: string | null) =>
    prisma.sack.create({
      data: {
        sackNo: `TEST-BRT-SK-${suffix}-${ts}`,
        customerId: customer.id,
        shipmentId,
        ...(shipmentId ? { seq: 1 } : {}),
      },
      select: { id: true, sackNo: true },
    });
  const sack = await mkSack("A", shipment.id);
  const sackB = await mkSack("B", shipmentB.id);
  const poolSack = await mkSack("POOL", null); // depoda — iade alınamaz

  const mkRoll = async (n: number, qty: number, shipmentId: string | null, sackId: string, status: "SHIPPED" | "WAREHOUSE") =>
    prisma.roll.create({
      data: {
        barcode: `TEST-BRT-R${n}-${ts}`,
        itemId: item.id,
        colorId: color.id,
        status,
        currentQty: qty,
        initialQty: qty,
        width: 330,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
        shipmentId,
        sackId,
        warehouseId: await fixtureWarehouseId(),
      },
      select: { id: true, barcode: true },
    });

  const r1 = await mkRoll(1, 100, shipment.id, sack.id, "SHIPPED");
  const r2 = await mkRoll(2, 50, shipment.id, sack.id, "SHIPPED");
  const r3 = await mkRoll(3, 75, shipment.id, sack.id, "SHIPPED");
  const rSingle = await mkRoll(4, 40, shipment.id, sack.id, "SHIPPED"); // tekil iade sınaması
  const rOther = await mkRoll(5, 25, shipmentB.id, sackB.id, "SHIPPED"); // başka sevkiyat
  const rMix = await mkRoll(7, 35, shipment.id, sack.id, "SHIPPED"); // §10 — dokunulmamış kalır
  await mkRoll(6, 30, null, poolSack.id, "WAREHOUSE"); // depodaki çuval

  try {
    // ---------------------------------------------------------------------
    console.log("\n[1] ÇUVAL LOOKUP");
    const lookup = ((await returnService.lookupSackForReturn(sack.sackNo)) as { data: SackLookup }).data;
    check("çuvalın 5 sevk edilmiş topu döndü", lookup.rolls.length === 5, String(lookup.rolls.length));
    check("çuval kimliği doğru", lookup.sack.sackNo === sack.sackNo);

    const poolErr = await err(() => returnService.lookupSackForReturn(poolSack.sackNo));
    check("depodaki çuval SEBEBİYLE reddedildi", poolErr !== null && /sevkiyata bağlı değil/i.test(poolErr), String(poolErr));
    const missingErr = await err(() => returnService.lookupSackForReturn(`TEST-BRT-YOK-${ts}`));
    check("olmayan çuval kodu 404", missingErr !== null && /bulunamadı/i.test(missingErr), String(missingErr));

    // ---------------------------------------------------------------------
    console.log("\n[2] TOPLU İADE — N defter satırı, TEK grup");
    const bulk = (await returnService.createReturn(
      { rollIds: [r1.id, r2.id, r3.id], reasonText: "TEST — çuval bazlı toplu iade" },
      admin.id,
    )) as { data: { id: string; rollCount?: number } };
    const leaderId = bulk.data.id;
    check("3 top iade alındı", bulk.data.rollCount === 3, String(bulk.data.rollCount));

    const members = await prisma.rollReturn.findMany({
      where: { rollId: { in: [r1.id, r2.id, r3.id] } },
      select: { id: true, returnGroupId: true, rollId: true },
    });
    check("3 defter satırı yazıldı", members.length === 3, String(members.length));
    check("hepsi AYNI grup anahtarını taşıyor", members.every((m) => m.returnGroupId === leaderId), JSON.stringify(members.map((m) => m.returnGroupId)));
    check("lider satırın grup anahtarı KENDİ id'si", members.some((m) => m.id === leaderId && m.returnGroupId === leaderId));

    // ---------------------------------------------------------------------
    console.log("\n[3+4] TEK BELGE, ÇOK KALEMLİ");
    const allDocs = await prisma.printedDocument.count({
      where: { docType: "RETURN_DISPATCH", sourceId: { in: members.map((m) => m.id) } },
    });
    check("toplam 1 belge doğdu (3 değil)", allDocs === 1, String(allDocs));
    const docs = await docRows(leaderId);
    check("belge liderin id'sine bağlı, v1 ACTIVE", docs.length === 1 && docs[0]!.status === "ACTIVE", JSON.stringify(docs.map((d) => [d.version, d.status])));
    const snap1 = docs[0]!.snapshot as unknown as DocSnapshot;
    check("belge 3 kalem taşıyor", snap1.doc.lines?.length === 3, String(snap1.doc.lines?.length));

    // ---------------------------------------------------------------------
    console.log("\n[5] ÜYE id'siyle İKİNCİ BELGE DOĞMAZ");
    const memberId = members.find((m) => m.id !== leaderId)!.id;
    const viaMember = (await printedDocumentService.getCurrent("RETURN_DISPATCH", memberId)) as { data: unknown };
    check("üye id'sinde belge çözülmedi (null)", viaMember.data === null, JSON.stringify(viaMember.data));
    const afterProbe = await prisma.printedDocument.count({
      where: { docType: "RETURN_DISPATCH", sourceId: { in: members.map((m) => m.id) } },
    });
    check("sorgudan sonra da tek belge (lazy-init kopya üretmedi)", afterProbe === 1, String(afterProbe));

    // ---------------------------------------------------------------------
    console.log("\n[6] documentSourceId liste + detayda dönüyor");
    const detail = (await returnService.getReturnById(memberId)) as { data: { documentSourceId: string } };
    check("detay: üye satırı LİDERİ işaret ediyor", detail.data.documentSourceId === leaderId, detail.data.documentSourceId);
    const leaderDetail = (await returnService.getReturnById(leaderId)) as { data: { documentSourceId: string } };
    check("detay: lider kendini işaret ediyor", leaderDetail.data.documentSourceId === leaderId);

    // ---------------------------------------------------------------------
    console.log("\n[7] BİR KALEM İPTAL → belge REVİZE (void DEĞİL)");
    await returnService.cancelReturn(memberId, "TEST — tek kalem iptali", admin.id);
    const docsAfterCancel = await docRows(leaderId);
    check("iki versiyon var", docsAfterCancel.length === 2, JSON.stringify(docsAfterCancel.map((d) => [d.version, d.status])));
    check("v1 SUPERSEDED", docsAfterCancel[0]?.status === "SUPERSEDED", String(docsAfterCancel[0]?.status));
    check("v2 ACTIVE (belge İPTAL EDİLMEDİ)", docsAfterCancel[1]?.status === "ACTIVE", String(docsAfterCancel[1]?.status));
    const snap2 = docsAfterCancel[1]!.snapshot as unknown as DocSnapshot;
    check("revize belge 2 kalem taşıyor", snap2.doc.lines?.length === 2, String(snap2.doc.lines?.length));

    // ---------------------------------------------------------------------
    console.log("\n[8] SON kalemler de iptal → belge VOIDED");
    const remaining = members.filter((m) => m.id !== memberId);
    for (const m of remaining) {
      await returnService.cancelReturn(m.id, "TEST — kalan kalem iptali", admin.id);
    }
    const docsAfterAll = await docRows(leaderId);
    const latest = docsAfterAll[docsAfterAll.length - 1]!;
    check("son versiyon VOIDED", latest.status === "VOIDED", `${latest.version}/${latest.status}`);

    // ---------------------------------------------------------------------
    console.log("\n[9] TEKİL iade davranışı DEĞİŞMEDİ");
    const single = (await returnService.createReturn(
      { rollId: rSingle.id, reasonText: "TEST — tekil iade" },
      admin.id,
    )) as { data: { id: string; rollCount?: number } };
    const singleRow = await prisma.rollReturn.findUnique({
      where: { id: single.data.id },
      select: { returnGroupId: true },
    });
    check("tekil iadede returnGroupId NULL", singleRow?.returnGroupId === null, String(singleRow?.returnGroupId));
    check("tekil yanıtta rollCount YOK", single.data.rollCount === undefined);
    const singleDocs = await docRows(single.data.id);
    const singleSnap = singleDocs[0]!.snapshot as unknown as DocSnapshot;
    check("tekil belgede `lines` alanı HİÇ YOK (eski çıktı korunur)", singleSnap.doc.lines === undefined, JSON.stringify(singleSnap.doc.lines));
    check("tekil belgede `line` alanı duruyor", singleSnap.doc.line != null);

    // ---------------------------------------------------------------------
    console.log("\n[10] Farklı sevkiyatlardan toplar tek belgeye giremez");
    // İKİSİ DE hâlâ SHIPPED — yoksa "bu top sevk edilmemiş" hatası önce düşer ve
    // test aslında karışık-sevkiyat kuralını HİÇ ölçmemiş olur.
    const mixErr = await err(() =>
      returnService.createReturn({ rollIds: [rOther.id, rMix.id], reasonText: "TEST karışık" }, admin.id),
    );
    check("karışık sevkiyat reddedildi", mixErr !== null && /farklı sevkiyat/i.test(mixErr), String(mixErr));
    const mixUntouched = await prisma.roll.findUnique({ where: { id: rMix.id }, select: { status: true } });
    check("reddedilen grupta hiçbir top iade alınmadı", mixUntouched?.status === "SHIPPED", String(mixUntouched?.status));

    // ---------------------------------------------------------------------
    console.log("\n[11] ATOMİKLİK — bir top kapılmışsa TÜM grup geri sarılır");
    const beforeCount = await prisma.rollReturn.count({ where: { customerId: customer.id } });
    // rSingle zaten iade alındı (artık SHIPPED değil) → grup reddedilmeli.
    const atomicErr = await err(() =>
      returnService.createReturn({ rollIds: [rOther.id, rSingle.id] , reasonText: "TEST atomik" }, admin.id),
    );
    check("kapılmış top içeren grup reddedildi", atomicErr !== null, String(atomicErr));
    const afterCount = await prisma.rollReturn.count({ where: { customerId: customer.id } });
    check("hiçbir yeni defter satırı yazılmadı", afterCount === beforeCount, `${beforeCount} → ${afterCount}`);
    const otherStill = await prisma.roll.findUnique({ where: { id: rOther.id }, select: { status: true } });
    check("gruptaki diğer top da DOKUNULMADAN kaldı", otherStill?.status === "SHIPPED", String(otherStill?.status));
  } finally {
    const returnIds = (
      await prisma.rollReturn.findMany({ where: { customerId: customer.id }, select: { id: true } })
    ).map((r) => r.id);
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: returnIds } } });
    await prisma.rollReturn.deleteMany({ where: { customerId: customer.id } });
    await prisma.roll.deleteMany({ where: { itemId: item.id } });
    await prisma.sack.deleteMany({ where: { id: { in: [sack.id, sackB.id, poolSack.id] } } });
    await prisma.shipment.deleteMany({ where: { id: { in: [shipment.id, shipmentB.id] } } });
    await prisma.color.deleteMany({ where: { id: color.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
