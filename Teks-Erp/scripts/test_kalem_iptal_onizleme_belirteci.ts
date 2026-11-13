// =============================================================================
// BEKÇİ — KALEM İPTALİ ÖNİZLEME BELİRTECİ (patron telefonu, 2026-11-13)
// =============================================================================
// Koşum: DATABASE_URL='postgresql://…/<ad>_test' npx tsx scripts/test_kalem_iptal_onizleme_belirteci.ts
//
//   §1 ⭐ belirteçsiz eski davranış: iptal geçer, önizleme `previewToken` taşır (lc1.)
//   §2 doğru belirteçle geçer: kalem iptal, iş emri bağı kopar
//   §3 ⭐ önizlemeden sonra kaleme iş emri BAĞLANDI (sürüm ilerlemez) → 409 CANCEL_PREVIEW_STALE, kalem açık, bağ duruyor
//   §4 aynı siparişin BAŞKA kalemi değişti → 409; iş emri durumu değişti → 409
//   §5 bozuk belirteç 409; aynı belirteçle tekrar (ilk deneme işlemiş) iptal edilmiş kalemi yeniden yazmaz
//   §6 ⭐ elle açık tx kalemleri kilitleyip bağ eklerken bekleyen iptal, kilit bırakılınca STALE alır
//
// ⭐ NEGATİF SONDA (2026-11-13, ölçüldü): `cancelOrderLine` içindeki `await previewGuard(tx)` kaldırıldı →
//    §6 ❌ (kilit arkasındaki yarış yakalanmadı); `guardLineCancelPreview` no-op yapıldı → §3b §3c §4a §4b §5a ❌.
//    Geri alındı.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { orderService } from "../src/routes/order.routes";
import { ACTIVE_ORDER_LINK } from "../src/services/helpers/order-link.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const TAG = `TST-KIB-${process.pid}`;
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
async function sonuc(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "geçti";
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string }; message?: string };
    if (!err.statusCode) return String(err.message).slice(0, 120);
    return err.details?.code ? `${err.statusCode}:${err.details.code}` : String(err.statusCode);
  }
}
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function kilitteBekleyen(): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    const r = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(r[0]?.n ?? 0) > 0) return true;
    await bekle(100);
  }
  return false;
}

