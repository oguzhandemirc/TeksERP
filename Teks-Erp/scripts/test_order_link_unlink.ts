// =============================================================================
// BEKÇİ — İŞ EMRİ ↔ SİPARİŞ KALEMİ BAĞI KOPARILIR, SİLİNMEZ (③a, WOTOL-BAG-DAMGA-PLAN)
// Çalıştır: npx tsx scripts/run-all-tests.ts order_link_unlink
// =============================================================================
// NEDEN: `WorkOrderToOrderLine` beş yolda `delete/deleteMany` ile siliniyordu;
// "bu iş emri hangi sipariş için açıldı" olgusu iz bırakmadan kayboluyordu (K5
// şerhi FK Cascade'i kapatmış, uygulama katmanı aynı kaybı üretiyordu). Damgaya
// geçince okuyan tek bir yol süzgeci unutursa koparılmış bağ "açık" sayılır —
// iş emri tipi, sipariş kilidi, refakat kartı sipariş bloğu yanlış olur.
//
// ÖLÇÜLENLER
//   §1 Koparma satırı SİLMEZ; damga üçlüsü (unlinkedAt · unlinkedById · unlinkReason),
//      `createdAt`/`allocatedQty` değişmez
//   §2 ⭐ Yeniden bağlama YENİ satırdır: açık 1 / toplam 2 (un-unlink YOK)
//   §3 ⭐ İKİ AÇIK satır yazılamaz — partial unique sed görevde (P2002)
//   §4 `WorkOrder.type` aynası AÇIK bağ sayısından: kopar → STOK, bağla → SİPARİŞ
//   §5 Sipariş tarafı okurları koparılmış bağı görmez (`workOrderLinks` süzgeçli)
//   §6 Refakat kartı sipariş bloğu canlı (açık) bağdan doğar
//   §7 `replace()` FARK bazlı: kalan bağın satır id'si ve `createdAt`i korunur,
//      çıkan `WO_REPLACE` ile damgalanır, giren yeni satır
//   §1b ⭐ seçicisiz `unlinkOrderLinesTx` fırlatır (bütün tabloyu damgalama yolu kapalı)
//   §8 ⭐ `withActiveOrderLinks` yalnız DÜZ nesneye iner: Date/Decimal/Buffer birebir
//      (tam paket 2026-09-14: `{ gte: Date }` → `{ gte: {} }` → Prisma _ref 500)
//   §13 AST + tip denetleyicisi: her okuma/ilişki/ham SQL `ACTIVE_ORDER_LINK`
//      taşır; src'de `workOrderToOrderLine.delete*` YOK
// =============================================================================
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import { ACTIVE_ORDER_LINK, activeOrderLinkCount, unlinkOrderLinesTx, withActiveOrderLinks } from "../src/services/helpers/order-link.helper";
import { workOrderLinkService } from "../src/services/workorder-link.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { aktifYuklemTara } from "./revoke-ast-tarama";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const ts0 = Date.now();
const TAG = `TEST-OLU-${ts0}`;
const woIds: string[] = [];
const orderIds: string[] = [];
const stationIds: string[] = [];
let itemId = "";
let customerId = "";

