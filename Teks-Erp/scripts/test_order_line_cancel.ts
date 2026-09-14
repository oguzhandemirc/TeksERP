// =============================================================================
// TeksERP - Sipariş kalemi iptali bekçisi
// =============================================================================
// Kullanıcının dört kuralı, dördü de burada kilitli:
//
// ① SOFT: kalem SİLİNMEZ, listede kalır ve SEVK EDİLMİŞ metrajı defterde durur.
//    Hard-delete edilseydi çıkmış mal kayıtlardan silinir, sevkiyat mutabakatı
//    (`test_consistency` §1) sessizce bozulurdu.
// ② İŞ EMRİ BAĞI OTOMATİK KOPAR; son bağsa iş emri STOK üretimine döner
//    ("tip = bağın aynası" invariantı, 2026-08-21).
// ③ KISMİ SEVK GÖRMÜŞ KALEM İPTAL EDİLEBİLİR ("kalanı iptal"): sevk edilen
//    geçerli sayılır, kalan düşer ve sipariş KAPANABİLİR. `recomputeOrderStatusTx`
//    iptal kalemin `quantity`sini değil `shipped`ini toplama katar — aksi halde
//    sipariş o farkı asla kapatamaz ve sonsuza dek "kısmi sevk" görünürdü.
// ④ SON AKTİF KALEM: sevk varsa sipariş COMPLETED, yoksa CANCELLED.
//
// ⑤ Ayrıca: iptal edilmiş kalem "açık talep" yüzeylerinden DÜŞER (WO picker,
//    üretim dengesi). Bu, özelliğin en kolay unutulan yarısıdır — kolon eklemek
//    kolay, 33 sorgu noktasını taramak zor.
// =============================================================================

