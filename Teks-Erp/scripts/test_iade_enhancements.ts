// İade sertleştirme testi — neden zorunluluğu, kalite→iade rafı statüsü (FİRE→SCRAP,
// A1→A1_STOCK), düzelt (PATCH), idempotency, iptal guard'ı (SCRAP raftan geri al).
// Çalıştırma:  npx ts-node scripts/test_iade_enhancements.ts
// Mevcut Customer + Item kullanır; ürettiği Shipment/Roll/RollReturn'leri sonunda temizler.
// returnGradingEnabled flag'ini geçici değiştirir; sonunda ESKİ değerine geri alır.
//
// Doğrulananlar:
//   1.  Neden YOK (reasonId+reasonText boş) → REDDEDİLİR.
//   2.  reasonText ile iade → kabul; top WAREHOUSE; appliedStatus=WAREHOUSE.
//   3.  Aynı top tekrar iade → REDDEDİLİR (idempotency, status≠SHIPPED).
//   4.  Flag AÇIK + FİRE kalite → top SCRAP; appliedStatus=SCRAP.
//   5.  Flag AÇIK + A1 kalite → top A1_STOCK; appliedStatus=A1_STOCK.
//   6.  Flag KAPALI + FİRE kalite gönder → override YOK SAYILIR, top WAREHOUSE.
//   7.  Düzelt: not değişir, neden korunur.
//   8.  Düzelt: nedeni de açıklamayı da boşalt → REDDEDİLİR (neden zorunlu).
//   9.  İptal (SCRAP raftan): top SHIPPED'e geri döner, sevkiyat bağı restore.
//   10. İptal edilmiş iadeyi düzelt → REDDEDİLİR.
//   11. reasonId (katalog) ile iade → kabul.

import { RollStatus, ShipmentStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { returnService } from "../src/services/return.service";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { atlamaDefteri } from "./lib/atlama";

const FLAG_KEY = "return.gradingEnabled";

let pass = 0;
let fail = 0;
// ⚠️ ATLAMA ARTIK SAYILIR VE BEYAN EDİLİR (2026-09-13). Eskiden `check(…, true)`
// ile GEÇTİ sayılıyordu: kapsam kaybı sıfır değil EKSİ idi — kapsanmayan şey
// yeşili ARTIRIYORDU. Bu daldan geçen koşum "ölçtüm" değil "bakamadım" der.
const ATLAMA = atlamaDefteri(() => {
  fail++;
});

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
async function expectReject(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "beklenen hata atılmadı (kabul edildi)");
  } catch (e) {
    check(label, true, `reddedildi: ${(e as Error).message}`);
  }
}

const createdReturns: string[] = [];
const createdRolls: string[] = [];
let createdShipmentId: string | null = null;
let prevFlag: boolean | null = null;

const rnd = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

async function setFlag(on: boolean) {
  await prisma.systemSetting.upsert({
    where: { key: FLAG_KEY },
    update: { value: on },
    create: { key: FLAG_KEY, value: on, description: "test geçici" },
  });
}

