// =============================================================================
// ROTA KAPSAMASI — "mal zaten öyle geliyorsa" muafiyeti (2026-08-27)
// =============================================================================
// SAHA BULGUSU: "Hızlı iş emrinde sipariş bağlarsam ve rotada boyahane yoksa
// (sadece kurşun+tambur) hata veriyor; siparişsiz açarsam sorun kalkıyor."
//
// SEBEP: sipariş bağlanınca hedef renk SİPARİŞTEN TÜRETİLİR (`create`,
// `resolvedTargetColorId = onlyColorId`) — planlamacının beyanı değil,
// müşterinin ne istediğidir. Hemen ardından "rotada renk veren adım var mı"
// kontrolü koşuyor ve 400 veriyordu. Dışarıdan boyalı gelen kumaşa yalnız
// kurşun+tambur yapılacaksa rotada boyahane OLMAMASI doğrudur.
//
// KARAR (kullanıcı, dar kapı): kural KALKMIYOR, DARALIYOR — nitelik eldeki
// topların HEPSİNDE zaten varsa kontrol atlanır. Bir kısmında eksikse o toplar
// niteliği hiç kazanamaz, yani kural orada hâlâ gerçek bir planlama hatasını
// yakalıyor.
//
// ⚠️ Bu testin değeri NEGATİF durumlarda: muafiyetin GENİŞLEMEDİĞİNİ ölçer.
// §2/§3/§4 düşerse kapı açılmış demektir.
// =============================================================================

import { RollStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";

const svc = new WorkOrderService();

const rollIds: string[] = [];
const woIds: string[] = [];
const orderIds: string[] = [];
const customerIds: string[] = [];
const itemIds: string[] = [];
const colorIds: string[] = [];

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Reddedilmesi BEKLENEN çağrı — hata mesajını döndürür, geçerse null. */
async function expectReject(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

async function main() {
  const ts = Date.now();
  try {
    // ── Fixture ─────────────────────────────────────────────────────────────
    const item = await prisma.item.create({
      data: { code: `TEST-RCG-ITM-${ts}`, name: `TEST RCG KUMAS ${ts}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    itemIds.push(item.id);
    const color = await prisma.color.create({
      data: { code: `TEST-RCG-CLR-${ts}`, name: `TEST RCG MAVI ${ts}` },
      select: { id: true },
    });
    colorIds.push(color.id);

    // BOYAHANESİZ rota: renk veren hiçbir adım yok (fabrikadaki "Yarı Mamul =
    // Kurşun + Tambur" senaryosunun birebir karşılığı).
    const station = await prisma.station.findFirst({
      where: { isActive: true, appliesColor: false, defaultCategory: null },
      select: { id: true, name: true },
    });
    if (!station) throw new Error("Renk uygulamayan aktif istasyon yok — önce npm run seed.");
    const steps = [{ stationId: station.id, notes: null }];

    const customer = await prisma.customer.create({
      data: { code: `TRCG-${ts}`.slice(0, 32), name: `TEST RCG Müşteri ${ts}` },
      select: { id: true },
    });
    customerIds.push(customer.id);
    // Sipariş satırı RENKLİ — hedef renk buradan türeyecek.
    const order = await prisma.order.create({
      data: {
        orderNumber: `TRCG-ORD-${ts}`,
        customerId: customer.id,
        lines: { create: [{ itemId: item.id, colorId: color.id, quantity: 500, width: 150 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    orderIds.push(order.id);
    const lineId = order.lines[0]!.id;

    const mkRoll = async (rollColorId: string | null, qty = 100) => {
      const r = await prisma.roll.create({
        data: {
          barcode: `TEST-RCG-${ts}-${rollIds.length}`,
          itemId: item.id,
          colorId: rollColorId,
          width: 150,
          initialQty: qty,
          currentQty: qty,
          status: RollStatus.STOCK,
          entrySource: rollColorId
            ? RollEntrySource.SEMI_FINISHED   // dışarıdan boyalı geldi
            : RollEntrySource.SUPPLIER_RECEIPT, // ham
        },
        select: { id: true, barcode: true },
      });
      rollIds.push(r.id);
      return r.barcode as string;
    };

    // ── §1 ASIL VAKA: mal zaten sipariş rengindeyse iş emri AÇILIR ──────────
    const b1 = await mkRoll(color.id);
    const b2 = await mkRoll(color.id);
    const ok = await svc.quickStart({ steps, orderLineIds: [lineId], rollBarcodes: [b1, b2] }, undefined);
    if (ok.data?.workOrder?.id) woIds.push(ok.data.workOrder.id);
    check(
      "boyalı mal + sipariş bağlı + boyahanesiz rota → İŞ EMRİ AÇILIR",
      Boolean(ok.success && ok.data?.workOrder?.id),
      ok.data?.workOrder?.workOrderNumber ?? ok.message,
    );
    check(
      "hedef renk yine de siparişten yazıldı (muafiyet rengi SİLMEZ)",
      ok.data?.workOrder?.targetColorId === color.id,
      `targetColorId=${ok.data?.workOrder?.targetColorId}`,
    );
    check("toplar bağlandı", ok.data?.attached === 2, `attached=${ok.data?.attached}`);

    // ── §2 NEGATİF: mal HAM ise kural hâlâ engeller ─────────────────────────
    // Kuralın asıl işi bu: renk gerçekten uygulanmayacak, plan hatalı.
    const h1 = await mkRoll(null);
    const msg2 = await expectReject(() =>
      svc.quickStart({ steps, orderLineIds: [lineId], rollBarcodes: [h1] }, undefined),
    );
    check(
      "HAM mal + sipariş bağlı + boyahanesiz rota → hâlâ REDDEDİLİR",
      msg2 !== null && /renk veren/i.test(msg2),
      msg2 ?? "REDDEDİLMEDİ (muafiyet fazla genişlemiş)",
    );

    // ── §3 NEGATİF: KARIŞIK küme (biri boyalı, biri ham) → REDDEDİLİR ───────
    // "Hepsi" kuralı load-bearing: ham top rengi hiç kazanamaz.
    const m1 = await mkRoll(color.id);
    const m2 = await mkRoll(null);
    const msg3 = await expectReject(() =>
      svc.quickStart({ steps, orderLineIds: [lineId], rollBarcodes: [m1, m2] }, undefined),
    );
    check(
      "KARIŞIK küme (boyalı + ham) → hâlâ REDDEDİLİR",
      msg3 !== null && /renk veren/i.test(msg3),
      msg3 ?? "REDDEDİLMEDİ (muafiyet 'hepsi' yerine 'herhangi biri' olmuş)",
    );

    // ── §4 NEGATİF: mal bilgisi YOKSA muafiyet de yok ───────────────────────
    // Masaüstü formu top almaz → düz `create` çağrısı. Davranış eskisiyle aynı
    // kalmalı; muafiyetin varsayılanı AÇIK olsaydı burası sessizce gevşerdi.
    const msg4 = await expectReject(() =>
      svc.create({ steps, orderLineIds: [lineId], targetItemId: item.id, type: "ORDER_PRODUCTION" }, undefined),
    );
    check(
      "topsuz create (masaüstü formu) → davranış DEĞİŞMEDİ, reddedilir",
      msg4 !== null && /renk veren/i.test(msg4),
      msg4 ?? "REDDEDİLMEDİ (muafiyet mal bilgisi olmadan da uygulanıyor)",
    );

    // ── §5 Siparişsiz akış bozulmadı ────────────────────────────────────────
    const s1 = await mkRoll(null);
    const noOrder = await svc.quickStart({ steps, rollBarcodes: [s1] }, undefined);
    if (noOrder.data?.workOrder?.id) woIds.push(noOrder.data.workOrder.id);
    check(
      "siparişsiz akış eskisi gibi çalışıyor",
      Boolean(noOrder.success && noOrder.data?.workOrder?.id),
      noOrder.data?.workOrder?.workOrderNumber ?? noOrder.message,
    );
  } finally {
    // FK sırası: hareket/sapma → top → WO → sipariş → müşteri → master data.
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.updateMany({
      where: { id: { in: rollIds } },
      data: { currentStepId: null, batchId: null },
    }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    for (const id of woIds) {
      await prisma.travelerCard.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.batch.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.workOrder.deleteMany({ where: { id } }).catch(() => {});
    }
    await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } }).catch(() => {});
    await prisma.color.deleteMany({ where: { id: { in: colorIds } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