import prisma from "../src/lib/prisma";
import { ACTIVE_ORDER_LINK } from "../src/services/helpers/order-link.helper";
import { orderService } from "../src/routes/order.routes";
import { ProductionBalanceService } from "../src/services/production-balance.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main(): Promise<void> {
  const ts = Date.now();
  const TAG = `TEST-OLC-${ts}`;
  // Defter satırları (SackAllocation · WorkOrderToOrderLine) KİMLİKLE silinir — id'ler burada toplanır (§10b).
  const sackIds: string[] = [];
  const woIds: string[] = [];

  try {
    const customer = await prisma.customer.create({
      data: { code: `${TAG}-C`, name: `${TAG} MUSTERI` },
      select: { id: true },
    });
    const item = await prisma.item.create({
      data: { code: `${TAG}-I`, name: `${TAG} KUMAS`, itemType: "FABRIC" },
      select: { id: true },
    });

    let seq = 0;
    const mkOrder = async (lines: Array<{ quantity: number; shippedQty?: number }>) =>
      prisma.order.create({
        data: {
          orderNumber: `${TAG}-${String(++seq).padStart(3, "0")}`,
          customerId: customer.id,
          status: "APPROVED",
          lines: { create: lines.map((l) => ({ itemId: item.id, ...l })) },
        },
        select: { id: true, lines: { select: { id: true }, orderBy: { quantity: "asc" } } },
      });
    const readOrder = (id: string) =>
      prisma.order.findUniqueOrThrow({
        where: { id },
        select: { status: true, cancelledAt: true, shippedQty: true },
      });
    const readLine = (id: string) =>
      prisma.orderLine.findUniqueOrThrow({
        where: { id },
        select: { cancelledAt: true, shippedQty: true, quantity: true, cancelReasonCode: true },
      });

    // ── 1) Çok kalemli siparişte tek kalemi iptal ──
    console.log("\n── 1) 3 kalemden 1'ini iptal ──");
    const o1 = await mkOrder([{ quantity: 100 }, { quantity: 200 }, { quantity: 300 }]);
    const victim = o1.lines[0]!.id;
    await orderService.cancelOrderLine(o1.id, victim, undefined, {
      reasonCode: "MUSTERI_DEGISIKLIK",
      reasonText: "Müşteri sipariş içeriğini değiştirmek istedi — yeni siparişle devam edildi",
    });
    const l1 = await readLine(victim);
    check("kalem iptal damgalı", l1.cancelledAt !== null);
    check("sebep kodu yazıldı", l1.cancelReasonCode === "MUSTERI_DEGISIKLIK", `${l1.cancelReasonCode}`);
    check("kalem SİLİNMEDİ (soft)", (await prisma.orderLine.count({ where: { id: victim } })) === 1);
    const others = await prisma.orderLine.count({ where: { orderId: o1.id, cancelledAt: null } });
    check("diğer 2 kalem aktif kaldı", others === 2, `${others}`);
    check("sipariş hâlâ açık", (await readOrder(o1.id)).status === "APPROVED");

    // ── 2) İş emri bağı otomatik kopar + WO STOK'a döner ──
    console.log("\n── 2) İş emri bağı ──");
    const o2 = await mkOrder([{ quantity: 500 }]);
    const line2 = o2.lines[0]!.id;
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `${TAG}-IE1`,
        type: "ORDER_PRODUCTION",
        status: "PLANNED",
        targetItemId: item.id, // hedef kumaş VAR → STOK'a dönebilir
        orderLinks: { create: [{ orderLineId: line2 }] },
      },
      select: { id: true },
    });
    woIds.push(wo.id);
    const prev = (await orderService.getLineCancelPreview(o2.id, line2)).data as {
      canCancel: boolean;
      affectedWorkOrders: Array<{ workOrderNumber: string; willBecomeStock: boolean }>;
      isLastActiveLine: boolean;
      resultingOrderStatus: string | null;
    };
    check("önizleme iptale izin veriyor", prev.canCancel);
    check("etkilenen iş emri LİSTELENDİ", prev.affectedWorkOrders.length === 1, `${prev.affectedWorkOrders.length}`);
    check("son bağ → 'stok üretimine döner' uyarısı", prev.affectedWorkOrders[0]?.willBecomeStock === true);
    check("son aktif kalem tespit edildi", prev.isLastActiveLine === true);
    check("sevk yoksa sipariş İPTAL olacağı önizlemede yazılı", prev.resultingOrderStatus === "CANCELLED", `${prev.resultingOrderStatus}`);

    await orderService.cancelOrderLine(o2.id, line2);
    const links = await prisma.workOrderToOrderLine.count({ where: { workOrderId: wo.id, ...ACTIVE_ORDER_LINK } });
    check("bağ koparıldı (açık bağ 0)", links === 0, `${links}`);
    check("koparılan bağ SİLİNMEDİ — ORDER_LINE_CANCEL damgalı (③a)",
      (await prisma.workOrderToOrderLine.count({ where: { workOrderId: wo.id, unlinkedAt: { not: null }, unlinkReason: "ORDER_LINE_CANCEL" } })) === 1);
    const woAfter = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id }, select: { type: true } });
    check("iş emri STOK üretimine döndü", woAfter.type === "STOCK_PRODUCTION", woAfter.type);

    // ── 3) Son kalem + sevk YOK → sipariş CANCELLED ──
    console.log("\n── 3) Son kalem, sevk yok → sipariş İPTAL ──");
    const o2after = await readOrder(o2.id);
    check("sipariş CANCELLED", o2after.status === "CANCELLED", o2after.status);
    check("sipariş iptal damgası da atıldı", o2after.cancelledAt !== null);

    // ── 4) Son kalem + sevk VAR → sipariş COMPLETED ──
    console.log("\n── 4) Son kalem, sevk var → sipariş TAMAMLANDI ──");
    const o3 = await mkOrder([{ quantity: 100 }]);
    const line3 = o3.lines[0]!.id;
    // ⚠️ Denormu ELLE yazmak İŞE YARAMAZ: `shippedQty` defter-otoritatiftir ve
    // `recomputeOrderStatusTx` onu her çağrıda SackAllocation'lardan yeniden
    // hesaplar (şemadaki "tek yazma noktası" notu). Gerçek sevk zinciri kurulur.
    const shipment = await prisma.shipment.create({
      data: { shipmentNo: `${TAG}-SHP`, customerId: customer.id, status: "DISPATCHED", dispatchedAt: new Date() },
      select: { id: true },
    });
    const sack = await prisma.sack.create({
      data: { sackNo: `${TAG}-CV`, customerId: customer.id, shipmentId: shipment.id },
      select: { id: true },
    });
    sackIds.push(sack.id);
    await prisma.sackAllocation.create({ data: { sackId: sack.id, orderLineId: line3, qty: 40 } });
    await orderService.cancelOrderLine(o3.id, line3);
    const o3after = await readOrder(o3.id);
    const l3 = await readLine(line3);
    check("sevk edilmiş metraj SİLİNMEDİ", Number(l3.shippedQty) === 40, `${l3.shippedQty}`);
    check("istenen metraj olduğu gibi duruyor", Number(l3.quantity) === 100, `${l3.quantity}`);
    check(
      "sipariş TAMAMLANDI (kalan 60 beklenmiyor)",
      o3after.status === "COMPLETED",
      `${o3after.status} — PARTIAL_SHIPPED ise iptal kalemin quantity'si hâlâ toplamda`,
    );

    // ── 4b) AKTİF KALEM KALIRKEN aritmetik (sondanın gördüğü tek yer) ──
    //
    // ⚠️ §4 bu regresyonu YAKALAYAMAZ: orada tek kalem vardı, yani "hepsi
    // iptal" dalı devreye giriyor ve statüyü doğrudan COMPLETED yapıyor —
    // `totalRequired` aritmetiği hiç gözlenmiyor. Ölçüldü: `quantity` ↔
    // `shipped` ayrımı silinince §4 hâlâ YEŞİL kalıyordu.
    //
    // Aritmetik ancak SİPARİŞTE AKTİF KALEM KALIRKEN görünür:
    //   A: 100 istendi, 100 sevk edildi  → aktif, tam karşılandı
    //   B:  50 istendi,  20 sevk edildi  → İPTAL ("kalan 30 beklenmiyor")
    //   doğru : totalRequired = 100 + 20 = 120 = sevk → COMPLETED
    //   yanlış: totalRequired = 100 + 50 = 150 > 120 → PARTIAL_SHIPPED (kapanmaz)
    console.log("\n── 4b) Aktif kalem kalırken iptal aritmetiği ──");
    const o6 = await mkOrder([{ quantity: 50 }, { quantity: 100 }]);
    const lineB = o6.lines[0]!.id; // 50
    const lineA = o6.lines[1]!.id; // 100
    const sh2 = await prisma.shipment.create({
      data: { shipmentNo: `${TAG}-SHP2`, customerId: customer.id, status: "DISPATCHED", dispatchedAt: new Date() },
      select: { id: true },
    });
    const sk2 = await prisma.sack.create({
      data: { sackNo: `${TAG}-CV2`, customerId: customer.id, shipmentId: sh2.id },
      select: { id: true },
    });
    sackIds.push(sk2.id);
    await prisma.sackAllocation.create({ data: { sackId: sk2.id, orderLineId: lineA, qty: 100 } });
    await prisma.sackAllocation.create({ data: { sackId: sk2.id, orderLineId: lineB, qty: 20 } });
    await orderService.cancelOrderLine(o6.id, lineB);
    const o6after = await readOrder(o6.id);
    const aktifKalan = await prisma.orderLine.count({ where: { orderId: o6.id, cancelledAt: null } });
    check("siparişte AKTİF kalem kaldı (hepsi-iptal dalı devre dışı)", aktifKalan === 1, `${aktifKalan}`);
    check(
      "sipariş KAPANDI — iptal kalemin kalan 30'u beklenmiyor",
      o6after.status === "COMPLETED",
      `${o6after.status} — PARTIAL_SHIPPED ise iptal kalem hâlâ quantity ile sayılıyor`,
    );
    check("sevk toplamı 120", Number(o6after.shippedQty) === 120, `${o6after.shippedQty}`);

    // ── 5) Tamamı sevk edilmiş kalem iptal EDİLEMEZ ──
    console.log("\n── 5) Tamamı sevk edilmiş kalem ──");
    const o4 = await mkOrder([{ quantity: 100 }, { quantity: 50 }]);
    const full = o4.lines[1]!.id; // quantity 100 (asc sıralı: 50, 100)
    await prisma.orderLine.update({ where: { id: full }, data: { shippedQty: 100 } });
    const prevFull = (await orderService.getLineCancelPreview(o4.id, full)).data as {
      canCancel: boolean;
      blockers: string[];
    };
    check("önizleme reddediyor", prevFull.canCancel === false);
    check("sebep yazılı (iade yoluna yönlendiriyor)", prevFull.blockers.some((b) => b.includes("iade")), prevFull.blockers.join(" | "));
    let rejected = false;
    try {
      await orderService.cancelOrderLine(o4.id, full);
    } catch {
      rejected = true;
    }
    check("iptal reddedildi", rejected);

    // ── 6) Mükerrer iptal → 409 (atomik claim) ──
    console.log("\n── 6) Mükerrer iptal ──");
    let conflict = false;
    try {
      await orderService.cancelOrderLine(o1.id, victim);
    } catch (e) {
      conflict = (e as { statusCode?: number }).statusCode === 400 || (e as { statusCode?: number }).statusCode === 409;
    }
    check("zaten iptal edilmiş kalem tekrar iptal edilemez", conflict);

    // ── 7) Hedef kumaşsız iş emri → SERT ENGEL ──
    console.log("\n── 7) Hedef kumaşsız iş emrinin son bağı ──");
    const o5 = await mkOrder([{ quantity: 700 }]);
    const line5 = o5.lines[0]!.id;
    const wo2 = await prisma.workOrder.create({
      data: {
        workOrderNumber: `${TAG}-IE2`,
        type: "ORDER_PRODUCTION",
        status: "PLANNED",
        // targetItemId YOK → STOK üretimine dönemez
        orderLinks: { create: [{ orderLineId: line5 }] },
      },
    });
    woIds.push(wo2.id);
    const prev5 = (await orderService.getLineCancelPreview(o5.id, line5)).data as {
      canCancel: boolean;
      blockers: string[];
    };
    check("önizleme engelliyor", prev5.canCancel === false);
    check("sebep 'hedef kumaş' diyor", prev5.blockers.some((b) => b.includes("hedef kumaş")), prev5.blockers.join(" | "));

    // ── 8) İptal edilmiş kalem AÇIK TALEP yüzeylerinden düşer ──
    console.log("\n── 8) Talep yüzeylerinden düşüyor mu ──");
    const balance = (await new ProductionBalanceService().getBalance({ itemId: item.id })).data ?? [];
    const talep = balance.reduce((s, g) => s + Number(g.talep), 0);
    // Aktif kalan talep:
    //   o1 → 200 + 300            = 500  (100'lük kalem iptal)
    //   o2 → 0                          (sipariş CANCELLED, tamamen kapsam dışı)
    //   o3 → 0                          (sipariş COMPLETED, kapsam dışı)
    //   o4 → 50 + (100−100)       =  50
    //   o5 → 700                        (iptali ENGELLENDİ → hâlâ aktif talep)
    //                              = 1250
    // İptal edilen 100 + 500 + 100 buraya GİRMEMELİ.
    check(
      "üretim dengesi yalnız aktif kalemleri sayıyor (1250)",
      talep === 1250,
      `${talep} — 1950 civarıysa iptal edilmiş kalemler hâlâ talep sayılıyor`,
    );
    const picker = (await orderService.findAvailableOrderLines({ itemId: item.id, limit: 50 })) as {
      // ⚠️ Picker satırları `id` DEĞİL `lineId` taşır (sipariş+kalem alanlarını
      // tek düzlemde birleştirdiği için ad çakışmasın diye).
      data?: Array<{ lineId: string }>;
    };
    const pickedIds = (picker.data ?? []).map((l) => l.lineId);
    check("WO picker iptal edilmiş kalemi göstermiyor", !pickedIds.includes(victim));
    check("WO picker aktif kalemleri gösteriyor", pickedIds.includes(o1.lines[1]!.id));
    // ── 9) Sipariş DÜZENLEME iptal edilmiş kaleme dokunamaz ──
    //
    // İki sessiz tehlike: ① kalem payload'da yoksa diff onu SİLER (iptal olgusu
    // ve sevk metrajı kaybolur), ② payload'da varsa metrajı DEĞİŞTİRİLEBİLİR
    // (kapanmış kararın geçmişi yeniden yazılır). İkisi de sunucuda kapalı.
    console.log("\n── 9) Düzenleme iptal edilmiş kaleme dokunamaz ──");
    const o7 = await mkOrder([{ quantity: 10 }, { quantity: 20 }]);
    const keep = o7.lines[1]!.id; // 20
    const killed = o7.lines[0]!.id; // 10
    await orderService.cancelOrderLine(o7.id, killed);

    // ① İptal edilmiş kalem payload'da YOK — silinmemeli.
    await orderService.update(o7.id, {
      lines: [{ id: keep, itemId: item.id, quantity: 25 }],
    } as unknown as Record<string, unknown>);
    const survived = await prisma.orderLine.findUnique({
      where: { id: killed },
      select: { quantity: true, cancelledAt: true },
    });
    check("payload'da olmayan iptal kalem SİLİNMEDİ", survived !== null);
    check("iptal damgası duruyor", survived?.cancelledAt != null);
    check("aktif kalem güncellendi (25)", Number((await readLine(keep)).quantity) === 25, `${(await readLine(keep)).quantity}`);

    // ② İptal edilmiş kalem payload'da VAR ve metrajı değiştirilmiş — yutulmalı.
    // ⚠️ Satır ① düştüyse burada ARTIK YOKTUR; `findUniqueOrThrow` ile okumak
    // testi ÇÖKERTİR ve "Sonuç" satırı hiç basılmaz. Çöken test, kırmızı testten
    // kötü bir sinyaldir (koşucu onu zaman aşımı/çökme diye raporlar, hangi
    // invariantın kırıldığını söylemez). Bu yüzden okuma savunmalı.
    await orderService.update(o7.id, {
      lines: [
        { id: keep, itemId: item.id, quantity: 25 },
        { id: killed, itemId: item.id, quantity: 9999 },
      ],
    } as unknown as Record<string, unknown>).catch(() => undefined);
    const killedNow = await prisma.orderLine.findUnique({
      where: { id: killed },
      select: { quantity: true },
    });
    check(
      "iptal kalemin metrajı DEĞİŞMEDİ (10)",
      killedNow !== null && Number(killedNow.quantity) === 10,
      killedNow === null ? "satır silinmiş" : `${killedNow.quantity} — 9999 ise salt-okunurluk yok`,
    );

  } finally {
    if (sackIds.length > 0) await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } });
    await prisma.sack.deleteMany({ where: { sackNo: { startsWith: TAG } } });
    await prisma.shipment.deleteMany({ where: { shipmentNo: { startsWith: TAG } } });
    if (woIds.length > 0) await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { workOrderNumber: { startsWith: TAG } } });
    await prisma.order.deleteMany({ where: { orderNumber: { startsWith: TAG } } });
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.item.deleteMany({ where: { code: { startsWith: TAG } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