async function main(): Promise<void> {
  console.log("\n=== İş emri ↔ sipariş bağı: koparılır, silinmez ===\n");
  const admin = await ensureTestAdmin();
  const wos = new WorkOrderService();
  const cards = new TravelerCardService();

  customerId = (await prisma.customer.create({ data: { code: `${TAG}-CUS`, name: `${TAG} müşteri` }, select: { id: true } })).id;
  itemId = (await prisma.item.create({ data: { code: `${TAG}-ITM`, name: `${TAG} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  const order = await prisma.order.create({
    data: { orderNumber: `${TAG}-ORD`, customerId, lines: { create: [
      { itemId, width: 300, quantity: 500 }, { itemId, width: 300, quantity: 300 }, { itemId, width: 300, quantity: 200 },
    ] } },
    select: { id: true, lines: { select: { id: true }, orderBy: { quantity: "desc" } } },
  });
  orderIds.push(order.id);
  const [l1, l2, l3] = order.lines.map((l) => l.id) as [string, string, string];
  const station = await prisma.station.create({ data: { code: `${TAG}-ST`, name: `${TAG} istasyon`, type: "INTERNAL", kind: "OTHER" }, select: { id: true } });
  stationIds.push(station.id);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-IE`, status: "PLANNED", type: "STOCK_PRODUCTION", targetItemId: itemId, width: 300, targetQuantity: 100,
      steps: { create: [{ stationId: station.id, stepSequence: 1, status: "PENDING" }] } },
    select: { id: true },
  });
  woIds.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, admin.id));

  // ── §1 ────────────────────────────────────────────────────────────────────
  console.log("── §1 Koparma SİLMEZ ──");
  await workOrderLinkService.linkOrderLines(wo.id, [l1, l2], admin.id);
  const before = await prisma.workOrderToOrderLine.findFirstOrThrow({ where: { workOrderId: wo.id, orderLineId: l1 }, select: { id: true, createdAt: true, allocatedQty: true } });
  const res1 = await workOrderLinkService.unlinkOrderLine(wo.id, l1, admin.id);
  const after = await prisma.workOrderToOrderLine.findUnique({ where: { id: before.id } });
  check("§1 koparma satırı SİLMEDİ, damga üçlüsü dolu (MANUAL_UNLINK)", res1.data.removed === true && after !== null && after.unlinkedAt !== null && after.unlinkedById === admin.id && after.unlinkReason === "MANUAL_UNLINK", JSON.stringify(after && { r: after.unlinkReason }));
  check("§1 ileri kayıt değişmedi (createdAt · allocatedQty)", after !== null && after.createdAt.getTime() === before.createdAt.getTime() && after.allocatedQty.equals(before.allocatedQty));
  const n1 = await prisma.$transaction((tx) => unlinkOrderLinesTx(tx, { workOrderId: wo.id, orderLineId: l1, reason: "MANUAL_UNLINK", userId: admin.id }));
  check("§1 zaten koparılmış bağa ikinci damga DOKUNMAZ (0)", n1 === 0);
  check("§1 diğer bağ (l2) AÇIK kaldı", (await activeOrderLinkCount(prisma, wo.id)) === 1);

  // ── §2 / §3 ───────────────────────────────────────────────────────────────
  console.log("── §2/§3 Yeniden bağlama + partial unique ──");
  const relink = await workOrderLinkService.linkOrderLines(wo.id, [l1], admin.id);
  const l1Rows = await prisma.workOrderToOrderLine.findMany({ where: { workOrderId: wo.id, orderLineId: l1 }, select: { id: true, unlinkedAt: true } });
  check("§2 ⭐ yeniden bağlama YENİ satır: açık 1 / toplam 2, eski damgalı durdu (un-unlink yok)",
    relink.data.linked === 1 && l1Rows.length === 2 && l1Rows.filter((r) => r.unlinkedAt === null).length === 1 && l1Rows.some((r) => r.id === before.id && r.unlinkedAt !== null),
    JSON.stringify(l1Rows.map((r) => (r.unlinkedAt ? "damgalı" : "açık"))));
  let err3: unknown = null;
  try { await prisma.workOrderToOrderLine.create({ data: { workOrderId: wo.id, orderLineId: l1, allocatedQty: 0 } }); } catch (e) { err3 = e; }
  check("§3 ⭐ ikinci AÇIK bağ yazılamadı — partial unique (P2002)", err3 instanceof Prisma.PrismaClientKnownRequestError && err3.code === "P2002", err3 instanceof Error ? err3.message.split("\n")[0] : "hata yok");
  const relink2 = await workOrderLinkService.linkOrderLines(wo.id, [l1], admin.id);
  check("§3 servisten aynı açık çifti yeniden bağlama NO-OP (alreadyLinked 1, satır sayısı sabit)", relink2.data.linked === 0 && relink2.data.alreadyLinked === 1 && (await prisma.workOrderToOrderLine.count({ where: { workOrderId: wo.id, orderLineId: l1 } })) === 2);

  // ── §4 ────────────────────────────────────────────────────────────────────
  console.log("── §4 Tip aynası açık bağdan ──");
  check("§4 ön koşul — bağlıyken SİPARİŞE ÖZEL", (await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id }, select: { type: true } })).type === "ORDER_PRODUCTION");
  await workOrderLinkService.unlinkOrderLine(wo.id, l2, admin.id);
  const lastUnlink = await workOrderLinkService.unlinkOrderLine(wo.id, l1, admin.id);
  const woAfter = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id }, select: { type: true } });
  check("§4 ⭐ son AÇIK bağ koparılınca STOK'a döndü — koparılmış satırlar (3) tipi tutmuyor",
    lastUnlink.data.typeChanged === true && woAfter.type === "STOCK_PRODUCTION" && (await prisma.workOrderToOrderLine.count({ where: { workOrderId: wo.id } })) === 3 && (await activeOrderLinkCount(prisma, wo.id)) === 0,
    `type=${woAfter.type}`);
  const relink3 = await workOrderLinkService.linkOrderLines(wo.id, [l1], admin.id);
  check("§4 yeniden bağlanınca SİPARİŞE ÖZEL (typeChanged)", relink3.data.typeChanged === true);

  // ── §5 ────────────────────────────────────────────────────────────────────
  console.log("── §5 Sipariş tarafı okurları ──");
  const lineView = await prisma.orderLine.findMany({ where: { orderId: order.id }, select: { id: true, workOrderLinks: { where: ACTIVE_ORDER_LINK, select: { workOrderId: true } } } });
  const l1View = lineView.find((l) => l.id === l1)!; const l2View = lineView.find((l) => l.id === l2)!;
  check("§5 kalem görünümü: l1 açık bağ 1, l2 (koparılmış) 0", l1View.workOrderLinks.length === 1 && l2View.workOrderLinks.length === 0);
  const woCount = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id }, select: { _count: { select: { orderLinks: { where: ACTIVE_ORDER_LINK } } } } });
  check("§5 `_count.orderLinks` süzgeçli 1 (ham satır 4)", woCount._count.orderLinks === 1 && (await prisma.workOrderToOrderLine.count({ where: { workOrderId: wo.id } })) === 4);

  // ── §6 ────────────────────────────────────────────────────────────────────
  console.log("── §6 Refakat kartı sipariş bloğu ──");
  // Yeniden basım snapshot'ı güncel plandan tazeler (Änderungsdruck) — snapshot'taki
  // sipariş bloğu yalnız AÇIK bağdan doğmalı (koparılmış l2 girmemeli).
  await cards.reprint(wo.id, "bekçi §6 — açık bağ snapshot'ı", admin.id);
  const card6 = await prisma.travelerCard.findUniqueOrThrow({ where: { workOrderId: wo.id }, select: { snapshot: true } });
  const planLinks = ((card6.snapshot as { orderLinks?: { orderLineId?: string }[] } | null)?.orderLinks) ?? [];
  check("§6 kart snapshot'ı yalnız AÇIK bağı taşıyor (1: l1)", planLinks.length === 1 && planLinks[0]?.orderLineId === l1, JSON.stringify(planLinks.map((l) => l.orderLineId === l1 ? "l1" : "?")));

  // ── §7 ────────────────────────────────────────────────────────────────────
  console.log("── §7 replace() fark bazlı ──");
  const keptBefore = await prisma.workOrderToOrderLine.findFirstOrThrow({ where: { workOrderId: wo.id, orderLineId: l1, ...ACTIVE_ORDER_LINK }, select: { id: true, createdAt: true } });
  await wos.replace(wo.id, { targetItemId: itemId, width: 300, steps: [{ stationId: station.id }], orderLineAllocations: [{ orderLineId: l1, allocatedQty: 120 }, { orderLineId: l3, allocatedQty: 50 }] }, admin.id);
  const keptAfter = await prisma.workOrderToOrderLine.findUnique({ where: { id: keptBefore.id }, select: { unlinkedAt: true, createdAt: true, allocatedQty: true } });
  check("§7 ⭐ kalan bağ AYNI satırda (id · createdAt korunur), allocatedQty yerinde güncellendi",
    keptAfter !== null && keptAfter.unlinkedAt === null && keptAfter.createdAt.getTime() === keptBefore.createdAt.getTime() && Number(keptAfter.allocatedQty) === 120, JSON.stringify(keptAfter && { q: Number(keptAfter.allocatedQty) }));
  check("§7 giren bağ (l3) yeni satır, açık", (await prisma.workOrderToOrderLine.count({ where: { workOrderId: wo.id, orderLineId: l3, ...ACTIVE_ORDER_LINK } })) === 1);
  await wos.replace(wo.id, { targetItemId: itemId, width: 300, steps: [{ stationId: station.id }], orderLineAllocations: [{ orderLineId: l1, allocatedQty: 120 }] }, admin.id);
  const l3Row = await prisma.workOrderToOrderLine.findFirst({ where: { workOrderId: wo.id, orderLineId: l3 }, select: { unlinkedAt: true, unlinkReason: true } });
  check("§7 çıkan bağ (l3) SİLİNMEDİ — WO_REPLACE damgası", l3Row !== null && l3Row.unlinkedAt !== null && l3Row.unlinkReason === "WO_REPLACE", JSON.stringify(l3Row));

  // ── §1b ───────────────────────────────────────────────────────────────────
  console.log("── §1b Seçicisiz koparma YASAK ──");
  const acikOnce = await prisma.workOrderToOrderLine.count({ where: ACTIVE_ORDER_LINK });
  let err1b: unknown = null;
  try { await prisma.$transaction((tx) => unlinkOrderLinesTx(tx, { reason: "MANUAL_UNLINK" } as never)); } catch (e) { err1b = e; }
  check("§1b ⭐ seçicisiz `unlinkOrderLinesTx` fırlatır, BÜTÜN tabloyu damgalamaz", err1b instanceof Error && /seçici yok/.test(err1b.message) && (await prisma.workOrderToOrderLine.count({ where: ACTIVE_ORDER_LINK })) === acikOnce, `açık önce=${acikOnce}`);

  // ── §8 ────────────────────────────────────────────────────────────────────
  console.log("── §8 withActiveOrderLinks: Date/Decimal düğümleri BİREBİR korunur ──");
  const d0 = new Date("2026-09-01T00:00:00Z");
  const dec = new Prisma.Decimal("12.5");
  const buf = Buffer.from("x");
  const where8 = {
    deadline: { gte: d0 },
    createdAt: { lte: d0 },
    lines: { some: { quantity: { gt: dec }, workOrderLinks: { some: { workOrder: { workOrderNumber: "X" } } } } },
    OR: [{ orderNumber: { contains: "A" } }, { orderLinks: { none: {} } }],
    raw: buf,
  };
  const out8 = withActiveOrderLinks(where8) as typeof where8 & { lines: { some: { workOrderLinks: { some: Record<string, unknown> } } }; OR: Array<Record<string, unknown>> };
  check("§8 ⭐ Date düğümü aynen (referans korunur, {} olmadı)", out8.deadline.gte === d0 && out8.createdAt.lte === d0);
  check("§8 ⭐ Decimal ve Buffer aynen", out8.lines.some.quantity.gt === dec && out8.raw === buf);
  check("§8 workOrderLinks.some aktif yüklem aldı", out8.lines.some.workOrderLinks.some.unlinkedAt === null && (out8.lines.some.workOrderLinks.some.workOrder as { workOrderNumber: string }).workOrderNumber === "X");
  check("§8 orderLinks.none de aktif yüklem aldı", (out8.OR[1] as { orderLinks: { none: Record<string, unknown> } }).orderLinks.none.unlinkedAt === null);
  // Gerçek uç bu bekçide ÖLÇÜLMEZ: `getOrderStats` çağrısı eski walk altında da yeşil kaldı
  // (sessiz yeşil — ölçüldü 2026-09-14); ısıran bekçi `test_order_stats` (tarih süzgeci
  // `{ gte: Date }` → Prisma `_ref`), siparis koşum listesinde.

  astKontrolleri();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

