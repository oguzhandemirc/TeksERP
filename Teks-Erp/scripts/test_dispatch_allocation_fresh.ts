// =============================================================================
// BEKÇİ — SEVK ANINDA TAHSİS TAZE HESAPLANIR (BULGU-T3-009)
// Çalıştır: npx tsx scripts/test_dispatch_allocation_fresh.ts
// =============================================================================
// Tahsis sevkiyat KURULURKEN hesaplanıyor ve sevk anına kadar donuyordu. Araya
// giren bir storno + sipariş düzeltmesi rakamı bayatlatıyordu:
//
//   T0 sevkiyat DISPATCHED — 500 m, siparişin 500 m'lik kalemine tahsisli
//   T1 storno → sevkiyat PLANNED'a döner; tahsis satırları BİLİNÇLİ korunur
//   T2 satış aynı kalemi 200 m'ye düşürür
//   T3 "Sevk Et" → bayat 500 m `shippedQty`ye terfi eder
//
// Sonuç: 200 m'lik kaleme 500 m sevk yazılır. "Açık" −300 m çıkar ve arayüz onu
// 0'a kelepçelediği için FAZLA SEVK HİÇBİR EKRANDA GÖRÜNMEZ; muhasebe fişinde
// 500 m fiyatlanır. İhlal edilen değişmez: INV-SEV-08 (Σ sevk ≤ kalem miktarı).
//
// ⚠️ DÜZELTME ÇIKIŞI ENGELLEMEZ — ölçüldü: `allocation.helper` içinde TEK BİR
// `throw` yok; talebi aşan mal tahsissiz kalır. Mal her hâlükârda çıkar, değişen
// tek şey deftere yazılan rakamdır. Bu bekçi ONU da ölçer (§3): "engellemiyor"
// iddiası test edilmeden bırakılmaz.
//
// §1 TAZELİK  — dispatch → undo → kalemi düşür → yeniden dispatch: Σ tahsis ≤ miktar
// §2 GÖRÜNÜRLÜK — tahsis edilemeyen metraj audit'e yazılır (sessizlik yerine sessizlik olmasın)
// §3 ESNEKLİK — talep küçülse de sevk YAPILABİLİR (mal çıkar, engellenmez)
// =============================================================================
import { ItemType, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";

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

const STAMP = `TSTALC${Date.now().toString().slice(-7)}`;
const svc = new ShippingService();
const temizle = { sack: [] as string[], roll: [] as string[], order: [] as string[], shipment: [] as string[], customer: [] as string[], item: [] as string[] };
let ADMIN = "";

async function main(): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) throw new Error("fixture eksik: admin");
  ADMIN = admin.id;

  const musteri = await prisma.customer.create({
    data: { code: `${STAMP}C`.slice(0, 30), name: `${STAMP} müşteri` },
    select: { id: true },
  });
  temizle.customer.push(musteri.id);
  const kumas = await prisma.item.create({
    data: { code: `${STAMP}I`.slice(0, 30), name: `${STAMP} kumaş`, itemType: ItemType.FABRIC },
    select: { id: true },
  });
  temizle.item.push(kumas.id);

  // Sipariş: 500 m'lik tek kalem.
  const siparis = await prisma.order.create({
    data: {
      orderNumber: `${STAMP}-SIP`.slice(0, 30),
      customerId: musteri.id,
      status: "APPROVED",
      lines: { create: [{ itemId: kumas.id, quantity: 500 }] },
    },
    include: { lines: true },
  });
  temizle.order.push(siparis.id);
  const kalemId = siparis.lines[0]!.id;

  // Depoda 500 m'lik tek çuval.
  const cuval = await prisma.sack.create({
    data: { sackNo: `${STAMP}-CV`.slice(0, 30), customerId: musteri.id },
    select: { id: true },
  });
  temizle.sack.push(cuval.id);
  const top = await prisma.roll.create({
    data: {
      barcode: `${STAMP}-R`.slice(0, 30),
      itemId: kumas.id,
      initialQty: 500,
      currentQty: 500,
      status: RollStatus.WAREHOUSE,
      sackId: cuval.id,
      createdById: ADMIN,
    },
    select: { id: true },
  });
  temizle.roll.push(top.id);

  // ── Sevkiyat kur + sevk et ────────────────────────────────────────────────
  const kur = (await svc.createShipment(
    { customerId: musteri.id, sackIds: [cuval.id], orderIds: [siparis.id] },
    ADMIN,
  )) as { data: { id: string; dispatched?: boolean } };
  const sevkId = kur.data.id;
  temizle.shipment.push(sevkId);
  // ⚠️ Anında sevk `shipping.confirmationEnabled` bayrağına bağlıdır — test onu
  // DEĞİŞTİRMEZ (proje kuralı: bekçiler feature-flag'e dokunmaz). Bu yüzden
  // sevkiyat hâlâ PLANNED ise AÇIKÇA sevk edilir; böylece kontrol ortamdaki
  // bayrak durumundan BAĞIMSIZ olur.
  const kurulan = await prisma.shipment.findUnique({ where: { id: sevkId }, select: { status: true } });
  if (kurulan?.status !== "DISPATCHED") await svc.dispatchShipment(sevkId, {}, ADMIN);

  const ilkTahsis = await prisma.sackAllocation.aggregate({
    where: { sack: { shipmentId: sevkId } },
    _sum: { qty: true },
  });
  check("§0: ilk sevkte 500 m siparişe tahsis edildi (körlük zemini)", Number(ilkTahsis._sum.qty ?? 0) === 500, `${ilkTahsis._sum.qty}`);

  // ── Storno → kalem 200'e düşürülür → yeniden sevk ─────────────────────────
  // ⚠️ `releaseSacks` GÖNDERİLMEZ: sevkiyat PLANNED'da kalsın ve tahsis satırları
  // BİLİNÇLİ olarak korunsun — bulgunun tarif ettiği tam durum budur.
  await svc.undoDispatch(sevkId, `${STAMP} yanlis arac yuklendi`, ADMIN);
  await prisma.orderLine.update({ where: { id: kalemId }, data: { quantity: 200 } });
  const yeniden = await svc.dispatchShipment(sevkId, {}, ADMIN).then(
    () => ({ ok: true }),
    (e: unknown) => ({ ok: false, err: String((e as Error).message).slice(0, 80) }),
  );

  // ═══ §3 — ESNEKLİK: sevk ENGELLENMEDİ ═══
  check("§3: talep küçülse de sevk YAPILABİLİR (mal çıkar)", yeniden.ok, JSON.stringify(yeniden));

  // ═══ §1 — TAZELİK ═══
  const sonTahsis = await prisma.sackAllocation.aggregate({
    where: { sack: { shipmentId: sevkId } },
    _sum: { qty: true },
  });
  const kalem = await prisma.orderLine.findUnique({ where: { id: kalemId }, select: { quantity: true, shippedQty: true } });
  const toplam = Number(sonTahsis._sum.qty ?? 0);
  check(
    "§1: Σ tahsis ≤ kalem miktarı (INV-SEV-08)",
    toplam <= Number(kalem?.quantity ?? 0),
    `tahsis=${toplam} · miktar=${kalem?.quantity}`,
  );
  check(
    "§1: `shippedQty` bayat 500'ü DEĞİL taze 200'ü taşıyor",
    Number(kalem?.shippedQty ?? 0) <= 200,
    `shippedQty=${kalem?.shippedQty}`,
  );

  // ═══ §2 — GÖRÜNÜRLÜK ═══
  const iz = await prisma.systemLog.findFirst({
    where: { tableName: "SACK_ALLOCATION", recordId: sevkId },
    orderBy: { createdAt: "desc" },
    select: { newData: true },
  });
  const payload = JSON.stringify(iz?.newData ?? {});
  check("§2: tahsis yeniden yazımı audit'e düştü", iz != null);
  check(
    "§2: TAHSİSSİZ metraj kayda geçti (sessizliğin yerine sessizlik konmadı)",
    payload.includes("tahsissizMetraj"),
    payload.slice(0, 90),
  );
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.sackAllocation.deleteMany({ where: { sack: { id: { in: temizle.sack } } } }).catch(() => undefined);
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: temizle.shipment } } }).catch(() => undefined);
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: temizle.roll } } }).catch(() => undefined);
    await prisma.roll.deleteMany({ where: { id: { in: temizle.roll } } }).catch(() => undefined);
    await prisma.sack.deleteMany({ where: { id: { in: temizle.sack } } }).catch(() => undefined);
    await prisma.shipment.deleteMany({ where: { id: { in: temizle.shipment } } }).catch(() => undefined);
    await prisma.orderLine.deleteMany({ where: { orderId: { in: temizle.order } } }).catch(() => undefined);
    await prisma.order.deleteMany({ where: { id: { in: temizle.order } } }).catch(() => undefined);
    await prisma.item.deleteMany({ where: { id: { in: temizle.item } } }).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { id: { in: temizle.customer } } }).catch(() => undefined);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