const woIds: string[] = [];

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== KALEM İPTALİ ÖNİZLEME BELİRTECİ BEKÇİSİ ===\n");
  try {
    const customer = await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} müşteri` }, select: { id: true } });
    const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } });
    let seq = 0;
    const siparis = async () =>
      prisma.order.create({
        data: { orderNumber: `${TAG}-${++seq}`, customerId: customer.id, status: "APPROVED", lines: { create: [{ itemId: item.id, quantity: 100 }, { itemId: item.id, quantity: 200 }] } },
        select: { id: true, lines: { select: { id: true }, orderBy: { quantity: "asc" } } },
      });
    const isEmri = async (lineId: string) => {
      const wo = await prisma.workOrder.create({
        data: { workOrderNumber: `${TAG}-IE${++seq}`, type: "ORDER_PRODUCTION", status: "PLANNED", targetItemId: item.id, orderLinks: { create: [{ orderLineId: lineId }] } },
        select: { id: true },
      });
      woIds.push(wo.id);
      return wo.id;
    };
    const belirtec = async (o: string, l: string) => ((await orderService.getLineCancelPreview(o, l)).data as { previewToken: string | null }).previewToken;
    const iptalMi = async (l: string) => (await prisma.orderLine.findUniqueOrThrow({ where: { id: l }, select: { cancelledAt: true } })).cancelledAt !== null;
    const acikBag = (wo: string) => prisma.workOrderToOrderLine.count({ where: { workOrderId: wo, ...ACTIVE_ORDER_LINK } });

    console.log("── §1 belirteçsiz eski davranış ──");
    const o1 = await siparis();
    const t1 = await belirtec(o1.id, o1.lines[0]!.id);
    check("§1a önizleme `previewToken` taşır (lc1.)", typeof t1 === "string" && t1.startsWith("lc1."), String(t1));
    check("§1b belirteçsiz iptal geçer", (await sonuc(() => orderService.cancelOrderLine(o1.id, o1.lines[0]!.id))) === "geçti" && (await iptalMi(o1.lines[0]!.id)));
    check("§1c `expectedPreviewToken: null` = gönderilmemiş", (await sonuc(() => orderService.cancelOrderLine(o1.id, o1.lines[1]!.id, undefined, { expectedPreviewToken: null }))) === "geçti");

    console.log("\n── §2 doğru belirteç ──");
    const o2 = await siparis();
    const wo2 = await isEmri(o2.lines[0]!.id);
    const t2 = await belirtec(o2.id, o2.lines[0]!.id);
    check("§2a doğru belirteçle geçer", (await sonuc(() => orderService.cancelOrderLine(o2.id, o2.lines[0]!.id, undefined, { expectedPreviewToken: t2 }))) === "geçti");
    check("§2b kalem iptal, bağ koptu", (await iptalMi(o2.lines[0]!.id)) && (await acikBag(wo2)) === 0);

    console.log("\n── §3 önizlemeden sonra iş emri bağlandı ──");
    const o3 = await siparis();
    const t3 = await belirtec(o3.id, o3.lines[0]!.id);
    const v3 = (await prisma.orderLine.findUniqueOrThrow({ where: { id: o3.lines[0]!.id }, select: { updatedAt: true } })).updatedAt.getTime();
    const wo3 = await isEmri(o3.lines[0]!.id);
    const v3b = (await prisma.orderLine.findUniqueOrThrow({ where: { id: o3.lines[0]!.id }, select: { updatedAt: true } })).updatedAt.getTime();
    check("§3a (ön koşul) bağ kalemin sürümünü ilerletmedi — yalnız belirteç yakalar", v3 === v3b && (await belirtec(o3.id, o3.lines[0]!.id)) !== t3);
    check("§3b bayat belirteç 409 CANCEL_PREVIEW_STALE", (await sonuc(() => orderService.cancelOrderLine(o3.id, o3.lines[0]!.id, undefined, { expectedPreviewToken: t3 }))) === "409:CANCEL_PREVIEW_STALE");
    check("§3c hiçbir şey uygulanmadı: kalem açık, bağ duruyor", !(await iptalMi(o3.lines[0]!.id)) && (await acikBag(wo3)) === 1);

    console.log("\n── §4 başka kalem / iş emri durumu değişti ──");
    const o4 = await siparis();
    const t4 = await belirtec(o4.id, o4.lines[0]!.id);
    await bekle(5);
    await prisma.orderLine.update({ where: { id: o4.lines[1]!.id }, data: { quantity: 250 } });
    check("§4a başka kalem değişti → 409", (await sonuc(() => orderService.cancelOrderLine(o4.id, o4.lines[0]!.id, undefined, { expectedPreviewToken: t4 }))) === "409:CANCEL_PREVIEW_STALE");
    const o4b = await siparis();
    const wo4 = await isEmri(o4b.lines[0]!.id);
    const t4b = await belirtec(o4b.id, o4b.lines[0]!.id);
    await prisma.workOrder.update({ where: { id: wo4 }, data: { status: "IN_PROGRESS" } });
    check("§4b iş emri durumu değişti → 409", (await sonuc(() => orderService.cancelOrderLine(o4b.id, o4b.lines[0]!.id, undefined, { expectedPreviewToken: t4b }))) === "409:CANCEL_PREVIEW_STALE");

    console.log("\n── §5 bozuk belirteç · tekrar ──");
    const o5 = await siparis();
    check("§5a bozuk belirteç 409", (await sonuc(() => orderService.cancelOrderLine(o5.id, o5.lines[0]!.id, undefined, { expectedPreviewToken: "lc1.bozuk" }))) === "409:CANCEL_PREVIEW_STALE" && !(await iptalMi(o5.lines[0]!.id)));
    const t5 = await belirtec(o5.id, o5.lines[0]!.id);
    await orderService.cancelOrderLine(o5.id, o5.lines[0]!.id, undefined, { expectedPreviewToken: t5 });
    const d5 = (await prisma.orderLine.findUniqueOrThrow({ where: { id: o5.lines[0]!.id }, select: { cancelledAt: true } })).cancelledAt!.getTime();
    const tekrar = await sonuc(() => orderService.cancelOrderLine(o5.id, o5.lines[0]!.id, undefined, { expectedPreviewToken: t5 }));
    const d5b = (await prisma.orderLine.findUniqueOrThrow({ where: { id: o5.lines[0]!.id }, select: { cancelledAt: true } })).cancelledAt!.getTime();
    check("§5b aynı belirteçle tekrar reddedilir, iptal damgası değişmez", tekrar !== "geçti" && d5 === d5b, tekrar);

    console.log("\n── §6 kilit arkasında bekleyen iptal ──");
    const o6 = await siparis();
    const t6 = await belirtec(o6.id, o6.lines[0]!.id);
    let bekleyen: Promise<string> | null = null;
    let kilitte = false;
    await prisma.$transaction(async (tx) => {
      // Bağ yaratan yolun FK kilidi: kalem satırını tut, iptal başlasın, sonra bağı ekle.
      await tx.$queryRaw`SELECT id FROM order_lines WHERE id = ${o6.lines[0]!.id}::uuid FOR KEY SHARE`;
      bekleyen = sonuc(() => orderService.cancelOrderLine(o6.id, o6.lines[0]!.id, undefined, { expectedPreviewToken: t6 }));
      kilitte = await kilitteBekleyen();
      const wo = await tx.workOrder.create({
        data: { workOrderNumber: `${TAG}-IE-YARIS`, type: "ORDER_PRODUCTION", status: "PLANNED", targetItemId: item.id, orderLinks: { create: [{ orderLineId: o6.lines[0]!.id }] } },
        select: { id: true },
      });
      woIds.push(wo.id);
    });
    const son6 = await bekleyen!;
    check("§6 bekleyen iptal STALE alır, kalem açık kalır", kilitte && son6 === "409:CANCEL_PREVIEW_STALE" && !(await iptalMi(o6.lines[0]!.id)), `kilitte=${kilitte} · ${son6}`);
  } finally {
    const orders = await prisma.order.findMany({ where: { orderNumber: { startsWith: TAG } }, select: { id: true, lines: { select: { id: true } } } });
    const recIds = orders.flatMap((o) => [o.id, ...o.lines.map((l) => l.id)]);
    if (recIds.length) await prisma.systemLog.deleteMany({ where: { recordId: { in: recIds } } });
    if (woIds.length) await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { workOrderNumber: { startsWith: TAG } } });
    await prisma.order.deleteMany({ where: { orderNumber: { startsWith: TAG } } });
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.item.deleteMany({ where: { code: { startsWith: TAG } } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
