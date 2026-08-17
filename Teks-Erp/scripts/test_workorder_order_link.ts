// =============================================================================
// Test: Sipariş bağlama MİRAS ALMAZ + renk/en değişimi izli (2026-08-17)
// Çalıştır: npx tsx scripts/test_workorder_order_link.ts
// =============================================================================
// Korunan invariant (saha talebi 8/10/12):
//   "Bir iş emrine sonradan sipariş bağlanınca iş emri siparişten KALITIM
//    YAPMAMALI; uyuşmuyorsa bağlamaya izin verilmemeli."
//
// Neden gerekli: `WorkOrderService.update/replace` yolunda hedef renk sipariş
// satırından yeniden çözülüyor ve açıkça gönderilmezse siparişinki YAZILIYOR.
// Sahadaki sonucu: boyahanede MAVİ işlem gören iş emri, yanlış bir sipariş bağı
// yüzünden EKRU'ya dönüyordu. Yeni uç (`workorder-link.service`) o yolu hiç
// kullanmaz; bu bekçi farkın korunduğunu ölçer.
//
// Kurulum: 1 müşteri + 2 kumaş + 3 renk + siparişler + iş emirleri.
// Temizlik: finally bloğunda, yalnız kendi ürettiklerini siler.
// =============================================================================
import prisma from "../src/lib/prisma";
import { workOrderLinkService } from "../src/services/workorder-link.service";

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