async function makeShippedRoll(itemId: string, width: number, shipmentId: string): Promise<string> {
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-IADE-${rnd()}`,
      itemId,
      colorId: null,
      width,
      initialQty: 100,
      currentQty: 100,
      status: RollStatus.SHIPPED,
      qualityGrade: (await roleGrade("FIRST")).code,
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
      shipmentId,
      // Sevk edilmiş top deposunu KORUR (sevkte temizlenmiyor) — deposuz SHIPPED
      // top üretimde doğamaz, fikstür de üretmemeli.
      warehouseId: await fixtureWarehouseId(),
    },
    select: { id: true },
  });
  createdRolls.push(roll.id);
  return roll.id;
}

(async () => {
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const customer = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!item || !customer || !admin) {
    throw new Error("Test verisi yetersiz (item/customer/admin yok) — önce npm run seed.");
  }
  const userId = admin.id;

  // İade rafı ROLDEN çözülür; rafın DEĞERİ fabrikanın yapılandırmasıdır (ön koşul).
  const rowOfRole = async (role: "SCRAP" | "SECOND") => {
    const { id, code } = await roleGrade(role);
    const row = await prisma.qualityGrade.findUniqueOrThrow({ where: { id }, select: { id: true, returnTargetStatus: true } });
    return { ...row, code };
  };
  const gFire = await rowOfRole("SCRAP");
  const gA1 = await rowOfRole("SECOND");
  check(`Ön koşul: ${gFire.code} (fire) iade rafı=SCRAP`, gFire.returnTargetStatus === RollStatus.SCRAP, String(gFire.returnTargetStatus));
  check(`Ön koşul: ${gA1.code} (2. kalite) iade rafı=A1_STOCK`, gA1.returnTargetStatus === RollStatus.A1_STOCK, String(gA1.returnTargetStatus));

  const reason = await prisma.returnReason.findFirst({ select: { id: true } });

  const flagRow = await prisma.systemSetting.findUnique({ where: { key: FLAG_KEY }, select: { value: true } });
  prevFlag = flagRow ? Boolean(flagRow.value) : false;

  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `TEST-SVK-${rnd()}`,
      customerId: customer.id,
      status: ShipmentStatus.DISPATCHED,
      dispatchedAt: new Date(),
    },
    select: { id: true },
  });
  createdShipmentId = shipment.id;

  const WIDTH = 150;
  const r1 = await makeShippedRoll(item.id, WIDTH, shipment.id);
  const r2 = await makeShippedRoll(item.id, WIDTH, shipment.id);
  const r3 = await makeShippedRoll(item.id, WIDTH, shipment.id);
  const r4 = await makeShippedRoll(item.id, WIDTH, shipment.id);
  const r5 = await makeShippedRoll(item.id, WIDTH, shipment.id);

  // 1. Neden yok → reddedilir
  await setFlag(false);
  await expectReject("1. Nedensiz iade reddedilir", () =>
    returnService.createReturn({ rollId: r1, reasonId: null, reasonText: null }, userId)
  );

  // 2. reasonText ile iade → WAREHOUSE, appliedStatus=WAREHOUSE
  const c2 = (await returnService.createReturn({ rollId: r1, reasonText: "test açıklama" }, userId)) as any;
  createdReturns.push(c2.data.id);
  const roll1 = await prisma.roll.findUnique({ where: { id: r1 }, select: { status: true } });
  const rr1 = await prisma.rollReturn.findUnique({ where: { id: c2.data.id }, select: { appliedStatus: true } });
  check("2. Nedenli iade → top WAREHOUSE", roll1?.status === RollStatus.WAREHOUSE, String(roll1?.status));
  check("2. appliedStatus=WAREHOUSE", rr1?.appliedStatus === RollStatus.WAREHOUSE, String(rr1?.appliedStatus));

  // 3. Aynı top tekrar → reddedilir
  await expectReject("3. Çift iade reddedilir (idempotency)", () =>
    returnService.createReturn({ rollId: r1, reasonText: "tekrar" }, userId)
  );

  // 4. Flag açık + FİRE → SCRAP
  await setFlag(true);
  const c4 = (await returnService.createReturn(
    { rollId: r2, reasonText: "hasarlı", qualityGradeId: gFire.id },
    userId
  )) as any;
  createdReturns.push(c4.data.id);
  const roll2 = await prisma.roll.findUnique({ where: { id: r2 }, select: { status: true } });
  const rr2 = await prisma.rollReturn.findUnique({ where: { id: c4.data.id }, select: { appliedStatus: true } });
  check("4. FİRE iade → top SCRAP", roll2?.status === RollStatus.SCRAP, String(roll2?.status));
  check("4. appliedStatus=SCRAP", rr2?.appliedStatus === RollStatus.SCRAP, String(rr2?.appliedStatus));

  // 5. Flag açık + A1 → A1_STOCK
  const c5 = (await returnService.createReturn(
    { rollId: r3, reasonText: "alt kalite", qualityGradeId: gA1.id },
    userId
  )) as any;
  createdReturns.push(c5.data.id);
  const roll3 = await prisma.roll.findUnique({ where: { id: r3 }, select: { status: true } });
  check("5. A1 iade → top A1_STOCK", roll3?.status === RollStatus.A1_STOCK, String(roll3?.status));

  // 6. Flag kapalı + FİRE gönder → override yok sayılır, WAREHOUSE
  await setFlag(false);
  const c6 = (await returnService.createReturn(
    { rollId: r4, reasonText: "flag kapalı", qualityGradeId: gFire.id },
    userId
  )) as any;
  createdReturns.push(c6.data.id);
  const roll4 = await prisma.roll.findUnique({ where: { id: r4 }, select: { status: true } });
  check("6. Flag kapalı → FİRE override yok sayılır (WAREHOUSE)", roll4?.status === RollStatus.WAREHOUSE, String(roll4?.status));

  // 7. Düzelt: not değişir, neden korunur
  await returnService.editReturn(c2.data.id, { note: "düzeltilmiş not" }, userId);
  const rr1e = await prisma.rollReturn.findUnique({ where: { id: c2.data.id }, select: { note: true, reasonText: true } });
  check("7. Düzelt: not güncellendi", rr1e?.note === "düzeltilmiş not", String(rr1e?.note));
  check("7. Düzelt: neden korundu", rr1e?.reasonText === "test açıklama", String(rr1e?.reasonText));

  // 8. Düzelt: nedeni+açıklamayı boşalt → reddedilir
  await expectReject("8. Nedeni boşaltan düzelt reddedilir", () =>
    returnService.editReturn(c2.data.id, { reasonId: null, reasonText: null }, userId)
  );

  // 9. İptal (SCRAP raftan): top SHIPPED'e geri döner
  await returnService.cancelReturn(c4.data.id, "yanlış top okutuldu", userId);
  const roll2c = await prisma.roll.findUnique({ where: { id: r2 }, select: { status: true, shipmentId: true } });
  const rr2c = await prisma.rollReturn.findUnique({ where: { id: c4.data.id }, select: { cancelledAt: true } });
  check("9. SCRAP iade iptali → top SHIPPED", roll2c?.status === RollStatus.SHIPPED, String(roll2c?.status));
  check("9. İptal → sevkiyat bağı restore", roll2c?.shipmentId === shipment.id, String(roll2c?.shipmentId));
  check("9. İptal → cancelledAt set", !!rr2c?.cancelledAt, String(rr2c?.cancelledAt));

  // 10. İptal edilmiş iadeyi düzelt → reddedilir
  await expectReject("10. İptal edilmiş iadeyi düzelt reddedilir", () =>
    returnService.editReturn(c4.data.id, { note: "olmaz" }, userId)
  );

  // 11. reasonId (katalog) ile iade
  if (reason) {
    const c11 = (await returnService.createReturn({ rollId: r5, reasonId: reason.id }, userId)) as any;
    createdReturns.push(c11.data.id);
    check("11. Katalog nedeni (reasonId) ile iade kabul", !!c11.data.id);
  } else {
    ATLAMA.atla("katalog nedeni (reasonId) ile iade", "ReturnReason kaydı yok");
  }

  // ⚠️ ÖZET BİÇİMİ DEĞİŞTİ ve bu SKIP MUHASEBESİNİN ÖTESİNDE bir değişikliktir.
  // Eski hâli `18/18 geçti` idi ve koşucunun `slash` dalına düşüyordu; o biçimin
  // `, N atlandı` için YERİ YOK. Koşucu atlamayı YALNIZ `Sonuç:` satırından okur
  // ve bu BİLEREK böyledir (serbest regex üç dosyada hayalet sayı üretmişti).
  // ⇒ Beyan edilebilmesi için biçim `Sonuç:` kalıbına taşındı.
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
})()
  .catch((e) => {
    console.error("Test hatası:", e);
    fail++;
  })
  .finally(async () => {
    // Temizlik — RollReturn (FK roll) → Roll → Shipment; flag eski değere.
    try {
      if (createdReturns.length) await prisma.rollReturn.deleteMany({ where: { id: { in: createdReturns } } });
      if (createdRolls.length) await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } });
      if (createdShipmentId) await prisma.shipment.delete({ where: { id: createdShipmentId } });
      if (prevFlag !== null) await setFlag(prevFlag);
    } catch (e) {
      console.error("Temizlik hatası:", (e as Error).message);
    }
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  });