/** Süzülmeyen okur BEKLENMİYOR — istisna kümesi boş; yeni istisna kırmızı. */
const BEKLENEN_ISTISNA_DOSYALARI = new Set<string>([]);

function astKontrolleri(): void {
  const kok = join(__dirname, "..");
  const r = aktifYuklemTara(kok, [{
    delegate: "workOrderToOrderLine", model: "WorkOrderToOrderLine", sabit: "ACTIVE_ORDER_LINK",
    tablo: "work_order_to_order_lines", helper: join("src", "services", "helpers", "order-link.helper.ts"),
  }]).get("workOrderToOrderLine")!;
  // Zeminler BU tablo için ölçüldü (2026-09-14): çağrı 15 · ilişki 24 · ham SQL 0 (=== 0).
  check("§13a ⭐ `src/`de `workOrderToOrderLine.delete*` KALMADI", r.silme.length === 0, r.silme.join(", "));
  check("§13b her okuma/güncelleme çağrısı ACTIVE_ORDER_LINK taşır ya da gerekçeli istisnadır", r.cagriSayisi >= 12 && r.cagriIhlal.length === 0, `çağrı=${r.cagriSayisi}${r.cagriIhlal.length ? " İHLAL: " + r.cagriIhlal.join(", ") : ""}`);
  check("§13c her ilişki süzgeci / iç içe okuması aktif yüklemi taşır (every YOK)", r.iliskiSayisi >= 20 && r.iliskiIhlal.length === 0, `ilişki=${r.iliskiSayisi}${r.iliskiIhlal.length ? " İHLAL: " + r.iliskiIhlal.join(", ") : ""}`);
  check("§13d ham SQL başvurusu YOK (=== 0)", r.sqlSayisi === 0 && r.sqlIhlal.length === 0, `sql=${r.sqlSayisi}`);
  const istisnaDosyalari = new Set(r.istisnalar.map((y) => y.split(":")[0]));
  const beklenmeyen = [...istisnaDosyalari].filter((d) => !BEKLENEN_ISTISNA_DOSYALARI.has(d));
  check("§13e istisna kümesi boş (sessiz yeni muaf yok)", beklenmeyen.length === 0 && r.istisnalar.length === 0, `beklenmeyen=[${beklenmeyen.join(", ")}]`);
}

async function cleanup(): Promise<void> {
  try {
    if (woIds.length) {
      await prisma.systemLog.deleteMany({ where: { recordId: { in: woIds } } });
      await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: woIds } } } });
      await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    }
    if (stationIds.length) await prisma.station.deleteMany({ where: { id: { in: stationIds } } });
    if (orderIds.length) {
      await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