/** Hata bekleyen çağrılar için: mesajı döner, hata YOKSA null. */
async function expectError(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function main(): Promise<void> {
  const ts = Date.now();
  const created: { customers: string[]; items: string[]; colors: string[]; orders: string[]; wos: string[] } = {
    customers: [], items: [], colors: [], orders: [], wos: [],
  };

  try {
    const customer = await prisma.customer.create({
      data: { code: `TEST-WOLINK-CUS-${ts}`, name: `TEST WOLINK MUSTERI ${ts}` },
      select: { id: true },
    });
    created.customers.push(customer.id);

    const [itemA, itemB] = await Promise.all([
      prisma.item.create({
        data: { code: `TEST-WOLINK-ITMA-${ts}`, name: "TEST WOLINK KUMAS A", itemType: "FABRIC", unit: "MT" },
        select: { id: true },
      }),
      prisma.item.create({
        data: { code: `TEST-WOLINK-ITMB-${ts}`, name: "TEST WOLINK KUMAS B", itemType: "FABRIC", unit: "MT" },
        select: { id: true },
      }),
    ]);
    created.items.push(itemA.id, itemB.id);

    const [mavi, ekru, yesil] = await Promise.all([
      prisma.color.create({ data: { code: `TEST-WOLINK-MAVI-${ts}`, name: `TEST MAVI ${ts}` }, select: { id: true } }),
      prisma.color.create({ data: { code: `TEST-WOLINK-EKRU-${ts}`, name: `TEST EKRU ${ts}` }, select: { id: true } }),
      prisma.color.create({ data: { code: `TEST-WOLINK-YESL-${ts}`, name: `TEST YESIL ${ts}` }, select: { id: true } }),
    ]);
    created.colors.push(mavi.id, ekru.id, yesil.id);

    // Sipariş: aynı kumaş+MAVİ (uyumlu), aynı kumaş+EKRU (renk uyuşmaz),
    // farklı kumaş+MAVİ (kumaş uyuşmaz), aynı kumaş+MAVİ ama farklı EN (uyarı).
    const order = await prisma.order.create({
      data: {
        orderNumber: `TEST-WOLINK-ORD-${ts}`,
        customerId: customer.id,
        lines: {
          create: [
            { itemId: itemA.id, colorId: mavi.id, width: 300, quantity: 500 },
            { itemId: itemA.id, colorId: ekru.id, width: 300, quantity: 400 },
            { itemId: itemB.id, colorId: mavi.id, width: 300, quantity: 300 },
            { itemId: itemA.id, colorId: mavi.id, width: 280, quantity: 200 },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true, colorId: true, itemId: true, width: true } } },
    });
    created.orders.push(order.id);
    const lineOk = order.lines.find((l) => l.itemId === itemA.id && l.colorId === mavi.id && Number(l.width) === 300)!;
    const lineWrongColor = order.lines.find((l) => l.colorId === ekru.id)!;
    const lineWrongItem = order.lines.find((l) => l.itemId === itemB.id)!;
    const lineWidthDiff = order.lines.find((l) => Number(l.width) === 280)!;

    // İş emri: MAVİ üretiyor, 300 cm. Boyahanedeymiş gibi IN_PROGRESS.
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TEST-WOLINK-IE-${ts}`,
        status: "IN_PROGRESS",
        type: "STOCK_PRODUCTION",
        targetItemId: itemA.id,
        targetColorId: mavi.id,
        width: 300,
      },
      select: { id: true },
    });
    created.wos.push(wo.id);

    // ── 1) Bağlanabilir liste kumaş+renk süzüyor ────────────────────────────
    const linkable = await workOrderLinkService.getLinkableOrderLines(wo.id);
    const ids = linkable.data.map((l) => l.id);
    check("uyumlu satır listede", ids.includes(lineOk.id));
    check("renk uyuşmayan satır listede DEĞİL", !ids.includes(lineWrongColor.id));
    check("kumaş uyuşmayan satır listede DEĞİL", !ids.includes(lineWrongItem.id));
    check("en farklı satır listede VAR (en engel değil)", ids.includes(lineWidthDiff.id));
    const widthRow = linkable.data.find((l) => l.id === lineWidthDiff.id);
    check(
      "en farkı UYARI olarak işaretli",
      (widthRow?.warnings.length ?? 0) > 0,
      widthRow?.warnings.join(" | ") ?? "uyarı yok",
    );
    check(
      "açık metraj hesaplanıyor",
      linkable.data.find((l) => l.id === lineOk.id)?.openQty === 500,
    );

    // ── 2) Bağlama MİRAS ALMAZ (kararın kalbi) ──────────────────────────────
    const before = await prisma.workOrder.findUnique({
      where: { id: wo.id },
      select: { targetItemId: true, targetColorId: true, width: true },
    });
    await workOrderLinkService.linkOrderLines(wo.id, [lineOk.id]);
    const afterLink = await prisma.workOrder.findUnique({
      where: { id: wo.id },
      select: { targetItemId: true, targetColorId: true, width: true },
    });
    check("bağ kuruldu", (await prisma.workOrderToOrderLine.count({ where: { workOrderId: wo.id } })) === 1);
    check("hedef renk DEĞİŞMEDİ", afterLink?.targetColorId === before?.targetColorId);
    check("hedef kumaş DEĞİŞMEDİ", afterLink?.targetItemId === before?.targetItemId);
    check("en DEĞİŞMEDİ", Number(afterLink?.width) === Number(before?.width));

    // Aynı satırı tekrar bağlamak idempotent (çift satır doğurmaz).
    const again = await workOrderLinkService.linkOrderLines(wo.id, [lineOk.id]);
    check("tekrar bağlama idempotent", again.data.linked === 0 && again.data.alreadyLinked === 1);

    // ── 3) Uyuşmazlık REDDEDİLİR, sessizce çözülmez ─────────────────────────
    const colorErr = await expectError(() =>
      workOrderLinkService.linkOrderLines(wo.id, [lineWrongColor.id]),
    );
    check("renk uyuşmazlığı reddedildi", colorErr !== null);
    check(
      "renk hatası İKİ TARAFI da yazıyor",
      Boolean(colorErr && colorErr.includes("MAVI") && colorErr.includes("EKRU")),
      colorErr ?? "",
    );
    check(
      'renk hatası doğru yolu gösteriyor ("Rengi Değiştir")',
      Boolean(colorErr && colorErr.includes("Rengi Değiştir")),
    );
    const itemErr = await expectError(() =>
      workOrderLinkService.linkOrderLines(wo.id, [lineWrongItem.id]),
    );
    check("kumaş uyuşmazlığı reddedildi", itemErr !== null);
    check(
      "reddedilen bağ YAZILMADI",
      (await prisma.workOrderToOrderLine.count({ where: { workOrderId: wo.id } })) === 1,
    );

    // ── 4) En farkı bağlamayı ENGELLEMEZ, uyarı döner ───────────────────────
    const widthLink = await workOrderLinkService.linkOrderLines(wo.id, [lineWidthDiff.id]);
    check("en farklı satır bağlandı", widthLink.data.linked === 1);
    check("en farkı uyarı olarak döndü", widthLink.data.warnings.length > 0);

    // ── 5) Bağ kaldırma ─────────────────────────────────────────────────────
    await workOrderLinkService.unlinkOrderLine(wo.id, lineWidthDiff.id);
    check(
      "bağ kaldırıldı",
      (await prisma.workOrderToOrderLine.count({ where: { workOrderId: wo.id } })) === 1,
    );

    // Siparişe özel iş emrinin SON bağı korunur.
    await prisma.workOrder.update({ where: { id: wo.id }, data: { type: "ORDER_PRODUCTION" } });
    const lastLinkErr = await expectError(() => workOrderLinkService.unlinkOrderLine(wo.id, lineOk.id));
    check("siparişe özel WO'nun son bağı kaldırılamaz", lastLinkErr !== null, lastLinkErr ?? "");
    await prisma.workOrder.update({ where: { id: wo.id }, data: { type: "STOCK_PRODUCTION" } });

    // ── 6) Rengi Değiştir — sebep zorunlu, iz bırakır ───────────────────────
    const noReason = await expectError(() => workOrderLinkService.changeTargetColor(wo.id, ekru.id, "  "));
    check("sebepsiz renk değişimi reddedildi", noReason !== null);

    const changed = await workOrderLinkService.changeTargetColor(
      wo.id,
      ekru.id,
      "Müşteri telefonla ekru istedi",
    );
    const afterColor = await prisma.workOrder.findUnique({
      where: { id: wo.id },
      select: { targetColorId: true },
    });
    check("renk değişti", afterColor?.targetColorId === ekru.id);
    check(
      "bağlı sipariş çelişkisi UYARI olarak döndü (engel değil)",
      changed.data.warnings.length > 0,
      changed.data.warnings.join(" | "),
    );
    const colorAudit = await prisma.systemLog.findFirst({
      where: { tableName: "WORK_ORDER", recordId: wo.id },
      orderBy: { createdAt: "desc" },
      select: { newData: true },
    });
    const colorAuditData = colorAudit?.newData as Record<string, unknown> | null;
    check("renk değişimi audit'e SEBEBİYLE yazıldı", colorAuditData?.event === "TARGET_COLOR_CHANGED");
    check(
      "audit'te sebep metni duruyor",
      String(colorAuditData?.reason ?? "").includes("telefonla"),
    );

    // Aynı renge tekrar çekmek anlamsız — reddedilir.
    const sameColor = await expectError(() =>
      workOrderLinkService.changeTargetColor(wo.id, ekru.id, "tekrar"),
    );
    check("zaten o renkteyse reddediliyor", sameColor !== null);

    // ── 7) Eni Değiştir ─────────────────────────────────────────────────────
    const widthNoReason = await expectError(() => workOrderLinkService.changeWidth(wo.id, 295, ""));
    check("sebepsiz en değişimi reddedildi", widthNoReason !== null);

    const widthRes = await workOrderLinkService.changeWidth(wo.id, 295, "Kabulde ölçüldü", undefined, "FASON_RECEIPT");
    const afterWidth = await prisma.workOrder.findUnique({
      where: { id: wo.id },
      select: { width: true },
    });
    check("en değişti", Number(afterWidth?.width) === 295);
    check("önceki en döndürüldü", widthRes.data.previousWidth === 300);
    const widthAudit = await prisma.systemLog.findFirst({
      where: { tableName: "WORK_ORDER", recordId: wo.id },
      orderBy: { createdAt: "desc" },
      select: { newData: true },
    });
    const widthAuditData = widthAudit?.newData as Record<string, unknown> | null;
    check("en değişimi audit'te KAYNAĞIYLA duruyor", widthAuditData?.source === "FASON_RECEIPT");

    const badWidth = await expectError(() => workOrderLinkService.changeWidth(wo.id, 5000, "saçma"));
    check("aralık dışı en reddedildi", badWidth !== null);

    // ── 8) İptal edilmiş iş emrinde hiçbiri çalışmaz ────────────────────────
    await prisma.workOrder.update({ where: { id: wo.id }, data: { status: "CANCELLED" } });
    const cancelledLink = await expectError(() => workOrderLinkService.linkOrderLines(wo.id, [lineWidthDiff.id]));
    const cancelledColor = await expectError(() => workOrderLinkService.changeTargetColor(wo.id, yesil.id, "olmaz"));
    const cancelledWidth = await expectError(() => workOrderLinkService.changeWidth(wo.id, 310, "olmaz"));
    check("iptal WO'ya sipariş bağlanamaz", cancelledLink !== null);
    check("iptal WO'da renk değişmez", cancelledColor !== null);
    check("iptal WO'da en değişmez", cancelledWidth !== null);
  } finally {
    // Temizlik — bağımlılık sırasına göre.
    await prisma.systemLog.deleteMany({ where: { recordId: { in: created.wos } } }).catch(() => {});
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: created.wos } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: created.wos } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: created.orders } } });
    await prisma.order.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.color.deleteMany({ where: { id: { in: created.colors } } });
    await prisma.item.deleteMany({ where: { id: { in: created.items } } });
    await prisma.customer.deleteMany({ where: { id: { in: created.customers } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
